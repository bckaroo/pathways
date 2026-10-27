# Pathways — Application Flow Concept (planning, not build)

Source: Andrew's Excalidraw chart (room e98395318c60e2e95068, saved 2026-10-13).
Status: planning mode — nothing here is committed to build.

## Concept narrative (5 stages, top-level tabs)

1. **Collective Action** — *"What is happening"* — NYS portfolio view.
   5th tab per owner decision. Content: how NYS CSC communities are performing
   (who's Bronze/Silver/Registered), what PEs are getting accomplished at
   portfolio level, geographies (map). Data: CSC certification list (NYSERDA
   / climatesmart.ny.gov) + map of adopted communities.
2. **TargetSet** — *"Baseline and Targets"* — GHG inventory, emission
   sectors, emissions over time. Owner priority for next build cycle
   (natural predecessor to PathFinder: you can't model pathways before you
   have a baseline).
3. **ClimateReady** — *"Adaptation & Resiliency"* — climate vulnerability
   (risk × impact), mitigation (reduce impact), adaptation (reduce risk).
4. **PathFinder** — *"Selecting Actions"* — BUILT (skill tree): climate
   actions, modeled GHG mitigation, co-benefits.
5. **Mobilization** — *"Monitoring Progress"* — per owner decision:
   progress tracking & milestones (status, target dates, reporting cadence,
   export for grant reporting). NOT engagement.

## Feature matrix (from chart, mapped to homes)

| Feature | Home | State |
|---|---|---|
| Import Existing CSC Actions | TargetSet | exists (progress import / program modules) |
| Integrates with any Climate Action Program | TargetSet + shell | schema exists (`program_module`) |
| AI Ingestion of Inventory Reports | TargetSet | new; Databricks-free OCR/ingest pattern exists |
| Calculate CSC Steps | TargetSet + PathFinder | points engine exists |
| Visualize decarb scenarios | PathFinder | trajectory chart exists (concept-only rules) |
| Understand Climate Actions | PathFinder | dossier exists |
| See how other communities act | Collective Action / Mobilization | new; needs multi-community dataset |
| Compare different pathways | Mobilization | new; save/compare saved scenarios |
| Export Pathways | global | stub exists |
| Collective Action (tab) | — | new |

## Build order (owner-agreed priority)

1. TargetSet — baseline: inventory + sectors + emissions-over-time
2. Mobilization — tracking/milestones/export
3. Collective Action — portfolio view + map
4. ClimateReady — vulnerability mapping (GIS-heavy)

## Open questions

- TargetSet data source for communities without an inventory: manual entry,
  AI ingestion of existing reports, or NYSERDA-provided inventories?
- Mobilization milestone model: dates per action already stored
  (`pw-years`); add status (planned/in-progress/complete/deferred)?
- Compare-pathways: scenario snapshots should ride the existing progress
  export format (add a `scenario_variants[]` block) rather than new storage.
- Inventory accounting must stay separate from CSC certification points
  (existing rule) — TargetSet is the natural home for the ledger.
- Phones: not a priority (owner 2026-10); optimize desktop + tablet.