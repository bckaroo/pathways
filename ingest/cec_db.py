#!/usr/bin/env python3
"""DB helpers for CEC ingestion: municipality matching + CEC table upserts.

Municipality matching (CEC -> CSC):
  CEC publishes names like "Village of Pittsford", "Town of Urbana",
  "City of Hornell", "Cayuga County". The CSC portal stores
  "Pittsford, Village (Monroe)" and "Albany County". We parse both sides and
  match on (area_type, core name, county). Matched communities reuse the CSC
  portal uid so CEC data joins the CSC dashboard data; unmatched CEC-only
  municipalities get synthetic portal_uid = -(numeric part of the NYSERDA
  CEC community id), which cannot collide with positive CSC portal uids.

All upserts are idempotent (ON CONFLICT ... DO UPDATE on natural keys).
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass

import psycopg

CSC_NAME_RE = re.compile(r"^(.*),\s*(Village|Town|City|County)\s*\(([^)]+)\)$", re.I)
CEC_NAME_RE = re.compile(r"^(Village|Town|City)\s+of\s+(.+)$", re.I)
CEC_ID_RE = re.compile(r"^CEC(\d+)$")


def _norm(value: str | None) -> str:
    """Lowercase, ASCII-folded, whitespace-collapsed comparison key."""
    if value is None:
        return ""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.lower().split())


def parse_cec_name(name: str) -> tuple[str | None, str]:
    """('village'|'town'|'city'|'county', core) or (None, raw) when unknown."""
    m = CEC_NAME_RE.match(name.strip())
    if m:
        return m.group(1).lower(), m.group(2).strip()
    if _norm(name).endswith("county"):
        return "county", name.strip()[: -len("county")].strip()
    return None, name.strip()


@dataclass
class MunicipalityIndex:
    """In-memory index of the municipalities table for CEC matching."""

    # (area_type, core_norm, county_norm) -> portal_uid
    typed: dict[tuple[str, str, str], int]
    # county name norm -> portal_uid  (CSC counties are named "Albany County")
    counties: dict[str, int]
    # raw name norm -> portal_uid (fallback)
    raw: dict[str, int]


def load_municipality_index(conn: psycopg.Connection) -> MunicipalityIndex:
    typed: dict[tuple[str, str, str], int] = {}
    counties: dict[str, int] = {}
    raw: dict[str, int] = {}
    with conn.cursor() as cur:
        cur.execute("SELECT portal_uid, name, area_type, county FROM municipalities")
        for uid, name, area_type, county in cur.fetchall():
            raw[_norm(name)] = uid
            m = CSC_NAME_RE.match(name or "")
            if area_type == "county" or (m and m.group(2).lower() == "county"):
                counties[_norm(name)] = uid
                if m:
                    counties[_norm(m.group(1))] = uid
                continue
            if m:
                typed[(m.group(2).lower(), _norm(m.group(1)), _norm(m.group(3)))] = uid
            if area_type:
                # also index by area_type + bare name for names without the pattern
                typed.setdefault((area_type, _norm(name), _norm(county)), uid)
    return MunicipalityIndex(typed=typed, counties=counties, raw=raw)


def synthetic_uid_for_cec(cec_community_id: str) -> int | None:
    m = CEC_ID_RE.match(cec_community_id or "")
    return -int(m.group(1)) if m else None


def match_municipality(
    index: MunicipalityIndex, cec_name: str, county: str | None
) -> tuple[int | None, str | None, str | None]:
    """Match a CEC community name to an existing CSC municipality row.

    Returns (portal_uid, area_type, core_name); portal_uid None when unmatched.
    """
    area_type, core = parse_cec_name(cec_name)
    county_norm = _norm(county)
    if area_type == "county":
        uid = index.counties.get(_norm(cec_name)) or index.counties.get(_norm(core))
        if uid is not None:
            return uid, "county", core.title()
        # fall back to the raw-name index: county rows created by earlier runs
        # (e.g. CEC-only counties) may exist without a parseable CSC pattern
        uid = index.raw.get(_norm(cec_name))
        if uid is not None:
            return uid, "county", core.title()
        return None, "county", core.title()
    if area_type is None:
        uid = index.raw.get(_norm(cec_name))
        return (uid, None, cec_name) if uid else (None, None, cec_name)
    uid = index.typed.get((area_type, _norm(core), county_norm))
    if uid is not None:
        return uid, area_type, core
    # county mismatch on an otherwise exact (type, core) match: still trust the
    # (type, core) pair — county spellings differ occasionally across sources.
    for (at, core_n, _c), u in index.typed.items():
        if at == area_type and core_n == _norm(core):
            return u, area_type, core
    return None, area_type, core


def upsert_municipality(
    conn: psycopg.Connection,
    portal_uid: int,
    name: str,
    area_type: str | None,
    county: str | None,
    source_url: str,
) -> None:
    """Insert (only when new) a CEC-only municipality row; never touches CSC rows."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO municipalities (portal_uid, name, area_type, county,
                certification_level, certification_level_name, has_gold_star,
                source_url, updated_at)
            VALUES (%s, %s, %s, %s, NULL, NULL, false, %s, now())
            ON CONFLICT (portal_uid) DO NOTHING
            """,
            (portal_uid, name, area_type, county, source_url),
        )


def upsert_program(conn: psycopg.Connection, source_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO programs (slug, name, agency, status, source_url, updated_at)
            VALUES ('cec', 'Clean Energy Communities', 'NYSERDA', 'closed', %s, now())
            ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name, agency = EXCLUDED.agency,
                status = EXCLUDED.status, source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            (source_url,),
        )


def upsert_cec_action(
    conn: psycopg.Connection,
    external_id: str,
    name: str,
    pledge_element: str,
    points_min: int | None,
    points_max: int | None,
    points_display: str,
    variable_points: bool,
    status_tags: list[str],
    source_url: str,
) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO actions (program_slug, external_id, name, pledge_element,
                points_min, points_max, points_display, variable_points,
                status_tags, source_url, updated_at)
            VALUES ('cec', %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, now())
            ON CONFLICT (program_slug, external_id) DO UPDATE SET
                name = EXCLUDED.name,
                pledge_element = EXCLUDED.pledge_element,
                points_min = COALESCE(EXCLUDED.points_min, actions.points_min),
                points_max = COALESCE(EXCLUDED.points_max, actions.points_max),
                points_display = EXCLUDED.points_display,
                variable_points = EXCLUDED.variable_points,
                status_tags = EXCLUDED.status_tags::jsonb,
                source_url = COALESCE(EXCLUDED.source_url, actions.source_url),
                updated_at = now()
            """,
            (
                external_id,
                name,
                pledge_element,
                points_min,
                points_max,
                points_display,
                variable_points,
                json.dumps(status_tags),
                source_url,
            ),
        )


def upsert_cec_designation(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cec_designations (municipality_uid, cec_community_id,
                status, designation_status, advanced_designation, star_rating,
                community_size, region, geo_id, population, hias_approved,
                points_achieved_new, points_achieved_old, points_achieved_total,
                current_star_status, last_threshold, next_threshold,
                till_next_star, latest_action_approved_on, source_url, updated_at)
            VALUES (%(municipality_uid)s, %(cec_community_id)s, %(status)s,
                %(designation_status)s, %(advanced_designation)s, %(star_rating)s,
                %(community_size)s, %(region)s, %(geo_id)s, %(population)s,
                %(hias_approved)s, %(points_achieved_new)s, %(points_achieved_old)s,
                %(points_achieved_total)s, %(current_star_status)s, %(last_threshold)s,
                %(next_threshold)s, %(till_next_star)s, %(latest_action_approved_on)s,
                %(source_url)s, now())
            ON CONFLICT (municipality_uid) DO UPDATE SET
                cec_community_id = EXCLUDED.cec_community_id,
                status = EXCLUDED.status,
                designation_status = EXCLUDED.designation_status,
                advanced_designation = EXCLUDED.advanced_designation,
                star_rating = EXCLUDED.star_rating,
                community_size = EXCLUDED.community_size,
                region = EXCLUDED.region,
                geo_id = EXCLUDED.geo_id,
                population = EXCLUDED.population,
                hias_approved = EXCLUDED.hias_approved,
                points_achieved_new = EXCLUDED.points_achieved_new,
                points_achieved_old = EXCLUDED.points_achieved_old,
                points_achieved_total = EXCLUDED.points_achieved_total,
                current_star_status = EXCLUDED.current_star_status,
                last_threshold = EXCLUDED.last_threshold,
                next_threshold = EXCLUDED.next_threshold,
                till_next_star = EXCLUDED.till_next_star,
                latest_action_approved_on = EXCLUDED.latest_action_approved_on,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def upsert_cec_completion(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO cec_completions (municipality_uid, action_external_id,
                raw_action_name, parent_category, points_approved,
                points_currently_valued, points_achieved, points_eligible,
                action_stage, action_status, completed_on, approved_on,
                source_url, updated_at)
            VALUES (%(municipality_uid)s, %(action_external_id)s, %(raw_action_name)s,
                %(parent_category)s, %(points_approved)s, %(points_currently_valued)s,
                %(points_achieved)s, %(points_eligible)s, %(action_stage)s,
                %(action_status)s, %(completed_on)s, %(approved_on)s,
                %(source_url)s, now())
            ON CONFLICT (municipality_uid, raw_action_name, completed_on) DO UPDATE SET
                action_external_id = EXCLUDED.action_external_id,
                parent_category = EXCLUDED.parent_category,
                points_approved = EXCLUDED.points_approved,
                points_currently_valued = EXCLUDED.points_currently_valued,
                points_achieved = EXCLUDED.points_achieved,
                points_eligible = EXCLUDED.points_eligible,
                action_stage = EXCLUDED.action_stage,
                action_status = EXCLUDED.action_status,
                approved_on = EXCLUDED.approved_on,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def upsert_crosswalk_row(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO crosswalk (csc_action_external_id, cec_hia_id, cec_hia_name,
                note, source_url, updated_at)
            VALUES (%(csc_action_external_id)s, %(cec_hia_id)s, %(cec_hia_name)s,
                %(note)s, %(source_url)s, now())
            """,
            row,
        )