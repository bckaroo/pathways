#!/usr/bin/env python3
"""
Rendered-map smoke test (Python / Playwright).

Companion to scripts/smoke-map.mjs. This one runs against the Python
Playwright install already present on this box, so no heavy Node devDependency
is needed for contributors here.

WHY THIS EXISTS
---------------
DEV-151 was signed off as "verified" because /map returned HTTP 200. The map
was rendering a blank canvas with zero community points. Status-code checks are
structurally incapable of catching that failure, because it emits no error:

  - HTTP 200                       OK
  - style loads                    OK
  - canvas paints                  OK
  - legend populates               OK  (from the same rows the map uses)
  - source created, never loaded   BAD (MapLibre v6 worker 404)
  - no error event at all          BAD
  - "load" never fires             BAD -> every layer added there is skipped

This asserts what actually distinguishes a working map: the worker files are
served, the style loaded, the source loaded, and queryRenderedFeatures()
returns points.

Usage:  python3 scripts/smoke_map.py
        BASE_URL=http://localhost:3005 python3 scripts/smoke_map.py
Exit 0 = the map genuinely rendered points. Exit 1 = it did not.
"""
from __future__ import annotations

import os
import sys
import urllib.request

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3005")
MAP_URL = f"{BASE_URL}/map"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

failures: list[str] = []


def ok(msg: str) -> None:
    print(f"  ok    {msg}")


def bad(msg: str) -> None:
    print(f"  FAIL  {msg}")
    failures.append(msg)


# ---------------------------------------------------------------------------
# Static checks: the most common cause of the silent hang is a 404 worker.
# ---------------------------------------------------------------------------
print("\n[smoke:map] static checks")

for name in ("maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"):
    path = os.path.join(ROOT, "public", "maplibre", name)
    if os.path.exists(path):
        ok(f"vendored {name}")
    else:
        bad(
            f"public/maplibre/{name} missing — the MapLibre v6 worker will 404 "
            f"and the map will hang silently. Fix: npm run vendor:maplibre"
        )

for name in ("maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"):
    url = f"{BASE_URL}/maplibre/{name}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            status = r.status
    except Exception as e:  # noqa: BLE001
        status = f"error: {e}"
    if status == 200:
        ok(f"served 200  /maplibre/{name}")
    else:
        bad(f"/maplibre/{name} returned {status} — map will render blank, no error")

if failures:
    print("\n[smoke:map] FAIL — static preconditions not met (server down?).\n")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Rendered checks via Playwright.
# ---------------------------------------------------------------------------
print("[smoke:map] rendered checks")

# Interpreter discovery.
#
# `python3` on PATH is NOT reliably the one with Playwright: inside `npm run`,
# Hermes's own bundled Python 3.14 venv wins, which has no playwright module.
# The working install is the user-site Python 3.12. Rather than hardcode a path
# or force a dependency into whichever interpreter happens to be first, probe
# candidates for the module and use the first that has it.
_SELFTEST = "import playwright.sync_api, sys; sys.exit(0)"


def _has_playwright(exe: str) -> bool:
    import subprocess

    try:
        return (
            subprocess.run(
                [exe, "-c", _SELFTEST],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
            ).returncode
            == 0
        )
    except Exception:  # noqa: BLE001
        return False


def _candidates() -> list[str]:
    import glob

    seen: list[str] = []
    env_exe = os.environ.get("SMOKE_PYTHON")
    if env_exe:
        seen.append(env_exe)
    seen += [
        "python3.12",
        "/usr/bin/python3",
        "python3",
        sys.executable,
    ]
    # User-site installs for other minor versions.
    for base in glob.glob(os.path.expanduser("~/.local/lib/python3.*")):
        ver = os.path.basename(base).replace("python", "")
        seen.append(f"python{ver}")
    # De-dupe, preserve order.
    out: list[str] = []
    for c in seen:
        if c and c not in out:
            out.append(c)
    return out


_sync_playwright = None
_chosen = None
for _exe in _candidates():
    if _has_playwright(_exe):
        # Run the actual test in a child process with that interpreter so we
        # get its playwright, without re-exec tricks in-process.
        _chosen = _exe
        break

if _chosen is None:
    bad(
        "no interpreter with Playwright found. Install it:\n"
        "        python3 -m pip install --user playwright && playwright install chromium\n"
        "        (override with SMOKE_PYTHON=/path/to/python3)"
    )
    print(f"\n[smoke:map] FAIL — {len(failures)} problem(s).\n")
    sys.exit(1)

print(f"  info  using interpreter: {_chosen}")

# Re-exec this same script under the chosen interpreter, set a flag so the
# child skips discovery and goes straight to the rendered checks.
if os.environ.get("_SMOKE_REEXEC") != "1":
    import subprocess

    env = dict(os.environ, _SMOKE_REEXEC="1")
    raise SystemExit(
        subprocess.run([_chosen, os.path.abspath(__file__)], env=env).returncode
    )

from playwright.sync_api import sync_playwright  # noqa: E402

with sync_playwright() as p:
    # Browser executable resolution.
    #
    # The cached revision may not match what this Playwright build expects
    # (seen here: Playwright 1.62 wants chromium_headless_shell-1234, while the
    # cache holds -1217 from the Node Playwright). Rather than force a ~180 MB
    # download, prefer the full Chromium already on disk — it is a real browser
    # and heavier than needed for a smoke test, which is fine.
    launch_kwargs: dict = {}
    cache = os.path.expanduser("~/.cache/ms-playwright")
    if os.path.isdir(cache):
        import glob

        for pat in (
            "chromium-*/chrome-linux64/chrome",
            "chromium-*/chrome-linux/chrome",
        ):
            found = sorted(glob.glob(os.path.join(cache, pat)))
            if found:
                launch_kwargs["executable_path"] = found[-1]
                print(f"  info  chromium: {found[-1]}")
                break

    try:
        browser = p.chromium.launch(**launch_kwargs)
    except Exception as e:  # noqa: BLE001
        bad(
            f"could not launch a Chromium for Playwright: {e}\n"
            f"        Fix with: python3.12 -m playwright install chromium"
        )
        print(f"\n[smoke:map] FAIL — {len(failures)} problem(s).\n")
        sys.exit(1)
    page = browser.new_page(viewport={"width": 1280, "height": 900})

    console_errors: list[str] = []
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))

    page.goto(MAP_URL, wait_until="networkidle")

    # The component's own guard fires at 6s; wait past it to catch the hang.
    page.wait_for_timeout(8000)

    # 1. The degraded banner must NOT be showing.
    degraded = page.evaluate(
        """() => {
            const el = document.querySelector('[role="status"]');
            if (!el) return false;
            return (el.textContent || '').includes('did not load');
        }"""
    )
    if degraded:
        bad(
            "in-app degraded banner is showing — map instance is up but the "
            "data layer never attached. This is the DEV-151 failure exactly."
        )
    else:
        ok("degraded banner not shown")

    # 2. The real assertion: features actually rendered.
    state = page.evaluate(
        """() => {
            const m = window.__pathwaysMap;
            if (!m) return { handle: false };
            const style = m.getStyle();
            let rendered = null;
            try {
                rendered = m.queryRenderedFeatures({ layers: ['communities'] }).length;
            } catch (e) { rendered = -1; }
            return {
                handle: true,
                styleLoaded: m.isStyleLoaded(),
                hasSource: !!(style.sources && style.sources['communities']),
                hasLayer: (style.layers || []).some(l => l.id === 'communities'),
                sourceLoaded: m.isSourceLoaded('communities'),
                rendered,
            };
        }"""
    )

    browser.close()

if not state.get("handle"):
    bad(
        "window.__pathwaysMap is absent — cannot inspect the map. The dev-only "
        "handle in state-map.tsx may have been removed."
    )
else:
    if not state.get("styleLoaded"):
        bad("map style never finished loading")
    else:
        ok("style loaded")
    if not state.get("hasSource"):
        bad("'communities' source absent from style")
    if not state.get("hasLayer"):
        bad("'communities' layer absent from style")
    if state.get("hasSource") and not state.get("sourceLoaded"):
        bad(
            "'communities' source present but NOT loaded — classic MapLibre v6 "
            "worker 404. Check /maplibre/maplibre-gl-worker.mjs is served."
        )
    elif state.get("hasSource"):
        ok("'communities' source loaded")

    rendered = state.get("rendered")
    if rendered is None:
        bad("could not read rendered feature count")
    elif rendered <= 0:
        bad(
            f"queryRenderedFeatures('communities') returned {rendered} — the map "
            f"is drawing no community points."
        )
    else:
        ok(f"map rendered {rendered} community features")

if console_errors:
    print("\n[smoke:map] console errors seen:")
    for e in console_errors[:10]:
        print(f"   - {e[:200]}")

if failures:
    print(f"\n[smoke:map] FAIL — {len(failures)} problem(s).\n")
    sys.exit(1)

print("\n[smoke:map] PASS — map renders community points.\n")
