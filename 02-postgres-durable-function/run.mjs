#!/usr/bin/env node
// A durable function whose journal IS Postgres. No extra service, no new
// language: one table for the run, one for its steps, and every step's effect
// committed in the same transaction as its checkpoint.
//
// This is the model DBOS Transact packages as a library ("entirely contained
// in this open-source library, there's no additional infrastructure for you to
// configure or manage"). Written out by hand here so you can see why the
// kill-and-resume test passes: a step and its effect either both commit or
// neither does.
//
//   node run.mjs --job demo-1
//   node run.mjs --job demo-1 --crash-at 3   # exits before COMMIT: nothing lands
//   node run.mjs --job demo-1                # resumes at step 3, refund exists once

import pg from "pg";

const args = process.argv.slice(2);
const arg = (n, d = null) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const JOB = arg("job", "demo-1");
const CRASH_AT = Number(arg("crash-at", "0"));
const DSN = process.env.DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/durable";

const db = new pg.Client({ connectionString: DSN });
await db.connect();

// ---- the job ----------------------------------------------------------------
// Each step receives the results of the steps before it and a client bound to
// the open transaction. Anything it writes through `tx` is atomic with the
// checkpoint of this step.
const steps = [
  {
    name: "fetch_ticket",
    async run({ tx, job }) {
      const { rows } = await tx.query("select job_id, subject, body from tickets where job_id = $1", [job]);
      if (!rows[0]) throw new Error(`no ticket for job ${job} — run schema.sql's seed first`);
      return rows[0];
    },
  },
  {
    name: "classify",
    async run({ prior }) {
      await new Promise((r) => setTimeout(r, 60)); // stands in for a model call
      const body = prior.fetch_ticket.body;
      const refund = /refund|charged twice/i.test(body);
      return { intent: refund ? "billing/refund" : "other", confidence: refund ? 0.93 : 0.41 };
    },
  },
  {
    name: "file_refund",
    async run({ tx, job, prior }) {
      // The effect. It is a row, so the same transaction carries it with the
      // checkpoint — and a rollback removes both.
      await tx.query(
        "insert into refunds (job_id, intent, amount_cents) values ($1, $2, $3) on conflict (job_id) do nothing",
        [job, prior.classify.intent, 4200],
      );
      const { rows } = await tx.query("select count(*)::int as n from refunds where job_id = $1", [job]);
      return { refunds_for_job: rows[0].n };
    },
  },
  {
    name: "notify",
    async run({ tx, job, prior }) {
      await tx.query(
        "insert into outbox (job_id, channel, body) values ($1, $2, $3) on conflict (job_id, channel) do nothing",
        [job, "email", `Your refund request for ${prior.fetch_ticket.subject} was filed.`],
      );
      return { queued: true };
    },
  },
];

// ---- the runner -------------------------------------------------------------
async function durableRun() {
  const results = {};
  let replayed = 0, executed = 0;

  await db.query(`insert into durable_runs (run_id) values ($1) on conflict (run_id) do nothing`, [JOB]);
  const { rows: runRows } = await db.query("select status from durable_runs where run_id = $1", [JOB]);
  if (runRows[0].status === "done") {
    console.log(JSON.stringify({ job: JOB, already_done: true, note: "the run's steps are all checkpointed; nothing re-executed" }));
    return;
  }

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const seq = i + 1;

    await db.query("begin");
    // One writer per run: a second process on the same job waits here instead
    // of executing steps concurrently.
    await db.query("select pg_advisory_xact_lock(hashtext($1))", [JOB]);

    const { rows: done } = await db.query(
      "select result from durable_steps where run_id = $1 and seq = $2", [JOB, seq]);
    if (done[0]) {
      results[step.name] = done[0].result;
      replayed++;
      await db.query("commit");
      console.log(`replay  ${seq}/${steps.length} ${step.name}  (checkpointed)`);
      continue;
    }

    const result = await step.run({ tx: db, job: JOB, prior: results });
    await db.query(
      "insert into durable_steps (run_id, seq, name, result) values ($1, $2, $3, $4)",
      [JOB, seq, step.name, result]);
    executed++;

    if (CRASH_AT === seq) {
      // Kill the process before COMMIT: the step's effect and its checkpoint
      // both disappear, so the resume re-runs the step exactly once more.
      console.log(`CRASH   ${seq}/${steps.length} ${step.name}  before COMMIT`);
      await db.query("rollback").catch(() => {});
      process.exit(137);
    }

    await db.query("commit");
    results[step.name] = result;
    console.log(`execute ${seq}/${steps.length} ${step.name}  ${JSON.stringify(result).slice(0, 80)}`);
  }

  await db.query("update durable_runs set status = 'done', updated_at = now() where run_id = $1", [JOB]);
  console.log(JSON.stringify({ job: JOB, steps: steps.length, replayed, executed, results }, null, 2));
}

await durableRun();
await db.end();
