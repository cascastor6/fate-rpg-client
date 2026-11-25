#!/usr/bin/env bash
# Optional: run the RLS test in plain SQL against a throwaway local Postgres (15+),
# without a Supabase project. Uses the standard PG* env vars for a superuser
# connection, e.g.  PGHOST=localhost PGUSER=postgres ./scripts/rls-test-local.sh
# A small shim stands in for Supabase's auth/vault/realtime pieces.
set -euo pipefail
cd "$(dirname "$0")/.."
DB=fate_rls_test
P="psql -X -q -v ON_ERROR_STOP=1"
$P -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null
$P -d $DB -f supabase/tests/supabase-shim.sql 2>&1 | grep -v -e wal_level -e "HINT:" || true
for f in supabase/migrations/*.sql; do $P -d $DB -f "$f"; done
out=$($P -d $DB -f supabase/tests/rls.sql 2>&1) || { echo "$out" | grep -E 'FAIL|ERROR' ; exit 1; }
echo "$out" | grep -oE '(PASS|FAIL) .*' || true
echo; echo "$(echo "$out" | grep -c PASS) checks passed"
$P -d postgres -c "drop database $DB" >/dev/null
