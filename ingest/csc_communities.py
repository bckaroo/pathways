#!/usr/bin/env python3
"""Ingest CSC participating communities from the official portal into Postgres.

Data path (all via climatesmart.ny.gov, TYPO3 + CloudFront — browser UA required):
  1. GET /actions-certification/participating-communities?type=1336777439
     -> JSON applicant list (all registered communities, coords, county, level)
  2. GET ...?type=1336777440&tx_sjcert_certificationrest[applicant]=<uid>
     -> JSON certification records (level, points approved, report URL)
  3. GET the certification report page -> parsed completed actions w/ points

Idempotent: upserts keyed on portal uids / natural keys. Verification at the
end compares against the portal's own public stats (478 registered / 185
certified / 7,956 actions completed as of 2026-09-21).
"""

from __future__ import annotations

import argparse
import re
import sys
import time
from datetime import date, datetime

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from db import (
    BROWSER_UA,
    CSC_BASE_URL,
    LEVEL_NAMES,
    connect,
    normalize_action_name,
    upsert_certification,
    upsert_completion,
    upsert_municipality,
    upsert_program,
    seed_certification_levels,
)

PAGE_URL = f"{CSC_BASE_URL}/actions-certification/participating-communities"
APPLICANTS_URL = f"{PAGE_URL}?type=1336777439"
CERT_URL = f"{PAGE_URL}?type=1336777440"

# Portal public stats observed 2026-09-21 (header widget on the communities page).
PORTAL_STATS = {"registered": 478, "certified": 185, "actions_completed": 7956}

ACTION_LINE_RE = re.compile(r"^(PE\d+\s+Action:|Innovation:|Performance:)\s*(.+)$")
# Reports also list retired/renamed actions in the legacy numbering format,
# e.g. "1.1 Pass a Resolution Adopting the CSC Pledge" (worth 4 pts, held by
# every certified community). Require a points line inside the block for these
# to avoid false positives on address-like text.
LEGACY_ACTION_LINE_RE = re.compile(r"^(\d+\.\d+)\s+(\S.*)$")
POINTS_LINE_RE = re.compile(r"^(\d+)\s+Points$")
PREFIX_RE = re.compile(r"^(PE\d+\s+Action:|Innovation:|Performance:)\s*")


def make_session() -> requests.Session:
    session = requests.Session()
    session.headers.update({"User-Agent": BROWSER_UA, "Accept": "*/*"})
    retry = Retry(
        total=4,
        backoff_factor=1.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET"]),
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


def get_json(session: requests.Session, url: str, params: dict | None = None) -> dict:
    resp = session.get(url, params=params, timeout=60)
    resp.raise_for_status()
    return resp.json()


def get_html(session: requests.Session, url: str) -> str:
    resp = session.get(url, timeout=60)
    resp.raise_for_status()
    return resp.text


def parse_certified_on(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.strptime(str(raw).strip(), "%B %d, %Y").date()
    except ValueError:
        print(f"[communities] WARN unrecognized date: {raw!r}")
        return None


def strip_prefix(value: str) -> str:
    return PREFIX_RE.sub("", value.strip()).strip()


def load_action_lookup(conn) -> dict[str, str]:
    """normalized name -> action external_id, covering current + legacy names."""
    lookup: dict[str, str] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT external_id, name, legacy_action_name FROM actions WHERE program_slug = 'csc'")
        rows = cur.fetchall()
    for external_id, name, legacy_name in rows:
        for candidate in (name, legacy_name):
            if candidate:
                key = normalize_action_name(strip_prefix(candidate))
                lookup.setdefault(key, external_id)
    # Renames observed in certification reports with no matching checklist row.
    # Evidence-backed only (same pledge element + same fixed points):
    # "Local CSC Coordinator" (pre-2025 name, 10 pts) -> "CSC Coordinator" (PE1, 10 pts).
    if "csc coordinator" in lookup:
        lookup["local csc coordinator"] = lookup["csc coordinator"]
    return lookup


def repair_completions(conn, lookup: dict[str, str]) -> int:
    """Re-match stored completions whose action link is NULL (self-healing pass
    so name-normalization/alias improvements apply on re-run without rescraping).
    Returns the number of rows relinked."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, raw_action_name FROM completions WHERE action_external_id IS NULL"
        )
        rows = cur.fetchall()
    relinked = 0
    for row_id, raw_name in rows:
        key = normalize_action_name(strip_prefix(raw_name))
        external_id = lookup.get(key)
        if external_id:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE completions SET action_external_id = %s WHERE id = %s",
                    (external_id, row_id),
                )
            relinked += 1
    return relinked


def _is_action_line(line: str) -> bool:
    return bool(ACTION_LINE_RE.match(line) or LEGACY_ACTION_LINE_RE.match(line))


def parse_completions(html: str) -> list[dict]:
    """Extract completed actions (name, points, summary) from a certification report page."""
    soup = BeautifulSoup(html, "lxml")
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in soup.get_text("\n").splitlines()]
    lines = [ln for ln in lines if ln]

    completions: list[dict] = []
    i = 0
    while i < len(lines):
        is_legacy = bool(LEGACY_ACTION_LINE_RE.match(lines[i])) and not ACTION_LINE_RE.match(lines[i])
        if not _is_action_line(lines[i]):
            i += 1
            continue
        raw_name = lines[i].strip()
        points: int | None = None
        summary_lines: list[str] = []
        in_summary = False
        j = i + 1
        while j < len(lines) and not _is_action_line(lines[j]):
            line = lines[j]
            pm = POINTS_LINE_RE.match(line)
            if pm and points is None:
                points = int(pm.group(1))
            if line == "Program Summary:":
                in_summary = True
            elif in_summary:
                # attachments and document markers end the summary block
                if line in ("pdf", "docx", "xlsx") or len(line) > 500:
                    in_summary = False
                else:
                    summary_lines.append(line)
            j += 1
        # Legacy-format lines lack a distinctive prefix; keep them only when the
        # block contains a points line (every real completed action has one).
        if is_legacy and points is None:
            i = j
            continue
        completions.append(
            {
                "raw_action_name": raw_name,
                "points_awarded": points,
                "summary": " ".join(summary_lines)[:2000] or None,
            }
        )
        i = j
    return completions


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--delay", type=float, default=0.25, help="politeness delay between requests (s)")
    ap.add_argument("--skip-reports", action="store_true", help="skip certification report parsing")
    ap.add_argument("--limit", type=int, default=None, help="process only the first N certified applicants (testing)")
    args = ap.parse_args()

    session = make_session()

    # ---- 1. applicants ------------------------------------------------------
    print("[communities] fetching applicant list ...")
    applicants = get_json(session, APPLICANTS_URL)["applicant"]
    print(f"[communities] applicants payload: {len(applicants)} communities")

    # ---- 2. certifications per certified applicant --------------------------
    with connect() as conn:
        upsert_program(conn, "csc", "Climate Smart Communities", "NYSDEC", "active", CSC_BASE_URL)
        seed_certification_levels(conn, PAGE_URL)

        for a in applicants:
            level = int(a.get("certification_level") or 0)
            cert_uid = a.get("certUid")
            row = {
                "portal_uid": int(a["uid"]),
                "name": str(a["name"]).strip(),
                "area_type": a.get("area_type") or None,
                "county": a.get("county") or None,
                "latitude": float(a["latitude"]) if a.get("latitude") else None,
                "longitude": float(a["longitude"]) if a.get("longitude") else None,
                "certification_level": level,
                "certification_level_name": LEVEL_NAMES.get(level, f"Level {level}"),
                "cert_uid": int(cert_uid) if cert_uid else None,
                "has_gold_star": a.get("has_gold_star") == "1",
                "source_url": PAGE_URL,
            }
            upsert_municipality(conn, row)
        conn.commit()
        print(f"[communities] upserted {len(applicants)} municipalities")

        certified = [a for a in applicants if a.get("certUid")]
        if args.limit:
            certified = certified[: args.limit]
        cert_failures = 0
        reports: list[tuple[int, int, str, int | None]] = []  # cert_uid, muni_uid, report_url, points_approved
        for idx, a in enumerate(certified, start=1):
            try:
                payload = get_json(session, CERT_URL, {"tx_sjcert_certificationrest[applicant]": a["uid"]})
            except Exception as exc:  # noqa: BLE001 — keep going, report failures
                cert_failures += 1
                print(f"[communities] WARN cert fetch failed for applicant {a['uid']}: {exc}")
                continue
            certs = payload.get("certifications") or []
            current_uid = int(a["certUid"])
            for c in certs:
                level_name = c.get("certificationLevelString") or LEVEL_NAMES.get(int(c.get("certificationLevel") or 0), "")
                upsert_certification(
                    conn,
                    {
                        "cert_uid": int(c["uid"]),
                        "municipality_uid": int(a["uid"]),
                        "name": str(c.get("name") or "").strip(),
                        "level": int(c.get("certificationLevel") or 0),
                        "level_name": level_name,
                        "points_approved": c.get("totalPointsApproved"),
                        "certified_on": parse_certified_on(c.get("certifiedOnString")),
                        "report_url": CSC_BASE_URL + c["certificationShowUri"] if c.get("certificationShowUri") else None,
                        "applicant_url": CSC_BASE_URL + payload["applicantObject"]["applicantShowUri"]
                        if payload.get("applicantObject", {}).get("applicantShowUri")
                        else None,
                        "source_url": CERT_URL,
                    },
                )
                if int(c["uid"]) == current_uid and c.get("certificationShowUri"):
                    reports.append(
                        (
                            current_uid,
                            int(a["uid"]),
                            CSC_BASE_URL + c["certificationShowUri"],
                            c.get("totalPointsApproved"),
                        )
                    )
            conn.commit()
            if idx % 25 == 0:
                print(f"[communities] certifications: {idx}/{len(certified)}")
            time.sleep(args.delay)

        if args.skip_reports:
            reports = []
        report_failures = 0
        lookup = load_action_lookup(conn)
        unmatched = 0
        total_completions = 0
        point_mismatches = 0
        relinked = repair_completions(conn, lookup)
        if relinked:
            print(f"[communities] repair pass relinked {relinked} unmatched completions")
        for idx, (cert_uid, muni_uid, report_url, points_approved) in enumerate(reports, start=1):
            try:
                html = get_html(session, report_url)
            except Exception as exc:  # noqa: BLE001
                report_failures += 1
                print(f"[communities] WARN report fetch failed for cert {cert_uid}: {exc}")
                continue
            parsed = parse_completions(html)
            parsed_points = sum(p["points_awarded"] or 0 for p in parsed)
            if points_approved is not None and parsed_points != points_approved:
                point_mismatches += 1
                print(
                    f"[communities] WARN cert {cert_uid}: parsed points {parsed_points} "
                    f"!= approved {points_approved}"
                )
            for p in parsed:
                key = normalize_action_name(strip_prefix(p["raw_action_name"]))
                action_external_id = lookup.get(key)
                if action_external_id is None:
                    unmatched += 1
                upsert_completion(
                    conn,
                    {
                        "certification_uid": cert_uid,
                        "municipality_uid": muni_uid,
                        "action_external_id": action_external_id,
                        "raw_action_name": p["raw_action_name"],
                        "points_awarded": p["points_awarded"],
                        "summary": p["summary"],
                        "source_url": report_url,
                    },
                )
            total_completions += len(parsed)
            if idx % 25 == 0:
                print(f"[communities] reports: {idx}/{len(reports)}")
            time.sleep(args.delay)
        conn.commit()

    # ---- verification vs portal stats ---------------------------------------
    with connect() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM municipalities")
            n_muni = cur.fetchone()[0]
            cur.execute("SELECT certification_level_name, count(*) FROM municipalities GROUP BY 1 ORDER BY 2 DESC")
            muni_breakdown = cur.fetchall()
            cur.execute("SELECT count(*) FROM certifications")
            n_certs = cur.fetchone()[0]
            cur.execute("SELECT level_name, count(*) FROM certifications GROUP BY 1 ORDER BY 2 DESC")
            cert_breakdown = cur.fetchall()
            cur.execute("SELECT count(*) FROM completions")
            n_completions = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM completions WHERE action_external_id IS NULL")
            n_unmatched = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM actions")
            n_actions = cur.fetchone()[0]

    print()
    print("=== ingestion summary ===")
    print(f"municipalities: {n_muni}  (by level: {muni_breakdown})")
    print(f"certifications: {n_certs}  (by level: {cert_breakdown})")
    print(f"actions in library: {n_actions}")
    print(f"completions stored: {n_completions} (unmatched to checklist: {n_unmatched})")
    print()
    print("=== verification vs portal public stats (observed 2026-09-21) ===")
    print(f"registered:      {n_muni:>5} / {PORTAL_STATS['registered']:>5}  {'MATCH' if n_muni == PORTAL_STATS['registered'] else 'MISMATCH'}")
    print(f"certified:       {n_certs:>5} / {PORTAL_STATS['certified']:>5}  {'MATCH' if n_certs == PORTAL_STATS['certified'] else 'MISMATCH'}")
    print(
        f"actions done:    {total_completions:>5} parsed from {len(reports)} certification reports; "
        f"portal claims {PORTAL_STATS['actions_completed']}."
    )
    print(
        "  note: portal total counts completions across ALL registered communities;"
        " public certification reports exist only for currently-certified communities,"
        " so a gap is expected (see README/DEVLOG)."
    )
    print(f"point-sum validation mismatches: {point_mismatches}")
    if cert_failures or report_failures:
        print(f"FAILURES: cert fetch={cert_failures}, report fetch={report_failures}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())