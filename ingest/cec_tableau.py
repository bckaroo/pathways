#!/usr/bin/env python3
"""Tableau Server client for NYSERDA's CEC dashboards (bi.nyserda.ny.gov).

Implements the minimal wire protocol needed to pull the CEC map/scorecard
underlying data tables anonymously:

  1. POST {vizql_root}/w/{wb}/v/{view}/startSession/viewing  -> session config
     (the modern two-phase bootstrap; empty tsConfigContainer otherwise)
  2. POST {vizql_root}/bootstrapSession/sessions/{sid}        -> shell payload
  3. POST .../commands/tabdoc/api-get-worksheet-logical-table-ids  -> table ids
     (the old JS-API compat command; versionName must be the literal "1.0")
  4. POST .../commands/tabdoc/api-get-worksheet-underlying-logical-table-data
     -> commandReturn.dataTablePresModel.showDataTable {schema, tuples}
  5. POST .../commands/tabdoc/set-parameter-value             -> drive the
     scorecard's [Parameters].[Community Name Parameter]

All requests are plain GET/POST reads against published views; no writes, no
authentication. Used by cec_designations.py and cec_completions.py.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

import pandas as pd
import requests

TABLEAU_BASE = "https://bi.nyserda.ny.gov"
SITE = "External"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

# The old JS-API compat layer declares versionName "1.0"; any other value fails
# validation with "bad value: version-name".
API_VERSION = "1.0"

CEC_MAP_URL = (
    f"{TABLEAU_BASE}/t/{SITE}/views/CECMap/CECInteractiveMap"
    "?iframeSizedToWindow=true&:embed=y&:showAppBanner=false&:display_count=no"
    "&:showVizHome=no&:toolbar=no"
)
CEC_SCORECARD_URL = (
    f"{TABLEAU_BASE}/t/{SITE}/views/CECScorecard/Scorecard"
    "?iframeSizedToWindow=true&:embed=y&:showAppBanner=false&:display_count=no"
    "&:showVizHome=no&:toolbar=no&:tabs=no"
)


@dataclass
class TableauSession:
    workbook: str
    view: str
    session: requests.Session
    referer: str
    vizql_root: str
    session_id: str
    sheet_id: str
    dashboard: str

    def cmd_url(self, namespace: str, command: str) -> str:
        return (
            f"{TABLEAU_BASE}{self.vizql_root}/sessions/{self.session_id}"
            f"/commands/{namespace}/{command}"
        )


def open_dashboard(workbook: str, view: str, referer: str | None = None) -> TableauSession:
    """Start a Tableau session and load the dashboard shell."""
    import requests

    s = requests.Session()
    s.headers["User-Agent"] = BROWSER_UA
    ref = referer or (
        f"{TABLEAU_BASE}/t/{SITE}/views/{workbook}/{view}"
        "?iframeSizedToWindow=true&:embed=y&:showAppBanner=false"
        "&:display_count=no&:showVizHome=no&:toolbar=no"
    )
    r = s.post(
        f"{TABLEAU_BASE}/vizql/t/{SITE}/w/{workbook}/v/{view}/startSession/viewing",
        headers={"Accept": "application/json", "Referer": ref},
        timeout=90,
    )
    r.raise_for_status()
    cfg = r.json()
    vizql_root = cfg["vizql_root"]
    sid = cfg["sessionid"]
    sheet_id = cfg.get("sheetId") or cfg.get("sheetName")
    r2 = s.post(
        f"{TABLEAU_BASE}{vizql_root}/bootstrapSession/sessions/{sid}",
        data={"sheet_id": sheet_id, "clientDimension": json.dumps({"w": 1920, "h": 1080})},
        headers={"Referer": ref},
        timeout=180,
    )
    m = re.search(r"\d+;({.*})\d+;({.*})", r2.text, re.MULTILINE)
    if not m:
        raise RuntimeError(f"unexpected bootstrap payload for {workbook}/{view}: {r2.text[:200]}")
    info = json.loads(m.group(1))
    ts = TableauSession(
        workbook=workbook,
        view=view,
        session=s,
        referer=ref,
        vizql_root=vizql_root,
        session_id=sid,
        sheet_id=sheet_id,
        dashboard=info.get("sheetName") or view,
    )
    return ts


def get_logical_table_ids(ts: TableauSession, worksheet: str) -> dict[str, str]:
    """caption -> showDataTableId for a worksheet (versionName=1.0 API)."""
    r = ts.session.post(
        ts.cmd_url("tabdoc", "api-get-worksheet-logical-table-ids"),
        files=[
            ("versionName", (None, API_VERSION)),
            ("visualIdPresModel", (None, json.dumps({"worksheet": worksheet, "dashboard": ts.dashboard}))),
        ],
        headers={"Referer": ts.referer},
        timeout=120,
    )
    r.raise_for_status()
    ret = r.json()["vqlCmdResponse"]["cmdResultList"][0]["commandReturn"]
    vpm = ret.get("commandValidationPresModel")
    if vpm and not vpm.get("valid", True):
        raise RuntimeError(f"logical-table-ids invalid: {vpm.get('errorMessage')}")
    out: dict[str, str] = {}
    for entry in ret.get("showDataTableIdWithCaptionList") or []:
        out[entry["showDataTableCaption"]] = entry["showDataTableId"]
    return out


def fetch_underlying_table(ts: TableauSession, worksheet: str, table_id: str, max_rows: int = 100000) -> pd.DataFrame:
    """Fetch one logical table of a worksheet as a DataFrame (raw string cells)."""
    r = ts.session.post(
        ts.cmd_url("tabdoc", "api-get-worksheet-underlying-logical-table-data"),
        files=[
            ("versionName", (None, API_VERSION)),
            ("showDataTableId", (None, table_id)),
            ("maxRows", (None, str(max_rows))),
            ("ignoreAliases", (None, "false")),
            ("ignoreSelection", (None, "true")),
            ("includeAllColumns", (None, "true")),
            ("visualIdPresModel", (None, json.dumps({"worksheet": worksheet, "dashboard": ts.dashboard}))),
        ],
        headers={"Referer": ts.referer},
        timeout=600,
    )
    r.raise_for_status()
    j = r.json()
    crl = j["vqlCmdResponse"].get("cmdResultList") or []
    if not crl:
        raise RuntimeError(f"no cmdResultList for {worksheet}/{table_id}")
    ret = crl[0].get("commandReturn") or {}
    vpm = ret.get("commandValidationPresModel")
    if vpm and not vpm.get("valid", True):
        raise RuntimeError(f"underlying-data invalid: {vpm.get('errorMessage')}")
    if "dataTablePresModel" not in ret:
        raise RuntimeError(f"no dataTablePresModel for {worksheet}/{table_id}: {list(ret.keys())}")
    dpm = ret["dataTablePresModel"]
    sd = dpm["showDataTable"]
    if isinstance(sd, str):
        sd = json.loads(sd)
    tbl = sd["table"]
    schema = tbl["schema"]
    tuples = tbl["tuples"]
    caps = {c["uniqueName"]: c["fieldCaption"] for c in dpm.get("showDataTableColumnPresModels") or []}
    cols = [caps.get(x, x) for x in schema]
    return pd.DataFrame(tuples, columns=cols)


def get_parameter_domain(ts: TableauSession) -> tuple[str, list[str]]:
    """Returns (parameterName, allowedValues) for the scorecard community parameter."""
    r = ts.session.post(
        ts.cmd_url("tabdoc", "get-parameter-models"),
        files=[],
        headers={"Referer": ts.referer},
        timeout=180,
    )
    r.raise_for_status()
    ret = r.json()["vqlCmdResponse"]["cmdResultList"][0]["commandReturn"]
    pcs = ret.get("parameterControls") or []
    if not pcs:
        raise RuntimeError("no parameterControls returned")
    pc = pcs[0]
    vals = []
    for v in pc.get("valuesAliases") or []:
        vals.append(v[0] if isinstance(v, list) else v)
    return pc["parameterName"], vals


def set_parameter(ts: TableauSession, parameter_name: str, value: str) -> None:
    r = ts.session.post(
        ts.cmd_url("tabdoc", "set-parameter-value"),
        files=[
            ("globalFieldName", (None, parameter_name)),
            ("valueString", (None, value)),
            ("useUsLocale", (None, "false")),
        ],
        headers={"Referer": ts.referer},
        timeout=120,
    )
    if r.status_code != 200:
        raise RuntimeError(f"set-parameter-value {value!r} -> {r.status_code}: {r.text[:150]}")