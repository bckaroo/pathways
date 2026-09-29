#!/usr/bin/env python3
"""
Test the basemap fallback path.

An untested fallback is worse than no fallback: it creates false confidence.
This drives the real page with the tile host blocked and asserts that

  1. the community points STILL render (data survives a basemap outage),
  2. the fallback surface is used (no 'openmaptiles' source),
  3. the user is told (the sky-blue "Basemap unavailable" banner appears).

The failure this guards against is the original one: a failing basemap took the
data layer down with it while the page still returned HTTP 200 and nothing said
anything was wrong.

Usage:  python3 scripts/test_basemap_fallback.py
Exit 0 = fallback behaves correctly.
"""
from __future__ import annotations

import os
import subprocess
import sys

BASE_URL = os.environ.get("BASE_URL", "http://localhost:3005")
MAP_URL = f"{BASE_URL}/map"

failures: list[str] = []


def ok(m: str) -> None:
    print(f"  ok    {m}")


def bad(m: str) -> None:
    print(f"  FAIL  {m}")
    failures.append(m)


# Reuse the interpreter discovery from smoke_map.py
_SELFTEST = "import playwright.sync_api, sys; sys.exit(0)"
here = os.path.dirname(os.path.abspath(__file__))


def has_playwright(exe: str) -> bool:
    try:
        return subprocess.run([exe, "-c", _SELFTEST], stdout=subprocess.DEVNULL,
                              stderr=subprocess.DEVNULL, timeout=30).returncode == 0
    except Exception:
        return False


if os.environ.get("_FB_REEXEC") != "1":
    for exe in ("python3.12", "/usr/bin/python3", "python3", sys.executable):
        if has_playwright(exe):
            env = dict(os.environ, _FB_REEXEC="1")
            raise SystemExit(subprocess.run([exe, os.path.abspath(__file__)],
                                            env=env).returncode)
    print("  FAIL  no interpreter with playwright")
    sys.exit(1)

from playwright.sync_api import sync_playwright  # noqa: E402

print("\n[fallback] driving the page with the tile host BLOCKED")

with sync_playwright() as p:
    # Same browser-executable resolution as smoke_map.py: the cached chromium
    # revision may not match what this Playwright build expects, so prefer the
    # full Chromium already on disk instead of forcing a download.
    launch_kwargs: dict = {}
    cache = os.path.expanduser("~/.cache/ms-playwright")
    if os.path.isdir(cache):
        import glob

        for pat in ("chromium-*/chrome-linux64/chrome", "chromium-*/chrome-linux/chrome"):
            found = sorted(glob.glob(os.path.join(cache, pat)))
            if found:
                launch_kwargs["executable_path"] = found[-1]
                break

    browser = p.chromium.launch(**launch_kwargs)

    # Block the tile host entirely, simulating an outage / offline / DNS fail.
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    blocked = {"n": 0}

    def route_handler(route):
        blocked["n"] += 1
        route.abort()

    context.route("**tiles.openfreemap.org/**", route_handler)
    page = context.new_page()

    console_errors: list[str] = []
    page.on("pageerror", lambda e: console_errors.append(str(e)))

    page.goto(MAP_URL, wait_until="domcontentloaded")
    # The component's basemap deadline is 8s; wait past it for the swap.
    page.wait_for_timeout(13000)

    print(f"  info  blocked {blocked['n']} tile requests")

    state = page.evaluate(
        """() => {
            const m = window.__pathwaysMap;
            if (!m) return { handle: false };
            const st = m.getStyle();
            const srcs = Object.keys(st.sources || {});
            let rendered = null;
            try { rendered = m.queryRenderedFeatures({layers:['communities']}).length; }
            catch(e) { rendered = -1; }
            const banners = [...document.querySelectorAll('[role="status"]')]
                .map(el => el.textContent.trim());
            return {
                handle: true,
                layerCount: (st.layers || []).length,
                hasVectorBasemap: srcs.includes('openmaptiles'),
                hasCommunities: (st.layers||[]).some(l=>l.id==='communities'),
                rendered,
                banners,
            };
        }"""
    )

    browser.close()

if not state.get("handle"):
    bad("window.__pathwaysMap absent — cannot verify fallback")
else:
    if blocked["n"] == 0:
        bad("no tile requests were blocked — the test did not exercise the fallback "
            "(is the basemap URL still openfreemap?)")

    # 1. The critical assertion: data survives a basemap outage.
    rendered = state.get("rendered")
    if rendered and rendered > 0:
        ok(f"community points SURVIVED the basemap outage ({rendered} rendered)")
    else:
        bad(f"community points did NOT survive the outage (rendered={rendered!r}). "
            f"This is the original bug: a basemap failure taking the data with it.")

    # 2. The fallback surface is in use.
    if state.get("hasVectorBasemap"):
        bad("still reporting a vector basemap — the fallback did not engage")
    else:
        ok(f"fallback surface engaged ({state.get('layerCount')} layers, no openmaptiles)")

    # 3. The user is told.
    banners = state.get("banners") or []
    if any("Basemap unavailable" in b for b in banners):
        ok("'Basemap unavailable' banner shown to the user")
    else:
        bad(f"no basemap banner shown; banners seen: {banners}")

if console_errors:
    print("\n[fallback] page errors:")
    for e in console_errors[:5]:
        print(f"   - {e[:160]}")

print()
if failures:
    print(f"[fallback] FAIL — {len(failures)} problem(s).\n")
    sys.exit(1)
print("[fallback] PASS — data survives a basemap outage and the user is told.\n")
