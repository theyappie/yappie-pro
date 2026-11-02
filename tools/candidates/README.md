# Candidates for the Election results page

`candidates.json` (repository root) is what the /results page lists. It is built from the compiled workbook (the *Confirmed* tab only):

    python3 tools/candidates/build_candidates.py <workbook.xlsx> taxonomy.json candidates.json <compiled date>
    python3 tools/candidates/make_calls_template.py candidates.json taxonomy.json AAPI_race_calls_template.xlsx

The second command makes the Google Sheet template for entering Associated Press race calls (see "Election results" in the main README). Candidate ids look like `ca-ami-bera` and are what the sheet's `id` column uses, so keep them stable when the list is rebuilt.
