# State policy atlas: data and how to refresh it

`atlas.json` (site root) is built from the five area files in this folder. The page (`/atlas`) loads it only when someone opens it. It is a **dated snapshot**, not a feed: nothing refreshes it by itself, which is why it costs nothing to run.

| File | What it holds |
|---|---|
| `history.json`, `disagg.json`, `language.json`, `hate.json`, `alienland.json` | One file per policy area: a cell for each of the 50 states and D.C. with status, one-line summary, citation, year, sources (primary marked `"p": true`), a verbatim quote and a note |
| `quotes/q_<area>.json` | Result of the quote check: for each state, whether the verbatim quote was found on one of its cited pages (`ok`: true, false or null if no page could be read) |
| `build_atlas.py` | Merges the five files and the quote results into `atlas.json` and holds the area names and what each status means |
| `validate.py` | Checks that all 51 keys are present, statuses are valid, lengths are within limits and every non-`none` cell has an `https` source |
| `qcheck.py` | Fetches each cell's cited pages and checks that its quote appears there (needs `curl` and `pdftotext`) |
| `RESEARCH_RULES.md` | The rules the research followed: only what a fetched page says, a verbatim quote for every claim, "none" means none found in the sources checked |

## Refresh
1. Edit the cell in the area file (or have Claude re-research the area against `RESEARCH_RULES.md`). Change `asOf` in that file to the date you checked.
2. `cd tools/atlas && python3 validate.py history disagg language hate alienland`
3. `python3 qcheck.py history.json quotes/q_history.json` (repeat for each area you changed; set `CA_BUNDLE=/path/to/ca.pem` only if you are behind a proxy that needs it).
4. `python3 build_atlas.py ../../atlas.json`, then commit `atlas.json`.

The page shows the verified date on every entry and says plainly when a quote could not be matched on a cited page. "None found" means the trackers and statutes checked did not show such a law; it is not proof that none exists.
