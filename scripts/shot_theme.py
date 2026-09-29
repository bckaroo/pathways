#!/usr/bin/env python3
"""Screenshot a route in light and dark, for visual confirmation."""
import glob, os, sys
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3005/communities/1003"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/home/abuck/.hermes/cache/scratch/theme"
os.makedirs(OUT, exist_ok=True)

cands = []
for pat in ("/home/abuck/.cache/ms-playwright/chromium-*/chrome-linux64/chrome",
            "/home/abuck/.cache/ms-playwright/chromium-*/chrome-linux/chrome",
            "/home/abuck/.hermes/tools/chromium-*/chrome-linux64/chrome"):
    cands += sorted(glob.glob(pat), reverse=True)
exe = next((c for c in cands if os.access(c, os.X_OK)), None)

slug = URL.rstrip("/").replace("http://localhost:3005", "").replace("/", "_") or "_home"

with sync_playwright() as pw:
    kw = {"args": ["--enable-unsafe-swiftshader"]}
    if exe:
        kw["executable_path"] = exe
    b = pw.chromium.launch(**kw)
    for scheme in ("light", "dark"):
        page = b.new_page(viewport={"width": 1440, "height": 1100})
        page.emulate_media(color_scheme=scheme)
        page.goto(URL, wait_until="networkidle", timeout=90_000)
        page.wait_for_timeout(900)
        # only the first screen for the profile; full page for short routes
        path = f"{OUT}/{slug or 'home'}-{scheme}.png"
        page.screenshot(path=path, full_page=True)
        print(path)
        page.close()
    b.close()
