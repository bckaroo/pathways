# CSC certification actions — catalogue, crosswalk, and verification

Reference for the CSC action catalogue behind the progression feature, and the
verification that keeps it honest against NYSDEC's published artifacts.

## 1. Where the data comes from

Two authorities, both published by NYSDEC and both cached under
`~/.hermes/cache/scratch/`:

| Artifact | What it gives us |
|---|---|
| **2025 Action Checklist** (xlsx, version 4.5, dated 2025-12-18) | every action, its point range, and its Mandatory / Priority / CSC-Grant status |
| **CEC/CSC Crosswalk** (pdf, dated 2024-12-20) | which CEC high-impact actions satisfy which CSC action |

```
https://climatesmart.ny.gov/fileadmin/csc/documents/Action_Checklist/
  2025-12-18-CSC-CertActionChecklist.xlsx
https://climatesmart.ny.gov/fileadmin/csc/documents/CEC_CSC_Crosswalk/
  2024-12-20-CEC-CSC-Crosswalk.pdf
```

**CloudFront returns HTTP 403 to a bare `curl`.** A browser User-Agent *and* a
`Referer` pointing at the actions page are both required — verified: 403 without,
200 with. The fetch helper in `scripts/verify_csc_actions.py` sets both, so this
is not a manual step.

The xlsx is parsed **from its XML parts with the stdlib** (`zipfile` +
`ElementTree`, reading `sharedStrings.xml` and `sheet1.xml`). The collector
house rule forbids `openpyxl`, and an xlsx is only a zip of XML, so no
dependency is needed.

## 2. Catalogue status — fully verified

`npm run verify:csc` reproduces the official catalogue exactly:

| Check | Result |
|---|---|
| official actions parsed | **124** |
| actions in database | **124** |
| points match (min/max per action) | **117/117 compared, 0 disagreements** |
| `mandatory` / `priority` / `funding_eligible` | **0 disagreements** |
| `variable_points == (min != max)` | **0 disagreements** |
| max single-action points | **45** on both sides |

The 7 actions not name-compared are the `Innovation:` and `Performance:` groups,
which the database stores without their group prefix. They are present and
correct; only the comparison key differs.

**The database is current and complete.** No ingest drift.

## 3. The point-scale split — why CSC and CEC need separate trees

| Program | Agency | Actions | Point scale | Status |
|---|---|---|---|---|
| `csc` | NYSDEC | 124 | **1–45** | active |
| `cec` | NYSERDA | 105 | **0–6700** | **closed** |

Plotting both on one axis is meaningless. They are two parallel progression
paths joined by the crosswalk — a dual tech tree, not one tree.

## 4. The crosswalk — 35 rows, many-to-many in both directions

Structure: **CEC high-impact action → CSC certification action**. The table holds
35 rows spanning only **23 distinct CSC actions** and 35 CEC action names.

Eight CSC actions are reachable from more than one CEC action:

| CSC action | CEC routes |
|---|---|
| `advanced-vehicles` | **4** |
| `community-campaigns` | 3 |
| `green-financing` | 3 |
| `electric-vehicle-charging-stations`, `heat-pumps`, `build-ready-program`, `thermal-energy-networks`, `led-street-lights` | 2 each |

### The fan-out trap (I fell into it)

```sql
-- WRONG: this returns 41 rows for a 35-row table
SELECT COUNT(*) FROM crosswalk cw
LEFT JOIN actions a ON a.external_id = cw.csc_action_external_id
```

A `LEFT JOIN` to `actions` fans out wherever a CSC action has multiple CEC
routes. **Use `COUNT(DISTINCT cw.id)`.** The verifier asserts the un-fanned
count so this cannot regress quietly.

### CEC names do not join cleanly to `cec_completions`

24 of the 35 crosswalk rows have an empty `cec_hia_id`. That is not missing
data — CEC's `designations` table holds only per-community **totals** (stars,
points), while the granular CEC action list lives in `cec_completions`. The
crosswalk references CEC actions by their published *name*, which differs from
the completion rows under five documented conventions:

| Convention | Crosswalk name | CEC data name |
|---|---|---|
| group prefix added | `Renewable Energy: CDG Subscription` | `CDG Subscription` |
| group prefix dropped | `LED Streetlights: 50% Conversion of Cobra Head Streetlights` | `50% Conversion of Cobra Head Streetlights` |
| tier suffix added | `Community Campaigns for Community Solar` | `... - Community Solar - Tier 1\|2\|3` |
| connector + plural | `...Campaigns for...` | `...Campaigns - ...` |
| vehicle class ↔ tier | `Light-Duty Electric Vehicles (Class-1-2)` | `Light-Duty Electric Vehicles - Tier 1\|2\|3` |

After normalising all five: **30 of 35 resolve by rule, 0 need hand-curation,
5 have no CEC counterpart at all.**

The 5 gaps, verified by searching **every text column of every table** (absence
from `cec_completions` alone would only prove nobody completed it):

- `Municipal Building Demonstration: Pool Heat Pump` — only in `crosswalk`
- `NY Green Bank Project Closing` — only in `crosswalk`
- `Thermal Energy Network: Study` / `: RFP` — the CSC action exists, CEC has no counterpart
- `Medium/Heavy-Duty Electric Vehicles (Class 3-8)` — CEC's nearest row is
  `Clean Fleets - Heavy Duty Electric Vehicles`, a **different action family**

These are recorded as known gaps, not as failures. A failure count that cannot
be driven to zero is noise, and noise gets ignored.

## 5. Never fuzzy-match action names

Token-overlap similarity produces confident wrong answers on this data. Measured
false positives from a real run:

| Crosswalk name | Wrongly matched | Score | Why it is wrong |
|---|---|---|---|
| `Medium/Heavy-Duty Electric Vehicles (Class 3-8)` | `Medium/Heavy-Duty Non-Road Vehicles` | 0.63 | "Electric" ≠ "Non-Road" — different actions |
| `Thermal Energy Network: Study` | `Benchmarking – CEC Energy Study Qualification` | 0.47 | matched on the single shared word "Study" |

Both score above any plausible threshold. **Any CEC↔CSC action mapping must be
curated and committed to the repo, never derived from a similarity score.**

## 6. Two bugs I wrote, and what they cost

Both were in my own verification code, and both produced *plausible wrong
numbers* rather than errors — the failure mode this project keeps hitting.

### `[^a-z0-9]` strip must run AFTER `.lower()`

```python
s = re.sub(r"[^a-z0-9]+", " ", s).strip().lower()   # WRONG
s = s.lower(); re.sub(r"[^a-z0-9]+", " ", s)        # right
```

`[^a-z0-9]` removes anything outside `a-z0-9`, which includes **every uppercase
letter**. Running it before lowercasing silently ate the first character of each
capitalised word: `"Municipal Building Demos"` → `"unicipal uilding emos"`.
Unmatched names then became permanent false negatives that looked like data
problems.

### Never hand-write a lookup key

`ABSENT_FROM_CEC` was typed as `"municipal building demo pool heat pump"` while
the normaliser emits `"...demos..."` (singular→plural). The lookup silently
missed for three iterations. **Build such keys by calling the normaliser**, as
the verifier now does.

## 7. `completions.summary` — 1.6M characters of unused evidence

Not part of the catalogue, but found while searching the schema and worth
recording:

| | value |
|---|---|
| completions rows | 4,530 |
| with a non-empty `summary` | **3,374** |
| average length | 485 chars |
| longest | 2,000 chars (capped) |
| total | **~1.64M characters** |

This is the per-action justification text from the certification reports — what
the community actually did, in its own words. Example:

> *13 Points Documented. The community-wide plan for green infrastructure is
> attached as: GI Planning Design Guidelines Monroe County. Monroe County also
> partnered with the City of Rochester to create a community-wide plan for green
> infrastructure retrofitting...*

It is currently **unused by any feature**, and it is the richest content in the
database. Natural uses: an evidence quote per completed action on the profile,
search across justifications, and qualitative analysis of what "Priority action"
means in practice.

## 8. Verification

```bash
npm run verify:csc        # 13 checks against the published artifacts
npm run validate:csc      # 185/185 certified levels reproduced by the rule engine
```

`verify:csc` asserts catalogue completeness, per-action point agreement, gating
flags, `variable_points` derivation, crosswalk join integrity (including the
fan-out guard), and that every crosswalk CEC name is either resolved or a
recorded gap.

## 9. Files

| File | Role |
|---|---|
| `scripts/verify_csc_actions.py` | 13 checks vs the official artifacts (`verify:csc`) |
| `src/lib/csc-progression.ts` | level rules and gap analysis |
| `src/components/progression-panel.tsx` | the skill-tree UI |
| `scripts/validate-csc-rules.mjs` | 185-community ground-truth check (`validate:csc`) |
| `docs/csc-progression-model.md` | thresholds, level rules, recertification trap |
