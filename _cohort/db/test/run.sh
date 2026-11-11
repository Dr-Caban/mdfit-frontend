#!/usr/bin/env bash
# One command for a reviewer: rebuild the database from zero, apply every
# migration in order, load fixtures, run the gate tests.
#   PGHOST=/tmp PGPORT=5433 PGUSER=<superuser> db/test/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5433} PGUSER=${PGUSER:-cohort}
DB=${DB:-cohort_test}
psql -d postgres -q -c "DROP DATABASE IF EXISTS $DB;" -c "CREATE DATABASE $DB;" 2>/dev/null
for f in db/migrations/*.sql; do psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"; echo "  applied $(basename "$f")"; done
# Test-only: the migration creates cohort_app NOLOGIN; a deploy grants LOGIN with a secret.
psql -d "$DB" -q -c "ALTER ROLE cohort_app LOGIN;"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f db/test/seed.sql; echo "  seeded"
psql -d "$DB" -tAc "select 'role cohort_app: superuser='||rolsuper||' bypassrls='||rolbypassrls from pg_roles where rolname='cohort_app';"
DB="$DB" bash db/test/gate.sh
