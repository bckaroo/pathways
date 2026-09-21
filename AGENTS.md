# AGENTS.md — Pathways (PROJ-025)

Managed by DevOS (canonical repo protocol).

## Rules
- All development work on this repo is tracked in DevOS as project **PROJ-025**.
- Before working: `devos doctor PROJ-025` (drift audit) and read the latest
  `notes/DEVLOG.md` entry to pick up current state and conventions.
- Find-before-create: query DevOS (`devos list --project PROJ-025`) before filing work.
- After each round of development, append a dated entry to `notes/DEVLOG.md`
  (summarize what was built, key commit hashes, verification, follow-ups).
- Never duplicate work already tracked in DevOS.

## Repo conventions
- Stack: Next.js 15 (App Router, TS) + Tailwind + MapLibre GL; Postgres 16 via
  `docker-compose.yml` + Drizzle ORM (`src/db/schema.ts`, migrations in `drizzle/`).
- Ingestion: Python 3.12 via uv (`ingest/`, `uv run --project ingest python ...`),
  idempotent upserts only — the CSC action list refreshes annually.
- Ports: dev server pinned to **3005** (range 3000–3099 per ops policy); Postgres
  host port **5433**. Never invent other ports.
- Naming: product name is **Pathways**. Do not use any other working name in
  code/UI/docs. No ClearPath/ICLEI/ClimateView marks anywhere.
- License: AGPL-3.0 (`LICENSE`); keep third-party data attributed in README.
- Commits: message cites the DevOS task id (`DEV-XXX: ...`) per the devos-operator
  Git plan. Trunk-based `main`; no direct pushes to GitHub without owner request.
- ProjectOS context: registry `software/pathways` (strategy/milestones). Dev-level
  work is tracked here in DevOS only.
