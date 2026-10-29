#!/usr/bin/env bash
# The kill-and-resume test for the Postgres-backed version.
# Needs Docker; starts a throwaway Postgres 16 on port 55432.
set -u
cd "$(dirname "$0")"

JOB="test-$(date +%s)"
CONTAINER="durable-fn-test-$$"
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1; }
trap cleanup EXIT

echo "== 0. start Postgres 16 and load the schema"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=postgres -p 55432:5432 postgres:16-alpine >/dev/null
for _ in $(seq 1 40); do
  docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 1
done
docker exec -i "$CONTAINER" psql -U postgres -q -c "create database durable" >/dev/null
docker exec -i "$CONTAINER" psql -U postgres -d durable -v ON_ERROR_STOP=1 -q < schema.sql
q() { docker exec "$CONTAINER" psql -U postgres -d durable -tAq -c "$1" | tr -d '[:space:]'; }
q "insert into tickets (job_id, subject, body) values ('$JOB', 'Refund for order 88213', 'Charged twice, please refund one charge.')" >/dev/null

echo
echo "== 1. kill the process at step 3, before COMMIT"
node run.mjs --job "$JOB" --crash-at 3 | tail -n 3
check "steps checkpointed at kill" 2 "$(q "select count(*) from durable_steps where run_id='$JOB'")"
check "refunds at kill (effect rolled back with the checkpoint)" 0 "$(q "select count(*) from refunds where job_id='$JOB'")"

echo
echo "== 2. a new process resumes the same job"
node run.mjs --job "$JOB" > ".resume-$JOB.out"
grep -E '^(replay|execute)' ".resume-$JOB.out"
check "steps replayed on resume" 2 "$(grep -c '^replay' ".resume-$JOB.out")"
check "refund rows after resume (exactly one)" 1 "$(q "select count(*) from refunds where job_id='$JOB'")"
check "outbox rows after resume (exactly one)" 1 "$(q "select count(*) from outbox where job_id='$JOB'")"
check "run marked done" done "$(q "select status from durable_runs where run_id='$JOB'")"

echo
echo "== 3. a third run is a no-op: the checkpoints are the record"
node run.mjs --job "$JOB" | tail -n 1
check "effects still once after a third run" 1 "$(q "select count(*) from refunds where job_id='$JOB'")"
rm -f ".resume-$JOB.out"

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$fail"
