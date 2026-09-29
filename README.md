# Pathways — NY Community Climate Dashboard

Open-source, self-hostable dashboard tracking **NYSDEC Climate Smart Communities (CSC)**
certification and **NYSERDA Clean Energy Communities (CEC)** actions across New York
State municipalities. A free alternative to commercial climate-action platforms.

**Status:** v1 public dashboard — statewide MapLibre map (CSC certification / CEC
stars) + community profile pages on top of the ingested CSC + CEC data.

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

# 5. Ingest CEC data (program closed — frozen snapshot)
npm run ingest:cec:hia          # HIA categories + max points into the action library
npm run ingest:cec:designations # 942 designations + Advanced stars
npm run ingest:cec:completions  # 5,336 completed HIAs (action grain)
npm run ingest:cec:crosswalk    # CSC ↔ CEC equivalence from the DEC crosswalk PDF
npm run ingest:geocode          # census-gazetteer coordinates for CEC-only municipalities

# 6. Dev server (port 3005, inside the 3000-3099 dev range)
npm run dev                   # http://localhost:3005
```

## Dashboard (v1)

- **Statewide map** (`/map`): one point per municipality over a keyless
  OpenFreeMap vector basemap (MapLibre + OpenMapTiles schema, free
  `admin_level` 4/6/7/8 boundary layers); color modes toggle between CSC
  certification level (Registered/Bronze/Silver/Gold) and CEC designation +
  Advanced (v3.0) stars. Click a point for a summary popup linking to the
  community profile.
- **Communities index** (`/communities`): searchable/filterable table of all
  tracked municipalities.
- **Community profiles** (`/communities/[uid]`): CSC certification badge,
  points and report link; **certification skill tree**; **sector radial**;
  completed CSC actions (unmatched legacy names are preserved verbatim); CEC
  designation card (stars, HIAs, points, population) and completed CEC actions.
- **Certification skill tree** (`src/components/progression-panel.tsx`): CSC
  certification modelled as a tech tree rather than a scoreboard. Every level
  requires four things at once — points, breadth (distinct pledge elements),
  mandatory actions and priority actions — so each level card shows a
  requirement ring and "Next unlock" names the *closest unmet requirement*,
  not just the point gap. Gold is modelled as unreachable because NYSDEC lists
  it as under development.
- **Sector radial** (`src/components/sector-radial.tsx`): an 8-spoke coverage
  view of which emissions sectors a community's actions actually address, with
  the programme's per-sector offering drawn as the outer ring. Sector
  assignment is **curated per action**, not derived from pledge element — see
  "Sectors are not pledge elements" below.
- Pages are server-rendered on demand (`force-dynamic`) so the UI always
  reflects the database; the build stays clean even without Postgres running
  (pages degrade to a "database not reachable" notice).
- Coordinates: CSC portal communities carry portal coordinates; the 546
  CEC-only municipalities are geocoded from `cec_designations.geo_id` against
  the U.S. Census 2020 Gazetteer (NY FIPS 36; towns join on state+MCD code,
  villages/cities on place GEOID, counties on county GEOID) with a
  name-matching fallback (`ingest/geocode.py`, idempotent).

### Sectors are not pledge elements

A community's CSC actions are grouped under ten **pledge elements** (PE1–PE10),
which are *process* categories — a task force, an inventory, outreach — not
emitting sectors. Mapping a sector chart straight off the pledge element is
wrong, and provably so:

| Pledge element | Contains actions that belong elsewhere |
|---|---|
| PE3 "Decrease energy use" | Fleet Inventory (transportation), HVAC upgrades (buildings) |
| PE6 "Implement climate-smart land use" | EV charging stations, public transit access (both transportation) |
| PE1, PE9 | Governance and outreach — no emitting sector at all |

So all 124 CSC actions are mapped **one at a time** to GPC-style sectors in
`src/lib/csc-sectors.json`, 1:1 with the catalogue. The legacy manual numbering
(`3.1 Buildings and Stationary Equipment`, …) also looks like a sector key but
is unusable: 19 of 124 actions have no legacy number, and they are precisely the
newest ones (Thermal Energy Networks, Refrigerant Management, Organics
Management).

### Theming

Light and dark are both supported. Colours go through semantic tokens defined
once in `src/app/globals.css` (`surface`, `panel`, `ink`/`ink-muted`/`ink-subtle`,
`line`, plus warn/info/ok/flag/crit families) and mapped to utilities via
`@theme inline`. `npm run audit:contrast` measures every rendered text node in
both schemes and fails below WCAG AA — vision review cannot measure a contrast
ratio, and once reported "no visual defects" on a page that was unreadable.

### Verification

| Command | What it proves |
|---|---|
| `npm run validate:csc` | The level rule engine reproduces all 185 certified communities' levels, with zero false "can level up" |
| `npm run verify:csc` | The action catalogue and crosswalk match NYSDEC's published XLSX/PDF artefacts |
| `npm run verify:ghg` | 31 assertions about the GHG inventory datasets (grain, accounting traps, aliases) |
| `npm run audit:contrast` | Every text node meets WCAG AA in both colour schemes |
| `npm run smoke:map` | The map renders community points over a live basemap |
| `npm run test:fallback` | Community data survives a basemap outage, and the user is told |

### Ports

Dev servers run in **3000–3099** only; this repo pins **3005** (`npm run dev` /
`npm run start`). Postgres is exposed on host port **5433**. Don't invent other ports.

## Data sources & attribution

| Source | What we ingest | Where |
|---|---|---|
| NYSDEC Climate Smart Communities portal (climatesmart.ny.gov) | Action checklist (2025-12-18, version 4.5), participating communities, certification levels, certification reports | `ingest/csc_checklist.py`, `ingest/csc_communities.py` |
| NYSERDA Clean Energy Communities map/scorecard (bi.nyserda.ny.gov Tableau, program closed — frozen) | Per-municipality CEC designations + Advanced (v3.0) star status (942 communities), completed High-Impact Actions (action-grain), star point thresholds | `ingest/cec_designations.py`, `ingest/cec_completions.py` (Tableau wire client: `ingest/cec_tableau.py`) |
| NYSERDA CEC High-Impact Actions page | HIA categories + maximum points ("Up to N points") | `ingest/cec_hia.py` |
| NYSDEC official CEC/CSC crosswalk PDF (2024-12-20) | CSC ↔ CEC action equivalence mapping | `ingest/cec_crosswalk.py` |
| U.S. Census 2020 Gazetteer (NY FIPS 36) | Population-weighted centroids for CEC-only municipalities (map geocoding via `cec_designations.geo_id`) | `ingest/geocode.py` |

- CSC action checklist XLSX: https://climatesmart.ny.gov/fileadmin/csc/documents/Action_Checklist/2025-12-18-CSC-CertActionChecklist.xlsx
- Participating communities: https://climatesmart.ny.gov/actions-certification/participating-communities
- The CSC action list updates **annually** (latest round: 2025-12-18). Re-run
  `ingest:csc:actions --refresh` after DEC publishes a new checklist.
- The CEC program is **closed** — its data is historical/frozen. The NYSERDA
  Tableau dashboards (CEC Map / CEC Scorecard) are read anonymously via their
  JS-API session endpoints (`ingest/cec_tableau.py`); no account or writes.
  Individual CEC HIA names/points are derived from the completions dataset
  (the map page publishes only category maxima); CEC-only municipalities use
  synthetic negative portal uids (`-(numeric CEC id)`), never colliding with
  CSC portal uids.
- Known source discrepancy: the CEC Map KPI reports 6 completed HIAs for the
  Town of AuSable (CEC701172), but the Scorecard's action-grain table holds
  no rows for that community — completions therefore cover 5,336 of the
  5,342 map-KPI actions (verified 2026-09-21; program frozen, gap not
  recoverable from public sources).

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