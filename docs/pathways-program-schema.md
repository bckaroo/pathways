# Pathways Program Module & DB Schema (DEV-278)

A climate-action program is **data, not code**. The same representation works in
three places:

1. **Authored module** — a JSON file (`public/pathways/<id>.json`), git-diffable,
   LLM/gPlanner-editable.
2. **Postgres** — via Drizzle (`src/db/schema.ts`): `programs` + `actions`
   carry tree metadata columns.
3. **API** — `GET /api/program/<slug>` assembles the module from the DB;
   consumed by the tree app via `public/pathways/tech-tree.html?data=/api/program/<slug>`.

## Module shape

```jsonc
{
  "id": "csc-ny",
  "name": "Climate Smart Communities",
  "jurisdiction": "New York State · NYSDEC",
  "source_url": "https://climatesmart.ny.gov",
  "point_ceiling": 300,
  "levels": [ { "name": "Bronze", "min_points": 120, "min_categories": 4 }, ... ],
  "required_actions": [1, 2, 3],           // ids gating all levels above Registered
  "categories": ["PE1", "PE2", ...],        // lane order
  "category_names": { "PE1": "..." , ... },
  "tiers": ["I — Foundation", "..."],       // column headers
  "actions": [ {
      "id": 6, "name": "...", "icon": "🏭",
      "tier": 3, "category": "PE2", "points": "16",
      "prereq": [12],                        // ids of prerequisite actions
      "tags": ["Priority", "CSC Grant"],     // Mandatory | Priority | Grant | CEC | Performance
      "why": "one-line hook for the card",
      "details": [ { "title": "...", "why": "...", "points_how": "...",
                     "submit": "...", "timeframe": "...", "recert": "...",
                     "elig": "...", "phase": "..." } ],
      "lookback": "10 years",                // optional retroactive credit window
      "cobenefits": ["NYSERDA ..."],         // optional funding synergies
      "impact": {                              // optional concept-planning assumption
        "kind": "direct",                      // direct | enabling | adaptation
        "max_annual_mtco2e": 500,              // rounded, editable per action
        "overlap_group": "municipal-fleet"     // total uses group maximum, not sum
      }
  } ]
}
```

## Storage mapping

| Module field | Table.column |
|---|---|
| program id | `programs.slug` (`<id>`-tree convention for checklist programs) |
| jurisdiction, levels, required_actions, categories, category_names, tiers, point_ceiling | `programs.jurisdiction/levels/required_actions/categories/category_names/tiers/point_ceiling` |
| action id ↔ external_id | `actions.external_id` = `action-<id>`; `legacy_action_no` keeps the numeric id |
| tier, icon, why | `actions.tier/.icon/.tree_why` |
| prereq | `actions.prereq_external_ids` (jsonb array of external ids) |
| details | `actions.details` (jsonb array of dossier sections) |
| lookback | `actions.lookback` |
| cobenefits | `actions.cobenefits` (jsonb array) |

Prereqs are stored as **external ids** (not serial PKs) so imports are
idempotent and stable across reorderings. The API route converts external ids
back to numeric ids for the renderer.

## Commands

```bash
docker compose up -d                      # pathways-db (localhost:5433)
npx drizzle-kit migrate                   # apply migrations
npx tsx scripts/seed-tree-program.ts      # seed from public/pathways/csc-ny.json
npm run build && npm run start -- -p <port>
# then: /tree, /api/program/csc-tree
```

## Conventions

- The `csc-tree` program slug is **separate** from the checklist-ingested `csc`
  program (DEV-149 data): tree metadata (tiers/prereqs/funding prose) is
  authored content, the checklist table is official-scorecard data. Merging the
  two is a later, deliberate decision.
- API pages stay `force-dynamic`, degrade gracefully when the DB is down
  (the tree app falls back to its builtin module).
- New program modules must satisfy the JSON Schema (add in
  `scripts/validate-module.mjs` when the first third-party program arrives).

## Illustrative GHG impact assumptions

Impact modeling is deliberately separate from certification scoring. A direct
action's modeled annual impact is its own `max_annual_mtco2e` assumption
multiplied by credited points divided by that action's maximum available points;
the ratio is clamped from zero to one. There is no program-wide CSC
point-to-ton conversion factor. Point displays may be numbers, ranges, or tiered
lists; the largest listed value is the denominator.

`enabling` actions and `adaptation` actions receive no direct quantified impact.
When direct actions share an `overlap_group`, the portfolio total uses the
largest modeled value in that group rather than adding all of them. This avoids
obvious double counting between policies, projects, and performance actions
that can describe the same reductions.

The CSC renderer provides rounded demonstration defaults for a limited set of
direct implementation actions and classifies the rest as enabling or
adaptation. Users can replace each direct action's maximum and credited points
in the dossier; those inputs persist only in browser storage. Imported program
modules can provide their own `impact` objects. All displayed results are
concept-planning illustrations, not an emissions inventory, forecast, achieved
reduction, or DEC-approved accounting method.