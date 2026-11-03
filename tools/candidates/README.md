# Candidates for the Election results page

`candidates.json` (repository root) is what the /results page lists. It is built from the compiled workbook (the *Confirmed* tab only):

    python3 tools/candidates/build_candidates.py <workbook.xlsx> taxonomy.json candidates.json <compiled date>
    python3 tools/candidates/make_calls_template.py candidates.json taxonomy.json AAPI_race_calls_template.xlsx

The second command makes the Google Sheet template for entering Associated Press race calls (see "Election results" in the main README). Candidate ids look like `ca-ami-bera` and are what the sheet's `id` column uses, so keep them stable when the list is rebuilt.

## Rebuilding from a newer workbook

`candidates.json` was last rebuilt on 2026-11-02 from the workbook compiled 3 Nov 2026 (267 confirmed candidates). A rebuild replaces the whole list, so it also picks up changes to existing rows (Cyndi Munson, Oklahoma governor, now comes from the workbook with her primary result and sources) and drops anyone the workbook no longer lists as confirmed (Aisha Wahab, whom the workbook excludes as Afghan American per the owner's instruction). Nothing is added by hand any more. Ids are the state code plus the name, so they stay the same across rebuilds; a call recorded for an id that disappears is reported and skipped by `scripts/results.mjs`.

The builder stops on a heritage it has no group for, so a new community needs one line in `GROUPS` (the page builds its Heritage menu from the data, so nothing else changes). The workbook's "AANHPI" is written "AAPI" in the text the site shows, and its "2+ AANHPI in this race" flag is left out because the page groups races itself.

## Entering race calls without a sheet (election night)

Race calls are read from `results-calls.csv` in the repository root (and from a published sheet, if one is set). Every update run turns them into `data/results.json`, which the Election results page reads.

1. `python3 tools/candidates/races.py [STATE ...]` lists the races with no call yet (pass state codes to narrow it).
2. Record a call only when a page you opened says the Associated Press called the race, or when the owner pasted AP's call (a list, a screenshot or an AP post). The web fetch tool is blocked from apnews.com, so use outlets that attribute the call to AP, or the owner's paste; a link to an apnews.com page may still go in the link column if the address came from a search result or from the owner. Never infer a call from vote counts, a concession, or another organization's call (NYT, CNN, NBC, Decision Desk HQ are not AP).
3. Add calls: `printf 'id | won | 2026-11-03 21:41 ET | https://apnews.com/... | evidence url\n' | python3 tools/candidates/add_calls.py`
   Columns: candidate id, `won`/`lost`/`runoff`/`recount`, time of the call (blank if unknown), an apnews.com link (blank if none; other links are dropped), and the evidence address or a note. Winners get `won`; the other tracked candidates in a one-seat race get `lost` once AP has called it. A later row for the same id replaces the earlier one.
4. The script validates the rows with `scripts/results.mjs` and reports anything it skipped (unknown ids, times in the future, two winners in a one-seat race).
5. `git add results-calls.csv`, commit, push, then run the *update-feed* workflow (or wait about 10 minutes).
