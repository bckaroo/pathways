#!/usr/bin/env python3
"""
Verify the CSC action catalogue and the CEC/CSC crosswalk against NYSDEC's
own published artifacts.

WHY THIS EXISTS
---------------
`actions` and `crosswalk` are ingested from a website, and an ingest that
silently drifts from the published source is worse than no ingest: the
progression engine would compute levels from stale points and show a community
"ready to level up" based on a rule the State no longer applies.

So the catalogue is checked against the authoritative artifacts:

  1. the December 18, 2025 CSC Action Checklist (xlsx, version 4.5)
     https://climatesmart.ny.gov/fileadmin/csc/documents/Action_Checklist/
       2025-12-18-CSC-CertActionChecklist.xlsx

  2. the December 20, 2024 CEC/CSC Crosswalk (pdf)
     https://climatesmart.ny.gov/fileadmin/csc/documents/CEC_CSC_Crosswalk/
       2024-12-20-CEC-CSC-Crosswalk.pdf

Both are behind CloudFront and return 403 to a bare curl — a browser UA and a
referer are required (see fetch_artifacts()).

WHAT IS ASSERTED
----------------
  A. every official action exists in the DB (by normalised name)
  B. every DB action exists in the official checklist
  C. points_min/points_max match the official point range exactly
  D. mandatory / priority / funding_eligible flags match the official status
  E. variable_points == (points_min != points_max)
  F. the crosswalk every `csc_action_external_id` resolves to a real action
  G. UNRESOLVED CEC NAMES ARE REPORTED, NOT FUZZY-MATCHED

(G) is the important one. Token-overlap matching over CEC action names produces
confident wrong answers — see CEC_NAME_MATCH below.

Usage:  python3 scripts/verify_csc_actions.py
Requires: the pathways-db container; openpyxl NOT required (the xlsx is parsed
from its XML parts with the stdlib) but pypdf/pdftotext IS needed for the
crosswalk PDF.
"""
import os
import re
import subprocess
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

SCRATCH = os.environ.get("SCRATCH_DIR", "/home/abuck/.hermes/cache/scratch")
CHECKLIST = os.path.join(SCRATCH, "csc-2025-checklist.xlsx")
CROSSWALK = os.path.join(SCRATCH, "cec-csc-crosswalk-2024.pdf")

CHECKLIST_URL = (
    "https://climatesmart.ny.gov/fileadmin/csc/documents/Action_Checklist/"
    "2025-12-18-CSC-CertActionChecklist.xlsx"
)
CROSSWALK_URL = (
    "https://climatesmart.ny.gov/fileadmin/csc/documents/CEC_CSC_Crosswalk/"
    "2024-12-20-CEC-CSC-Crosswalk.pdf"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REFERER = "https://climatesmart.ny.gov/actions-certification/actions"

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"

passed = 0
failed = 0
notes = []


def check(ok, label, detail=""):
    global passed, failed
    if ok:
        passed += 1
        print(f"  [PASS] {label}")
    else:
        failed += 1
        print(f"  [FAIL] {label}")
        if detail:
            for line in str(detail).splitlines():
                print(f"         {line}")


def fetch_artifacts():
    """Download the two source artifacts.

    A bare curl gets HTTP 403 from CloudFront; a browser User-Agent plus a
    referer from the actions page succeeds. Verified: 403 without, 200 with.
    """
    os.makedirs(SCRATCH, exist_ok=True)
    for url, path in ((CHECKLIST_URL, CHECKLIST), (CROSSWALK_URL, CROSSWALK)):
        if os.path.exists(path) and os.path.getsize(path) > 20000:
            continue
        req = urllib.request.Request(
            url, headers={"User-Agent": UA, "Referer": REFERER}
        )
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
        print(f"  fetched {os.path.basename(path)} ({os.path.getsize(path)} bytes)")


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "pathways-db", "psql", "-U", "pathways", "-d", "pathways",
         "-t", "-A", "-F", "|", "-c", sql],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        print("SQL ERROR:", out.stderr.strip()[:400])
        sys.exit(1)
    return [l.split("|") for l in out.stdout.strip().split("\n") if l]


def parse_checklist():
    """Parse the official xlsx using only the stdlib (no openpyxl).

    The house rule for the collector stack forbids openpyxl, and an xlsx is
    just a zip of XML parts, so read sharedStrings + sheet1 directly.
    """
    z = zipfile.ZipFile(CHECKLIST)
    shared = [
        "".join(t.text or "" for t in si.iter(f"{NS}t"))
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{NS}si")
    ]
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))

    rows = []
    for row in sheet.iter(f"{NS}row"):
        cells = {}
        for c in row.findall(f"{NS}c"):
            t, v, isel = c.get("t"), c.find(f"{NS}v"), c.find(f"{NS}is")
            if t == "s" and v is not None:
                val = shared[int(v.text)]
            elif t == "inlineStr" and isel is not None:
                val = "".join(x.text or "" for x in isel.iter(f"{NS}t"))
            elif v is not None:
                val = v.text
            else:
                val = None
            col = "".join(ch for ch in c.get("r") if ch.isalpha())
            cells[col] = val
        rows.append(cells)

    actions = []
    for r in rows:
        a = r.get("A")
        if not a or a == "Action Name":
            continue
        if "Action:" in a or a.startswith(("Innovation:", "Performance:", "Planning:", "Benchmarking:")):
            actions.append({
                "name": a.strip(),
                "points_raw": (r.get("D") or "").strip(),
                "status_raw": (r.get("E") or "").strip(),
                "legacy_num": r.get("B"),
            })
    return actions


def key(name):
    """Normalise an action name for comparison.

    The DB stores bare names ("Clean Energy Upgrades") while the official sheet
    and the live site use prefixed ones ("PE3 Action: Clean Energy Upgrades",
    "Innovation: New Innovative Actions", "Performance: Reduce GHGs from ...").

    Both prefix SHAPES must be stripped:
      "PE<n> Action: <name>"
      "<Group>: <name>"        (Innovation / Performance / Planning / Benchmarking)

    Doing this on one side only produced 7 phantom "gaps" on the first run, and
    requiring the literal word "action" left the second shape unstripped.
    """
    s = (name or "").lower().replace("\xa0", " ")
    s = re.sub(r"\s*\(expired but still eligible for csc points\)", "", s)
    s = re.sub(r"^pe\d+\s+action:\s*", "", s)
    s = re.sub(r"^(innovation|performance|planning|benchmarking):\s*", "", s)
    s = re.sub(r"^(innovation|performance|planning|benchmarking)\s+action:\s*", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def main():
    print("\n[verify-csc] fetching source artifacts")
    fetch_artifacts()

    print("\n[verify-csc] parsing official December 18, 2025 action checklist")
    official = parse_checklist()
    print(f"  {len(official)} official actions parsed")

    db = psql(
        "SELECT external_id, name, points_min, points_max, mandatory, priority, "
        "funding_eligible, variable_points, pledge_element "
        "FROM actions WHERE program_slug='csc'"
    )
    print(f"  {len(db)} csc actions in database")

    off_by_key = {}
    for o in official:
        off_by_key.setdefault(key(o["name"]), []).append(o)
    db_by_key = {}
    for r in db:
        db_by_key.setdefault(key(r[1]), []).append(r)

    print("\n[verify-csc] A/B — catalogue completeness")

    only_db = sorted(set(db_by_key) - set(off_by_key))
    only_off = sorted(set(off_by_key) - set(db_by_key))
    check(
        not only_off,
        f"all {len(off_by_key)} official actions exist in the database",
        "\n".join(f"missing: {k}" for k in only_off),
    )
    check(
        not only_db,
        f"no database action is absent from the official checklist",
        "\n".join(f"extra: {k}" for k in only_db),
    )
    check(
        len(official) == len(db),
        f"action counts agree ({len(official)} official vs {len(db)} in db)",
        f"official={len(official)} db={len(db)}",
    )

    print("\n[verify-csc] C/D/E — points and gating flags")

    bad_points, bad_flags, bad_var = [], [], []
    common = set(db_by_key) & set(off_by_key)
    for k in sorted(common):
        d = db_by_key[k][0]
        o = off_by_key[k][0]
        pmin, pmax = int(d[2] or 0), int(d[3] or 0)
        nums = [int(x) for x in re.findall(r"\d+", o["points_raw"])]
        if nums and (pmin, pmax) != (min(nums), max(nums)):
            bad_points.append(f"{d[1]}: db {pmin}-{pmax} vs official {o['points_raw']}")

        st = o["status_raw"]
        want = ("Mandatory" in st, "Priority" in st, "CSC Grant" in st)
        have = (d[4] == "t", d[5] == "t", d[6] == "t")
        if want != have:
            bad_flags.append(f"{d[1]}: db {have} vs official {want} [{st}]")

        if (pmin != pmax) != (d[7] == "t"):
            bad_var.append(f"{d[1]}: range {pmin}-{pmax}, variable flag={d[7]}")

    check(not bad_points, f"points match for all {len(common)} compared actions",
          "\n".join(bad_points[:12]))
    check(not bad_flags, "mandatory/priority/funding flags match", "\n".join(bad_flags[:12]))
    check(not bad_var, "variable_points agrees with (min != max)", "\n".join(bad_var[:12]))

    # Nothing may sit above the ceiling the official checklist implies.
    max_off = 0
    for o in official:
        nums = [int(x) for x in re.findall(r"\d+", o["points_raw"] or "")]
        if nums:
            max_off = max(max_off, max(nums))
    max_db = max(int(r[3] or 0) for r in db)
    check(max_db == max_off, f"max single-action points agree ({max_off})",
          f"db max={max_db} official max={max_off}")

    print("\n[verify-csc] F/G — crosswalk integrity")

    cw = psql(
        "SELECT cec_hia_name, csc_action_external_id, COALESCE(cec_hia_id,'') "
        "FROM crosswalk"
    )
    print(f"  {len(cw)} crosswalk rows")

    # COUNT the rows with COUNT(*), but join with DISTINCT ids: the LEFT JOIN to
    # actions fans out because several CSC actions have multiple CEC routes
    # (advanced-vehicles has 4). A plain COUNT(*) on the join returns 41 for a
    # 35-row table — that fan-out is exactly the trap this assertion guards.
    joined = psql(
        "SELECT COUNT(DISTINCT cw.id), "
        "COUNT(DISTINCT cw.id) FILTER (WHERE a.external_id IS NOT NULL) "
        "FROM crosswalk cw "
        "LEFT JOIN actions a ON a.external_id = cw.csc_action_external_id"
    )
    total, resolves = int(joined[0][0]), int(joined[0][1])
    check(total == len(cw),
          f"crosswalk LEFT JOIN does not fan out the row count ({total} = {len(cw)})",
          "a plain COUNT(*) here returns more than the table holds")
    check(resolves == len(cw),
          f"every crosswalk row resolves to a real CSC action ({resolves}/{len(cw)})",
          f"{len(cw)-resolves} rows point at a non-existent action")

    multi = psql(
        "SELECT csc_action_external_id, COUNT(*) n FROM crosswalk "
        "GROUP BY 1 HAVING COUNT(*)>1 ORDER BY n DESC"
    )
    check(len(multi) > 0,
          f"multi-hop routes present ({len(multi)} CSC actions reachable from >1 CEC action)")

    # G — the hard-won lesson. Report unmatched CEC names; do NOT auto-resolve.
    cec_names = [r[0] for r in psql("SELECT DISTINCT raw_action_name FROM cec_completions")]

    # CEC publishes the SAME action under several shapes, so a crosswalk name can
    # differ from every cec_completions row while still referring to the same
    # action. Observed convention differences, all verified against the data:
    #
    #   group prefix added    "Renewable Energy: CDG Subscription"     -> "CDG Subscription"
    #   group prefix dropped  "LED Streetlights: 50% Conversion of
    #                          Cobra Head Streetlights"               -> "50% Conversion of Cobra Head Streetlights"
    #   tier suffix added     "Community Campaigns for Community Solar"-> ".../Community Solar - Tier 1|2|3"
    #   separator + plural    "...Campaigns for..." vs "...Campaigns - ..."
    #   wording variant       "Demonstrations" vs "Demos", "Trainings" vs "Training"
    #
    # Normalising these makes the comparison meaningful; it does NOT invent
    # mappings. Anything still unmatched is reported with its cause.
    def canon(s):
        s = (s or "")
        # tier / level / revision suffixes, with or without a separator
        s = re.sub(r"\s*[-–—]?\s*(Tier|Lvl|Level)\s*\d+\s*$", "", s, flags=re.I)
        s = re.sub(r"\s*[-–—]?\s*V\.?\d+\s*$", "", s, flags=re.I)
        s = re.sub(r"\s*[-–—]\s*(LR|RR)\s*$", "", s, flags=re.I)
        s = re.sub(r"\(expired but still eligible for csc points\)", "", s, flags=re.I)
        s = re.sub(r"^(\(Retired\)|Retired)\s*", "", s, flags=re.I)
        # CEC group prefixes used in the crosswalk but not in the data
        s = re.sub(r"^(renewable energy|led streetlights|led street lights):\s*", "", s, flags=re.I)
        # wording and connector variants
        s = re.sub(r"\bStreets?lights?\b|\bStreet\s+lights?\b", "streetlights", s, flags=re.I)
        s = s.replace("Demonstrations", "Demos").replace("Demonstration", "Demos")
        s = s.replace("Trainings", "Training")
        s = re.sub(r"\bCampaigns?\s+for\s+", "Campaigns ", s, flags=re.I)
        s = re.sub(r"\bgreater than or equal to\b", ">=", s, flags=re.I)
        s = re.sub(r"\bless than\b", "<", s, flags=re.I)
        s = re.sub(r"\b100%\b", "100", s)
        # "(EVs)" / "(Class-1-2)" style parentheticals: the crosswalk uses them
        # to name a vehicle class, CEC names the same action by Tier. Dropping
        # the parenthetical is what lets the two agree.
        s = re.sub(r"\s*\((?!expired)[^)]*\)\s*", " ", s, flags=re.I)
        # ORDER MATTERS: lower() must run BEFORE the non-alphanumeric strip.
        # `[^a-z0-9]` deletes anything outside a-z0-9, which includes every
        # UPPERCASE letter. Stripping first silently ate the first character of
        # each capitalised word ("Municipal Building Demos" -> "unicipal uilding
        # emos"), turning unmatched names into permanent false negatives.
        s = re.sub(r"\s+", " ", s).strip(" :-–—").lower()
        return re.sub(r"[^a-z0-9]+", " ", s).strip()

    cec_canon = {}
    for n in cec_names:
        cec_canon.setdefault(canon(n), []).append(n)
    cec_keys = [k for k in cec_canon if k]

    def resolve(name):
        c = canon(name)
        if c in cec_canon:
            return "exact"
        # allow the CEC row to carry an extra descriptive suffix, but never a
        # different head noun (that is how Medium/Heavy-Duty "Electric" wrongly
        # matched "Non-Road" under a similarity score).
        if len(c) > 10 and any(k.startswith(c + " ") for k in cec_keys):
            return "prefix"
        # singular/plural head noun
        if c and c + "s" in cec_canon or (c.endswith("s") and c[:-1] in cec_canon):
            return "plural"
        return None

    # Verified absent from the CEC source data ENTIRELY — checked across every
    # text column of every table, not just cec_completions, because absence from
    # the completions table alone would only prove "nobody completed it", not
    # "CEC does not offer it":
    #
    #   'pool heat pump'    -> only in crosswalk.cec_hia_name
    #   'green bank'        -> only in crosswalk.cec_hia_name
    #   'thermal' CEC rows  -> only in crosswalk; the CSC action exists
    #                          (actions.external_id = thermal-energy-networks)
    #                          but CEC has no matching completion rows
    #
    # So no mapping is possible from our data. These are recorded as known gaps,
    # NOT as verification failures — a failure count that cannot be driven to
    # zero is noise, and noise gets ignored.
    # NOTE: build these keys by CALLING canon(), never by typing the string out.
    # Hand-writing them produced 'demo' where canon() emits 'demos', so the
    # lookup silently missed and the name stayed "unclassified" for three
    # iterations while looking like a data problem.
    ABSENT_FROM_CEC = {
        canon("Municipal Building Demonstration: Pool Heat Pump"),
        canon("Thermal Energy Network: Study"),
        canon("Thermal Energy Network: RFP"),
        canon("NY Green Bank Project Closing"),
    }
    # The crosswalk documents Class -> Tier equivalence for light-duty EVs, so
    # this maps to "Light-Duty Electric Vehicles - Tier n" by convention.
    # Medium/Heavy-Duty EVs do NOT: CEC's nearest row is "Clean Fleets - Heavy
    # Duty Electric Vehicles", a different action family, and mapping them would
    # assert a relationship the State does not publish. It is listed here as a
    # gap so it is accounted for rather than silently dropped.
    CURATED = {
        canon("Light-Duty Electric Vehicles (Class-1-2)"): "light duty electric vehicles",
    }
    CURATED_GAPS = {
        canon("Medium/Heavy-Duty Electric Vehicles (Class 3-8)"),
    }

    resolved, absent, curate = [], [], []
    for name, _, _ in cw:
        c = canon(name)
        how = resolve(name)
        if how:
            resolved.append((name, how))
        elif c in CURATED:
            resolved.append((name, "curated"))
        elif c in ABSENT_FROM_CEC or c in CURATED_GAPS:
            absent.append(name)
        else:
            curate.append(name)

    check(
        not curate,
        f"every crosswalk CEC name is resolved or a recorded gap "
        f"({len(resolved)} resolved, {len(absent)} absent from CEC data)",
        f"{len(curate)} unclassified — decide these explicitly:\n"
        + "\n".join(f"  {n}" for n in curate),
    )
    check(
        len(absent) == len(ABSENT_FROM_CEC) + len(CURATED_GAPS),
        f"{len(ABSENT_FROM_CEC) + len(CURATED_GAPS)} crosswalk actions have no CEC "
        f"counterpart (documented gap, not a failure)",
        "\n".join(f"  {n}" for n in absent),
    )
    check(
        len(resolved) + len(absent) == len(cw),
        f"every one of the {len(cw)} crosswalk rows is accounted for",
        f"resolved={len(resolved)} absent={len(absent)} total={len(cw)}",
    )

    # Record the classification so the numbers are auditable rather than asserted.
    print("\n  crosswalk CEC-name resolution:")
    print(f"    resolved by normalisation : {sum(1 for _, h in resolved if h != 'curated')}")
    print(f"    resolved by curation      : {sum(1 for _, h in resolved if h == 'curated')}")
    print(f"    absent from CEC data      : {len(absent)}")

    print("\n[verify-csc] note on name matching")
    notes.append(
        "Token-overlap matching over CEC action names is UNSAFE. Observed false\n"
        "positives: 'Medium/Heavy-Duty Electric Vehicles (Class 3-8)' scores 0.63\n"
        "against 'Medium/Heavy-Duty Non-Road Vehicles' (a different action), and\n"
        "'Thermal Energy Network: Study' scores 0.47 against 'Benchmarking - CEC\n"
        "Energy Study Qualification'. Any CEC<->CSC action mapping must be curated\n"
        "and committed, never derived from a similarity threshold."
    )
    for n in notes:
        print(f"  ! {n}")

    print(f"\n[verify-csc] {passed} passed, {failed} failed\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
