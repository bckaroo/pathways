# GHG Inventory Data Sources — NY State / Region / County / Municipality

Research date: **2026-09-28**. All row counts and coverage figures below were
retrieved live from the Socrata APIs, not read off documentation.

Status: **research complete, ingestion not yet built.**

---

## 1. What actually exists

Four independent dataset families, at four different grains. They do **not**
nest cleanly — that is the central design problem, and it is why this document
exists rather than a schema alone.

| Grain | Dataset | Rows | Years | Source |
|---|---|---|---|---|
| State | Statewide GHG Emissions (`5i6e-asw6`) | 18,632 | 1990–2023 | NYSDEC / CLCPA |
| County | UER County Energy Use (`46pe-aat9`) | 299,662 | 2021–2025 | NYSERDA UER |
| County | UER County Energy Use, frozen (`47km-hhvs`) | 123,713 | 2016–2021 | NYSERDA UER |
| Municipality | UER Community Energy Use (`m3xm-q3dw`) | 1,675,299 | 2016–2020 | NYSERDA UER |
| ZIP | UER ZIP Energy Use (`g2x3-izm4`) | 273,665 | 2021+ | NYSERDA UER |
| ZIP | UER ZIP Energy Use, frozen (`tzb9-c2c6`) | 743,398 | 2016–2021 | NYSERDA UER |
| Facility | Title V Emissions Inventory (`4ry5-tfin`) | 5,647 | 2010+ | NYSDEC air quality |

Base URL for all: `https://data.ny.gov/resource/<id>.json`
(Socrata SoQL. No key required for modest volumes; a free app token raises
throttling limits.)

---

## 2. The state layer — emissions, not consumption

The only dataset that contains **actual GHG emissions** rather than energy
consumption.

### 2.1 The accounting flags are ORTHOGONAL, and getting this wrong loses 31%

This is the single most consequential trap in the entire dataset. There are
**four independent flag/axis columns** that all look like "the filter":

| Column | Values | Meaning |
|---|---|---|
| `gross` | Yes / No | gross vs. net of sequestration |
| `net` | Yes / No | **overlaps `gross`** — 15,742 rows are `Yes` on both |
| `conventional_accounting` | Yes / No | adds/omits the CLCPA extras below |
| `sector` / `category` / `sub_category_1..3` / `gas` | — | **nested**, not flat |

**Verified reconciliation for 2023:**

| Slice | Total |
|---|---|
| `gross='Yes' AND conventional_accounting='Yes'` | 243.37 mmt |
| `gross='Yes' AND conventional_accounting='No'` | **110.69 mmt** |
| `gross='Yes'` (either) | **354.06 mmt** ✅ |

**354.06 mmt is exactly the NYSDEC published gross 2023 figure**, and it is only
reached by summing *both* accounting treatments. The `conventional_accounting='No'`
rows are not an alternative view to discard — they are the CLCPA-mandated
additions, and they include:

| Category | sub_category_1 | 2023 |
|---|---|---|
| Imported Fossil Fuels | Transportation | 25.40 mmt |
| Solid Waste Management | Out-of-State Waste Disposal | 17.28 mmt |
| Imported Fossil Fuels | Residential | 14.84 mmt |
| Imported Fossil Fuels | Electricity | 13.52 mmt |
| Imported Fossil Fuels | Commercial | 9.82 mmt |
| Imported Electricity | Net Electricity Imports | 6.33 mmt |
| ... | (plus Direct Electricity Imports, in-state waste combustion) | |

> **The failure mode:** filtering to the intuitive
> `conventional_accounting='Yes'` produces **243.37 mmt, a 31% understatement**,
> which is internally consistent, plausibly precise, and wrong. Nothing in the
> API flags it. The only way to catch it is to reconcile against the published
> headline — which is why §8's reproduction steps exist.

**Net vs gross:** `net` totals are 305.07 mmt (either accounting) vs 205.89 mmt
(conventional only) — the same 31% trap appears on the net axis.

**Reconciliation verified across five years** (the CLCPA extras are a stable
~31% of the total, so this is a systematic property, not a one-year artifact):

| year | gross total | conventional | CLCPA extra | extra % |
|---|---|---|---|---|
| 2019 | 367.59 | 247.47 | 120.12 | 32.7% |
| 2020 | 326.87 | 225.93 | 100.94 | 30.9% |
| 2021 | 346.38 | 238.22 | 108.16 | 31.2% |
| 2022 | 354.00 | 242.82 | 111.18 | 31.4% |
| 2023 | **354.06** | 243.37 | 110.69 | 31.3% |

Two independent published NYSDEC figures reproduce exactly from the raw API:

- 1990 gross 415.73 mmt → 2023 gross 354.06 mmt = **−14.8%** ✅
  (the published "14.8% below the 1990 baseline")
- 1990 net 367.28 mmt → 2023 net 305.07 mmt = **−16.9%**

These two checks are the acceptance test for any state-level ingestion. If a
pipeline cannot reproduce them, its filters are wrong.


### 2.2 The hierarchy is NESTED — flat sums double-count

`Not Applicable` at a level means *"no breakdown reported at this level"*, i.e.
**that row is itself the rollup**. Summing all rows adds parents to children.

**Level-by-level structure for `Energy` / `Fuel Combustion` (2023):**

| Column | Distinct values | Contains `Not Applicable`? | Role |
|---|---|---|---|
| `sub_category_1` | 5 | **no** | end-use: Transportation, Industrial, Commercial, Residential, Electricity |
| `sub_category_2` | 15 | **yes** (102 rows) | mode: Road, Military, Nonroad-… |
| `sub_category_3` | 22 | **no** | fuel: Gasoline, Distillate Fuel, Natural Gas, Residual Fuel, Wood, Kerosene, … |

> Note: `Not Applicable` appears at **`sub_category_2`**, not
> `sub_category_3`. `sub_category_3` is fully enumerated for Fuel Combustion.

**Validated leaf rule:** for `Energy` / `Fuel Combustion`, sum
`sub_category_3 != 'Not Applicable'`. Verified exact:

```
category-level total   (conv. accounting) = 155.54 mmt
sub_category_3 leaf sum (conv. accounting) = 155.54 mmt   ✅ identical
```

**Watch the accounting filter while doing this.** Fuel Combustion is
**163.82 mmt** across both accounting treatments and **155.54 mmt** conventional
only. Comparing a figure computed under one treatment against one computed under
the other is itself a bug — and it is exactly how this document's first draft
went wrong.

Other categories (`Fugitive Emissions`, `Other Fossil Fuel Use`,
`Electricity Transmission`) and all non-Energy sectors have no sub-category
breakdown → use them directly at `category` level.

**Verified Energy reconstruction (2023, gross, conventional accounting):**

| Component | mmt |
|---|---|
| Fuel Combustion | 155.54 |
| Fugitive Emissions | 13.38 |
| Other Fossil Fuel Use | 0.84 |
| Electricity Transmission | 0.12 |
| **Energy total** | **169.88** |
| Waste | 27.64 |
| IPPU | 23.71 |
| AFOLU | 22.13 |
| **Grand total (conventional)** | **243.37** |
| + non-conventional (CLCPA extras) | 110.69 |
| **= published gross 2023** | **354.06** ✅ |


### 2.3 Accounting axes (per row)

- `sector`: `Energy` · `AFOLU` · `IPPU` · `Waste`
- `category`, `sub_category_1..3` — nested (see 2.2)
- `gas`: CO2 · CH4 · N2O · HFCs · PFCs · SF6 · NF3
- `year`: 1990–2023
- **Two GWPs per row**: `mt_co2e_ar5_20_yr` and `mt_co2e_ar5_100_yr`

> **GWP design consequence:** CLCPA reports on a **20-year GWP**; nearly every
> other US inventory uses 100-year. Both columns exist, so this must be an
> explicit user-facing toggle, never a silent default. Mixing them across a
> dashboard produces numbers that look plausible and are wrong by a large factor
> for methane.

**2023 composition (gross, conventional):** CO2 ~64.6%, CH4 ~24.9%,
HFCs ~8.8%, N2O ~1.6%.

**Critical limitation:** statewide only. There is **no sub-state breakdown here**.
State → county apportionment must come from the UER and be computed, not read.


---

## 3. The UER layer — consumption, needing factors

### 3.1 It is consumption, NOT emissions

Verified unit list for community data:

| data_class | unit | rows |
|---|---|---|
| electricity | MWh | 522,478 |
| electricity | MW | 484,290 |
| natural_gas | Therms | 386,970 |
| electricity | count | 163,830 |
| natural_gas | count | 117,731 |

`MW` rows are **demand/capacity**, not energy — mixing them into an energy
total is a category error that would inflate results. `count` rows are account
counts (needed for per-capita normalization).

> **Emissions must be derived** by joining consumption to an emission-factor
> set. That factor set is a versioned artifact with its own provenance, exactly
> as in the KCC prototype — the pipeline must refuse to produce a number
> without one rather than reaching for a default.

### 3.2 Customer classes (community grain)

Community data splits consumption by class, which is what makes the inventory
analytically useful rather than decorative:

| Field | Meaning |
|---|---|
| `Residential (R)` | residential |
| `Small Commercial (SC)` | small commercial |
| `Other (O)` | large commercial / industrial |
| `Total (T)` | all |
| `Business (SC+O)` | commercial aggregate |
| `Small Consumer (R+SC)` | |
| `ICAP Capacity Tag (…)` | demand-side capacity, per class |
| `CCA-Ineligible Customer Count (…)` | Community Choice Aggregation eligibility |

CCA eligibility is a signal worth surfacing: it indicates whether a
municipality can act on its own supply-side emissions.

### 3.3 County grain has a DER dimension the community grain lacks

`DER_*` fields enumerate distributed energy resources:

- Technology: `DER_PV` (solar), `DER_ESS` (storage), `DER_HYDRO`, `DER_FC`
  (fuel cells), `DER_FW` (fuel cells / wind?), `DER_OTHER`, `DER_TOTALS`
- Program: `_All`, `_CDG` (Community Distributed Generation), `_NM/Onsite`
  (net metering / behind-the-meter), `_RC`, `_RNM`

Plus `Commercial Consumption (C)` and `CCA Opt-Out Eligible Load`.

---

## 4. Hard limitations — read before designing

### 4.1 There is no "region" grain anywhere

Verified `data_stream` values across all UER datasets:
`county_monthly`, `zipcode_monthly`, `zip_monthly`, `community_monthly`.

**No regional dataset exists.** The state→region→county→municipality ladder in
the request has a missing rung. Options, in preference order:

1. **Derive regions by aggregating counties** using a published NY regional
   scheme (e.g. the 10 Regional Economic Development Council regions, or the
   9 CLCPA / DEC regions). Defensible *if the scheme is sourced and cited*;
   regional totals then equal the sum of their counties by construction.
2. Use **ZIP rollups** as a proxy — worse, because ZIPs cross county lines and
   the frozen/populated year ranges differ.

Do **not** invent a region definition. A dashboard where two regions overlap
one county double-counts that county and is worse than having no region view.

### 4.2 NYC is badly incomplete at the municipal grain

Verified: the community dataset (`m3xm-q3dw`, the 2016–2020 municipal series)
contains only **three** boroughs, and one of them only partially.

| Borough | county_name | in community data |
|---|---|---|
| Brooklyn | Kings | natural gas only — **no electricity** |
| Queens | Queens | yes |
| Staten Island | Richmond | yes |
| **Manhattan** | **New York** | **absent — 0 rows** |
| **The Bronx** | **Bronx** | **absent — 0 rows** |

Verified query returning nothing:
`$where=county_name='New York'` and `$where=county_name='Bronx'` both return
zero rows from `m3xm-q3dw`.

Consequence: **the single largest emissions source in the state cannot be
inventoried at the municipal grain.** Any municipal map will show NYC as
near-empty, which will read as "NYC has low emissions" unless the gap is stated
on the face of the visual.

**County grain is complete for all five** and is the correct fallback — all of
`New York`, `Kings`, `Queens`, `Bronx`, `Richmond` are present in `46pe-aat9`
with roughly 2,700–3,800 rows each. This is the strongest argument for a
county-first architecture with municipal detail as a second-class grain.

> Note the asymmetry, which is easy to conflate: the boroughs are **absent from
> the municipal series** but **present in the county series**. The gap is a
> grain problem, not a data-availability problem.


### 4.3 County aliases are a TEMPORAL split, not duplicates — and summing them fakes a trend

The county dataset contains **65 `county_name` values for 62 real counties**.
The extra three are alias pairs for NYC counties:

```
'Kings'  + 'Brooklyn'
'New York' + 'Manhattan'
'Richmond' + 'Staten Island'
```

**Verified structure (natural gas, Consolidated Edison, `46pe-aat9`):**

| `county_name` | years present | rows | distinct `data_field` | `Total Consumption (T)` |
|---|---|---|---|---|
| `New York` | **2021–2025** | 2,892 | 65 | 2,982,498,783 Therms |
| `Manhattan` | **2024–2025** | 306 | 17 | 986,234,688 Therms |

Both are the same county and the same utility. The alias is **not** a duplicate
row and **not** a complementary field set — it is a **second reported series
covering only the most recent years**, under a newer naming convention that
overlaps the older one.

> **This is the most dangerous trap in the dataset.** A plain `GROUP BY
> county_name` reports Manhattan and the Bronx twice **for 2024–2025 only**.
> Because the overlap is confined to the newest years, the error *increases over
> time* and renders as **apparent emissions growth in NYC** — a plausible-looking
> trend that is entirely an artifact. Any county time series must collapse the
> alias pairs to a canonical county id *before* aggregating, and the rule must
> be: **prefer the longer series (`New York`), and reconcile the overlap
> explicitly** rather than summing.

Related but separate: the **field vocabularies differ** between the two names
(65 vs 17 `data_field` codes). `Manhattan` carries `ICAP Capacity Tag` and
`Industrial Consumption (I)`; `New York` carries the `DER_*` family. Neither is
a superset, so **whichever name is chosen, some fields are lost** — the union is
needed, with the overlap deduplicated. This is a normalization problem that
cannot be deferred.


### 4.4 Municipal data is frozen at 2020; county data runs to 2025

- Community (`m3xm-q3dw`): **2016–2020** (annual max is 2020, despite the
  dataset title saying 2021)
- County (`46pe-aat9`): **2021–2025**

There is **no year where both grains have data**. Municipal and county views
cannot be shown on a shared time axis without either (a) restricting to 2020
and its county equivalent from the frozen dataset, or (b) clearly labelling
them as different periods.

### 4.5 Small populations are suppressed

12 of 973 municipality-grain rows fail to join, and the cause is mostly
suppression rather than name mismatch — e.g. `West Hampton Dunes`,
`Centre Island`, `Shoreham`. These are genuinely tiny villages where utility
data would identify individual customers.

> Absence must render as **"not published"**, never as 0. This is the same
> unknown-is-not-zero bug that had to be fixed in the KCC prototype validator.

### 4.6 Units are inconsistent across the county dataset

Both `Therms` (22,719 rows) and `therms` (720 rows) appear; `MWh` and `MWH`
likewise. Normalization is required before any aggregation.

---

## 5. Join to the `pathways.municipalities` table

Verified against the live DB (1,024 rows).

`municipalities` columns: `portal_uid`, `name`, `area_type`, `county`,
`latitude`, `longitude`, `certification_level`, `certification_level_name`,
`cert_uid`, `has_gold_star`, `source_url`, `updated_at`.

The `name` field is **structured**: `"Holland Patent, Village (Oneida)"` —
base name, type, and county in one string. `area_type` and `county` duplicate
it as columns.

### Grain mismatch inside our own table

| `area_type` | count |
|---|---|
| town | 579 |
| village | 335 |
| city | 59 |
| **county** | **51** |

51 rows are **counties, not municipalities**. Any municipal-level aggregate must
filter these out or they will appear as very large "municipalities."

### Join results (normalized name, municipality-grain rows only)

| Metric | Value |
|---|---|
| municipality-grain rows | 973 |
| **matched to UER** | **961 (98.8%)** |
| unmatched | 12 |

The 12 unmatched, by cause:

| Cause | Examples | Handling |
|---|---|---|
| Spacing / punctuation | `DeWitt`↔`De Witt`, `AuSable`↔`Au Sable`, `La Fayette`↔`Lafayette` | fuzzy match on collapsed whitespace + no punctuation |
| NYC | `New York City`, `New York` | special-case to the 5 borough counties |
| True suppression | `West Hampton Dunes`, `Centre Island`, `Shoreham`, `Lake Placid`, `Harrisville` | label "not published" |

Also present in UER but not in our table: `Reservation` rows (e.g. `St. Regis
Mohawk Reservation`) — 684 rows, a grain our schema does not model.

---

## 6. Recommended architecture

### 6.1 Layering — mirrors the KCC prototype's split, for the same reason

```
raw ingestion        → one table per source, unmodified, with source lineage
   ↓
normalization        → canonical county ids, canonical units, canonical place ids
   ↓
derivation (two)     → emissions layer   (needs versioned factor set, scope rules)
                       intensity layer   (needs population / area / accounts)
```

Emissions and intensity are **different arithmetic on the same consumption
rows**. Sharing a source table does not make them one deliverable — this is the
same conclusion reached on KCC, and the same mistake is available here.

### 6.2 Grain registry

Every derived row must carry its grain explicitly:
`state | region | county | municipality | zip | facility`.
Nothing may be compared across grains without an explicit apportionment, and
the UI should refuse to do so silently.

### 6.3 Non-negotiables

1. **Factor set is versioned and required.** No emissions number without one.
2. **`conventional_accounting` is NOT a filter — sum both values.** Filtering to
   `'Yes'` understates the state total by 31% (§2.1). This is the highest-risk
   item in the entire dataset.
3. **Respect the nested hierarchy.** Use fuel-level leaves for Fuel Combustion;
   never flat-sum parents with children (§2.2).
4. **20-yr vs 100-yr GWP is an explicit toggle**, defaulted to 20-yr for CLCPA
   alignment and labelled.
5. **Canonical county mapping** collapsing the three NYC alias pairs, with the
   temporal-overlap rule from §4.3. Not a `GROUP BY county_name`.
6. **Suppressed ≠ zero** — render as "not published."
7. **No invented regions** — regions are derived from a cited county scheme.
8. **NYC municipal gap is stated in the UI**, not buried in a footnote.
9. **`MW` and `count` rows never enter an energy total.**
10. **Units normalized** (`Therms`/`therms`, `MWh`/`MWH`) before aggregation.
11. **State-level acceptance test:** a pipeline must reproduce **354.06 mmt
    gross 2023** and **−14.8% vs 1990**, or its filters are wrong (§2.1).


---

## 7. Open questions needing a decision

1. **Which regional scheme?** 10 REDC regions, or the DEC/CLCPA regions, or
   none at all for v1?
2. **Municipal time axis.** Restrict to 2020 (both grains populated via the
   frozen county dataset) or show grains on separate axes?
3. **Who owns the factor set?** EPA eGRID subregion is the natural choice for
   electricity (NY has several zones: upstate NYUP, NYCW, NENY, Long Island),
   and it changes year over year. This is real modeling work, not a lookup.
4. **Does the municipal gap make a county-first v1 the honest call?** The
   available evidence says yes.

---

## 8. Reproduction

Every claim in this document is asserted by a runnable script:

```bash
npm run verify:ghg        # 31 checks, exits non-zero if any claim is now false
```

The script is the authoritative form of the checks below. Key ones:

```bash
# --- §2.1 THE 31% TRAP: the state total only reconciles if BOTH are summed ---
curl -s "https://data.ny.gov/resource/5i6e-asw6.json?\$select=sum(mt_co2e_ar5_20_yr)&\$where=year='2023' AND gross='Yes' AND conventional_accounting='Yes'"
#   -> 243.37 mmt   WRONG (a 31% understatement)

curl -s "https://data.ny.gov/resource/5i6e-asw6.json?\$select=sum(mt_co2e_ar5_20_yr)&\$where=year='2023' AND gross='Yes'"
#   -> 354.06 mmt   CORRECT (matches the NYSDEC published headline)

# --- §2.2 nested hierarchy: fuel-level leaves == category-level total ---
# both return 155,540,083  (note: MUST hold the accounting filter constant)
curl -s "https://data.ny.gov/resource/5i6e-asw6.json?\$select=sum(mt_co2e_ar5_20_yr)&\$where=year='2023' AND gross='Yes' AND sector='Energy' AND category='Fuel Combustion' AND conventional_accounting='Yes'"
curl -s "https://data.ny.gov/resource/5i6e-asw6.json?\$select=sum(mt_co2e_ar5_20_yr)&\$where=year='2023' AND gross='Yes' AND sector='Energy' AND category='Fuel Combustion' AND conventional_accounting='Yes' AND sub_category_3!='Not Applicable'"

# --- §4.1 no region grain exists ---
curl -s "https://data.ny.gov/resource/46pe-aat9.json?\$select=distinct data_stream"
#   -> ["county_monthly"]  (no regional stream exists)

# --- §4.2 NYC absent from the municipal series (both return []) ---
curl -s "https://data.ny.gov/resource/m3xm-q3dw.json?\$select=distinct com_name&\$where=county_name='New York'"
curl -s "https://data.ny.gov/resource/m3xm-q3dw.json?\$select=distinct com_name&\$where=county_name='Bronx'"

# --- §4.3 alias pairs are a TEMPORAL split (2021-25 canonical vs 2024-25 alias) ---
curl -s "https://data.ny.gov/resource/46pe-aat9.json?\$select=county_name,year&\$where=county_name in('New York','Manhattan')&\$group=county_name,year&\$order=county_name,year"
```

### Methodological note — five wrong hypotheses, all corrected by reconciliation

Every non-obvious claim here was tested against the live API. **Five of the
author's initial hypotheses were false**, and each failure produced a
plausible-looking number:

| # | Hypothesis | Reality |
|---|---|---|
| 1 | The NYC alias pairs are duplicate rows | They are a **temporal split** (§4.3) |
| 2 | The aliases hold identical values | **Different series**, different field vocabularies |
| 3 | `conventional_accounting='Yes'` is the CLCPA filter | Filtering to it **drops 31%** (§2.1) |
| 4 | `Not Applicable` appears at `sub_category_3` | It appears at **`sub_category_2`** (§2.2) |
| 5 | Fuel Combustion 2023 = 155.54 mmt (unqualified) | **163.82 mmt** all-accounting; 155.54 is conventional-only |

What settled every one of them was **reconciling against a published NYSDEC
figure** — 354.06 mmt gross 2023, and −14.8% vs 1990. Neither was read off
documentation; both were reproduced from the raw API.

> **Do not trust a plausible number from this API without reconciling it
> against a published figure.** The failure mode is not an error — it is a
> precise, internally consistent, wrong answer.


