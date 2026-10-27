# Pathways — TargetSet, Mobilization, Compare-pathways drafts (planning)

Planning only — no build. Provenance of all filler numbers: Sleepy Hollow CAP
(2025-06-24, KB `environment` domain, SleepyHollowClimateActionPlan20250624).

## 1. TargetSet — "Baseline and Targets"

Owner priority. Content: GHG inventory, emission sectors, emissions over time.

### 1.1 Two ledgers, never mixed (hard rule)

- `community_inventory` — community-wide total (2019 baseline: 74,615 MtCO₂e;
  2023 update ~87,000 MtCO₂e/yr — vintage matters, both stored, never summed).
- `govops_inventory` — SUBSET of the community total (2018 baseline:
  1,078 MtCO₂e; sectors: buildings, vehicle fleet, public lighting,
  wastewater). Displayed in its own card/panel; never added to community.
- CSC certification points continue to live separately (existing rule).

### 1.2 Data model (filler-ready, program module extension)

```jsonc
"inventory": {
  "ledgers": [
    {
      "id": "community",
      "name": "Community-wide",
      "units": "MtCO2e",
      "scope": "community",                 // community | govops (subset)
      "sectors": ["transportation", "residential", "commercial", "waste"],
      "baseline_year": 2019,
      "records": [
        { "year": 2019, "total": 74615,
          "sector_shares": { "…": null },   // fill from CAP Fig 2-x
          "source": "Village of Sleepy Hollow CAP 2025 (2019 data)" }
      ],
      "trend_assumption": { "growth_pct_yr": 2.0,
        "source_label": "placeholder — editable" }
    },
    {
      "id": "govops",
      "name": "Government operations",
      "units": "MtCO2e",
      "scope": "govops",
      "sectors": ["buildings", "vehicle_fleet", "public_lighting", "wastewater"],
      "baseline_year": 2018,
      "records": [
        { "year": 2018, "total": 1078,
          "sectors": null,                  // fill from CAP Fig 2-2
          "source": "Village of Sleepy Hollow CAP 2025 (2018 data)" }
      ]
    }
  ],
  "targets": [
    { "id": "clcpa", "name": "CLCPA-aligned (40/85)",
      "ledger": "community",
      "pct_below_baseline_by_year": [{ "pct": 40, "year": 2030 },
                                     { "pct": 85, "year": 2050 } ],
      "source": "Sleepy Hollow CAP; aligns NY CLCPA + Westchester goals" }
  ]
}
```

Rules: targets interpreted as pct-below-**that ledger's** baseline-year total;
a target attaches to exactly one ledger; unknown sector shares land as `null`
and the UI shows "sector split pending — needs AI ingestion" rather than
inventing numbers.

### 1.3 TargetSet UI (Arc Modern, desktop+tablet; same 3-shell as the options)

- Left: ledger selector (Community / Gov-Ops) + year list with source/vintage
  chips; sector bars where shares exist.
- Center: emissions-over-time chart — measured points vs dashed pre-first-
  year trend, target wedge (two target years → piecewise straight target line
  between them), "gap to target this year" chip.
- Right/below: sector cards (MtCO₂e, % of ledger, source line); targets table.
- Header actions: import inventory JSON, AI-ingest report (later phase),
  edit assumptions.
- Replaces the PathFinder sidebar's hypothetical mini-chart as the source of
  truth: PathFinder scenarios reference the active TargetSet ledger +
  baseline, while remaining concept-mode (illustrative per existing rules).

### 1.4 AI ingestion (park until TargetSet core lands)

Input: a community's inventory PDF/report → extract ledger JSON
(sheets/units/sectors/source/vintage). Reuses the Databricks-free OCR
pipeline pattern (`openclaw-ocr-ingestion-pipeline`). Human-confirmed edit
step before anything enters the ledger; provenance string mandatory.

## 2. Mobilization — extension of the SHCAP Dashboard

Mobilization = progress tracking & milestones. Owner direction: think of it
as an extension of `bckaroo/shcapdashboard` (Google Sheets → published CSV →
single-file HTML dashboard → iframe in the ESRI StoryMap).

- SHCAP data model already matches: `status`, `percentComplete`,
  `targetDate`, `responsibleParty`, `funding`, `implementationProjects`,
  `cscPoints` — 49 CAP actions, villages-edit-Sheets pattern.
- Proposal: Mobilization tab reads the SHCAP CSV (same published-CSV URL
  pattern as progress import) and renders: milestone table (status/target
  date/owner), overdue + next-90-days views, reporting-cadence checklist,
  export for grant reporting (PDF/MD summary per action).
- Keep both entry routes: a community using Sheets keeps editing there
  (single source of truth = the Sheet); Pathways renders + exports. A
  community without Sheets edits inside Pathways (localStorage first, DB later).
- Not public/community-engagement dashboards (owner decision earlier) —
  internal-facing; the SHCAP StoryMap embed stays the public surface.

## 3. Compare pathways — GHG lines over years, race to target

- Mental model (owner): several pathways drawn as different GHG-emissions
  tonnage lines over years on one chart; the comparison is which hits the
  target date/percent first/at all.
- A **pathway** = a named scenario: action selections + completion years +
  impact assumptions — i.e. exactly what Trajectory already computes
  (`PathwaysGHG.buildTrajectory`). So a pathway = a persisted snapshot of
  `impact_inputs` + `completion_years` + `scenario` (+ inventory/ledger ref
  + target ref). Serialization: a `pathways[]` block inside the existing
  progress export; import/export round-trips it. Multiple pathways can be
  computed for one community w/o new storage engines.
- Chart: one line per pathway (from its own trajectory), baseline/BAU +
  target wedge shared with TargetSet. First-crossing annotation per pathway:
  `targetMetYear` (existing rule: only when final-year point still under
  target; quoted from the target-year values).
- Comparison metrics per pathway (table under the chart):
  - **GHG:** target met year (or ✗), annual savings in target year,
    cumulative t CO₂e avoided to 2050.
  - **Cost:** program cost (sum of per-action cost estimates — new optional
    `cost_usd` field per action, filler first), cumulative spend to target.
  - **Effort:** # actions, # requiring capital, CSC points gained.
  - **Certification:** level reached, year.
- Cost caveat for the filler phase: SHCAP's `funding` strings are programs,
  not dollar figures — seed a tiny per-action cost band (low/med/high) as a
  placeholder and keep it clearly labeled illustrative, same treatment as
  GHG assumptions.

## 4. Filler dataset (Sleepy Hollow, clearly-labeled demo)

`programs/demo-sleepy-hollow.json`: module `inventory` block per 1.2 above
(74,615 community 2019; 1,078 gov-ops 2018; ~87,000 2023 update record; CLCPA
40/85 targets) + the 49 SHCAP actions mapped onto the existing action schema
(status → `pw` state; CAP strategies → theme map) so PathFinder, TargetSet,
and (later) Mobilization all light up with real-world-flavored content.
Label: "Demo — Sleepy Hollow CAP figures; illustrative, not live data."

## 5. Status (2026-10-13)
- **TargetSet core BUILT** (uncommitted): view tabs, ledger view, emissions-over-time chart,
  targets table, editable assumptions, SH filler data, 13 inventory tests. Sector splits
  extracted from the CAP (community 49/48/3; gov-ops 428/344/179/127).
- Next: pathways-as-scenarios compare chart, then Mobilization (SHCAP CSV), then AI ingestion.

## 6. Build order (drafting-only sequence once owner says go)

1. TargetSet core: inventory ledger schema + emissions-over-time chart +
   targets + SH filler data (largest new pure-logic module → tests first).
2. Pathways-as-scenarios: serialize `pathways[]`, compare chart + metrics
   table (rides TargetSet baseline instead of inline hypotheticals).
3. Mobilization: SHCAP CSV ingest + milestone views + grant export.
4. AI inventory ingestion (human-confirm loop) — after 1–2 prove the ledger.