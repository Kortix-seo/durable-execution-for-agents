#!/usr/bin/env node
// A journal-and-replay durable execution engine in ~150 lines, with no
// dependencies. It is the mechanism Temporal, Restate and Inngest all share:
// every completed step is appended to a journal, and a restarted process
// replays the journal instead of re-running the work.
//
// Run it:   node run.mjs --job demo-1
// Crash it: node run.mjs --job demo-1 --crash-at 3 --crash-mode after-effect
// Resume:   node run.mjs --job demo-1
//
// Read test.sh for the assertion: after a kill between "the side effect
// happened" and "the journal recorded it", the resumed run reports the
// duplicate and suppresses it. That is what your step has to look like.

import {
  appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const JOB = arg("job", "demo-1");
const CRASH_AT = Number(arg("crash-at", "0")); // 1-based step to kill at, 0 = never
const CRASH_MODE = arg("crash-mode", "before-journal"); // before-journal | after-effect

const STATE = join(HERE, ".state", JOB);
const JOURNAL = join(STATE, "journal.jsonl");
const EFFECTS = join(STATE, "side-effects.log");
mkdirSync(STATE, { recursive: true });

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the journal ------------------------------------------------------------
function readJournal() {
  if (!existsSync(JOURNAL)) return new Map();
  const entries = readFileSync(JOURNAL, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  const byName = new Map();
  for (const e of entries) byName.set(e.step, e);
  return byName;
}

function commitStep(step, result) {
  appendFileSync(JOURNAL, JSON.stringify({ step, at: new Date().toISOString(), hash: hash(result), result }) + "\n");
}

// ---- side effects -----------------------------------------------------------
// An effect the outside world sees. The idempotency key is derived from the
// job and the step, so a replay of the same step cannot apply it twice.
function applyEffect(key, line) {
  if (existsSync(EFFECTS) && readFileSync(EFFECTS, "utf8").includes(key)) {
    return { applied: false, suppressed_duplicate: true, key };
  }
  appendFileSync(EFFECTS, `${key} ${line}\n`);
  return { applied: true, suppressed_duplicate: false, key };
}

// ---- the job ----------------------------------------------------------------
// A support-triage agent job. Each step is a plain async function that returns
// JSON. Replace step 2 with your model call; nothing else in this file changes.
const steps = [
  {
    name: "fetch_ticket",
    async run() {
      await sleep(50); // stands in for a slow API call
      return { id: JOB, subject: "Refund for order 88213", body: "Charged twice, please refund one charge." };
    },
  },
  {
    name: "classify",
    async run({ fetch_ticket: ticket }) {
      await sleep(80); // stands in for a model call
      const refund = /refund|charged twice/i.test(ticket.body);
      return { intent: refund ? "billing/refund" : "other", confidence: refund ? 0.93 : 0.41 };
    },
  },
  {
    name: "apply_effect",
    async run({ fetch_ticket: ticket, classify: classification }) {
      // The external side effect: a refund request is filed. This is the step
      // that must not happen twice.
      return applyEffect(`${JOB}:refund-requested`, `refund-requested ${ticket.id} ${classification.intent}`);
    },
  },
  {
    name: "write_summary",
    async run({ fetch_ticket: ticket, classify: classification }) {
      const summary = [
        `# ${ticket.subject}`,
        "",
        `intent: ${classification.intent} (${classification.confidence})`,
        `refund filed: yes`,
        "",
      ].join("\n");
      writeFileSync(join(STATE, "summary.md"), summary);
      return { path: "summary.md", bytes: summary.length, hash: hash(summary) };
    },
  },
  {
    name: "notify",
    async run({ fetch_ticket: ticket }) {
      return applyEffect(`${JOB}:notified`, `notified ${ticket.id}`);
    },
  },
];

// ---- the runner -------------------------------------------------------------
const journal = readJournal();
const results = {};
let replayed = 0;
let executed = 0;

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const seq = i + 1;
  const stored = journal.get(step.name);

  if (stored) {
    // Replay: the result is taken from the journal, the function does not run.
    results[step.name] = stored.result;
    replayed++;
    console.log(`replay  ${seq}/${steps.length} ${step.name}  (${stored.hash})`);
    continue;
  }

  const crashBeforeJournal = CRASH_AT === seq && CRASH_MODE === "before-journal";
  const crashAfterEffect = CRASH_AT === seq && CRASH_MODE === "after-effect";
  if (crashBeforeJournal) {
    console.log(`CRASH   ${seq}/${steps.length} ${step.name}  before the step ran`);
    process.exit(137);
  }

  const result = await step.run(results);
  console.log(`execute ${seq}/${steps.length} ${step.name}  ${JSON.stringify(result).slice(0, 90)}`);
  executed++;

  if (crashAfterEffect) {
    console.log(`CRASH   ${seq}/${steps.length} ${step.name}  after the effect, before the journal commit`);
    process.exit(137);
  }
  commitStep(step.name, result);
  results[step.name] = result;
}

console.log(JSON.stringify({
  job: JOB,
  steps: steps.length,
  replayed,
  executed,
  journal_hash: hash([...journal.keys()]),
  summary: results.write_summary,
  refund_effect: results.apply_effect,
}, null, 2));
