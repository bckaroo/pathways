#!/usr/bin/env python3
"""
Contrast audit for Pathways, in both colour schemes.

WHY THIS EXISTS
---------------
A vision model reviewed a dark-mode screenshot of the community profile and
reported "no visual defects" while white cards sat on a black page with
light-on-light text. Vision cannot measure a contrast ratio.

Equally, injecting a <style> block to force dark tokens does NOT test the real
`@media (prefers-color-scheme: dark)` block — and I made that mistake: the
override never fired the media query, so the light values stayed and the report
was wrong in the other direction.

The only trustworthy method is Playwright's `color_scheme`, which drives the
browser's genuine preference and therefore the media query itself.

Run:  python3.12 scripts/audit_contrast.py [url]
Exit: 0 = all sampled text meets WCAG AA (4.5:1), 1 = failures found.
"""

import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3005/communities/1003"
SCHEMES = ["light", "dark"]
AA_NORMAL = 4.5
AA_LARGE = 3.0  # >=18.66px bold or >=24px

# Measured in-page. Walks up for the first opaque background, because most text
# sits on a card whose own background is the thing that matters — not <body>.
MEASURE_JS = """
() => {
  // Resolve ANY CSS colour to sRGB. Uses the browser itself (canvas) so oklab,
  // oklch, hsl, named colours and alpha all become correct 0-255 triples —
  // hand-rolled regex parsing silently corrupts oklab into near-black.
  const CV = document.createElement('canvas');
  CV.width = CV.height = 1;
  const CX = CV.getContext('2d', { willReadFrequently: true });
  const cache = new Map();
  const toRgb = (c) => {
    if (!c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return null;
    if (cache.has(c)) return cache.get(c);
    CX.clearRect(0, 0, 1, 1);
    CX.fillStyle = '#000';
    CX.fillStyle = c;                  // invalid values leave it black
    CX.fillRect(0, 0, 1, 1);
    const d = CX.getImageData(0, 0, 1, 1).data;
    const v = [d[0], d[1], d[2]];
    cache.set(c, v);
    return v;
  };
  // Effective background: walk up until an OPAQUE colour is found, since an
  // alpha'd surface composites against whatever is behind it.
  const parse = (c) => toRgb(c);
  const lum = (rgb) => {
    const [r, g, b] = rgb.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (fg, bg) => {
    const a = lum(fg), b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const isOpaque = (c) => {
    if (!c || c === 'transparent') return false;
    if (/rgba?\\(/.test(c)) {
      const m = c.match(/[\\d.]+/g);
      return m && m.length >= 4 ? parseFloat(m[3]) >= 1 : true;
    }
    // oklab(...) / oklch(...) / color(...) carry alpha after a slash
    const sl = c.split('/');
    if (sl.length === 2) return parseFloat(sl[1]) >= 1;
    return true;
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n.nodeType === 1 && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (isOpaque(c)) {
        const p = toRgb(c);
        if (p) return p;
      }
      n = n.parentElement;
    }
    return toRgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255];
  };

  const out = [];
  document.querySelectorAll('body *').forEach((el) => {
    // only leaf-ish elements that actually render text
    const own = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.trim())
      .join(' ')
      .trim();
    if (!own) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const fg = parse(cs.color);
    if (!fg) return;
    const bg = bgOf(el);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      text: own.replace(/\\s+/g, ' ').slice(0, 46),
      fg: `rgb(${fg.join(',')})`,
      bg: `rgb(${bg.join(',')})`,
      ratio: +ratio(fg, bg).toFixed(2),
      size, weight, large,
      need: large ? 3.0 : 4.5,
      cls: (typeof el.className === 'string' ? el.className : '').slice(0, 70),
    });
  });
  return out;
}
"""


def audit(page, scheme):
    page.emulate_media(color_scheme=scheme)
    page.goto(URL, wait_until="networkidle", timeout=90_000)
    page.wait_for_timeout(700)  # let fonts/paint settle
    pref = page.evaluate("window.matchMedia('(prefers-color-scheme: dark)').matches")
    body = page.evaluate("getComputedStyle(document.body).backgroundColor")
    rows = page.evaluate(MEASURE_JS)
    fails = [r for r in rows if r["ratio"] < r["need"]]
    fails.sort(key=lambda r: r["ratio"])
    return pref, body, rows, fails


def main():
    # Pin the executable: Playwright's bundled headless-shell revision can be
    # absent while a full chromium build is present, which raises
    # "Executable doesn't exist at chromium_headless_shell-<N>". Probe for a
    # real binary before falling back to the default lookup.
    import glob
    import os

    cands = []
    for pat in (
        "/home/abuck/.cache/ms-playwright/chromium-*/chrome-linux64/chrome",
        "/home/abuck/.cache/ms-playwright/chromium-*/chrome-linux/chrome",
        "/home/abuck/.hermes/tools/chromium-*/chrome-linux64/chrome",
    ):
        cands += sorted(glob.glob(pat), reverse=True)
    exe = next((c for c in cands if os.access(c, os.X_OK)), None)

    bad_total = 0
    with sync_playwright() as pw:
        launch_kwargs = {"args": ["--enable-unsafe-swiftshader"]}
        if exe:
            launch_kwargs["executable_path"] = exe
            print(f"chromium: {exe}")
        browser = pw.chromium.launch(**launch_kwargs)
        ctx = browser.new_context(viewport={"width": 1400, "height": 1000})
        page = ctx.new_page()

        for scheme in SCHEMES:
            pref, body, rows, fails = audit(page, scheme)
            print(f"\n{'='*72}\n{scheme.upper()}   browser prefers dark: {pref}   body: {body}")
            print(f"{'='*72}")
            print(f"  text nodes measured: {len(rows)}")
            print(f"  below WCAG AA:      {len(fails)}")
            if fails:
                bad_total += len(fails)
                print(f"\n  {'ratio':>6} {'need':>5}  {'fg':<18} {'bg':<18} text")
                for r in fails[:25]:
                    print(f"  {r['ratio']:>6} {r['need']:>5}  {r['fg']:<18} {r['bg']:<18} {r['text']}")
                if len(fails) > 25:
                    print(f"  ... and {len(fails) - 25} more")

        browser.close()

    print(f"\n{'='*72}")
    if bad_total:
        print(f"FAIL — {bad_total} text nodes below WCAG AA across both schemes")
    else:
        print("PASS — every sampled text node meets WCAG AA in both schemes")
    print("=" * 72)
    return 1 if bad_total else 0


if __name__ == "__main__":
    sys.exit(main())
