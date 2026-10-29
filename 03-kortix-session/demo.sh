#!/usr/bin/env bash
# What "durable" means when the unit of work is a session, not a function.
#
# The demo simulates the lifecycle Kortix sessions have: a session works on a
# branch of the project repo in its own sandbox; what it commits and pushes
# survives the sandbox; what is still in the working tree when the sandbox
# dies does not; the session's change request is the record a person merges.
#
# It runs against a throwaway local git repo — no Kortix account needed.
set -u
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1: expected $2, got $3"; fail=1; fi; }
git_t() { git -c user.email=a@example.com -c user.name=agent "$@"; }

cd "$WORK"
git init -q --bare origin.git
git clone -q origin.git project 2>/dev/null
cd project
echo "# ops repo" > README.md
git add . && git_t commit -qm "init" && git push -q origin HEAD:main
git -C "$WORK/origin.git" symbolic-ref HEAD refs/heads/main
git branch -q -u origin/main
cd ..

echo "== 1. session s-1 starts: its own clone, its own branch, named after the session"
git clone -q origin.git sandbox-s1
cd sandbox-s1
git checkout -q -b session/s-1
echo "- step 1: refund filed for order 88213" > steps.md
git add steps.md && git_t commit -qm "step 1: file refund"
git push -q -u origin session/s-1
echo "pushed: $(git rev-parse --short HEAD) on $(git branch --show-current)"

echo
echo "== 2. step 2 runs, then the sandbox is destroyed before it commits"
echo "- step 2: notify customer (uncommitted when the sandbox died)" >> steps.md
check "step 2 present in the working tree before the kill" 2 "$(grep -c '^- step' steps.md)"
cd "$WORK" && rm -rf sandbox-s1
echo "sandbox-s1 destroyed"

echo
echo "== 3. session s-2 starts from the pushed branch, not from the lost sandbox"
git clone -q origin.git sandbox-s2
cd sandbox-s2
git fetch -q origin session/s-1
git checkout -q -B session/s-1 origin/session/s-1
check "step 1 survived the sandbox" 1 "$(grep -c '^- step' steps.md)"
check "step 2 was lost with the sandbox" 0 "$(grep -c 'step 2' steps.md)"

echo
echo "== 4. s-2 finishes the work and pushes; the change request is the record"
echo "- step 2: notify customer" >> steps.md
git add steps.md && git_t commit -qm "step 2: notify customer"
git push -q origin session/s-1
{
  echo "change request: session/s-1 -> main"
  git log --oneline origin/main..origin/session/s-1
} > ../change-request.txt
cat ../change-request.txt

echo
echo "== 5. a person merges: the run's outcome is now on the default branch"
git checkout -q main && git_t merge -q --ff-only origin/session/s-1
git push -q origin main
check "steps on main after merge" 2 "$(git show main:steps.md | grep -c '^- step')"
check "commits the session contributed" 2 "$(git rev-list --count origin/main~2..origin/main)"

echo
echo "== 6. what a trigger adds: the same run, started with nobody present"
cat <<'CMD' | sed 's/^/  /'
kortix triggers add nightly-refund-sweep --type cron --cron "0 3 * * *" --timezone UTC --prompt "Open a change request for last night's refunds." --apply
CMD

echo
if [ "$fail" = 0 ]; then echo "ALL CHECKS PASSED"; else echo "SOME CHECKS FAILED"; fi
exit "$fail"
