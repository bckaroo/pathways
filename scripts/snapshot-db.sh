#!/usr/bin/env bash
# Snapshot / restore the Pathways database as a compact SQL dump.
#
# WHY A COMMITTED SNAPSHOT
# ------------------------
# The GitHub Pages build must be reproducible. Re-scraping NYSDEC and NYSERDA on
# every CI run would make the published site depend on a third party's uptime
# and HTML structure, take ~3 minutes, and hammer a government portal from CI
# runners. A 0.8 MB gzipped dump removes all of that, and doubles as a working
# starting database for anyone self-hosting (see README quickstart step 0).
#
#   scripts/snapshot-db.sh dump     -> data/pathways-snapshot.sql.gz
#   scripts/snapshot-db.sh restore  -> load it into the local container
#
# Restore is destructive to local rows in the tables the dump covers: pg_dump
# emits DROP/CREATE for them. That is intentional and it is why the dump step
# refuses to overwrite an existing file unless --force is passed.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${PATHWAYS_DB_CONTAINER:-pathways-db}"
DB_USER="${POSTGRES_USER:-pathways}"
DB_NAME="${POSTGRES_DB:-pathways}"
OUT="${REPO_ROOT}/data/pathways-snapshot.sql.gz"

# Tables that make up the published dataset. Auth/operational tables are never
# included, so a snapshot can be published without leaking anything operational.
# Table names for the dump. Rules learned by testing each one individually:
#   * tables in `public` resolve by BARE name (search_path covers them), and
#     qualifying them as public.x makes pg_dump read "public" as a DATABASE and
#     fail with "cross-database references are not implemented";
#   * __drizzle_migrations lives in the `drizzle` schema, which is NOT on the
#     search_path, so it is the one entry that MUST be qualified.
# A wrong name aborts pg_dump with "no matching tables were found" rather than
# skipping, which is why restore-tested names are listed explicitly here.
TABLES=(
  programs actions municipalities certifications completions
  certification_levels crosswalk cec_designations cec_completions
  drizzle.__drizzle_migrations
)

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 1; }

container_up() {
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true
}

cmd_dump() {
  local force=0
  [[ "${1:-}" == "--force" ]] && force=1
  if [[ -f "$OUT" && $force -eq 0 ]]; then
    echo "[snapshot] $OUT exists. Re-run with --force to overwrite." >&2
    exit 1
  fi
  container_up || { echo "[snapshot] container '$CONTAINER' is not running" >&2; exit 1; }

  mkdir -p "$(dirname "$OUT")"
  local tmp; tmp="$(mktemp)"

  # ONE pg_dump invocation with all tables, NOT a loop appending separate dumps.
  # Per-table dumps each carry their own CREATE TABLE preamble, so concatenating
  # them makes the second dump collide with the first
  # ("relation \"programs\" already exists" once shared objects repeat) and the
  # restore exits non-zero. A single call emits one coherent, ordered script.
  #
  # --create would emit CREATE DATABASE, which a CI service container cannot use
  # (it connects to an existing db), so schema+data only. -C is deliberately off.
  # --no-owner/--no-privileges so it restores under any role name.
  #
  # Table-name rules, verified one at a time:
  #   * `public` tables resolve by BARE name; qualifying them as public.x makes
  #     pg_dump read "public" as a DATABASE -> "cross-database references are
  #     not implemented";
  #   * __drizzle_migrations is in the `drizzle` schema, which is NOT on the
  #     search_path, so it MUST be qualified.
  # We pass --schema=public explicitly so `drizzle` is created too; without it a
  # fresh database errors "schema \"drizzle\" does not exist".
  #
  # `\restrict`/`\unrestrict` in the dump header are pg_dump 16.10+ hardening;
  # psql honours them on restore, so do not strip them or reorder lines.
  #
  # pg_dump does NOT emit CREATE SCHEMA for a schema that already exists in the
  # source database -- it assumes the destination has it too. So a fresh restore
  # fails with 'schema "drizzle" does not exist'. Prepend the schema creation
  # ourselves, guarded so it is a no-op when the schema is already there.
  {
    echo "CREATE SCHEMA IF NOT EXISTS drizzle;"
  } > "$tmp"

  local args=(--no-owner --no-privileges --schema=public --schema=drizzle)
  for t in "${TABLES[@]}"; do args+=(--table="$t"); done
  docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" "${args[@]}" >> "$tmp"
  gzip -9 -c "$tmp" > "$OUT"
  rm -f "$tmp"

  local rows
  rows=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -t -A -c \
    "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables")
  printf '[snapshot] wrote %s (%.1f MB, %s rows)\n' \
    "${OUT#"$REPO_ROOT"/}" "$(stat -c%s "$OUT" | awk '{print $1/1048576}')" "$rows"
}

cmd_restore() {
  container_up || { echo "[snapshot] container '$CONTAINER' is not running" >&2; exit 1; }
  [[ -f "$OUT" ]] || { echo "[snapshot] no snapshot at $OUT" >&2; exit 1; }
  gunzip -c "$OUT" | docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" -q
  echo "[snapshot] restored $OUT into $CONTAINER/$DB_NAME"
}

case "${1:-}" in
  dump)    shift; cmd_dump "${1:-}" ;;
  restore) shift; cmd_restore ;;
  *)       usage ;;
esac
