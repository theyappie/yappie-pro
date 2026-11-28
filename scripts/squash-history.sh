#!/bin/bash
# usage: squash-history.sh      (started by .github/workflows/squash-history.yml, from a checkout of the whole history)
# Keeps the repository small. Every update is a commit, so the history grows by a few MB a day. This replaces the history of the branch with ONE commit that has exactly the same files:
# the site and its data do not change, and the log and open pull requests are lost. The message of the new commit lists the commits made by hand before it.
# It squashes when the log is a year old (SQUASH_AFTER_DAYS, 360) or when GitHub gives the repository's size as 400 MB or more (SQUASH_AT_KB), whichever comes first, and when someone starts the workflow by hand and types "squash".
# Otherwise it changes nothing. Before it pushes it checks that the new commit has the same files as the old one and is the only commit; the push is refused if anything reached the branch since (an update, say), and the whole
# thing is done again on the newer commit, so no update is lost. An update that was already running when the push went through is not lost either (scripts/commit-data.sh rebuilds it on top).
set -euo pipefail
: "${GITHUB_REF_NAME:?the name of the branch to squash (GitHub Actions sets it)}" "${GITHUB_REPOSITORY:?owner/name (GitHub Actions sets it)}" "${PUSH_TOKEN:?the token to push with}"
here=$(cd "$(dirname "$0")" && pwd)
auth() { bash "$here/with-token.sh" "$@"; }
gh_api() { GH_TOKEN=$PUSH_TOKEN gh api "$@"; }
branch=$GITHUB_REF_NAME
max_days=${SQUASH_AFTER_DAYS:-360}
max_kb=${SQUASH_AT_KB:-409600}

# 1. Is it time?
commits=$(git rev-list --count HEAD)
first=$(git log --max-parents=0 --format=%ct HEAD | sort -n | sed -n 1p)
days=$(( ($(date +%s) - first) / 86400 ))
size_kb=$(gh_api "repos/$GITHUB_REPOSITORY" --jq .size 2>/dev/null || echo 0)
[[ $size_kb =~ ^[0-9]+$ ]] || size_kb=0
echo "The log of $branch has $commits commits and is $days days old. GitHub gives the repository's size as $(( size_kb / 1024 )) MB."
case "${EVENT:-}" in
  workflow_dispatch)
    if [ "${CONFIRM:-}" != "squash" ]; then echo "::notice::Nothing was changed. To squash the history now, start this workflow again and type squash in the box."; exit 0; fi
    echo "Started by hand with squash typed in: squashing now." ;;
  *)
    if [ "$days" -ge "$max_days" ]; then echo "The log is a year old: squashing."
    elif [ "$size_kb" -ge "$max_kb" ]; then echo "The repository has reached $(( max_kb / 1024 )) MB: squashing early."
    else echo "Not due: the log is squashed at $max_days days or $(( max_kb / 1024 )) MB. Nothing was changed."; exit 0; fi ;;
esac
[ "$commits" -gt 1 ] || { echo "The log is already a single commit; nothing to do."; exit 0; }

# 2. Wait for a quiet moment: no update or brief running, so that none is cut off by the push. (It would recover, but there is no hurry.)
busy() { local n=0 s c; for s in in_progress queued; do c=$(gh_api "repos/$GITHUB_REPOSITORY/actions/runs?status=$s&per_page=50" --jq '[.workflow_runs[] | select(.name == "update-feed" or .name == "daily-digest")] | length' 2>/dev/null || echo 0); n=$(( n + c )); done; echo "$n"; }
quiet=0
for i in $(seq 1 36); do
  if [ "$(busy)" = "0" ]; then quiet=1; break; fi
  echo "An update or brief is running; waiting 20 seconds ($i of 36)."; sleep 20
done
[ "$quiet" = 1 ] || { echo "::error::An update or brief kept running for 12 minutes. Nothing was changed; start this workflow again, or it tries again at the next monthly check."; exit 1; }

# 3. Build one commit with the same files as the newest commit of the branch, and push it over the branch only if the branch is still where it was read.
build() {
  local old=$1 msg new
  msg=$(mktemp)
  {
    echo "history: squashed on $(date -u +%F) ($(git rev-list --count "$old") commits became one)"
    echo
    echo "The files are exactly those of commit ${old:0:10}. The earlier log was removed to keep the repository small (scripts/squash-history.sh)."
    echo
    echo "Commits made by hand or by Dependabot before this one (date, subject; newest first, at most 300):"
    git log --format='%an%x09%as%x09%s' "$old" | awk -F'\t' '$1 != "yappie-pro-bot" && n < 300 { n++; printf "- %s %s\n", $2, $3 }'
  } > "$msg"
  new=$(GIT_AUTHOR_NAME=yappie-pro-bot GIT_AUTHOR_EMAIL=actions@users.noreply.github.com GIT_COMMITTER_NAME=yappie-pro-bot GIT_COMMITTER_EMAIL=actions@users.noreply.github.com git commit-tree "$old^{tree}" -F "$msg")
  rm -f "$msg"
  echo "$new"
}
for try in 1 2 3 4 5; do
  auth git fetch -q origin "$branch"
  old=$(git rev-parse FETCH_HEAD)
  [ "$(git rev-list --count "$old")" -gt 1 ] || { echo "The log of $branch is already a single commit; nothing to do."; exit 0; }
  new=$(build "$old")
  [ "$(git rev-parse "$new^{tree}")" = "$(git rev-parse "$old^{tree}")" ] || { echo "::error::The new commit does not have the same files as the old one. Nothing was pushed."; exit 1; }
  [ "$(git rev-list --count "$new")" = "1" ] || { echo "::error::The new commit is not a single commit. Nothing was pushed."; exit 1; }
  if auth git push -q --force-with-lease="refs/heads/$branch:$old" origin "$new:refs/heads/$branch"; then
    now=$(auth git ls-remote origin "refs/heads/$branch" | cut -f1)
    [ "$now" = "$new" ] || echo "::notice::The push went through; an update has been added on top of it since, which is as it should be."
    echo "Done: $branch is now one commit (${new:0:10}) with the files of ${old:0:10}. Open pull requests (a Dependabot one, say) are rebuilt by Dependabot, or can be closed and made again."
    exit 0
  fi
  echo "Something reached the branch in the meantime; starting again on the newer commit ($try of 5)."
  sleep $(( try * 3 ))
done
echo "::error::Could not push after 5 tries. Nothing was lost; start this workflow again."; exit 1
