#!/bin/bash
# usage: commit-data.sh "<commit message>" [path ...]      (the default path is data)
# Commits what changed under the given paths and pushes it; used by the update and daily-brief workflows.
# A push is refused when something else reached the branch in the meantime (another update, the brief, a change made by hand). Every file under data/ is rebuilt from scratch by each run,
# so where both sides changed one, this run's version is kept. If the two cannot be combined, this run's commit is dropped: the next update, minutes later, rebuilds everything.
# The workflows keep no access token in the checkout; the step that calls this script hands it over in PUSH_TOKEN, and it is used for the push alone (scripts/with-token.sh).
# Without PUSH_TOKEN, git uses whatever access the checkout itself has.
set -u
: "${GITHUB_REF_NAME:?the name of the branch to push to (GitHub Actions sets it)}"
here=$(cd "$(dirname "$0")" && pwd)
auth() { if [ -n "${PUSH_TOKEN:-}" ]; then bash "$here/with-token.sh" "$@"; else "$@"; fi; }
msg=$1; shift; [ $# -gt 0 ] || set -- data
git config user.name "yappie-pro-bot"
git config user.email "actions@users.noreply.github.com"
git add -- "$@"
if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
git commit -q -m "$msg"
for try in 1 2 3 4 5; do
  auth git push -q origin "HEAD:$GITHUB_REF_NAME" && exit 0
  echo "Push not accepted (usually because something was pushed in the meantime); trying again ($try of 5)."
  sleep $((try * 3))
  auth git fetch -q origin "$GITHUB_REF_NAME"
  if ! git rebase -X theirs FETCH_HEAD; then
    git rebase --abort || true
    git reset -q --hard FETCH_HEAD
    echo "Could not combine this run with the newer data; skipping it. The next update starts from the newer data."
    exit 0
  fi
done
echo "Could not push after 5 tries."; exit 1
