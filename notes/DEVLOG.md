# Development Log

Append-only log of each round of development on this repo (part of DevOS
project **PROJ-025**). New entries go at the top.

## Round 2 — 2026-09-21 · xiaozhu · CEC ingestion end-to-end (DEV-150)

**What was built**

- CEC ingestion (DEV-150), finishing the in-progress attempt found in the
  working tree: `ingest/cec_tableau.py` (anonymous Tableau JS-API wire client
  for bi.nyserda.ny.gov — session bootstrap, logical-table ids, underlying
  table fetch, parameter steering), `cec_hia.py` (15 HIA categories + max
  points from the HIA page), `cec_designations.py` (942 communities from CEC
  Map tables vCEC_PROJECTS + vCEC_PROJECT_POINT_TOTALS: designation/Advanced
  v3.0 star status, thresholds, population, GeoID), `cec_completions.py`
  (action-grain sweep of the Scorecard across all 942 communities with
  per-community caches + parameter-echo verification), `cec_crosswalk.py`
  (official CEC/CSC crosswalk PDF 2024-12-20 via pdfplumber ruled-table
  extraction). Drizzle schema + migration `0001` for `cec_designations`,
  `cec_completions`; npm scripts `ingest:cec:*`.
- Municipality matching (`cec_db.py`): CEC names ↔ CSC portal rows on
  (area_type, core, county); matched communities reuse the CSC portal uid;
  CEC-only municipalities get synthetic negative uids `-(CEC numeric id)`.

**Verification**

- `npm run build`: 5/5 static pages clean; `npm run lint`: clean.
- HIA: 15 categories with max points (e.g. Clean Fleets 6,700, Benchmarking
  1,800) upserted into the CEC program action library.
- Designations: 942/942 rows; 923 matched to CSC portal rows + 19 CEC-only
  synthetic; 0 missing point-totals; 605 Designated + 337 Not Designated;
  Advanced stars 221/95/40/17/18 (1–5★ = 391).
- Completions: 5,336 rows across 941 communities (5,243 from the earlier
  attempt + 93 previously-skipped CEC-only county rows recovered); 0 failed
  fetches, 0 sentinel dates, 0 missing municipality rows.
- Crosswalk: 35 unique rows from 36 PDF bullets (1 duplicate); 0 unmapped
  CSC ids; 24 CEC-side ids NULL by design (bullet variants not observed as
  completed actions; raw names preserved).
- QA vs map KPI: 5,336 vs 5,342 — single gap = Town of AuSable (CEC701172,
  KPI 6 vs Scorecard 0 rows). Verified live (empty underlying table for the
  domain-valid name "Town of Au Sable"); documented in README. Not
  recoverable from public sources; program frozen.

**Bugs found & fixed during verification**

- `match_municipality` county branch returned core already suffixed with
  " County" and designations appended another → 19 rows named
  "…County County", which then never matched again (93 completions rows
  skipped). Fixed: bare-core return, raw-index fallback, designations
  self-heal UPDATE (idempotent, verified: 0 remaining).
- Completions uid resolution now authoritative via
  `cec_designations.cec_community_id` (name matching only as fallback).
- Scorecard sweep treated a failed attempt's empty `rows` as success
  (`rows is None` leak) and rejected genuinely-empty communities; fixed:
  success assigned only on verification pass, empty underlying result for a
  domain-valid community is valid. QA output now names per-community gaps.

**Decisions**

- AuSable 6-row gap documented rather than synthesized — no public source
  carries those rows at action grain.
- Crosswalk rebuilt per run (delete + insert); completions/designations
  remain idempotent upserts keyed on natural keys.
- No push to GitHub (per repo conventions; owner request required).

**Follow-ups**

- v1 dashboard (t_ea30a016cafd129a): surface CEC designations/stars +
  completions alongside CSC data.
- Optional: populate `certification_levels.points_required` from CSC docs;
  chase the 2 outlier CSC certification reports (134, 98).

## Round 1 — 2026-09-21 · xiaomao · Pathways v0 bootstrap (DEV-148 + DEV-149)

**What was built**

- DevOS registration: PROJ-025 "Pathways", canonical repo at
  `~/.openclaw/workspace/dev/pathways` (via `devos init-repo`; enrollment
  approved by Andrew 2026-09-21 in Xiaozhu's webchat). Registry context:
  ProjectOS `software/pathways`.
- Scaffold (DEV-148, commit `7818330`): Next.js 15.5.25 App Router
  (TypeScript, src dir) + Tailwind 4 + MapLibre GL (dep ready, map UI is a
  later task); Drizzle ORM schema for programs / municipalities / actions
  (variable point tiers as min-max + display string, mandatory, priority,
  funding-eligible, CEC-related flags) / certifications / completions /
  crosswalk / certification_levels; migration `drizzle/0000_*` checked in and
  applied; docker-compose Postgres 16 (host port 5433); `.env.example`;
  AGPL-3.0 LICENSE; README quickstart + data attribution; AGENTS.md repo
  conventions; dev server pinned to **3005**.
- CSC ingestion (DEV-149, commit `e434b98`): `ingest/csc_checklist.py` parses
  the official 2025-12-18 Certification Action Checklist XLSX;
  `ingest/csc_communities.py` ingests participating communities via the
  portal's applicant REST endpoint (`?type=1336777439`), current
  certifications (`?type=1336777440`) and certification report pages
  (completions). Browser User-Agent required (CloudFront rejects library
  default UAs). All upserts idempotent; uv venv (`ingest/pyproject.toml`).

**Verification**

- `npm run build`: 5/5 static pages, clean. `npm run lint`: clean.
- Dev server: HTTP 200 on `http://localhost:3005` (landing page shows live
  DB counts).
- Portal stats cross-check (observed on portal 2026-09-21: 478 registered /
  185 certified / 7,956 actions completed):
  - registered: **478/478 MATCH**
  - certified: **185/185 MATCH** (Bronze 160 + Silver 25)
  - actions library: **124** from the XLSX (81 variable-point, 2 mandatory,
    20 funding-eligible, 21 CEC-related)
  - completions: **4,530** parsed from 185 certification reports. The portal's
    7,956 counts completions across ALL registered communities; public
    certification reports exist only for currently-certified communities, so
    the gap is expected and documented (README).
  - per-report point-sum validation vs portal `totalPointsApproved`:
    **183/185 exact** (2 outlier reports — cert 134 −15, cert 98 −9; rows are
    stored, WARN logged; likely further legacy-format variants in those two).
- Completion-name matching: 98.5% linked to the current action library after
  self-heal (rename alias "Local CSC Coordinator" → "CSC Coordinator",
  "&"/"and" folding, legacy numbering format support). The 66 unmatched rows
  are retired actions (60× legacy pledge "1.1 Pass a Resolution…", 3× retired
  7.17 wetlands action, 3 one-offs) — raw names preserved deliberately.

**Decisions**

- Report names that don't exist in the current checklist are stored with
  `action_external_id = NULL` + raw name (never dropped), so future
  crosswalk/repair passes can relink without data loss.
- Postgres on host port 5433 (5432 could clash with other local stacks).
- No GitHub remote/push this run (per task constraints); `devos doctor`
  shows only the expected no-remote warning.

**Follow-ups**

- CEC ingestion (ProjectOS t_2a9305e9c106e3a3 / pending DevOS task) and v1
  dashboard (t_ea30a016cafd129a) — not started this run by design.
- Verify Bronze/Silver point thresholds from CSC docs to populate
  `certification_levels.points_required`.
- Optional: chase the 2 outlier certification reports (134, 98) for further
  legacy name formats; add GitHub remote + push when owner requests it.