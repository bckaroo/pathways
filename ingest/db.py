"""Shared helpers for Pathways ingestion scripts.

Reads DATABASE_URL from the repo-root .env (or the environment), provides a
psycopg connection, and small idempotent upsert helpers. All ingestion is
re-runnable: every write is an ON CONFLICT ... DO UPDATE keyed on natural keys
(CSC portal uids, slugged action names).
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from pathlib import Path

import psycopg
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(REPO_ROOT / ".env")

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://pathways:pathways@localhost:5433/pathways")
CSC_BASE_URL = os.environ.get("CSC_BASE_URL", "https://climatesmart.ny.gov")

# CloudFront in front of the TYPO3 portal rejects library default user agents.
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# Portal internal rank -> certification level name (from the portal's
# rankToLevel config and the certification REST payload).
LEVEL_NAMES = {0: "Registered", 2: "Bronze", 4: "Silver", 6: "Gold"}


def connect() -> psycopg.Connection:
    return psycopg.connect(DATABASE_URL)


def slugify(value: str) -> str:
    """Stable slug for external ids: ASCII-folded lowercase dash-separated."""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("'", "").replace("’", "")
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def normalize_action_name(value: str) -> str:
    """Loose key for matching report action names against the checklist."""
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.lower().replace("’", "'").replace("&", " and ")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def upsert_program(conn: psycopg.Connection, slug: str, name: str, agency: str, status: str, source_url: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO programs (slug, name, agency, status, source_url, updated_at)
            VALUES (%s, %s, %s, %s, %s, now())
            ON CONFLICT (slug) DO UPDATE
            SET name = EXCLUDED.name, agency = EXCLUDED.agency,
                status = EXCLUDED.status, source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            (slug, name, agency, status, source_url),
        )


def upsert_action(conn: psycopg.Connection, row: dict) -> None:
    row = {**row, "status_tags": json.dumps(row["status_tags"])}
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO actions (program_slug, external_id, name, pledge_element,
                legacy_action_no, legacy_action_name, points_min, points_max,
                points_display, variable_points, mandatory, priority,
                funding_eligible, cec_related, status_tags, source_url, updated_at)
            VALUES (%(program_slug)s, %(external_id)s, %(name)s, %(pledge_element)s,
                %(legacy_action_no)s, %(legacy_action_name)s, %(points_min)s, %(points_max)s,
                %(points_display)s, %(variable_points)s, %(mandatory)s, %(priority)s,
                %(funding_eligible)s, %(cec_related)s, %(status_tags)s::jsonb, %(source_url)s, now())
            ON CONFLICT (program_slug, external_id) DO UPDATE SET
                name = EXCLUDED.name,
                pledge_element = EXCLUDED.pledge_element,
                legacy_action_no = EXCLUDED.legacy_action_no,
                legacy_action_name = EXCLUDED.legacy_action_name,
                points_min = EXCLUDED.points_min,
                points_max = EXCLUDED.points_max,
                points_display = EXCLUDED.points_display,
                variable_points = EXCLUDED.variable_points,
                mandatory = EXCLUDED.mandatory,
                priority = EXCLUDED.priority,
                funding_eligible = EXCLUDED.funding_eligible,
                cec_related = EXCLUDED.cec_related,
                status_tags = EXCLUDED.status_tags::jsonb,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def upsert_municipality(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO municipalities (portal_uid, name, area_type, county, latitude,
                longitude, certification_level, certification_level_name, cert_uid,
                has_gold_star, source_url, updated_at)
            VALUES (%(portal_uid)s, %(name)s, %(area_type)s, %(county)s, %(latitude)s,
                %(longitude)s, %(certification_level)s, %(certification_level_name)s,
                %(cert_uid)s, %(has_gold_star)s, %(source_url)s, now())
            ON CONFLICT (portal_uid) DO UPDATE SET
                name = EXCLUDED.name,
                area_type = EXCLUDED.area_type,
                county = EXCLUDED.county,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                certification_level = EXCLUDED.certification_level,
                certification_level_name = EXCLUDED.certification_level_name,
                cert_uid = EXCLUDED.cert_uid,
                has_gold_star = EXCLUDED.has_gold_star,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def upsert_certification(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO certifications (cert_uid, municipality_uid, name, level,
                level_name, points_approved, certified_on, report_url, applicant_url,
                source_url, updated_at)
            VALUES (%(cert_uid)s, %(municipality_uid)s, %(name)s, %(level)s,
                %(level_name)s, %(points_approved)s, %(certified_on)s, %(report_url)s,
                %(applicant_url)s, %(source_url)s, now())
            ON CONFLICT (cert_uid) DO UPDATE SET
                municipality_uid = EXCLUDED.municipality_uid,
                name = EXCLUDED.name,
                level = EXCLUDED.level,
                level_name = EXCLUDED.level_name,
                points_approved = EXCLUDED.points_approved,
                certified_on = EXCLUDED.certified_on,
                report_url = EXCLUDED.report_url,
                applicant_url = EXCLUDED.applicant_url,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def upsert_completion(conn: psycopg.Connection, row: dict) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO completions (certification_uid, municipality_uid,
                action_external_id, raw_action_name, points_awarded, summary,
                source_url, updated_at)
            VALUES (%(certification_uid)s, %(municipality_uid)s, %(action_external_id)s,
                %(raw_action_name)s, %(points_awarded)s, %(summary)s, %(source_url)s, now())
            ON CONFLICT (certification_uid, raw_action_name) DO UPDATE SET
                municipality_uid = EXCLUDED.municipality_uid,
                action_external_id = EXCLUDED.action_external_id,
                points_awarded = EXCLUDED.points_awarded,
                summary = EXCLUDED.summary,
                source_url = EXCLUDED.source_url,
                updated_at = now()
            """,
            row,
        )


def seed_certification_levels(conn: psycopg.Connection, source_url: str) -> None:
    for level, name in LEVEL_NAMES.items():
        if level == 0:
            continue
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO certification_levels (level, level_name, points_required,
                    notes, source_url, updated_at)
                VALUES (%s, %s, NULL, %s, %s, now())
                ON CONFLICT (level) DO UPDATE SET
                    level_name = EXCLUDED.level_name, notes = EXCLUDED.notes,
                    source_url = EXCLUDED.source_url, updated_at = now()
                """,
                (level, name, "Point thresholds pending verification from CSC docs", source_url),
            )