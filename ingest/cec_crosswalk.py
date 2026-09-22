#!/usr/bin/env python3
"""Ingest the official CEC/CSC crosswalk PDF into the `crosswalk` table.

Source: https://climatesmart.ny.gov/fileadmin/csc/documents/CEC_CSC_Crosswalk/2024-12-20-CEC-CSC-Crosswalk.pdf
(PDF dated 2024-12-20, 2 pages; fetched 2026-09-21 — CEC program closed, frozen.)

The PDF is a two-column ruled table: left = CEC High-Impact Action bullets,
right = the equivalent CSC Certification Action ("PE3 Action: ..."). The
table's ruling rectangles let pdfplumber's default find_tables() extract exact
cells: one row per CSC action group, containing 1+ CEC bullets in the left
cell.

Rows are matched against the action libraries: the CSC side via
(pledge_element, normalized name) and the CEC side via normalized name.
Unmatched ids stay NULL with the raw names preserved (never dropped).
Idempotency: the crosswalk table is fully rebuilt per run (delete + insert)
since it is a pure derived mapping of one static PDF.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import pdfplumber

from cec_db import upsert_crosswalk_row
from db import connect, normalize_action_name

RAW_DIR = Path(__file__).resolve().parent / "data" / "raw"
CROSSWALK_CACHE = RAW_DIR / "2026-09-21-CEC-CSC-Crosswalk.pdf"
CROSSWALK_URL = (
    "https://climatesmart.ny.gov/fileadmin/csc/documents/CEC_CSC_Crosswalk/"
    "2024-12-20-CEC-CSC-Crosswalk.pdf"
)

CSC_ACTION_RE = re.compile(r"^(PE\d+|Innovation|Performance)\s+Action:\s*(.*)$")


def parse_pdf(path: Path) -> list[tuple[str, str]]:
    """Extract (cec_hia_name, csc_action_text) pairs via the PDF's ruled table.

    The crosswalk table has ruling rectangles, so pdfplumber's default line
    strategy yields exact 2-column cells: one row per CSC action group, with
    that group's CEC bullets in the left cell (one "• ..." line per bullet;
    wrapped bullet lines carry no bullet marker and continue the previous
    bullet).
    """
    pairs: list[tuple[str, str]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            for table in page.find_tables():
                for row in table.extract():
                    if not row or len(row) < 2:
                        continue
                    left = " ".join((row[0] or "").split())
                    right = " ".join((row[1] or "").split())
                    if left.startswith("CEC High-Impact"):
                        continue  # header row
                    if not right:
                        continue
                    raw_lines = [ln.strip() for ln in (row[0] or "").split("\n") if ln.strip()]
                    bullets: list[str] = []
                    for ln in raw_lines:
                        if ln.startswith("•"):
                            bullets.append(ln[1:].strip())
                        elif bullets:
                            bullets[-1] = (bullets[-1] + " " + ln).strip()
                    for b in bullets:
                        pairs.append((b, right))
    return pairs


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download the PDF even if cached")
    args = ap.parse_args()

    if not CROSSWALK_CACHE.exists() or args.refresh:
        import requests

        from db import BROWSER_UA

        print(f"[crosswalk] downloading {CROSSWALK_URL}")
        resp = requests.get(CROSSWALK_URL, headers={"User-Agent": BROWSER_UA}, timeout=60)
        resp.raise_for_status()
        CROSSWALK_CACHE.parent.mkdir(parents=True, exist_ok=True)
        CROSSWALK_CACHE.write_bytes(resp.content)

    raw_pairs = parse_pdf(CROSSWALK_CACHE)

    # load action libraries for id mapping
    csc_by_key: dict[tuple[str, str], str] = {}
    cec_by_norm: dict[str, tuple[str, str]] = {}
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT external_id, name, pledge_element FROM actions WHERE program_slug = 'csc'"
            )
            for ext, name, pe in cur.fetchall():
                csc_by_key[(pe, normalize_action_name(name))] = ext
            cur.execute(
                "SELECT external_id, name FROM actions WHERE program_slug = 'cec' "
                "AND NOT (status_tags @> '\"category\"'::jsonb)"
            )
            for ext, name in cur.fetchall():
                cec_by_norm.setdefault(normalize_action_name(name), (ext, name))

        # dedupe (identical bullet repeated in the PDF, e.g. the CCA line)
        seen: set[tuple[str, str]] = set()
        rows = []
        dupes = 0
        unmatched_csc = 0
        unmatched_cec = 0
        for cec_name, csc_text in raw_pairs:
            if not cec_name:
                continue
            key = (normalize_action_name(cec_name), normalize_action_name(csc_text))
            if key in seen:
                dupes += 1
                continue
            seen.add(key)

            csc_ext = None
            csc_note = ""
            m = CSC_ACTION_RE.match(csc_text or "")
            if m:
                pe, csc_name = m.group(1), m.group(2).strip()
                csc_ext = csc_by_key.get((pe, normalize_action_name(csc_name)))
                if csc_ext is None:
                    unmatched_csc += 1
                    csc_note = f"CSC action not found in checklist library: {csc_text}"
            else:
                unmatched_csc += 1
                csc_note = f"unparsed CSC cell: {csc_text!r}"

            cec_hit = cec_by_norm.get(normalize_action_name(cec_name))
            cec_ext = cec_hit[0] if cec_hit else None
            if cec_ext is None:
                unmatched_cec += 1

            note = "; ".join(x for x in (csc_note,) if x) or None
            rows.append(
                {
                    "csc_action_external_id": csc_ext,
                    "cec_hia_id": cec_ext,
                    "cec_hia_name": cec_name,
                    "note": note,
                    "source_url": CROSSWALK_URL,
                }
            )

        with conn.cursor() as cur:
            cur.execute("DELETE FROM crosswalk")
            for row in rows:
                upsert_crosswalk_row(conn, row)
        conn.commit()

    print(f"[crosswalk] parsed {len(raw_pairs)} raw bullet pairs -> {len(rows)} unique rows (dupes dropped: {dupes})")
    print(f"[crosswalk] rows with unmapped CSC id: {unmatched_csc}; unmapped CEC id: {unmatched_cec}")
    for row in rows[:8]:
        print(f"    {row['cec_hia_name']!r} -> {row['csc_action_external_id']} ({row['cec_hia_id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())