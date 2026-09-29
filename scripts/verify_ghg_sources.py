#!/usr/bin/env python3
"""
Verify GHG inventory data-source claims against the live Socrata APIs.

Companion to docs/ghg-inventory-data-sources.md. Every claim in that document
that could silently be wrong is asserted here.

WHY THIS EXISTS
---------------
While researching the data sources, three plausible hypotheses turned out to be
FALSE, and each failure produced a number that looked fine:

  1. The NYC county alias pairs were assumed to be duplicate rows. They are a
     TEMPORAL split (canonical series 2021-2025, alias series 2024-2025 only).
  2. The alias pairs were then assumed to hold identical values. They hold
     different series AND different field vocabularies.
  3. `conventional_accounting='Yes'` was assumed to be the CLCPA filter. It is
     not — filtering to it DROPS 31% of the state total.

(None of these were caught by reading the data. They were caught by reconciling
against published NYSDEC headline figures.)

So this script encodes the reconciliation as an assertion. If a future Socrata
revision changes the semantics, the numbers stop matching and this fails loudly
rather than the dashboard silently reporting a 31% understatement.

Usage:  python3 scripts/verify_ghg_sources.py
Exit 0 = every claim reproduced. Exit 1 = at least one is now false.
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request

BASE = "https://data.ny.gov/resource"

# Dataset ids
STATEWIDE = "5i6e-asw6"   # Statewide GHG Emissions, 1990+
UER_COUNTY = "46pe-aat9"  # UER County Energy Use, 2021+
UER_COMM = "m3xm-q3dw"    # UER Community Energy Use, 2016-2020

failures: list[str] = []
checks = 0


def q(dsid: str, params: dict) -> list:
    url = f"{BASE}/{dsid}.json?" + urllib.parse.urlencode(params)
    with urllib.request.urlopen(url, timeout=180) as r:
        return json.load(r)


def s(dsid: str, where: str, field: str = "mt_co2e_ar5_20_yr") -> float:
    """Sum a field subject to a SoQL where clause."""
    d = q(dsid, {"$select": f"sum({field}) as t", "$where": where})
    return float(d[0]["t"]) if d and d[0].get("t") is not None else 0.0


def check(label: str, actual, expected, tol=0.02) -> None:
    """Assert actual ≈ expected within a relative tolerance."""
    global checks
    checks += 1
    if isinstance(expected, float):
        ok = expected == 0 or abs(actual - expected) <= tol * abs(expected)
    else:
        ok = actual == expected
    status = "ok   " if ok else "FAIL "
    if not ok:
        failures.append(f"{label}: got {actual!r}, expected {expected!r}")
    print(f"  {status} {label}")
    if not ok:
        print(f"         got      {actual!r}")
        print(f"         expected {expected!r}")


print("\n[verify-ghg] §2.1 state accounting flags are ORTHOGONAL")

# The critical trap: the intuitive filter loses 31%.
gross_conv = s(STATEWIDE, "year='2023' AND gross='Yes' AND conventional_accounting='Yes'") / 1e6
gross_all = s(STATEWIDE, "year='2023' AND gross='Yes'") / 1e6
gross_nonconv = s(STATEWIDE, "year='2023' AND gross='Yes' AND conventional_accounting='No'") / 1e6

check("2023 gross, conventional only (KNOWN-WRONG figure)", gross_conv, 243.37)
check("2023 gross, ALL accounting (= NYSDEC published)", gross_all, 354.06)
check("2023 gross, non-conventional (the CLCPA extras)", gross_nonconv, 110.69)
check("sum of both treatments == published total",
      gross_conv + gross_nonconv, gross_all, tol=0.001)

# Independent acceptance test: the published 1990-vs-2023 reduction.
g1990 = s(STATEWIDE, "year='1990' AND gross='Yes'") / 1e6
check("1990 gross baseline (mmt)", g1990, 415.73)
check("1990->2023 change (-14.8% as published)",
      round(100 * (gross_all - g1990) / g1990, 1), -14.8, tol=0.01)

print("\n[verify-ghg] §2.2 state hierarchy is NESTED, not flat")

leaf_total = s(STATEWIDE,
               "year='2023' AND gross='Yes' AND sector='Energy'"
               " AND category='Fuel Combustion' AND conventional_accounting='Yes'")
sub3_total = s(STATEWIDE,
               "year='2023' AND gross='Yes' AND sector='Energy'"
               " AND category='Fuel Combustion' AND conventional_accounting='Yes'"
               " AND sub_category_3!='Not Applicable'")
check("fuel-level leaves (sub_category_3) == category-level total",
      sub3_total, leaf_total, tol=0.0001)
check("Fuel Combustion 2023, conventional (mmt)", leaf_total / 1e6, 155.54)

# NOTE: the accounting filter matters here too. Without it, Fuel Combustion is
# 163.82 mmt (155.54 conventional + 8.28 non-conventional). Comparing across
# different accounting treatments is itself a bug — see the check below.
fb_all = s(STATEWIDE,
           "year='2023' AND gross='Yes' AND sector='Energy'"
           " AND category='Fuel Combustion'")
check("Fuel Combustion 2023, ALL accounting (mmt)", fb_all / 1e6, 163.82)

# 'Not Applicable' appears at sub_category_2 (mode level), NOT sub_category_3.
na2 = q(STATEWIDE, {
    "$select": "count(*) as n",
    "$where": ("year='2023' AND gross='Yes' AND sector='Energy'"
               " AND category='Fuel Combustion' AND sub_category_2='Not Applicable'"),
})
check("'Not Applicable' rollups sit at sub_category_2", int(na2[0]["n"]) > 0, True)

na3 = q(STATEWIDE, {
    "$select": "count(*) as n",
    "$where": ("year='2023' AND gross='Yes' AND sector='Energy'"
               " AND category='Fuel Combustion' AND sub_category_3='Not Applicable'"),
})
check("sub_category_3 has NO 'Not Applicable' in Fuel Combustion "
      "(it is the fuel level, fully enumerated)", int(na3[0]["n"]), 0)


print("\n[verify-ghg] §4.1 no regional grain exists")

streams = {r["data_stream"] for r in q(UER_COUNTY, {"$select": "distinct data_stream"})}
check("county dataset exposes only county_monthly", streams, {"county_monthly"})
comm_streams = {r["data_stream"] for r in q(UER_COMM, {"$select": "distinct data_stream"})}
check("community dataset exposes only community_monthly",
      comm_streams, {"community_monthly"})

print("\n[verify-ghg] §4.2 NYC incomplete at the MUNICIPAL grain")

for borough, county in [("Manhattan", "New York"), ("The Bronx", "Bronx")]:
    rows = q(UER_COMM, {"$select": "distinct com_name",
                        "$where": f"county_name='{county}'"})
    check(f"{borough} absent from community series", len(rows), 0)

# ...but present at the county grain, which is the correct fallback.
for county in ["New York", "Kings", "Queens", "Bronx", "Richmond"]:
    rows = q(UER_COUNTY, {"$select": "count(*) as n",
                          "$where": f"county_name='{county}'"})
    check(f"{county} present at county grain", int(rows[0]["n"]) > 0, True)

print("\n[verify-ghg] §4.3 county aliases are a TEMPORAL split")

# Each alias pair: canonical 2021-2025, alias 2024-2025 only.
for canonical, alias in [("New York", "Manhattan"),
                         ("Kings", "Brooklyn"),
                         ("Richmond", "Staten Island")]:
    def years(name):
        d = q(UER_COUNTY, {"$select": "distinct year",
                           "$where": f"county_name='{name}'", "$order": "year"})
        return sorted(r["year"] for r in d)
    yc, ya = years(canonical), years(alias)
    check(f"{canonical} spans 2021-2025", yc, ["2021", "2022", "2023", "2024", "2025"])
    check(f"{alias} is 2024-2025 only (subset -> summing double-counts recent yrs)",
          ya, ["2024", "2025"])

# 65 county_name values for 62 real counties.
names = {r["county_name"] for r in q(UER_COUNTY, {"$select": "county_name",
                                                  "$group": "county_name", "$limit": 200})}
check("county_name has 65 values (62 counties + 3 aliases)", len(names), 65)

print("\n[verify-ghg] §4.6 units inconsistent across the county dataset")

units_ng = {r["unit"] for r in q(UER_COUNTY, {"$select": "distinct unit",
                                              "$where": "data_class='natural_gas'"})}
check("natural_gas has BOTH 'Therms' and 'therms' (needs normalization)",
      {"Therms", "therms"} <= units_ng, True)

print("\n[verify-ghg] §3.1 UER is consumption, not emissions")

classes = {r["data_class"] for r in q(UER_COMM, {"$select": "distinct data_class"})}
check("community data_class is only electricity + natural_gas",
      classes, {"electricity", "natural_gas"})
units_c = {r["unit"] for r in q(UER_COMM, {"$select": "distinct unit"})}
check("units include MW (demand, must not enter an energy total)",
      "MW" in units_c, True)
check("units include count (accounts, not energy)", "count" in units_c, True)

print()
if failures:
    print(f"[verify-ghg] FAIL — {len(failures)} of {checks} checks failed:\n")
    for f in failures:
        print(f"   - {f}")
    print()
    sys.exit(1)

print(f"[verify-ghg] PASS — all {checks} checks reproduced.\n")
