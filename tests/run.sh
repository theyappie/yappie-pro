#!/bin/bash
# usage: bash tests/run.sh      (or: npm test)
# Runs every test suite against this copy of the site, with made-up sources served from this computer (no request leaves it), and prints one line per suite.
# Exits with an error when any suite fails. The pull-request workflow (.github/workflows/test.yml) runs this, so a dependency update or a change is checked before it is merged.
set -u
R=$(cd "$(dirname "$0")/.." && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOST_GAP_MS=0 # the suites read many made-up sources from one local address; the pause between requests to one site has a test of its own (audit)
fail=0
run() { n=$1; shift; if timeout 900 "$@" > "$T/$n.log" 2>&1; then echo "pass  $n  $(tail -1 "$T/$n.log" | cut -c1-90)"; else fail=1; echo "FAIL  $n"; tail -30 "$T/$n.log" | sed 's/^/      /'; fi; }
for t in collector collector_options collector_builtin collector_custom collector_hubs collector_names collector_backfill collector_admin outputs_stable twins plainterms openstates events calendar_dates audit digest_mail; do
  run "$t" node "$R/tests/${t}_test.mjs" "$R" "$T/tmp_$t"
done
run threads node "$R/tests/threads_test.mjs" "$R" "$R/data/feed.json" "$T/tmp_threads"
run events_span node "$R/tests/events_span_test.mjs" "$R"
run admin_core node "$R/tests/admin_core_test.mjs" "$R"
run admin_names node "$R/tests/admin_names_test.mjs" "$R"
run admin_worker node "$R/tests/admin_worker_test.mjs" "$R" "$T/tmp_worker"
[ $fail = 0 ] && echo "All suites passed." || echo "Some suites failed."
exit $fail
