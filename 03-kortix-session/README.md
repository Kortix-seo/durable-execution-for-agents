# 03 — when the unit of work is a session, not a function

The other two examples make a *function* durable. When the work is an agent editing a repository, the durable unit is different, and so is what you have to change: almost nothing in the agent's code, and everything about where its output lands.

Kortix is the open-source AI Operating System, and a session there runs one agent in its own sandbox — the sandbox clones the project repo and works on a new branch whose name is the session id. The agent prompt says it plainly: *"The session you're in is an isolated sandbox — an ephemeral branch of this repo … Only what you commit + push survives."*

`demo.sh` reproduces that lifecycle against a local git repo, so the claim is checkable without an account:

```
== 1. session s-1 starts: its own clone, its own branch, named after the session
pushed: 21b15d5 on session/s-1

== 2. step 2 runs, then the sandbox is destroyed before it commits
PASS  step 2 present in the working tree before the kill (2)
sandbox-s1 destroyed

== 3. session s-2 starts from the pushed branch, not from the lost sandbox
PASS  step 1 survived the sandbox (1)
PASS  step 2 was lost with the sandbox (0)
```

That last line is the honest part, and it is the opposite of what a workflow engine promises: **there is no replay of an in-flight agent step.** What survives is committed work; what was in the working tree is gone; the next session starts from the branch.

## What makes it durable anyway

- **The branch is the checkpoint.** One commit per completed step of the job is the agent's equivalent of a journal entry, and it is readable by a person.
- **The change request is the record.** The agent commits, pushes its session branch and opens a change request against the default branch; a person with the merge permission merges it. Merge is default-deny for agents, so the review is part of the durability, not an obstacle to it.
- **A trigger removes the human start.** `cron`, `webhook`, `event` and `monitor` triggers start a session with nobody present, which is the piece a workflow engine gives you for free and a laptop agent does not:

```bash
kortix triggers add nightly-refund-sweep --type cron --cron "0 3 * * *" --timezone UTC \
  --prompt "Open a change request for last night's refunds." --apply
```

- **A reminder re-prompts the same session later.** That is how a run that is waiting for an approval comes back to itself a day later, without you building a timer into it.

## Choosing between this and a workflow engine

If the job is a fixed sequence of steps with retries and timers, a replay engine or a Postgres checkpoint table is the right tool: the shape is known in advance and the engine enforces it.

If the job needs judgement at each step — read the ticket, decide, edit the files, explain what you did — the sequence is not known in advance, and a workflow's step graph becomes a straitjacket. That is where the session model wins: the unit that survives is a commit, and the unit that decides is a person at merge time.

The guide compares the two with the products' own numbers: [durableexecutionguide.com](https://durableexecutionguide.com).
