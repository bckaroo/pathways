#!/usr/bin/env python3
"""Ingest completed CEC High-Impact Actions per community into Postgres.

Source: NYSERDA CEC scorecard (bi.nyserda.ny.gov workbook CECScorecard, program
CLOSED — data frozen). The scorecard's underlying vCEC_PROJECTS table is
action-grain (one row per completed HIA: name, parent category, points,
dates) but is filtered by the dashboard's
[Parameters].[Community Name Parameter]. This script sweeps all CEC-tracked
communities (942 at the 2026-09-21 snapshot, from the cached
cec/vCEC_PROJECTS.json produced by cec_designations.py): for each community it
sets the parameter and pulls the underlying action rows.

Per-community payloads are cached under ingest/data/raw/cec/scorecard-actions/
so re-runs only fetch what is missing (--refresh forces re-download). The
parameter switch is verified on every fetch: rows whose Community Name does
not match the requested community are rejected (never mis-attributed).

Idempotent: upserts on (municipality_uid, raw_action_name, completed_on);
the CEC individual action library is (re)derived from the same sweep data.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from cec_db import (
    load_municipality_index,
    match_municipality,
    upsert_cec_action,
    upsert_cec_completion,
)
from cec_tableau import (
    CEC_SCORECARD_URL,
    TableauSession,
    fetch_underlying_table,
    get_logical_table_ids,
    get_parameter_domain,
    open_dashboard,
    set_parameter,
)
from cec_designations import load_projects
from db import connect, normalize_action_name, slugify

WORKBOOK, VIEW = "CECScorecard", "Scorecard"
CACHE_DIR = Path(__file__).resolve().parent / "data" / "raw" / "cec" / "scorecard-actions"

NULLS = {"%null%", "null", "", "None"}
DATE_SENTINEL = "1900-01-01"

# Columns pulled from the underlying table into the compact cache.
ROW_FIELDS = {
    "Community Name": "community_name",
    "Community Id": "community_id",
    "High Impact Action Name": "action_name",
    "High Impact Action Parent Name": "parent",
    "High Impact Action Points Approved": "points_approved",
    "High Impact Action Points Currently Valued": "points_currently_valued",
    "High Impact Action Points Achieved": "points_achieved",
    "High Impact Action Points Eligible": "points_eligible",
    "High Impact Action Stage": "stage",
    "High Impact Action Status": "status",
    "Date Action Approved": "date_approved",
    "Date Action Completed": "date_completed",
    "CEC Status": "cec_status",
    "County": "county",
    "Region": "region",
}


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
    print(f"[completions] WARN unparseable date: {text!r}")
    return None


def extract_rows(df, expected_name: str, accepted: set[str] | None = None) -> tuple[list[dict], str | None]:
    """Convert an underlying fetch into compact rows; reject on community mismatch.

    Community spelling is compared space/case-insensitively against the
    requested name and any alias used for the parameter (e.g. the domain's
    "Town of Au Sable" for the map's "Town of AuSable").
    """
    if "Community Name" not in df.columns:
        return [], "columns missing Community Name"

    if len(df) == 0:
        # parameter-accepted community with zero underlying rows: a valid empty
        # result (e.g. Town of Au Sable has no action rows in the scorecard),
        # not a verification failure
        return [], None

    def key(v: str) -> str:
        return str(v).strip().casefold().replace(" ", "")

    accepted = accepted or {expected_name}
    accepted_keys = {key(v) for v in accepted}
    names = df["Community Name"].map(lambda v: str(v).strip()).unique()
    if len(names) != 1 or key(names[0]) not in accepted_keys:
        return [], f"community mismatch: got {list(names)[:3]} expected {expected_name!r}"
    rows = []
    for _, r in df.iterrows():
        row = {}
        for src, dst in ROW_FIELDS.items():
            row[dst] = _cell(r[src])
        rows.append(row)
    return rows, None


def sweep(communities: list[tuple[str, str]], refresh: bool, delay: float, limit: int | None,
          start: int | None = None, end: int | None = None):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    total_target = sum(
        1 for i, _ in enumerate(communities)
        if (start is None or i >= start) and (end is None or i < end)
    )
    ts: TableauSession | None = None
    param_name: str | None = None
    table_id: str | None = None
    aliases: dict[str, str] = {}

    def ensure_session():
        nonlocal ts, param_name, table_id
        if ts is None:
            ts = open_dashboard(WORKBOOK, VIEW, referer=CEC_SCORECARD_URL)
            param_name, domain = get_parameter_domain(ts)
            # alias map: map-side community name -> domain spelling when the
            # only difference is spacing/case (e.g. "Town of AuSable" ->
            # "Town of Au Sable")
            domain_by_stripped = {d.casefold().replace(" ", ""): d for d in domain}
            for name, _cid in communities:
                if name in domain:
                    continue
                hit = domain_by_stripped.get(name.casefold().replace(" ", ""))
                if hit:
                    aliases[name] = hit
            if aliases:
                print(f"[completions] parameter aliases: {aliases}")
            known = {c for c, _ in communities} | set(aliases.values())
            missing = known - set(domain)
            if missing:
                print(f"[completions] WARN {len(missing)} communities not in parameter domain "
                      f"(e.g. {sorted(missing)[:3]})")
            ids = get_logical_table_ids(ts, "HIA Complete")
            table_id = next((tid for cap, tid in ids.items() if cap == "vCEC_PROJECTS"), None)
            if table_id is None:
                raise SystemExit(f"[completions] vCEC_PROJECTS table not found: {list(ids)}")
            print(f"[completions] session ready; parameter={param_name!r} table={table_id[:24]}...")
        return ts, param_name, table_id

    failures: list[tuple[str, str]] = []
    fetched = 0
    cached = 0
    done = 0
    for idx, (name, cid) in enumerate(communities):
        if start is not None and idx < start:
            continue
        if end is not None and idx >= end:
            continue
        if limit is not None and done >= limit:
            break
        cache_path = CACHE_DIR / f"{slugify(name)}.json"
        payload = None
        if cache_path.exists() and not refresh:
            try:
                payload = json.loads(cache_path.read_text())
            except (json.JSONDecodeError, UnicodeDecodeError) as e:
                # truncated/corrupt cache (e.g. interrupted run) -> re-fetch
                print(f"[completions] WARN unreadable cache {cache_path.name}: {e}; re-fetching")
                cache_path.unlink(missing_ok=True)
        if payload is not None:
            cached += 1
        else:
            rows = None
            err = None
            for attempt in range(3):
                try:
                    ts2, pname, tid = ensure_session()
                    param_value = aliases.get(name, name)
                    set_parameter(ts2, pname, param_value)
                    df = fetch_underlying_table(ts2, "HIA Complete", tid)
                    fetched_rows, mismatch = extract_rows(df, name, accepted={name, param_value})
                    if mismatch is not None:
                        raise RuntimeError(mismatch)
                    rows = fetched_rows
                    break
                except Exception as e:  # session may have expired; recreate and retry
                    err = f"{type(e).__name__}: {str(e)[:160]}"
                    ts = None  # force session recreation
                    time.sleep(1.0 + attempt)
            if rows is None:
                failures.append((name, err or "unknown"))
                print(f"[completions] FAIL {name!r}: {err}")
                done += 1
                continue
            payload = {
                "community": name,
                "community_id": cid,
                "source_url": CEC_SCORECARD_URL,
                "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "rows": rows,
            }
            cache_path.write_text(json.dumps(payload, ensure_ascii=False))
            fetched += 1
            time.sleep(delay)
        done += 1
        if done % 25 == 0 or done == total_target:
            print(f"[completions] progress {done}/{total_target} (fetched {fetched}, cached {cached}, "
                  f"failed {len(failures)})", flush=True)
    return failures, fetched, cached


def load_all_rows() -> list[dict]:
    rows: list[dict] = []
    for p in sorted(CACHE_DIR.glob("*.json")):
        payload = json.loads(p.read_text())
        for r in payload["rows"]:
            r["community"] = payload["community"]
            r["community_id"] = payload.get("community_id")
            rows.append(r)
    return rows


def build_library(rows: list[dict]) -> dict[str, dict]:
    """Group completion rows by normalized action name -> library entries."""
    groups: dict[str, list[dict]] = {}
    for r in rows:
        key = normalize_action_name(r["action_name"] or "")
        if not key:
            continue
        groups.setdefault(key, []).append(r)
    library = {}
    for key, items in groups.items():
        raw_counts = Counter(i["action_name"] for i in items)
        rep_raw = sorted(raw_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        parent_counts = Counter(i["parent"] for i in items if i["parent"])
        parent = sorted(parent_counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if parent_counts else "HIA"
        points = [p for p in (_int(i["points_approved"]) for i in items) if p is not None]
        distinct = sorted(set(points))
        variable = len(distinct) > 1
        pmin = distinct[0] if distinct else None
        pmax = distinct[-1] if distinct else None
        display = (
            f"{pmin} - {pmax}" if variable and pmin is not None
            else str(pmax) if pmax is not None else ""
        )
        library[key] = {
            "external_id": slugify(key),
            "name": rep_raw,
            "parent": parent,
            "points_min": pmin,
            "points_max": pmax,
            "points_display": display,
            "variable_points": variable,
        }
    return library


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-fetch even cached communities")
    ap.add_argument("--limit", type=int, default=None, help="sweep only the first N communities (testing)")
    ap.add_argument("--start", type=int, default=None, help="skip communities before this index (parallel workers)")
    ap.add_argument("--end", type=int, default=None, help="stop before this index (parallel workers)")
    ap.add_argument("--delay", type=float, default=0.15, help="seconds between fetches")
    ap.add_argument("--no-db", action="store_true", help="sweep/cache only, skip DB upserts")
    args = ap.parse_args()

    projects = load_projects()
    communities = sorted(
        {(str(r["Community Name"]).strip(), str(r["Community Id"]).strip()) for _, r in projects.iterrows()}
    )
    print(f"[completions] sweeping {len(communities)} CEC communities")

    failures, fetched, cached = sweep(communities, args.refresh, args.delay, args.limit,
                                      start=args.start, end=args.end)
    print(f"[completions] sweep done: fetched {fetched}, from cache {cached}, failed {len(failures)}")
    for name, err in failures:
        print(f"    FAIL {name}: {err}")

    rows = load_all_rows()
    total_counts = Counter(r["community"] for r in rows)
    print(f"[completions] cached action rows: {len(rows)} across {len(total_counts)} communities")
    expected_total = int(projects["Count of High Impact Action NEW"].map(
        lambda v: int(str(v).replace(",", "") or 0)).sum())
    print(f"[completions] QA expected total actions (map KPI): {expected_total}")
    if len(rows) != expected_total:
        kpi_by_name: dict[str, int] = {}
        for _, pr in projects.iterrows():
            kpi_by_name[str(pr["Community Name"]).strip()] = kpi_by_name.get(
                str(pr["Community Name"]).strip(), 0
            ) + int(str(pr["Count of High Impact Action NEW"]).replace(",", "") or 0)
        cached_counts = Counter(r["community"] for r in rows)
        gaps = [(n, k - cached_counts.get(n, 0)) for n, k in kpi_by_name.items()
                if k - cached_counts.get(n, 0) != 0]
        print(f"[completions] WARN row-count mismatch: {len(rows)} != {expected_total}")
        for n, delta in sorted(gaps):
            print(f"    gap {n!r}: map KPI {kpi_by_name[n]} vs scorecard {cached_counts.get(n, 0)} rows "
                  f"(source discrepancy; program frozen)")
    if args.no_db:
        print("[completions] --no-db: skipping DB upserts")
        return 0

    library = build_library(rows)
    print(f"[completions] distinct CEC actions observed: {len(library)}")

    with connect() as conn:
        index = load_municipality_index(conn)
        # authoritative uid per CEC community id (cec_designations.py matched
        # or created every sweep community's municipality row already)
        uid_by_cec_id: dict[str, int] = {}
        with conn.cursor() as cur:
            cur.execute("SELECT cec_community_id, municipality_uid FROM cec_designations")
            for cid, uid in cur.fetchall():
                if cid:
                    uid_by_cec_id[cid] = uid
        missing_uid = 0
        sentinel_dates = 0
        written = 0
        for r in rows:
            uid = uid_by_cec_id.get(r.get("community_id") or "")
            if uid is None:
                uid, _area_type, _core = match_municipality(index, r["community"], r.get("county"))
            if uid is None:
                # every sweep community came from vCEC_PROJECTS with a CEC id,
                # so cec_designations.py already created its municipality row
                missing_uid += 1
                continue
            lib = library.get(normalize_action_name(r["action_name"] or ""))
            completed = _date(r.get("date_completed"))
            approved = _date(r.get("date_approved"))
            if completed is None:
                completed = approved if approved is not None else DATE_SENTINEL
                if approved is None:
                    sentinel_dates += 1
                    print(f"[completions] WARN no dates for {r['community']!r} / {r['action_name']!r}")
            upsert_cec_completion(
                conn,
                {
                    "municipality_uid": uid,
                    "action_external_id": lib["external_id"] if lib else None,
                    "raw_action_name": r["action_name"],
                    "parent_category": r["parent"] or "HIA",
                    "points_approved": _int(r["points_approved"]),
                    "points_currently_valued": _int(r["points_currently_valued"]),
                    "points_achieved": _int(r["points_achieved"]),
                    "points_eligible": _int(r["points_eligible"]),
                    "action_stage": _cell(r["stage"]),
                    "action_status": _cell(r["status"]),
                    "completed_on": completed,
                    "approved_on": approved,
                    "source_url": CEC_SCORECARD_URL,
                },
            )
            written += 1
        # individual action library rows (after completions reference them)
        for lib in library.values():
            upsert_cec_action(
                conn,
                external_id=lib["external_id"],
                name=lib["name"],
                pledge_element=lib["parent"],
                points_min=lib["points_min"],
                points_max=lib["points_max"],
                points_display=lib["points_display"],
                variable_points=lib["variable_points"],
                status_tags=["observed"],
                source_url=CEC_SCORECARD_URL,
            )
        conn.commit()
    print(f"[completions] completions written: {written} (sentinel dates: {sentinel_dates}, missing municipality rows: {missing_uid})")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())