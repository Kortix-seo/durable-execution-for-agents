# 01 — journal and replay, in one file

`run.mjs` is a durable execution engine in about 180 lines, no dependencies, and it is the first of the three examples in this open-source companion repo to Kortix, the open-source CompanyOS. It is the mechanism behind Temporal, Restate and Inngest: every completed step appends an entry to a journal, and a restarted process reads the journal instead of re-running the work. The step that is not in the journal yet is the only one that runs again.

The job is a support agent's: fetch a ticket, classify it, file a refund, write a summary, notify the customer. Step 3 is the external effect.

## What the test proves

`./test.sh` runs the job, then kills the process **after the refund was filed and before the journal recorded it** — the one window a journal cannot close by itself — and resumes in a new process.

```
== 3. start a new process; it replays the journal and finishes the job
replay  1/5 fetch_ticket  (4ea690fa04638871)
replay  2/5 classify  (1c4095096e727051)
execute 3/5 apply_effect  {"applied":false,"suppressed_duplicate":true,"key":"…:refund-requested"}
execute 4/5 write_summary  {"path":"summary.md","bytes":74,"hash":"172d379185fa3c7b"}
execute 5/5 notify  {"applied":true,"suppressed_duplicate":false,"key":"…:notified"}
PASS  effects after resume (refund filed once) (2)
PASS  summary identical (f122efa5…)
```

Then the control at the end shows the same crash with no idempotency key: two refunds for one ticket. That is the difference the key makes, and it is why every effect in `run.mjs` takes one.

## What to change for your own job

- Replace `classify` with your model call. It is already the only non-deterministic step, which is why it is journaled and never replayed by its function.
- Every effect function takes an idempotency key derived from the job and the step. If your downstream API has no idempotency mechanism, write the key into your own table before the call.
- Steps must be deterministic from their inputs on replay. If a step reads the clock, a random number or the network, journal that value in the step instead of re-reading it.

The resume is a new process reading `.state/<job>/journal.jsonl`. In production that file is the engine's store, and the engine also handles concurrency, timers and visibility — that is what the hosted products in the existing landscape sell. This example exists so the mechanism is readable in one sitting.
