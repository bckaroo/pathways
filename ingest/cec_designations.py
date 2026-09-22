#!/usr/bin/env python3
"""Ingest CEC designations + Advanced (v3.0) star status into Postgres.

Source: NYSERDA Clean Energy Communities map/scorecard (bi.nyserda.ny.gov
Tableau workbooks CECMap / CECScorecard, program CLOSED — data frozen):
  - CECMap "Data Table" worksheet, logical table vCEC_PROJECTS
    -> one row per CEC-tracked municipality (942 at the 2026-09-21 snapshot)
    with CEC status, Advanced (v3.0) star designation, community id/size,
    county, region, population and a representative HIA.
  - CECMap "New Map sheet" worksheet, logical table vCEC_PROJECT_POINT_TOTALS
    -> star-rating thresholds (last/next/till-next), census GeoID,
    points achieved (new/old/total), latest approved HIA date.

Raw table payloads are cached under ingest/data/raw/cec/ with a download
timestamp; re-runs use the cache unless --refresh is passed. Idempotent:
municipality match-or-insert (see cec_db.py) + upserts on municipality_uid.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from cec_db import (
    load_municipality_index,
    match_municipality,
    parse_cec_name,
    synthetic_uid_for_cec,
    upsert_cec_designation,
    upsert_municipality,
    upsert_program,
)
from cec_tableau import (
    CEC_MAP_URL,
    TableauSession,
    fetch_underlying_table,
    get_logical_table_ids,
    open_dashboard,
)
from db import connect

RAW_DIR = Path(__file__).resolve().parent / "data" / "raw" / "cec"

WORKBOOK, VIEW = "CECMap", "CECInteractiveMap"

# Cells use "%null%"/"null"/"" for missing values.
NULLS = {"%null%", "null", "", "None"}


def _cell(value) -> str | None:
    text = str(value).strip() if value is not None else ""
    return None if text.lower() in NULLS else text


def _int(value) -> int | None:
    text = _cell(value)
    if text is None:
        return None
    return int(text.replace(",", "").replace(" ", ""))


def _date(value) -> str | None:
    text = _cell(value)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    print(f"[designations] WARN unparseable date: {text!r}")
    return None


def _fetch_or_cache(table_caption_fragment: str, worksheet: str, cache_name: str, refresh: bool) -> dict:
    cache_path = RAW_DIR / cache_name
    if cache_path.exists() and not refresh:
        print(f"[designations] using cached table: {cache_path}")
        return json.loads(cache_path.read_text())
    ts: TableauSession = open_dashboard(WORKBOOK, VIEW, referer=CEC_MAP_URL)
    try:
        ids = get_logical_table_ids(ts, worksheet)
        table_id = next(
            (tid for caption, tid in ids.items() if table_caption_fragment in caption),
            None,
        )
        if table_id is None:
            raise SystemExit(f"[designations] table {table_caption_fragment!r} not found in {worksheet}: {list(ids)}")
        df = fetch_underlying_table(ts, worksheet, table_id)
    finally:
        ts.session.close()
    payload = {
        "source_url": CEC_MAP_URL,
        "workbook": WORKBOOK,
        "worksheet": worksheet,
        "table_id": table_id,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "columns": list(df.columns),
        "rows": df.values.tolist(),
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(payload, ensure_ascii=False))
    print(f"[designations] cached {len(payload['rows'])} rows -> {cache_path}")
    return payload


def as_frame(payload: dict):
    import pandas as pd

    return pd.DataFrame(payload["rows"], columns=payload["columns"])


def load_projects(refresh: bool = False):
    """vCEC_PROJECTS (community-grain, 942 rows) — cached, used by other scripts."""
    return as_frame(_fetch_or_cache("vCEC_PROJECTS", "Data Table", "2026-09-21-cec-vCEC_PROJECTS.json", refresh))


def load_point_totals(refresh: bool = False):
    return as_frame(
        _fetch_or_cache(
            "vCEC_PROJECT_POINT_TOTALS", "New Map sheet", "2026-09-21-cec-vCEC_PROJECT_POINT_TOTALS.json", refresh
        )
    )


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download the Tableau tables even if cached")
    args = ap.parse_args()

    projects = load_projects(args.refresh)
    totals = load_point_totals(args.refresh)
    if len(projects) == 0 or len(totals) == 0:
        raise SystemExit("[designations] empty source tables")

    totals_by_name = {}
    for _, r in totals.iterrows():
        totals_by_name[str(r["Community Name"]).strip()] = r

    cec_source_url = CEC_MAP_URL
    matched = Counter()
    inserted_new = 0
    unmatched_examples = []
    status_counts = Counter()
    star_counts = Counter()
    designation_status_counts = Counter()
    missing_totals = 0

    with connect() as conn:
        index = load_municipality_index(conn)
        upsert_program(conn, cec_source_url)
        for _, r in projects.iterrows():
            community_name = str(r["Community Name"]).strip()
            community_id = _cell(r["Community Id"])
            county = _cell(r["County"])
            status = _cell(r["Cec Status Desc"]) or "Unknown"
            status_counts[status] += 1
            star = _cell(r["Advanced (v3.0) Designation"])
            star_counts[star or "(none)"] += 1

            uid, area_type, core = match_municipality(index, community_name, county)
            if uid is None:
                syn = synthetic_uid_for_cec(community_id or "")
                if syn is None:
                    unmatched_examples.append(community_name)
                    continue
                area_type_cec, _core = parse_cec_name(community_name)
                if area_type == "county":
                    display_name = f"{core.title()} County"
                elif area_type:
                    type_word = area_type.capitalize()
                    display_name = f"{core}, {type_word} ({county})"
                else:
                    display_name = community_name
                upsert_municipality(
                    conn, syn, display_name, area_type, county, cec_source_url
                )
                uid = syn
                inserted_new += 1
                matched["inserted"] += 1
            else:
                matched["matched"] += 1

            t = totals_by_name.get(community_name)
            if t is None:
                missing_totals += 1
                print(f"[designations] WARN no point-totals row for {community_name!r}")
            row = {
                "municipality_uid": uid,
                "cec_community_id": community_id,
                "status": status,
                "designation_status": _cell(t["Designation Status"]) if t is not None else None,
                "advanced_designation": star,
                "star_rating": _cell(t["Star Rating"]) if t is not None else None,
                "community_size": _cell(r["Community Size"]),
                "region": _cell(r["Region"]),
                "geo_id": _cell(t["Geoid Join"]) if t is not None else None,
                "population": _int(r["Population"]),
                "hias_approved": _int(t["Advanced (v3.0) HIAs Approved"]) if t is not None else None,
                "points_achieved_new": _int(t["Points Achieved New"]) if t is not None else None,
                "points_achieved_old": _int(t["Points Achieved Old"]) if t is not None else None,
                "points_achieved_total": _int(t["Points Achieved Total"]) if t is not None else None,
                "current_star_status": _cell(t["Current Star Status"]) if t is not None else None,
                "last_threshold": _int(t["Last Threshold"]) if t is not None else None,
                "next_threshold": _int(t["Next Threshold"]) if t is not None else None,
                "till_next_star": _int(t["Till next star"]) if t is not None else None,
                "latest_action_approved_on": _date(t["HIA_LATEST_APPROVED_DATE"]) if t is not None else None,
                "source_url": cec_source_url,
            }
            designation_status_counts[row["designation_status"] or "(none)"] += 1
            upsert_cec_designation(conn, row)

        # self-heal CEC-only county rows created by earlier runs with a doubled
        # "... County County" display name (match_municipality used to return
        # the core already suffixed with " County")
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE municipalities SET name = county || ' County', updated_at = now()
                WHERE portal_uid < 0 AND area_type = 'county' AND county IS NOT NULL
                  AND name <> county || ' County'
                """
            )
            healed = cur.rowcount
        conn.commit()

    print(f"[designations] municipalities matched to CSC portal rows: {matched['matched']}")
    print(f"[designations] CEC-only municipalities inserted (synthetic negative uids): {inserted_new}")
    print(f"[designations] county display names self-healed: {healed}")
    print(f"[designations] rows missing point-totals match: {missing_totals}")
    print(f"[designations] status: {dict(status_counts)}")
    print(f"[designations] designation_status: {dict(designation_status_counts)}")
    print(f"[designations] advanced stars: {dict(star_counts)}")
    if unmatched_examples:
        print(f"[designations] WARN unmatched communities without CEC id: {unmatched_examples[:10]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())