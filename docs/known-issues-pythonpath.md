# Known environment issue: Hermes injects PYTHONPATH

**Status:** OPEN, upstream. Documented here because it caused two bugs in this
repo that looked unrelated, and because it is a security issue, not just noise.

**Reported:** NousResearch/hermes-agent issue #7071 (open at time of writing).
**Scope:** every Hermes session on this machine — not Pathways-specific.
**Action taken in this repo:** none. Deliberately not worked around; see below.

---

## What happens

The Hermes agent exports `PYTHONPATH` into every child process, pointing at its
own Python 3.14 venv's `site-packages` (and, per the upstream report, at the
agent repo root as well):

```
PYTHONPATH=/home/abuck/.hermes/installs/<install-id>/environments/<env-id>/venv/lib/python3.14/site-packages
```

Two properties make this harmful:

1. **It is version-pinned.** A `3.14` site-packages path is only valid for the
   3.14 interpreter that owns it. Every *other* interpreter on the box inherits
   it, so a 3.13 process resolves packages out of a 3.14 tree.
2. **It is passed through**, not scrubbed, into sandboxed execution.

## Symptom 1 — conda entry-point warnings on every command

```
Error while loading conda entry point: conda-anaconda-tos (No module named 'pydantic_core._pydantic_core')
Error while loading conda entry point: anaconda-auth  (No module named 'pydantic_core._pydantic_core')
```

Printed to stderr around *every* shell command, by any `bash -lic` that sources
conda. Cosmetic, but it fires loose `watch_patterns: ["Error"]` notifications and
trains you to ignore real alerts.

**Mechanism** (verified directly). `pydantic_core` ships a pure-Python
`__init__.py` plus a compiled extension named for the ABI it was built against
(`_pydantic_core.cpython-313-x86_64-linux-gnu.so`). With the leaked 3.14 path
first on the search order, conda's 3.13 imports the *shim* from the 3.14 tree —
then that shim tries to load its sibling extension, and the one sitting there
belongs to a different environment layout than the interpreter asking. The
result is a pure-Python module imported from the wrong tree reporting a missing
native part:

```
ModuleNotFoundError: No module named 'pydantic_core._pydantic_core'
```

The tell is the traceback path: it points into
`.../venv/lib/python3.14/site-packages/pydantic_core/__init__.py` even though the
running interpreter is 3.13.

```
PYTHONPATH set    -> conda python 3.13 fails to import pydantic_core
PYTHONPATH unset  -> conda python 3.13 imports it cleanly
```

**Not caused by:** conda itself, `~/.bashrc`, `~/.profile`, or any dotfile —
`PYTHONPATH` appears in none of them. Confirmed by walking the process tree to
the agent's own `python3 -I -c ...` parent process.

## Symptom 2 — `npm run` picks the wrong interpreter

`npm run <script>` inherits whatever `python3` is first on PATH, and under this
agent that is Hermes's 3.14 venv:

```
python3      -> 3.14.7  playwright: no
python3.12   -> 3.12.3  playwright: YES
```

So browser-driven checks either died with an unhelpful `ImportError` or silently
ran under a different interpreter than the previous run.

**Mitigated** in this repo by `scripts/_python.sh`, which probes each candidate
by importing what the target script actually needs instead of trusting PATH.
A poisoned interpreter fails the probe and is skipped. Verified with the leaked
`PYTHONPATH` present: still selects `python3.12`, `smoke:map` passes.

## Security consequence

**`hermes_cli.config` is importable from any child process.** Verified with a
read-only probe under the live agent:

```
hermes_cli.config   IMPORTABLE at <install>/workspace/hermes_cli/config.py
tools.skills_guard  IMPORTABLE at <install>/workspace/tools/skills_guard.py
```

That module is the one the upstream report names as holding provider API keys.
The output redactor is reportedly bypassable with base64/hex/reverse encoding.

**Already mitigated here:** `~/.hermes/config.yaml` and `~/.hermes/.env` are both
mode `600`, so they are not readable by other OS users. The exposure is
import-time module resolution within the agent's own sandbox, not file
permissions.

## Why this repo does not work around it

Suppressing the warnings would mean editing the conda installation to
accommodate a variable injected by the agent — a workaround for a symptom, in a
component the user owns, to paper over a bug in a component they do not.

The only correct fix is upstream: stop adding the agent repo root to
`PYTHONPATH`, and remove `PYTHONPATH` from the passthrough prefix list. Until
then the practical posture is:

- Treat `PYTHONPATH` as untrusted in any script you write. Do not rely on
  `python3` resolving to a system interpreter.
- Probe dependencies explicitly rather than assuming an interpreter works.
- Do not expect a clean stderr from shell commands — filter known noise rather
  than alerting on the word "error".
