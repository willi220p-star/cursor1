#!/usr/bin/env bash
# SQL tests for the Supabase migrations, against a throwaway local Postgres 16. Never touches a live project.
#
#   artifacts/gtm-studio/scripts/sql-test.sh
#
# By default it initdb's a cluster in a temp dir (unix socket only, free port), runs everything, and stops it.
# With SQL_TEST_EXTERNAL=1 it uses the server named by the standard PG* variables instead (CI service
# container) and creates/drops its own databases there.
#
# Steps: stub auth/storage schemas → existing migrations → seed legacy rows → new migrations (twice, to
# prove they re-run) → tests → every rollback in reverse → old-schema checks. Then the same migrations
# and rollbacks on an empty database.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$APP_DIR/supabase/migrations"
ROLLBACKS="$APP_DIR/supabase/rollbacks"
TESTS="$APP_DIR/supabase/tests"
NEW_PREFIX="2026101700"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/sql-test.XXXXXX")"
LOG="$TMP/test.log"
STARTED_CLUSTER=0

as_pg() {
  # initdb and pg_ctl refuse to run as root; run them as the postgres user in that case.
  if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

cleanup() {
  local code=$?
  if [ "$STARTED_CLUSTER" = "1" ]; then
    as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -m fast -w stop >/dev/null 2>&1 || true
  elif [ "${SQL_TEST_EXTERNAL:-0}" = "1" ]; then
    psql -X -q -d postgres -c "drop database if exists sqltest_main" -c "drop database if exists sqltest_empty" >/dev/null 2>&1 || true
  fi
  if [ $code -ne 0 ] && [ -f "$LOG" ]; then
    echo "---- last 60 log lines ($LOG) ----"
    tail -n 60 "$LOG"
  fi
  rm -rf "$TMP"
  exit $code
}
trap cleanup EXIT

if [ "${SQL_TEST_EXTERNAL:-0}" = "1" ]; then
  : "${PGHOST:?set PGHOST (and PGPORT/PGUSER/PGPASSWORD) for SQL_TEST_EXTERNAL=1}"
else
  [ -x "$PGBIN/initdb" ] || { echo "Postgres binaries not found in $PGBIN (set PGBIN)"; exit 1; }
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
  [ "$(id -u)" = "0" ] && chown postgres "$TMP"
  as_pg "$PGBIN/initdb" -D "$TMP/data" -U postgres --auth=trust --no-sync >/dev/null
  as_pg "$PGBIN/pg_ctl" -D "$TMP/data" -w -l "$TMP/server.log" \
    -o "-p $PORT -k $TMP -c listen_addresses='' -c fsync=off" start >/dev/null
  STARTED_CLUSTER=1
  export PGHOST="$TMP" PGPORT="$PORT" PGUSER=postgres
fi

run() { # run <db> <file>...
  local db="$1"; shift
  for f in "$@"; do
    echo "== $db: $(basename "$f")" >>"$LOG"
    psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >>"$LOG" 2>&1
  done
}
# The one-paste rollout file must be exactly the migrations in order, or it is out of date.
rollout_fresh() {
  local want; want="$(for f in $(new_migrations); do echo "-- ===== $(basename "$f") ====="; cat "$f"; echo; done)"
  local have; have="$(sed '1,/^$/d' "$APP_DIR/supabase/rollout/2-apply-all.sql")"
  [ "$want" = "$have" ] || { echo "supabase/rollout/2-apply-all.sql is out of date: run scripts/build-rollout.sh" >&2; exit 1; }
}
old_migrations() { ls "$MIGRATIONS"/*.sql | sort | grep -v "/$NEW_PREFIX"; }
new_migrations() { ls "$MIGRATIONS"/"$NEW_PREFIX"*.sql | sort; }
rollbacks_reversed() { ls "$ROLLBACKS"/"$NEW_PREFIX"*.down.sql | sort -r; }

rollout_fresh
: >"$LOG"
for db in sqltest_main sqltest_empty; do
  psql -X -q -d postgres -c "drop database if exists $db" -c "create database $db" >>"$LOG" 2>&1
done

echo "Main database: legacy data, migrations, tests, rollbacks"
run sqltest_main "$TESTS/00_stub.sql"
run sqltest_main $(old_migrations)
run sqltest_main "$TESTS/10_seed_legacy.sql"
run sqltest_main "$APP_DIR/supabase/rollout/1-backup.sql"
run sqltest_main $(new_migrations)
run sqltest_main $(new_migrations)   # re-run: must be idempotent
run sqltest_main "$APP_DIR/supabase/rollout/2-apply-all.sql"   # the one-paste file the rollout uses
run sqltest_main "$APP_DIR/supabase/rollout/3-check.sql"
run sqltest_main "$TESTS/_helpers.sql"
for f in "$TESTS"/[2-8]*.sql; do run sqltest_main "$f"; done
run sqltest_main $(rollbacks_reversed)
run sqltest_main "$TESTS/90_after_rollback.sql"

echo "Empty database: migrations and rollbacks"
run sqltest_empty "$TESTS/00_stub.sql"
run sqltest_empty $(old_migrations)
run sqltest_empty $(new_migrations)
run sqltest_empty "$TESTS/_helpers.sql" "$TESTS/95_empty_db.sql"
run sqltest_empty $(rollbacks_reversed)
run sqltest_empty "$TESTS/90_after_rollback.sql"

PASSED="$(grep -c 'NOTICE:  ok - ' "$LOG" || true)"
echo "All SQL tests passed: $PASSED assertions."
