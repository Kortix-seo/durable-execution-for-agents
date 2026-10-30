# 02 — a durable function whose journal is Postgres

No engine, no new service: two tables and one rule. This is the second example in an open-source companion repo to Kortix, the open-source CompanyOS. Each step's effect and its checkpoint commit **in the same transaction**, so a process killed before `COMMIT` leaves neither, and the resumed run executes the step exactly once more.

```sql
create table durable_runs  (run_id text primary key, status text, …);
create table durable_steps (run_id text, seq int, name text, result jsonb, …);
```

That is the whole idea DBOS Transact packages as a library. It is written out by hand here so you can see the transaction boundary, which is the thing that makes the test pass.

## Run it

```bash
npm ci
./test.sh      # starts a throwaway Postgres 16 in Docker on port 55432
```

Or against your own database:

```bash
psql "$DATABASE_URL" -f schema.sql
DATABASE_URL=postgres://user:pass@host:5432/durable node run.mjs --job demo-1
```

## What the test proves

The crash lands at step 3, after the refund row was inserted inside the open transaction and before `COMMIT`:

```
execute 1/4 fetch_ticket  {"job_id":"test-…","subject":"Refund for order 88213", …}
execute 2/4 classify  {"intent":"billing/refund","confidence":0.93}
CRASH   3/4 file_refund  before COMMIT
PASS  refunds at kill (effect rolled back with the checkpoint) (0)

replay  1/4 fetch_ticket  (checkpointed)
replay  2/4 classify  (checkpointed)
execute 3/4 file_refund  {"refunds_for_job":1}
execute 4/4 notify  {"queued":true}
PASS  refund rows after resume (exactly one) (1)
PASS  outbox rows after resume (exactly one) (1)
```

A third run of the same job is a no-op: `{"already_done":true, "note":"… nothing re-executed"}`. The checkpoints are the record of what happened, which is also what you want when someone asks why a customer was refunded.

## Where this stops being enough

The moment a step calls something outside the database — a payment API, a mail provider — the transaction no longer covers it. You are back to an idempotency key, as in [01-journal-replay](../01-journal-replay/). The rule of thumb that holds for both examples: **the checkpoint and the effect share a commit point; if they can't, the effect carries a key.**

`pg_advisory_xact_lock(hashtext(run_id))` at the top of each step keeps two processes from running the same job at once. Without it, both read "no checkpoint" and both execute the step.
