# Development Log

Append-only log of each round of development on this repo (part of DevOS
project **PROJ-025**). New entries go at the top.

## 2026-10-12 — Pages deploy fix: ship /tree + DB-backed program module (DEV-282 follow-up, agent:hermes)

**What was built**
- Fixed the GitHub Pages build that had failed twice since DEV-278: `force-dynamic` on `/api/program/[slug]` is illegal under `output: export`, and the route wasn't in the static-export swap list. The route is now registered in `scripts/to-static-export.mjs` and exports `generateStaticParams` for `csc-tree`, so Pages ships a real 67-action JSON prerendered from the build DB.
- CI now seeds `csc-tree` after the snapshot restore (the checklist snapshot predates it), asserts 67 tree actions, and verifies `out/tree` and the exported program module exist with real content.
- `/tree` page builds raw `<a>`/`<iframe>` URLs with `PAGES_BASE_PATH` so they resolve under the repo sub-path (raw URLs don't inherit Next's basePath).
- Local static-export simulation run end-to-end: seed → apply → STATIC_EXPORT build → verified `out/api/program/csc-tree` (67 actions, real content), `out/tree/index.html`, `out/pathways/tech-tree.html` → revert. (Note: pathways-db must be running; the first attempt failed with an empty `generateStaticParams` when the DB was down — an ECONNREFUSED turned into a confusing "missing generateStaticParams" build error.)

**Verification**
- Live site at https://bckaroo.github.io/pathways/map/ currently shows both basemap-degraded AND "Map data layer did not load" banners — the data-layer half is a real open bug (basemap-degraded alone is by design when tiles.openfreemap.org is unreachable). The repo's `test_basemap_fallback.py` could not verify the fallback locally ("__pathwaysMap absent"), so the fallback path remains unverified. OPEN — do not treat the map as healthy on Pages until this is chased.
- `npm run test:tree`, lint, tsc, `npm run build`, `git diff --check`: green.

## 2026-10-12 — Sleepy Hollow scenario, trajectory chart, zoom (DEV-282 follow-up, agent:hermes)

**What was built**
- Line chart under Illustrative annual impact: BAU vs with-actions vs target paths, driven by each action's completion year and modeled annual savings; scenario assumptions (baseline 74,615 t from the Sleepy Hollow 2019 community inventory, growth, target year/%) editable, persisted, and exported. Overlap groups de-duplicate year by year; savings start in the completion year; emissions floor at zero; pre-baseline completions apply from the baseline year.
- Progress import: the import modal now accepts progress JSON (progress/impact_inputs/completion_years/scenario) in addition to program modules.
- Canvas zoom: Ctrl/⌘+wheel and trackpad pinch (anchored at the pointer), +/− and Shift+0 keys, and a corner −/%/+ control; native wheel scrolling, drag-pan, and click-suppression preserved at all zooms (35–250%).
- Card badges: modeled/max GHG impact next to points, plus per-card Year completed (persisted, exported).
- Authored demo JSONs: `public/pathways/sleepy-hollow-progress.json` (real Sept 2025 Bronze certification, 178 pts/27 actions, 19 mapped in-tree) and a workspace aggressive 50%-by-2040 concept scenario.

**Verification**
- `npm run test:tree`: 11/11 pass (trajectory start-year/overlap/partial-points/zero-floor, scenario bounds, prior suites).
- lint/tsc/build green; browser-verified zoom paths (buttons, keys, ctrl-wheel), drag vs click at zoom, Sleepy Hollow real-progress import (19/67, 150 pts) and aggressive-2040 import (target met, on path from 2032).
- Fixed: inverted chart y-mapping (flat/lines-wrong-way), summary "target reached" false positive, summary render crash after an edit.

## 2026-10-12 — Illustrative per-action GHG impact model (DEV-282, agent:hermes)

**What was built**
- Added a concept-planning annual GHG model that uses explicit, rounded maximum assumptions on 19 direct CSC actions. Each action is prorated by credited points divided by its own maximum points, clamped from zero to one; no universal CSC point-to-ton factor is used.
- Added editable credited-point and maximum-impact inputs to direct-action dossiers, with separate local browser persistence. Numeric, range, and tiered point displays are supported, while the existing completion state remains independent and backward-compatible.
- Classified all other CSC actions as enabling or adaptation with no direct quantified impact. Related direct actions share overlap groups whose portfolio contribution is the largest modeled value rather than the sum.
- Added an overlap-adjusted left-pane estimate, action-level formula and classification in the dossier, methodology disclosures, help/schema guidance, and impact inputs in progress exports.

**Verification**
- `npm run test:tree`: 8/8 pass, including formula clamps, point parsing, classification, overlap aggregation, and required UI/disclosure checks.
- `npm run lint`, `npx tsc -p tsconfig.json --noEmit`, `npm run build`, and `git diff --check`: clean; 6/6 routes generated.
- Browser on `127.0.0.1:3005`: 67 cards rendered with no captured page errors; a 2.5-of-5 point input produced ~50 t CO₂e/yr from a 100 t/yr action maximum; the total and points metric updated while completion stayed 0/67. Enabling and adaptation dossiers showed no direct quantified impact. Existing completion toggling still moved 0/67 → 1/67 → 0/67 independently.
- Work left uncommitted and unpushed.

## 2026-10-12 — Tree semantic subgroup and phase layout (DEV-280, agent:hermes)

**What was built**
- Replaced the one-card-per-row canvas with a pure, tested layout engine that groups CSC actions into 25 authored semantic themes inside their existing Pledge Element lanes (including transportation and mobility, municipal buildings, nature and forestry, flooding and stormwater, and extreme heat).
- Widened each implementation phase to three horizontal action slots so same-phase prerequisite sequences read left to right; added alternating phase bands, persistent vertical boundaries, and sticky phase/lane/subgroup labels during pan.
- Generic modules can author `action.subgroup`/`action.theme`, `action_subgroups`, or top-level `subgroups`; otherwise deterministic action-content rules provide a theme and safely fall back to `General`. No prerequisite data was added or changed.
- Preserved the in-progress DEV-279 grab-pan implementation, card selection, locked prerequisite navigation/highlighting, progress state, DB `?data=` loading, and builtin fallback.

**Verification**
- `npm run test:tree`: 3/3 pass (67-action CSC map coverage, generic fallback, collision-free horizontal layout and sequence placement).
- `npm run lint`: clean. `npm run build`: 6/6 routes generated, including `/tree` and `/api/program/[slug]`.
- Browser on existing preview `127.0.0.1:3006`: 67 cards, 25 subgroup bands, 8 sticky phase columns, 6020×7284 canvas; card dossier, locked prerequisite navigation, and 300 px drag-pan verified; no page errors.
- DB container was not running, so `/api/program/csc-tree` returned the expected 503 and the browser successfully exercised the builtin fallback (67 cards/25 groups). DB-backed response was not re-verified this round.
- Work left uncommitted and unpushed.

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
## Round 3 — 2026-09-21 · xiaozhu · v1 public dashboard (DEV-151)

**What was built**

- Geocoding (`ingest/geocode.py`, `npm run ingest:geocode`): the 546 CEC-only
  municipalities (synthetic negative uids) had no coordinates. The CEC map
  publishes `cec_designations.geo_id`; verified it joins the US Census 2020
  Gazetteer (NY FIPS 36) 100%: villages/cities on the 7-digit place GEOID
  (179), towns on the state+MCD key (348), counties on the county GEOID (19).
  A name-matching fallback (parenthetical-stripped, punctuation/space-folded
  keys) stays as a safety net. Coordinates coverage now 1,024/1,024.
- Statewide map `/map`: MapLibre GL 6 (named imports — v6 dropped the default
  export) over a free CARTO light raster basemap (OSM attribution). One
  circle per municipality; color mode toggles between CSC certification
  level (Registered/Bronze/Silver/Gold) and CEC designation + Advanced stars
  (5-step green ramp + lime for plain Designated). Hover cursor, click
  popups link to profile pages; legend + stat chips per mode.
- Communities index `/communities`: full 1,024-row table with client-side
  search, municipality-type filter, CEC status/star filter, certified-only
  toggle.
- Community profiles `/communities/[uid]`: CSC card (level badge, points,
  certified date, report link, completion count), completed CSC actions table
  (unmatched legacy names preserved verbatim + footnote), CEC card (status,
  stars, HIAs approved, points, population, size, region, last HIA),
  completed CEC actions table.
- Home page: CEC stats row + "Explore the statewide map" / "Browse
  communities" CTAs; shared nav header in the root layout.

**Verification**

- `npm run lint`: clean. `npm run build`: 5/5 routes, clean (dynamic routes
  `/map`, `/communities`, `/communities/[uid]` are force-dynamic; build stays
  green without Postgres).
- Production server smoke test (next start, port 3005): `/`, `/map`,
  `/communities` → 200; `/communities/1191` (Potsdam, Bronze cert + action
  tables), `/communities/-811010` (NYC, CEC-only synthetic, Designated 4★),
  `/communities/403` (Croton-on-Hudson, 5★) → 200 with expected content;
  communities index shows "Showing 1,024 of 1,024".
- Geocode re-run is idempotent (546/546 re-joined, no unmatched).

**Decisions**

- Point map (not boundary polygons) for v1 — no boundary dataset required;
  census centroids are fine at statewide zoom. Polygons stay a follow-up.
- DB-backed pages are `force-dynamic` with graceful "database not reachable"
  fallbacks (fresh data per request; static build stays clean).
- Geocoding keys off the published CEC geo_id rather than name matching;
  the 13 towns the name-only pass missed (parenthetical county qualifiers,
  "AuSable" spellings) all recover via the geo_id join.

**Follow-ups**

- Gold rendering path exists but no Gold communities in data yet (expected).
- Verify Bronze/Silver point thresholds from CSC docs to populate
  `certification_levels.points_required` (carried from Round 2).
- Optional: municipal boundary polygons (choropleth), outlier cert reports
  (134, 98), GitHub remote + push when owner requests.

## 2026-10-12 — Skill-tree pathway preview (DEV-277, agent:hermes)

**What was built**
- `/tree` route (static) embedding the self-contained Pathways skill-tree app in a full-height iframe, with "Open full screen" and "Back to dashboard" controls; nav link "Skill Tree" added to root layout.
- `public/pathways/tech-tree.html` — self-contained app (~395KB, zero deps): 3-pane shell (metrics / pathway canvas / action dossier), 8 prerequisite tiers × 12 Pledge-Element lanes, gold prerequisite edges, violet chain highlight on locked actions with prerequisite list (clickable), point/category milestones to Bronze+Silver, program dropdown, JSON import/export, search filter. Program module: `public/pathways/csc-ny.json` (CSC certification v4.5, 67 actions; descriptions sourced from climatesmart.ny.gov via browser AJAX).
- Production build passes (lint + build, /tree static ○ 118 kB).

**Ops note — port conflict**
- AGENTS.md pins dev port 3005, but it is currently occupied by PROJ-033 (APA NYM TechComm) `next dev`. Preview is served at **127.0.0.1:3006** (`next start -p 3006`, temp session) — not registered, per policy a persistent Pathways port should be decided by Andrew (apps range 3110+ or a dedicated dev port) and logged in ports.json.

**Verification**
- lint clean; build 6/6 routes green incl. `/tree`.
- HTTP 200: `/tree`, `/pathways/tech-tree.html`, `/pathways/csc-ny.json`; frame renders (nav + iframe 1280×473 confirmed via CDP).
- Earlier app-level browser tests: level eval (SILVER at full completion), prereq chains, import/export roundtrip, state isolation per program.

**Follow-ups**
- Register a persistent Pathways port in `~/.openclaw/config/ports.json`; resolve the 3005 double-claim with PROJ-033.
- Wire csc-ny.json into the Drizzle DB (actions table) so the tree reads live data; add GitHub Pages export of the static tree.

## 2026-10-13 — Tree v2: DB-backed program (DEV-278, agent:hermes, branch feat/tree-db-drizzle)

**What was built**
- `src/db/schema.ts`: tree metadata on `programs` (jurisdiction, point_ceiling, levels, required_actions, categories, category_names, tiers) and `actions` (icon, tier, tree_why, prereq_external_ids, details, lookback, cobenefits). Migration `drizzle/0002_loose_mister_sinister.sql`.
- `scripts/seed-tree-program.ts`: idempotent seed of an authored module into DB. Prereqs stored as external ids (`action-<N>`); ran against `public/pathways/csc-ny.json`.
- `src/app/api/program/[slug]/route.ts`: assembles the program module from DB (force-dynamic, 503 + hint on DB-down).
- `public/pathways/tech-tree.html`: boot honors `?data=<url>` — fetches the DB-backed module (async, before layout) and falls back to builtin on failure. `let BUILTIN` to allow override.
- `/tree` iframe now `?data=/api/program/csc-tree`.

**Verification**
- docker pathways-db migration applied (migration 0002); DB seeded: 67 actions, 66 with prereqs, 35 with cobenefits.
- `GET /api/program/csc-tree` → 200; a66 details=1 lookback="10 years"; a105 prereqs=[88]; required=[1,2,3]; 3 levels; 12 categories.
- Browser: /tree iframe renders 67 cards, REGISTERED, dossier sections populate from DB data.
- eslint clean; tsc --noEmit clean; next build 6/6 routes.

**Decisions & notes**
- Program slug `csc-tree` intentionally separate from checklist-injected `csc` (DEV-149): tree tiers/prereqs are authored content; merge with the official scorecard rows is a deliberate later step.
- Collateral: an over-broad `pkill -f next-server` killed APA's stale 3005 listener; its live dev server (3115, per scripts/dev.sh) is intact. dev.sh comment still says 3005 — stale doc, worth fixing in PROJ-033.
- pathways-db on /mnt storage crash-recovers slowly (~13 min fsync); consider volume on faster storage.

**Follow-ups**
- Merge to main after owner review (+ push branch for CI).
- JSON Schema validation for third-party modules; editing UI over the DB (kills the file-edit rigidity).

## 2026-10-13 — Arc Modern UI restyle (owner-picked direction, uncommitted)
- Applied Arc Modern light theme (from 6-direction OpenDesign comparison `pathways-ui-directions`) to `public/pathways/tech-tree.html`: full color remap (dark gold/silver → warm off-white surfaces, indigo #4f46e5 accent, emerald #059669, muted #7a716a), fonts Georgia→Sora / Verdana→Inter (Inter+Sora webfonts added), radii +4-8px, phase-header + zoom-ctl lightened; zoom-ctl moved bottom-right so it no longer clips left-anchored lane labels.
- Verification: `npm run test:tree` 11/11 pass on the restyled artifact; headless Chrome screenshots at 1440×900 + 1000×800 visually audited (no residual dark theme, contrast OK).
- Pre-restyle backup: `~/.hermes/cache/scratch/pathways-pre-arc-bak.html` (retained).
- Follow-ups: tablet touch-target sizes for cards/zoom; dark-mode for Planner Dark direction if wanted; commit/push on owner request (DEV id needed for message).

## 2026-10-13 (2) — Dark mode added (Arc Night), uncommitted
- Theme system: hardcoded hexes converted to CSS vars (--bg/--pane/--panel-lit/--ink/--muted/--accent/--violet/--green/--warn/--line/--border + --tr-* trajectory colors); `html[data-theme="dark"]` token block (neutral dark surfaces #14161e/#1b1e29, lighter indigo #8b90ff, emerald #34d399); trajectory SVG strokes moved from inline attrs to classes (#trajectory path.trbau/.trtarget/.tradj, line.traxis/.trgrid, text.trtext).
- Toggle: titlebar button `◐ Dark / ☀ Light`, persisted in localStorage `pw-theme`, defaults to OS prefers-color-scheme, `?theme=dark|light` URL override for testing/dev.
- Also fixed 3 stale light-on-dark text colors uncovered by the light restyle (.impact-result, .subgroup-label, #right .p-locked-note li → var(--ink)).
- Verification: test:tree 11/11 pass; headless screenshots light + dark (1440×900) visually audited, PASS both, no residual theme artifacts.
- Brand tagline changed to "setting the path to climate action" (owner wording); nowrap, hidden under 1000px viewport; .tb-btn compacted + nowrap at tablet width (fixed 2-line button wrap at 900px). test:tree 11/11.

## 2026-10-13 (3) — Planning round: app flow drafts (no code)
- Saved owner's .excalidraw app-flow diagram: notes/planning/app-flow.excalidraw (+ JSON extract from earlier).
- Drafted notes/planning/targetset-mobilization-compare-drafts.md: TargetSet ledger data model w/ Sleepy Hollow filler figures (gov-ops 1,078 MtCO2e 2018; community 74,615 MtCO2e 2019 + ~87,000 2023 update; CLCPA 40/85 targets); Mobilization = extension of shcapdashboard (Sheets CSV pipeline, same 49-action schema); Compare-pathways as persisted trajectory snapshots compared as tonnage lines to target (metrics: target-met year, cost bands, points, certification). Build order: TargetSet → pathways compare → Mobilization → AI ingestion.
- Filler data pending: SH sector shares (CAP Fig 2-1/2-2 values not yet extracted).

## 2026-10-13 (4) — TargetSet tab built (uncommitted)
- New **TargetSet** view in `public/pathways/tech-tree.html`: view-tab bar (PathFinder / TargetSet + 3 disabled planned tabs: ClimateReady, Mobilization, Collective Action), `#app-inv` panel with ledger selector, baseline card, sector bars, inventory-year list, emissions-over-time SVG (measured dots + dashed trend + dashed piecewise target path), targets table, editable trend/end-year assumptions.
- Pure module `INVENTORY_MODEL` (tagged block, testable): ledger lookup, sector rows from absolute or %-share data, compound trend, piecewise-linear target path (floor 0, held flat after last stop), projection with measured-null-off-inventory-years, gap-to-target, targetMetYear (never reports the baseline year). 13 new tests in `tests/inventory-model.test.mjs` → suite 23/23 pass; `npx tsc --noEmit` clean; `npm run lint` clean.
- Filler data: Sleepy Hollow CAP figures extracted from the KB'd CAP PDF and now in-code + `public/pathways/demo-sleepy-hollow-inventory.json`: community 74,615 (2019) / 87,000 (2023, Transportation 49% · Buildings 48% · Other 3%), gov-ops 1,078 (2018; Vehicle Fleet 428 · Buildings 344 · Public Lighting 179 · Water/Wastewater 127), targets −40% 2030 / −85% 2050 (CLCPA-aligned). Ledgers stay separate (gov-ops subset, never summed).
- Bug found + fixed: the scripted light-theme remap had produced **self-referential custom properties** (`--bg:var(--bg)`, `--border:var(--border)`) in `:root`, so those tokens were invalid in light mode (unstyled chips/borders). Replaced with literal light tokens. Also added the missing shared `.chip/.chip-row` CSS and a tick formatter that stops "1k/1k/1k" collapsing on small ledgers.
- Deep links for review: `?view=targetset|pathfinder`, `?theme=dark|light`, `?ledger=community|govops`.
