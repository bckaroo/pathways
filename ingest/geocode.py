#!/usr/bin/env python3
"""Geocode municipalities that lack coordinates via the US Census 2020 Gazetteer.

The CSC portal ingest stores coordinates for participating communities, but the
546 CEC-only municipalities inserted by the CEC ingest (synthetic negative
uids) have none — which would leave large holes in the statewide map.

Primary join: cec_designations.geo_id (census GeoID published by the NYSERDA
CEC map points layer, verified against the gazetteer on 2026-09-21):
  - city / village -> 7-digit place GEOID      (2020_gaz_place_36.txt)
  - town           -> "36" + 5-digit MCD code  (2020_gaz_place_36.txt cousubs:
                     cousub GEOID = SSCCC + MCD5, key = state + MCD5)
  - county         -> 5-digit county GEOID     (2020_gaz_counties_36.txt)
Fallback: name matching on (area_type, core name, county) for any row the
GeoID join misses. Only rows with portal_uid < 0 are ever touched (never CSC
portal rows). Idempotent: coordinates are overwritten with the same values on
re-run.

Gazetteer files (2020 Census Gazetteer, NY FIPS 36) are cached under
ingest/data/raw/gazetteer/ and only downloaded when missing or --refresh.
"""

from __future__ import annotations

import argparse
import re
import unicodedata
from collections import Counter
from pathlib import Path

import requests

from db import connect

GAZ_DIR = Path(__file__).resolve().parent / "data" / "raw" / "gazetteer"
GAZ_BASE = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer"
GAZ_FILES = {
    "cousubs": f"{GAZ_BASE}/2020_gaz_cousubs_36.txt",
    "place": f"{GAZ_BASE}/2020_gaz_place_36.txt",
    "counties": f"{GAZ_BASE}/2020_gaz_counties_36.txt",
}

# "Urbana, Town (Steuben)" -> ("Urbana", "town", "Steuben")
CSC_NAME_RE = re.compile(r"^(.*),\s*(Village|Town|City|County)\s*\(([^)]+)\)$", re.I)


def norm(value: str | None) -> str:
    """Lowercase, ASCII-folded, whitespace-collapsed comparison key."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.lower().split())


def parse_municipality_name(name: str) -> tuple[str, str, str]:
    """(core, area_type, county) from the stored display name; raw fallback."""
    m = CSC_NAME_RE.match((name or "").strip())
    if m:
        return m.group(1).strip(), m.group(2).lower(), m.group(3).strip()
    stripped = (name or "").strip()
    area = "county" if norm(stripped).endswith("county") else ""
    core = stripped[: -len("County")].strip() if area else stripped
    return core, area, ""


def ensure_gazetteer(refresh: bool) -> dict[str, Path]:
    GAZ_DIR.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}
    for key, url in GAZ_FILES.items():
        path = GAZ_DIR / Path(url).name
        if refresh or not path.exists():
            resp = requests.get(url, timeout=120, headers={"User-Agent": "pathways-ingest/1.0"})
            resp.raise_for_status()
            path.write_bytes(resp.content)
        paths[key] = path
    return paths


def load_gazetteer(paths: dict[str, Path]) -> dict:
    """Index the NY gazetteer rows by GeoID for the join + name fallbacks."""
    places: dict[str, tuple[float, float, str]] = {}
    cousubs: dict[str, tuple[float, float, str, str]] = {}
    cousub_by_name: dict[tuple[str, str], tuple[float, float]] = {}
    counties: dict[str, tuple[float, float, str]] = {}
    county_by_name: dict[str, tuple[float, float]] = {}

    for line in paths["counties"].read_text().splitlines()[1:]:
        f = [x.strip() for x in line.split("\t")]
        if f[0] != "NY":
            continue
        geoid, name, lat, lon = f[1], f[3], float(f[8]), float(f[9])
        counties[geoid] = (lat, lon, name)
        county_by_name[norm(name[: -len(" County")])] = (lat, lon)

    for line in paths["cousubs"].read_text().splitlines()[1:]:
        f = [x.strip() for x in line.split("\t")]
        if f[0] != "NY":
            continue
        geoid, name, lat, lon = f[1], f[3], float(f[9]), float(f[10])
        # 10-digit SSCCC+MCD5, plus the 7-digit "state+MCD" key the CEC map
        # publishes as geo_id for towns
        cousubs[geoid] = (lat, lon, name, geoid[2:5])
        cousubs[geoid[:2] + geoid[5:]] = (lat, lon, name, geoid[2:5])
        cousub_by_name.setdefault((norm(name), geoid[2:5]), (lat, lon))

    for line in paths["place"].read_text().splitlines()[1:]:
        f = [x.strip() for x in line.split("\t")]
        if f[0] != "NY":
            continue
        geoid, name, lat, lon = f[1], f[3], float(f[10]), float(f[11])
        places[geoid] = (lat, lon, name)

    return {
        "places": places,
        "cousubs": cousubs,
        "cousub_by_name": cousub_by_name,
        "counties": counties,
        "county_by_name": county_by_name,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="re-download gazetteer files")
    args = ap.parse_args()

    paths = ensure_gazetteer(args.refresh)
    gaz = load_gazetteer(paths)

    updates: list[tuple[float, float, int, str]] = []
    by_source: Counter = Counter()
    unmatched: list[tuple[str, str, str, str | None]] = []

    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT m.portal_uid, m.name, m.area_type, m.county, d.geo_id
            FROM municipalities m
            LEFT JOIN cec_designations d ON d.municipality_uid = m.portal_uid
            WHERE m.portal_uid < 0
            """
        )
        rows = cur.fetchall()

        for uid, name, area_type, county, geo_id in rows:
            core, parsed_type, parsed_county = parse_municipality_name(name)
            at = (area_type or parsed_type or "").lower()
            county_name = county or parsed_county
            lat = lon = None
            source = None

            geo_id = (geo_id or "").strip()
            if at in ("city", "village") and geo_id in gaz["places"]:
                lat, lon, _ = gaz["places"][geo_id]
                source = f"geoid-place"
            elif at == "town" and geo_id in gaz["cousubs"]:
                lat, lon, _, _ = gaz["cousubs"][geo_id]
                source = "geoid-cousub"
            elif at == "county" and geo_id in gaz["counties"]:
                lat, lon, _ = gaz["counties"][geo_id]
                source = "geoid-county"

            if lat is None:
                # name fallback: (type, core, county) then unique (type, core).
                # CEC cores may embed a county qualifier "Clinton (Clinton County)"
                # and spellings drift ("AuSable" vs "Au Sable"): compare on a
                # punctuation/space-folded alnum key.
                core_key = re.sub(r"[^a-z0-9]", "", norm(re.sub(r"\s*\([^)]*\)\s*", " ", core)))
                county_key = norm(county_name)
                county_fips = {norm(n[: -len(" County")]): g for g, (_l, _o, n) in gaz["counties"].items()}.get(county_key)
                if at == "county":
                    hit = gaz["county_by_name"].get(norm(core))
                elif at in ("town", "city"):
                    hits = [
                        v
                        for (n, _c), v in gaz["cousub_by_name"].items()
                        if re.sub(r"[^a-z0-9]", "", n) == core_key
                    ]
                    if county_fips:
                        scoped = [v for (n, c), v in gaz["cousub_by_name"].items() if c == county_fips and re.sub(r"[^a-z0-9]", "", n) == core_key]
                        hits = scoped or hits
                    hit = hits[0] if len(hits) == 1 else None
                else:  # village -> places file, unique-name only
                    hits = [
                        (lon2, lat2)
                        for _g, (lat2, lon2, nm) in gaz["places"].items()
                        if re.sub(r"[^a-z0-9]", "", norm(nm)) == core_key
                    ]
                    hit = hits[0] if len(hits) == 1 else None
                if hit:
                    lat, lon = hit[1], hit[0]
                    source = "name"

            if lat is None:
                unmatched.append((name, at, county_name, geo_id))
            else:
                updates.append((lat, lon, uid, source or "?"))
                by_source[source or "?"] += 1

        cur.executemany(
            """
            UPDATE municipalities
            SET latitude = %s, longitude = %s, updated_at = now()
            WHERE portal_uid = %s
            """,
            [(u[0], u[1], u[2]) for u in updates],
        )

        cur.execute(
            "SELECT count(*) FROM municipalities WHERE latitude IS NOT NULL AND longitude IS NOT NULL"
        )
        with_coords = cur.fetchone()[0]
        cur.execute("SELECT count(*) FROM municipalities")
        total = cur.fetchone()[0]

    print(f"gazetteer join: {len(rows)} CEC-only municipalities")
    for source, n in sorted(by_source.items()):
        print(f"  {source}: {n}")
    if unmatched:
        print(f"UNMATCHED ({len(unmatched)}):")
        for name, at, county, geo_id in unmatched:
            print(f"  {name} [{at or '?'} / {county or '?'} / {geo_id or '-'}]")
    print(f"coordinates coverage: {with_coords}/{total}")


if __name__ == "__main__":
    main()