#!/usr/bin/env bash
# Resolve a Python interpreter that can import the project's test dependencies.
#
# WHY THIS EXISTS
# ---------------
# `npm run <script>` inherits whatever `python3` is first on PATH. On this
# machine that is often Hermes's bundled 3.14 venv, which has no Playwright, so
# the browser-driven checks die with an unhelpful ImportError — or worse, a
# different interpreter silently changes behaviour between runs.
#
# Usage:  scripts/_python.sh <script.py> [args...]
#
# Resolution order: $PATHWAYS_PYTHON, then any candidate that can import
# playwright, then plain python3 so non-browser scripts still run.

set -euo pipefail

CANDIDATES=(python3.12 python3.11 python3)

NEED_BROWSER=0
for arg in "$@"; do
  case "$arg" in
    *smoke_map.py|*test_basemap_fallback.py|*audit_contrast.py|*shot_theme.py)
      NEED_BROWSER=1 ;;
  esac
done

# An explicit override must be honoured or fail loudly — silently falling
# through to another interpreter would make the variable a lie, and would hide
# a typo in it until the day the fallback happened to be missing.
if [[ -n "${PATHWAYS_PYTHON:-}" ]]; then
  if ! command -v "$PATHWAYS_PYTHON" >/dev/null 2>&1; then
    echo "[_python.sh] PATHWAYS_PYTHON=$PATHWAYS_PYTHON not found on PATH" >&2
    exit 127
  fi
  if [[ $NEED_BROWSER -eq 1 ]] && ! "$PATHWAYS_PYTHON" -c 'import playwright' >/dev/null 2>&1; then
    echo "[_python.sh] PATHWAYS_PYTHON=$PATHWAYS_PYTHON cannot import playwright," >&2
    echo "             but $* needs it. Refusing to fall back — the override" >&2
    echo "             would be ignored silently otherwise." >&2
    exit 127
  fi
  exec "$PATHWAYS_PYTHON" "$@"
fi

for py in "${CANDIDATES[@]}"; do
  command -v "$py" >/dev/null 2>&1 || continue
  if [[ $NEED_BROWSER -eq 1 ]]; then
    "$py" -c 'import playwright' >/dev/null 2>&1 || continue
  fi
  exec "$py" "$@"
done

echo "[_python.sh] no usable interpreter for: $*" >&2
if [[ $NEED_BROWSER -eq 1 ]]; then
  echo "[_python.sh] the requested script needs playwright; install it with" >&2
  echo "             python3.12 -m pip install playwright && python3.12 -m playwright install chromium" >&2
fi
exit 127
