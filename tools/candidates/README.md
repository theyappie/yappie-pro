# Candidates for the Election results page

`candidates.json` (repository root) is what the /results page lists. It is built from the compiled workbook (the *Confirmed* tab only):

    python3 tools/candidates/build_candidates.py <workbook.xlsx> taxonomy.json candidates.json <compiled date>
    python3 tools/candidates/make_calls_template.py candidates.json taxonomy.json AAPI_race_calls_template.xlsx

The second command makes the Google Sheet template for entering Associated Press race calls (see "Election results" in the main README). Candidate ids look like `ca-ami-bera` and are what the sheet's `id` column uses, so keep them stable when the list is rebuilt.

## Added by hand after the workbook

`candidates.json` also holds candidates added directly after the workbook was compiled. If you rebuild it from the workbook, add these again:

- Cyndi Munson, Oklahoma governor (Democratic nominee), added 2026-11-02 at the owner's request. Source: AsAmNews, 2026-06-24.

## Entering race calls without a sheet (election night)

Race calls are read from `results-calls.csv` in the repository root (and from a published sheet, if one is set). Every update run turns them into `data/results.json`, which the Election results page reads.

1. `python3 tools/candidates/races.py [STATE ...]` lists the races with no call yet (pass state codes to narrow it).
2. Record a call only when a page you opened says the Associated Press called the race. Prefer an apnews.com page. Never infer a call from vote counts, a concession, or another organization's call (NYT, CNN, NBC, Decision Desk HQ are not AP).
3. Add calls: `printf 'id | won | 2026-11-03 21:41 ET | https://apnews.com/... | evidence url\n' | python3 tools/candidates/add_calls.py`
   Columns: candidate id, `won`/`lost`/`runoff`/`recount`, time of the call (blank if unknown), an apnews.com link (blank if none; other links are dropped), and the evidence address or a note. Winners get `won`; the other tracked candidates in a one-seat race get `lost` once AP has called it. A later row for the same id replaces the earlier one.
4. The script validates the rows with `scripts/results.mjs` and reports anything it skipped (unknown ids, times in the future, two winners in a one-seat race).
5. `git add results-calls.csv`, commit, push, then run the *update-feed* workflow (or wait about 10 minutes).
