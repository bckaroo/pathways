# Pathways — NY Community Climate Dashboard

Open-source, self-hostable dashboard tracking **NYSDEC Climate Smart Communities (CSC)**
certification and **NYSERDA Clean Energy Communities (CEC)** actions across New York
State municipalities. A free alternative to commercial climate-action platforms.

**Status:** v0 bootstrap — data foundation (CSC ingestion live; CEC ingestion and the
public dashboard are next milestones).

## Stack

- **Next.js 15** (App Router, TypeScript) + Tailwind CSS + MapLibre GL
- **PostgreSQL 16** via Docker Compose + **Drizzle ORM** (migrations checked in)
- **Python 3.12** ingestion (uv-managed venv: openpyxl/pandas, requests/bs4)

## Quickstart

```bash
# 1. Postgres (host port 5433 to avoid clashing with any system Postgres)
docker compose up -d

# 2. Environment
cp .env.example .env          # defaults match docker-compose.yml

# 3. Node deps + database schema
npm install
npm run db:migrate            # applies checked-in drizzle migrations

# 4. Ingest CSC data (idempotent — safe to re-run)
npm run ingest:csc:actions    # official 2025-12-18 CSC action checklist XLSX
npm run ingest:csc:communities  # participating communities + certifications + reports (~3 min)

# 5. Dev server (port 3005, inside the 3000-3099 dev range)
npm run dev                   # http://localhost:3005
```

### Ports

Dev servers run in **3000–3099** only; this repo pins **3005** (`npm run dev` /
`npm run start`). Postgres is exposed on host port **5433**. Don't invent other ports.

## Data sources & attribution

| Source | What we ingest | Where |
|---|---|---|
| NYSDEC Climate Smart Communities portal (climatesmart.ny.gov) | Action checklist (2025-12-18, version 4.5), participating communities, certification levels, certification reports | `ingest/csc_checklist.py`, `ingest/csc_communities.py` |
| NYSERDA Clean Energy Communities (nyserda.ny.gov/cec) | High-impact actions, designations *(pending task)* | — |

- CSC action checklist XLSX: https://climatesmart.ny.gov/fileadmin/csc/documents/Action_Checklist/2025-12-18-CSC-CertActionChecklist.xlsx
- Participating communities: https://climatesmart.ny.gov/actions-certification/participating-communities
- The CSC action list updates **annually** (latest round: 2025-12-18). Re-run
  `ingest:csc:actions --refresh` after DEC publishes a new checklist.
- The CEC program is **closed** — its data is historical/frozen.

Pathways is an independent open-source project. It is **not affiliated with, endorsed
by, or sponsored by** NYSDEC or NYSERDA. Program names are used descriptively with
links to official sources.

## Portal stats verification (2026-09-21)

The portal's public header reports **478 registered / 185 certified / 7,956 actions
completed**. Ingestion verifies:

- **Registered:** 478/478 matched (applicants REST endpoint, `?type=1336777439`).
- **Certified:** 185/185 matched (applicants carrying a current certification uid;
  Bronze/Silver split from the certification REST endpoint, `?type=1336777440`).
- **Actions completed:** certification report pages exist only for *currently
  certified* communities, so parsed completions cover that subset; the portal's 7,956
  counts completions across **all** registered communities (including never-certified
  ones), which are not exposed in public data. The gap is expected; see
  `notes/DEVLOG.md` for the numbers observed this run.

## Data model (v0)

`municipalities` · `programs` · `actions` (points incl. variable tiers, mandatory /
priority / funding-eligible / CEC-related flags) · `certifications` · `completions`
(per-community completed actions from certification reports) · `crosswalk` (CSC ↔ CEC,
pending) · `certification_levels` (thresholds pending verification).

Schema lives in `src/db/schema.ts`; migrations in `drizzle/`.

## Ingestion notes

- All scripts are **idempotent** (upserts keyed on portal uids / slugs) — re-run any time.
- The portal (TYPO3 behind CloudFront) rejects library default user agents; scripts
  send a browser UA (`ingest/db.py`).
- Raw downloads are cached under `ingest/data/raw/` (gitignored);
  `--refresh` re-downloads. The communities scraper supports `--skip-reports`
  (fast, skips completions) and `--limit N` (testing).
- Per-report QA: parsed points per community are validated against the portal's
  `totalPointsApproved`; mismatches are logged as WARN lines.

## License

Code: **AGPL-3.0** (see `LICENSE`). Our own written content: CC-BY-4.0.
Third-party data remains under its providers' terms as published.