# Power map: data and how to refresh it

`power.json` (site root) is built from the four files in this folder plus `orgs.json` (so coalition members and court-case organizations link to their profile on the Organizations tab). The page (`/power`) loads it only when someone opens it. It is a **dated snapshot with a source for every entry**, not a feed.

Public officials and public institutions only. Heritage is never inferred from a name or photo: a member of Congress is listed only where a cited source (CRS, APAICS, CAPAC, the member's own bio or an outlet quoted on the card) states it, and the card says which. A person whose heritage no fetched source states is left out.

| File | What it holds |
|---|---|
| `officials.json` | Members of Congress identified as Asian American, Native Hawaiian or Pacific Islander, with the basis for each; the CAPAC membership and leadership |
| `institutions.json` | Commissions, offices and legislative caucuses on AAPI affairs (federal, state, territory, city), with status and sources |
| `cases.json` | Court cases involving AAPI organizations as parties, counsel or friends of the court, with the latest verified event and date |
| `finance.json` | Grants of $5,000 or more reported on IRS filings (Schedule I of Form 990, Part XV of Form 990-PF), matched to directory organizations by name and city; each row links to the filing on ProPublica Nonprofit Explorer |
| `build_power.py` | Merges them into `power.json` (also rewrites the retired spelling of AAPI in display text) |
| `RESEARCH_RULES.md` | The rules the research followed |

Bills a member sponsored are on the member's Congress.gov page (linked on each card). Organizations' positions on bills are not copied here: they are on the Issues pages under *Who's saying what*.

## Refresh
1. Edit the file for the part that changed (a new commission member, a court ruling, a new year of filings) and add its source. Update `asOf` in `officials.json`.
2. `cd tools/power && python3 build_power.py ../../orgs.json ../../power.json`
3. Open `/power`, check the changed cards, then commit `power.json`.

After a general election, replace the roster in `officials.json` once the new Congress is sworn in.
