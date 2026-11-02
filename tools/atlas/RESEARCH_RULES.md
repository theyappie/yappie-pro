# State Policy Atlas — research brief (shared rules)

You are one of five researchers building the **State Policy Atlas** for *The Yappie Pro*, a public news/policy portal about Asian American, Native Hawaiian and Pacific Islander (AANHPI/AAPI) communities. Reporters, researchers and legislative staff will cite it, so **accuracy beats coverage**. Today is **2026-11-02**. Your job: for ONE policy area, record the status of the law in **all 50 states + DC** (51 entries), each backed by sources you actually read.

## Hard rules
1. **Only record what a page you fetched in this session says.** Never fill a cell from memory. If you cannot confirm a state, set `"s":"unclear"` and say why in `x`. Guessing is the worst outcome.
2. Every cell whose status is not `none` needs at least one source URL. Prefer **primary sources** (the statute text on the legislature's site, the bill page, the governor's or agency's page, the state education department) and mark them `"p":true`. Secondary trackers (NCSL, ADL, Asian American Education Project, AAPI Data, Advancing Justice, National Agricultural Law Center, law-firm summaries, news) are acceptable as support or when no primary source can be reached — mark them `"p":false`. When a state's law is claimed by a secondary source only, say so in `x` ("per <tracker>; statute text not reached").
3. `q` = a short **verbatim** phrase (≤200 chars) from one of your sources that supports the status. This lets a human spot-check you. Copy exactly; do not paraphrase inside `q`.
4. For `none`: it means **"no such law found in the trackers and statutes checked"**, which is a claim of absence. Cite the tracker(s)/search you relied on in `src` (e.g. the tracker's table showing the state is absent) and leave `q` empty. Do not assert that no law exists anywhere.
5. `pending` only when a bill is **alive in the 2025–26 cycle as of Nov 2026** (introduced or carried over, not yet dead/vetoed/adjourned-without-action). Cite the bill number and URL. If the bill died, the status is `none` (mention the dead bill in `x` if useful).
6. Be neutral and plain. No advocacy language. Summaries ≤120 characters. No emoji.
7. Work efficiently: start with the best aggregate trackers to get the landscape, then confirm each non-`none` state against its statute/bill page, then do a targeted check of the remaining states. Use parallel searches. Budget roughly 80–120 tool calls; stop when every state has a cell.
8. Do not write anywhere except the output file named in your task. Write the output with the Write tool as valid JSON (UTF-8, no comments, no trailing commas). Validate it by reading it back with a tiny Python/Node one-liner (`python3 -c "import json;json.load(open(PATH))"`).

## Output schema
```
{
 "area": "<history|disagg|language|hate|alienland>",
 "asOf": "2026-11-02",
 "method": "≤600 chars: which trackers and primary sources you used",
 "cells": {
   "AL": { "s": "enacted|partial|pending|none|unclear",
           "t": "one-line plain summary (≤120 chars)",
           "law": "statute / public act / regulation citation, or ''",
           "y": 2021,                      // year enacted or effective; null if none/unknown
           "src": [ {"n":"page title (≤90 chars)", "u":"https://…", "p": true } ],
           "q": "verbatim supporting phrase, or ''",
           "x": "optional nuance ≤220 chars" },
   "AK": { … }, … all 50 state codes plus "DC" …
 },
 "notes": ["anything a reviewer should know: gaps, conflicts between sources, states you could not confirm"]
}
```
All 51 keys must be present. Use USPS codes. Order doesn't matter.

## Status meanings are specific to each area — see your task. When a state sits between two statuses, choose the lower one and explain in `x`.
