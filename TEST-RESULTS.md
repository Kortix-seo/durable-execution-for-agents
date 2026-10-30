# Test results — 2026-10-29

Every number below is the output of the scripts in this repository, run on the day this repository was published. Kortix is the open-source CompanyOS; this is its companion sample code, and the tests are how the claims are checked rather than asserted.

Environment: Node v22.23.1, Docker with `postgres:16-alpine`, git 2.x, Linux x86_64.

## 01 — journal and replay

`cd 01-journal-replay && ./test.sh` → exit 0

```
== 1. baseline: run the job to completion
PASS  baseline effects (2)

== 2. kill the process after step 3's refund was filed, before the journal recorded it
execute 2/5 classify  {"intent":"billing/refund","confidence":0.93}
execute 3/5 apply_effect  {"applied":true,"suppressed_duplicate":false,"key":"test-…:refund-requested"}
CRASH   3/5 apply_effect  after the effect, before the journal commit
journal lines at kill: 2
PASS  effects before resume (1)

== 3. start a new process; it replays the journal and finishes the job
replay  1/5 fetch_ticket  (4ea690fa04638871)
replay  2/5 classify  (1c4095096e727051)
execute 3/5 apply_effect  {"applied":false,"suppressed_duplicate":true,"key":"test-…:refund-requested"}
execute 4/5 write_summary  {"path":"summary.md","bytes":74,"hash":"172d379185fa3c7b"}
execute 5/5 notify  {"applied":true,"suppressed_duplicate":false,"key":"test-…:notified"}
PASS  replayed steps on resume (2)
PASS  effects after resume (refund filed once) (2)
PASS  refund key appears once (1)

== 4. the resumed job produced the same summary as the uninterrupted one
PASS  summary identical (f122efa562901647fad82de6e6b47aee943cee949470a3e1cc591fbeeea6286c)

== 5. control: the same crash WITHOUT an idempotency key duplicates the effect
PASS  effects in the naive run (2)

ALL CHECKS PASSED
```

Two things to read out of it. The resumed process replayed two steps and re-ran one, and the refund line appears once because the key was already in the effects log. The control run at the bottom is the same crash without the key: two refunds.

## 02 — Postgres-backed durable function

`cd 02-postgres-durable-function && npm ci && ./test.sh` → exit 0

```
== 1. kill the process at step 3, before COMMIT
execute 1/4 fetch_ticket  {"job_id":"test-…","subject":"Refund for order 88213", …}
execute 2/4 classify  {"intent":"billing/refund","confidence":0.93}
CRASH   3/4 file_refund  before COMMIT
PASS  steps checkpointed at kill (2)
PASS  refunds at kill (effect rolled back with the checkpoint) (0)

== 2. a new process resumes the same job
replay  1/4 fetch_ticket  (checkpointed)
replay  2/4 classify  (checkpointed)
execute 3/4 file_refund  {"refunds_for_job":1}
execute 4/4 notify  {"queued":true}
PASS  steps replayed on resume (2)
PASS  refund rows after resume (exactly one) (1)
PASS  outbox rows after resume (exactly one) (1)
PASS  run marked done (done)

== 3. a third run is a no-op: the checkpoints are the record
{"job":"test-…","already_done":true,"note":"the run's steps are all checkpointed; nothing re-executed"}
PASS  effects still once after a third run (1)

ALL CHECKS PASSED
```

The step that crashed left no refund row at all — not a duplicate, and not a half-finished one — because the insert and the checkpoint were in the transaction that was rolled back.

## 03 — the session model

`cd 03-kortix-session && ./demo.sh` → exit 0

```
== 1. session s-1 starts: its own clone, its own branch, named after the session
pushed: 21b15d5 on session/s-1

== 2. step 2 runs, then the sandbox is destroyed before it commits
PASS  step 2 present in the working tree before the kill (2)
sandbox-s1 destroyed

== 3. session s-2 starts from the pushed branch, not from the lost sandbox
PASS  step 1 survived the sandbox (1)
PASS  step 2 was lost with the sandbox (0)

== 4. s-2 finishes the work and pushes; the change request is the record
change request: session/s-1 -> main
888e2a2 step 2: notify customer
21b15d5 step 1: file refund

== 5. a person merges: the run's outcome is now on the default branch
PASS  steps on main after merge (2)
PASS  commits the session contributed (2)

ALL CHECKS PASSED
```

This one is a simulation of the session lifecycle against local git: it demonstrates the property (committed work survives, uncommitted work does not) rather than running a Kortix session. The Kortix-specific behaviour it maps to is documented from the product's own pages, not measured here.

## Reproducing

The scripts are deterministic apart from the job ids and the two hash values, which change with the ticket body. If a check fails for you, the failing line names the expected and actual value; open an issue with that line and the versions above.
