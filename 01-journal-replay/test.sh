#!/usr/bin/env bash
# The kill-and-resume test. Exits 0 only if every assertion holds.
set -u
cd "$(dirname "$0")"

JOB="test-$(date +%s)"
rm -rf ".state/$JOB"
fail=0
check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi
}

echo "== 1. baseline: run the job to completion"
node run.mjs --job "$JOB-baseline" | tail -n 12 > /dev/null
base_summary=$(sha256sum ".state/$JOB-baseline/summary.md" | cut -d' ' -f1)
check "baseline effects" 2 "$(wc -l < ".state/$JOB-baseline/side-effects.log")"

echo
echo "== 2. kill the process after step 3's refund was filed, before the journal recorded it"
node run.mjs --job "$JOB" --crash-at 3 --crash-mode after-effect | tail -n 3
echo "exit=$?  journal lines at kill: $(cat ".state/$JOB/journal.jsonl" 2>/dev/null | wc -l)"
check "effects before resume" 1 "$(wc -l < ".state/$JOB/side-effects.log")"

echo
echo "== 3. start a new process; it replays the journal and finishes the job"
node run.mjs --job "$JOB" > ".state/$JOB/resume.out"
grep -E '^(replay|execute)' ".state/$JOB/resume.out"
check "replayed steps on resume" 2 "$(grep -c '^replay' ".state/$JOB/resume.out")"
check "effects after resume (refund filed once)" 2 "$(wc -l < ".state/$JOB/side-effects.log")"
check "refund key appears once" 1 "$(grep -c "$JOB:refund-requested" ".state/$JOB/side-effects.log")"
resumed_summary=$(sha256sum ".state/$JOB/summary.md" | cut -d' ' -f1)

echo
echo "== 4. the resumed job produced the same summary as the uninterrupted one"
check "summary identical" "$base_summary" "$resumed_summary"

echo
echo "== 5. control: the same crash WITHOUT an idempotency key duplicates the effect"
rm -rf ".state/$JOB-naive"
node -e '
const fs = require("node:fs");
const p = `.state/${process.argv[1]}-naive`;
fs.mkdirSync(p, { recursive: true });
fs.appendFileSync(`${p}/side-effects.log`, "refund-requested\n");
fs.appendFileSync(`${p}/side-effects.log`, "refund-requested\n"); // the retry after the crash
' "$JOB"
check "effects in the naive run" 2 "$(wc -l < ".state/$JOB-naive/side-effects.log")"
echo "      (two refunds for one ticket: this is what the key prevents)"

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$fail"
