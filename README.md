# Durable execution for AI agents, three ways — the runnable code

Kortix is the open-source AI Operating System, and this is the companion repository to the guide at [durableexecutionguide.com](https://durableexecutionguide.com): the same interrupted agent job, run three ways, each one with the kill-and-resume test it passes.

Most durable-execution material answers "what is durable execution" with a definition. This answers the question an agent's author actually has: **your run takes twenty minutes, calls four APIs, waits a day for a person to approve something, and the process dies. What survives, what has to be re-done, and what changes in my code?**

The job is deliberately boring so the durability is the only interesting part: read a support ticket, classify it, file a refund, notify the customer. Four steps, one external effect that must happen exactly once.

| # | Mechanism | Where the state lives | What your step has to look like | What breaks |
|---|---|---|---|---|
| [01](01-journal-replay/) | Append-only journal + replay, the mechanism Temporal, Restate and Inngest share | A journal file (in production: the engine's own store) | Deterministic, with an idempotency key on every external effect | A step that is non-deterministic on replay produces a different history and the engine refuses it |
| [02](02-postgres-durable-function/) | The checkpoint is a row in Postgres, committed in the same transaction as the effect | Your Postgres | A plain async function; anything it writes through the transaction | An effect outside the database (an HTTP call) is no longer covered by the checkpoint |
| [03](03-kortix-session/) | A session's branch, its pushed commits and the change request it opens | Git, plus the platform's session record | Nothing special: the agent commits what it did | Anything not committed and pushed when the sandbox dies is gone |

## Run them

Each example is self-contained. Node 22+.

```bash
cd 01-journal-replay && ./test.sh                    # no dependencies
cd 02-postgres-durable-function && npm ci && ./test.sh   # needs Docker (starts Postgres 16)
cd 03-kortix-session && ./demo.sh                    # needs git only
```

Each script exits non-zero if any assertion fails. The measured output of the run that produced this repository is in [TEST-RESULTS.md](TEST-RESULTS.md).

## The four rules these examples teach

1. **A step boundary is a commit point, not a function call.** Everything before the boundary is guaranteed; everything after it is not. If you put the refund inside the same step as the classification, a retry refunds twice.
2. **An external effect needs a key you control.** Journal-and-replay engines only guarantee that a *recorded* step does not re-run. A crash between your HTTP call and the journal write re-runs the step — which is exactly what `01-journal-replay` reproduces on purpose, then suppresses with an idempotency key.
3. **Put the effect and its checkpoint in one transaction when you can.** That is the whole of `02-postgres-durable-function`: the refund row and the checkpoint row commit together, so a process killed before `COMMIT` leaves neither.
4. **In-memory state is not state.** Anything held in a variable, a closure or a local file lives exactly as long as the process. If it needs to survive, it has to be in the journal, the database or a commit.

## Which one to use

- **A replay engine** (Temporal, Restate, Inngest, Trigger.dev, Hatchet) when the workflow is the centre of your system and you want retries, timers, signals and visibility without building them. All five are self-hostable; their licences differ, and you should read the one you pick.
- **Postgres plus a checkpoint table** (what DBOS Transact packages as a library) when you already run Postgres and the workflow's effects are rows. DBOS's own README says the durable workflows are "entirely contained in this open-source library, there's no additional infrastructure for you to configure or manage".
- **A session-based agent platform** when the work *is* an agent editing a repository, and a human is the approver anyway. That is the shape `03-kortix-session` shows: the session's sandbox is disposable, its branch is not, and the change request is the durable record of what it did.

Kortix is the second and third together: the open-source AI Operating System where a session runs one agent in its own sandbox on a branch of your repo, the agent commits and pushes, and the change lands through a change request a person merges — with `cron`, `webhook`, `event` and `monitor` triggers starting sessions with nobody present. What survives a dead sandbox is what was committed and pushed; Kortix is not a durable-execution engine you code against, and this repository does not claim it is.

- The guide, with the vendor-neutral comparison and the licence and pricing table: [durableexecutionguide.com](https://durableexecutionguide.com)
- What Kortix is, in the docs: [kortix.com/docs](https://kortix.com/docs)
- [Kortix on GitHub](https://github.com/kortix-ai/suna)

## What is in each example

```
01-journal-replay/          run.mjs (engine + job), test.sh (kill-and-resume)
02-postgres-durable-function/ run.mjs, schema.sql, package.json, test.sh
03-kortix-session/          kortix.yaml (manifest excerpt), demo.sh, README.md
TEST-RESULTS.md             the measured output of all three tests on 2026-10-29
```

The code is deliberately small: `01` is about 180 lines including comments, `02` about 130 plus the schema. You are meant to read it, not to deploy it — in production the replay engine is Temporal's or Restate's, and the Postgres version is DBOS or your own job table.

## Licence and provenance

The code in this repository is MIT-licensed sample code. The claims about other products are quoted from their own pages and repositories; the source for each is next to it in the table below, read 2026-10-29.

| Product | Claim used here | Source |
|---|---|---|
| Temporal | "Durable Execution is crash-proof execution." | https://temporal.io/blog/what-is-durable-execution |
| Restate | "Durable Execution is a programming paradigm that makes ordinary code resilient to crashes, restarts, and infrastructure failures." | https://restate.dev/what-is-durable-execution |
| DBOS | Durable workflows "entirely contained in this open-source library, there's no additional infrastructure for you to configure or manage" | https://github.com/dbos-inc/dbos-transact-ts |
| Trigger.dev | "The open-source platform for building AI workflows in TypeScript" | https://github.com/triggerdotdev/trigger.dev |
| Hatchet | "a platform for orchestrating background tasks, AI agents, and durable workflows at scale" | https://github.com/hatchet-dev/hatchet |
| Inngest | Functions sync with "the Inngest Platform or a self-hosted Inngest server" | https://github.com/inngest/inngest |
| Microsoft | "Durable Task is Microsoft's durable execution framework for building fault-tolerant workflows as ordinary code." | https://learn.microsoft.com/en-us/azure/durable-task/common/what-is-durable-task |
