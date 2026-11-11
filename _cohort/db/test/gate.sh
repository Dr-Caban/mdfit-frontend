#!/usr/bin/env bash
# Phase 0 gate tests. Every assertion is a real query against a real database,
# run as cohort_app — a role that owns nothing and is not superuser, because RLS
# is bypassed by table owners (unless FORCE) and always by superusers. Testing as
# the owner would prove nothing.
set -uo pipefail
export PGHOST=${PGHOST:-/tmp} PGPORT=${PGPORT:-5433}
DB=${DB:-cohort}
pass=0; fail=0

ok(){ printf '  \033[32mPASS\033[0m  %s\n' "$1"; pass=$((pass+1)); }
no(){ printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

# $1 label  $2 expected  $3 sql  [$4 session settings]
expect(){
  local label="$1" want="$2" sql="$3" setup="${4:-}"
  local got
  got=$(psql -U cohort_app -d "$DB" -qtAc "${setup} ${sql}" 2>&1 | tr -d '[:space:]')
  if [ "$got" = "$want" ]; then ok "$label"; else no "$label (want=$want got=$got)"; fi
}

# $1 label  $2 sql  [$3 setup] — passes when the statement is REFUSED
refuses(){
  local label="$1" sql="$2" setup="${3:-}"
  if psql -U cohort_app -d "$DB" -v ON_ERROR_STOP=1 -q -c "${setup} ${sql}" >/dev/null 2>&1; then
    no "$label (statement was ALLOWED)"
  else
    ok "$label"
  fi
}

P1="SET cohort.practice_id='1'; SET cohort.staff_id='1'; SET cohort.disciplines='{bodywork}';"
P2="SET cohort.practice_id='2'; SET cohort.staff_id='3'; SET cohort.disciplines='{bodywork}';"
P1_BH="SET cohort.practice_id='1'; SET cohort.staff_id='1'; SET cohort.disciplines='{behavioral}';"
P1_OTHER="SET cohort.practice_id='1'; SET cohort.staff_id='2'; SET cohort.disciplines='{behavioral}';"

echo
echo "A1 — tenant isolation (RLS, app filter absent from every query)"
expect "practice 1 sees only its own clients"        1 "SELECT count(*) FROM client;" "$P1"
expect "practice 2 sees only its own clients"        1 "SELECT count(*) FROM client;" "$P2"
expect "practice 2 cannot read practice 1's client"  0 "SELECT count(*) FROM client WHERE id=1;" "$P2"
expect "no tenant context = no rows (fail closed)"   0 "SELECT count(*) FROM client;" ""
expect "practice 2 cannot read practice 1's ledger"  0 "SELECT count(*) FROM ledger_entry WHERE practice_id=1;" "$P2"

echo
echo "A2 — discipline segregation"
expect "bodywork sees the bodywork note"             1 "SELECT count(*) FROM note WHERE id=1;" "$P1"
expect "behavioral cannot see the bodywork note"     0 "SELECT count(*) FROM note WHERE id=1;" "$P1_BH"
expect "bodywork cannot see behavioral encounters"   0 "SELECT count(*) FROM encounter WHERE discipline='behavioral';" "$P1"

echo
echo "A4 — sensitivity tiers (T2 is author-only)"
expect "author reads own T2 note"                    1 "SELECT count(*) FROM note WHERE id=2;" "$P1_BH"
expect "same-discipline colleague cannot read T2"    0 "SELECT count(*) FROM note WHERE id=2;" "$P1_OTHER"
expect "T1 note IS visible to that colleague"        1 "SELECT count(*) FROM note WHERE id=3;" "$P1_OTHER"

echo
echo "A5 — audit ledger is append-only and chained"
refuses "UPDATE on ledger_entry is refused"          "UPDATE ledger_entry SET outcome='ok' WHERE seq=1;" "$P1"
refuses "DELETE on ledger_entry is refused"          "DELETE FROM ledger_entry WHERE seq=1;" "$P1"
refuses "TRUNCATE on ledger_entry is refused"        "TRUNCATE ledger_entry;" "$P1"
refuses "INSERT with a wrong prev_hash is refused" \
  "INSERT INTO ledger_entry (practice_id,actor_id,event,subject_type,subject_id,prev_hash,hash,signature,key_id)
   VALUES (1,1,'chart.view','client',1,
     decode(repeat('aa',32),'hex'), decode(repeat('bb',32),'hex'), '\\x00','k1');" "$P1"
expect "chain verifies: every prev_hash links"       t \
  "SELECT bool_and(linked) FROM (
       SELECT prev_hash = coalesce(lag(hash) OVER (PARTITION BY practice_id ORDER BY seq), ledger_genesis()) AS linked
         FROM ledger_entry) c;" "$P1"

echo
echo "A5 — note signing and locking"
refuses "locked note cannot be UPDATEd"              "UPDATE note SET dek_id='x' WHERE id=4;" "$P1"
refuses "locked note cannot be DELETEd"              "DELETE FROM note WHERE id=4;" "$P1"
expect  "unlocked note can still be edited"          1 \
  "WITH u AS (UPDATE note SET dek_id='k2' WHERE id=1 RETURNING 1) SELECT count(*) FROM u;" "$P1"

echo
echo "P9 — double-booking (overlapping ranges, not just equal starts)"
refuses "overlapping booking for same provider refused" \
  "INSERT INTO encounter (practice_id,client_id,provider_id,discipline,starts_at,ends_at)
   VALUES (1,1,1,'bodywork','2026-12-01T14:30:00Z','2026-12-01T15:00:00Z');" "$P1"
expect  "non-overlapping booking is accepted"        1 \
  "WITH i AS (INSERT INTO encounter (practice_id,client_id,provider_id,discipline,starts_at,ends_at)
   VALUES (1,1,1,'bodywork','2026-12-01T16:00:00Z','2026-12-01T17:00:00Z') RETURNING 1) SELECT count(*) FROM i;" "$P1"

echo
echo "Write paths — a tenant cannot write into, or move rows into, another tenant"
refuses "practice 2 cannot INSERT a client into practice 1" \
  "INSERT INTO client (practice_id,given_name,family_name) VALUES (1,'X','Y');" "$P2"
refuses "practice 1 cannot move its client to practice 2" \
  "UPDATE client SET practice_id=2 WHERE id=1;" "$P1"
refuses "practice 2 cannot append to practice 1's ledger" \
  "INSERT INTO ledger_entry (practice_id,actor_id,event,subject_type,prev_hash,hash,signature,key_id)
   VALUES (1,3,'chart.view','client', decode(repeat('33',32),'hex'), decode(repeat('cc',32),'hex'),'\\x00','k1');" "$P2"
expect  "soft delete succeeds"                        1 \
  "WITH u AS (UPDATE client SET deleted_at=now() WHERE id=1 RETURNING 1) SELECT count(*) FROM u;" "$P1"
expect  "soft-deleted client is gone from client_active" 0 "SELECT count(*) FROM client_active WHERE id=1;" "$P1"
expect  "client_active still enforces tenancy"       0 "SELECT count(*) FROM client_active WHERE id=2;" "$P1"

echo
echo "Note identity — author, client, practice and discipline are fixed"
refuses "colleague cannot reassign a note's author"  "UPDATE note SET author_id=2 WHERE id=3;" "$P1_OTHER"
refuses "a note cannot be moved to another discipline" "UPDATE note SET discipline='behavioral' WHERE id=1;" "$P1"

echo
echo "Ledger fork race — two writers chaining off the same head"
HEAD="decode(repeat('33',32),'hex')"
ROW="INSERT INTO ledger_entry (practice_id,actor_id,event,subject_type,prev_hash,hash,signature,key_id) VALUES (1,1,'chart.view','client',$HEAD"
( psql -U cohort_app -d "$DB" -q -c "$P1 BEGIN; $ROW, decode(repeat('d1',32),'hex'),'\\x00','k1'); SELECT pg_sleep(2); COMMIT;" >/dev/null 2>&1 ) &
sleep 0.7
if psql -U cohort_app -d "$DB" -v ON_ERROR_STOP=1 -q -c "$P1 $ROW, decode(repeat('d2',32),'hex'),'\\x00','k1');" >/dev/null 2>&1
then no "second concurrent writer on the same head was ALLOWED (fork)"; else ok "second concurrent writer on the same head is refused"; fi
wait
expect "exactly one of the two racing rows landed"   1 \
  "SELECT count(*) FROM ledger_entry WHERE practice_id=1 AND prev_hash=$HEAD;" "$P1"
expect "chain still verifies after the race"         t \
  "SELECT bool_and(linked) FROM (
       SELECT prev_hash = coalesce(lag(hash) OVER (PARTITION BY practice_id ORDER BY seq), ledger_genesis()) AS linked
         FROM ledger_entry) c;" "$P1"

echo
echo "Negative control — the same data, read WITHOUT row-level security"
got=$(psql -d "$DB" -qtAc "SELECT count(*) FROM client;" | tr -d '[:space:]')
if [ "$got" = "2" ]; then ok "a superuser sees both tenants' clients (so the passes above are RLS, not empty tables)"; else no "negative control (want=2 got=$got)"; fi

echo
printf '\n  %d passed, %d failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
