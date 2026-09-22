#!/usr/bin/env python3
"""Ingest the CEC High-Impact Action points table (NYSERDA) into `actions`.

Source: https://www.nyserda.ny.gov/All-Programs/Clean-Energy-Communities/High-Impact-Actions
The CEC program is CLOSED — the page is a frozen historical record. It
publishes the HIA list at CATEGORY level: 15 sections titled
"<Category>: Up to <N> points" (three are fixed-point). Individual tiered HIAs
(e.g. "Clean Energy Upgrades -Tier 2") are not itemized on the page; the
authoritative individual-level list comes from the completions dataset
(cec_completions.py), which also derives per-action points.

Category rows are stored with external_id = "category-" + slug so they can
never collide with individual-action external_ids (plain slug of the name).
Idempotent: upsert on (program_slug='cec', external_id).
"""

from __future__ import annotations

import argparse
import html
import re
import sys
from pathlib import Path

import requests

from cec_db import upsert_program, upsert_cec_action
from db import BROWSER_UA, connect, slugify

HIA_PAGE_URL = (
    "https://www.nyserda.ny.gov/All-Programs/Clean-Energy-Communities/High-Impact-Actions"
)
RAW_DIR = Path(__file__).resolve().parent / "data" / "raw"
HIA_CACHE = RAW_DIR / "2026-09-21-cec-hia-page.html"

HIA_RE = re.compile(r"^(.+?):\s*(Up to\s*)?([\d,]+)\s+Points\s*$", re.I)


def download(refresh: bool) -> str:
    if HIA_CACHE.exists() and not refresh:
        print(f"[hia] using cached download: {HIA_CACHE}")
        return HIA_CACHE.read_text(encoding="utf-8", errors="replace")
    print(f"[hia] downloading {HIA_PAGE_URL}")
    resp = requests.get(HIA_PAGE_URL, headers={"User-Agent": BROWSER_UA}, timeout=60)
    resp.raise_for_status()
    HIA_CACHE.parent.mkdir(parents=True, exist_ok=True)
    HIA_CACHE.write_bytes(resp.content)
    return resp.text


def parse_categories(page_html: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for raw in re.findall(r"<h3[^>]*>(.*?)</h3>", page_html, re.S):
        text = html.unescape(re.sub(r"<[^>]+>", "", raw))
        text = re.sub(r"\s+", " ", text).strip()
        m = HIA_RE.match(text)
        if not m:
            continue
        name = m.group(1).strip()
        key = name.casefold()
        if key in seen:
            print(f"[hia] WARN duplicate category heading skipped: {name!r}")
            continue
        seen.add(key)
        up_to = bool(m.group(2))
        points = int(m.group(3).replace(",", ""))
        out.append(
            {
                "name": name,
                "points_display": ("Up to " if up_to else "") + f"{points:,} points",
                "points_min": None if up_to else points,
                "points_max": points,
                "variable_points": up_to,
            }
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download the HIA page even if cached")
    args = ap.parse_args()

    categories = parse_categories(download(args.refresh))
    if not categories:
        raise SystemExit("[hia] no HIA categories parsed — page format changed?")

    with connect() as conn:
        upsert_program(conn, HIA_PAGE_URL)
        for c in categories:
            upsert_cec_action(
                conn,
                external_id=f"category-{slugify(c['name'])}",
                name=c["name"],
                pledge_element="HIA",
                points_min=c["points_min"],
                points_max=c["points_max"],
                points_display=c["points_display"],
                variable_points=c["variable_points"],
                status_tags=["category"],
                source_url=HIA_PAGE_URL,
            )
        conn.commit()

    print(f"[hia] ingested {len(categories)} HIA categories:")
    for c in categories:
        print(f"    {c['name']}: {c['points_display']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())