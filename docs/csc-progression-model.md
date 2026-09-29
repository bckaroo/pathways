# CSC progression model — the certification skill tree

How a community profile answers *"where is this community, and what unlocks
next?"*, and the data traps that make the naive implementation wrong.

## 1. Why it's a tech tree, not a scoreboard

CSC certification has **four independent requirements per level**. All four must
hold simultaneously:

| Requirement | Bronze | Silver |
|---|---|---|
| Points | 120 | 300 |
| Distinct pledge elements | 4 | 7 |
| Mandatory actions | 2 | 2 |
| Priority actions | 3 | 6 |

You cannot reach a level by grinding points. A community with 400 points but
only 3 pledge elements is not "93% of the way to Silver" — it is blocked on
breadth. That is why the UI shows a requirement ring (mean of the four
fractional coverages) rather than a points bar, and why the "next unlock" line
names the *closest unmet requirement* rather than just the point gap.

## 2. The thresholds are NOT in our database

`certification_levels.points_required` is **NULL for all three rows**. The
values above come from NYSDEC's published Certification Levels page and were
corroborated against our own data:

- the observed Bronze floor among 160 certified communities is **exactly 120**
- the observed Silver floor is **305**, consistent with a 300 threshold

### Two official sources disagree — do not use the wrong one

| Level | NYSDEC website | NYSERDA manual (PDF) | Observed in data |
|---|---|---|---|
| Bronze | 120 | — | floor 120 |
| Silver | **300** | 250 | floor 305 |
| Gold | *"under development"* | 350 | 0 certified |

The website matches the data; **the NYSERDA manual PDF is stale** and lists
250/350. Using it would make the engine disagree with the State on real
communities.

### Gold does not exist

NYSDEC states Gold is *"currently under development."* Zero communities hold it
**because it is not offered**, not because nobody has earned it. Inventing a
Gold threshold would render a progress bar toward a level that cannot be
reached. The UI shows Gold as explicitly not-yet-offered, with no ring.

## 3. `points_awarded` vs `points_approved` — the authoritative total

Both exist and they are **not** the same number:

- `certifications.points_approved` — the official total NYSDEC granted
- `SUM(completions.points_awarded)` — our reconstruction from per-action rows

They agree exactly for **183 of 185** communities. The 3 exceptions are all
small and **negative** (our sum is lower), e.g.:

- `Hyde Park, Town` — approved **121**, computed **117** (−4)
- one Bronze at −15, one Silver at −9

Cause looks like partial-credit rounding on variable-point actions in the
published application: Hyde Park was credited **6** points for an action whose
published range is **1–10**, but `points_approved` implies a larger credit.

**Rule:** for a certified community, `points_approved` wins. For an uncertified
community no approved figure exists, so the per-action sum is the only option —
and the UI labels it *"estimated from completed actions"* and warns it may
differ from a future NYSDEC determination. Never silently mix the two.

This matters directly: `Hyde Park` at 117 computed points would have been shown
as **failing its own Bronze certification** without the approved-total override.

## 4. Only certified communities have action-level data

| | count |
|---|---|
| Municipalities with completions | **185** — all certified |
| Unc certified with completions | **0** |
| Unc certified without completions | **805** |

`completions` originates from published certification reports — one source URL
per application, and `185 certifications = 185 distinct municipalities`. The
805 uncertified municipalities are visible on the map but have **no action-level
data at all**.

**Consequence: the branch view is only renderable for certified communities.**
Any aggregate that averages "branches explored" across all 1,024 will be
computing it over the 185 with data and silently treating 805 as zero. That is
the same class of error as rendering suppressed census data as `0`. Aggregate
statements over the tree must state the denominator, e.g. *"among 185 certified
communities."*

## 5. Recertification is a latent double-count trap

Every municipality currently has **exactly one** `certifications` row — the
ingest keeps only the latest. So joining `completions` through `certifications`
on `municipality_uid` is safe **today**.

It will not stay safe. Recertification is real and present in the source data:
Croton-on-Hudson's CEC history contains *"Bronze CSC Recertification"* and
*"Silver CSC Recertification"* entries. If multiple certification cycles are
ever ingested, then:

```sql
-- WRONG once recertifications are ingested: pulls every cycle's actions
-- together and double-counts points, inflating apparent progress.
SELECT SUM(points_awarded) FROM completions co
JOIN certifications c ON c.cert_uid = co.certification_uid
WHERE c.municipality_uid = $1
```

This is the same shape as the UER alias temporal-split trap in
`docs/ghg-inventory-data-sources.md` §4.3 — two overlapping series in one table,
summed without deduplication, rendering as fake growth. **Filter to a single
`cert_uid`.** The validator asserts exactly one certification per municipality
today and will fail loudly if that stops being true.

## 6. Pledge element codes have no names in our database

`actions.pledge_element` stores bare codes `PE1`…`PE10`. Names live in
`src/lib/csc-progression.ts` (`CSC_PLEDGE_ELEMENTS`), sourced from NYSDEC's
pledge element list. Ten named groupings (`Performance`, `Innovation`, …) also
appear and are not pledge elements — the tree distinguishes them, since only
`PE*` groups count toward the "distinct pledge elements" requirement.

## 7. Verification

```bash
npm run validate:csc     # reproduces the certified level of all 185 communities
```

The validator is the ground truth check. For every certified community it
asserts:

1. the community **satisfies** the requirements of the level it holds
2. the community does **not** satisfy the next level up

(2) is the stronger test — it proves the thresholds are not too permissive, so a
"you can level up" prompt can be trusted. Result: **185/185 satisfy their own
level, 160/160 correctly fail the next, 0 too-permissive.**

Any threshold or rule change must keep this at 185/185. If NYSDEC later defines
Gold, add the threshold here, extend the validator, and re-run.

## 8. Files

| File | Role |
|---|---|
| `src/lib/csc-progression.ts` | level definitions, rule engine, gap analysis |
| `src/components/progression-panel.tsx` | the tree UI (no rules computed inline) |
| `scripts/validate-csc-rules.mjs` | 185-community ground-truth check |
| `src/app/communities/[uid]/page.tsx` | passes completions + cert into the panel |
