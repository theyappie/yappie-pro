# Design rules for The Yappie Pro

This file is the reference for how the site looks. Change it first, then change the page. The values below are the ones in `index.html` (the `:root` block and the rules after it); if the page and this file disagree, fix whichever is wrong.

The site is a tool people scan, not a brochure. It should feel like a newsroom desk: dense where people compare things, calm where they read, and never decorated for its own sake. It shares its colours and typefaces with theyappie.com, so the two read as one family.

## Principles

1. **Say a thing once.** A label that would appear on every row says nothing. Show it only where it tells one row from another, or leave it to the filter and the details pane. A story is never repeated in two modules on the same page.
2. **Weight follows importance.** Each page has one largest thing, a few of medium size, and the rest plain. Sections on Today differ in form (a lead with a picture, a ranked list, a table, a date list) so the eye is told where to go.
3. **Rules and space, not boxes.** Content is separated by a hairline or by space. A box is for something you can act on or select.
4. **Blue means "you can act on this" or "this is selected".** Nothing else is blue.
5. **Text first.** No decoration that carries no information: no gradients, glass, emoji icons, stock pictures, or illustrations. Pictures are the stories' own.

## Colour

Every colour is a token; light and dark are defined together, and the dark values are used both by `prefers-color-scheme` and by the manual switch (`data-theme`).

| Role | Token | Light | Dark | Used for |
|---|---|---|---|---|
| Page and panels | `--bg`, `--pn` | `#faf9f5` | `#0b0e1a` / `#111525` | Backgrounds |
| Ink | `--tx` | `#111525` | `#e9ecf5` | All text that matters: headlines, sources, topics, bill numbers |
| Muted | `--dm` | `#5e5e5e` | `#9aa3bd` | Metadata: dates, kinds, counts, hints |
| Line | `--ln` | `#dee2e6` | `#232a45` | Hairlines and the border of anything boxed |
| Action | `--ac` | `#0a67f1` | `#4d94ff` | Links, buttons, the selected row's bar, the focus ring, the saved star |
| Action text on a selection | `--acs` | `#0a5fe0` | `#4d94ff` | Blue text that sits on the selected tint |
| Selection tint | `--sel` | `#e7f0fe` | `#182247` | The selected row, a pressed button, hover |
| Deadline | `--warn-bg`, `--warn-bd`, `--warn-tx` | `#fdeccb`, `#d9972b`, `#5a3a00` | `#3a2a0b`, `#b07a1f`, `#f3d9a4` | A date that is close: comment deadlines within 7 days, stale-data notice |
| Breaking | `--bk`, `--bkbg` | `#c8102e`, `#fdecec` | `#ff5c66`, `#2b1117` | The Breaking tag and row, nothing else |
| Header bar | `--bar` | `#111525` | `#111525` | The header, on both themes |

Contrast, measured: ink on page 17.2:1 (light) and 16.3:1 (dark); muted 6.2:1 and 7.2:1; action 4.7:1 and 6.0:1; action text on the selection tint 4.9:1; deadline text 8.8:1 and 10.1:1. Text must stay at 4.5:1 or better; a new colour is checked before it is added.

Amber is only for time pressure. Red is only for breaking news. Neither is used to decorate.

## Type

Two typefaces, both loaded from Adobe Fonts (the same kit as theyappie.com):

- **Corsario** (`--head`, serif): the date on Today, the lead story's headline, the large issue on Issues, the ranks on the headline list, the headline of a statement on Advocacy and the figure on a Research row. Never for body text or metadata.
- **Tablet Gothic** (`--sans`, `--mono` is the same face): everything else. Tabular figures are switched on only for dates, counts and the closing-day column: with them on, its `%` turns into a stacked "0/0" glyph, so they are never set on body text.

| Use | Size | Weight |
|---|---|---|
| Lead headline (Today) | 26px, 22px on a phone | 700, Corsario |
| Row headline | 15px, 17px on a phone | 600 |
| Body, summaries | 14–15.5px | 400 |
| **Metadata** (source, topic, date, kind, counts) | **13px** | 400–600 |
| Section label | 12.5px, capitals, 0.06em tracking | 700 |
| Table column heading | 12–12.5px | 600 |

Metadata is sentence case and 13px or larger. **Capitals are only for section labels** (the small headings above a block of content) and the column headings of the tracker. Body text lines stay between 45 and 90 characters.

## Shape and depth

- **One radius: `--r`, 6px.** Cards, buttons, inputs, badges, pictures.
- Fully round shapes are for two things only: dots and count badges. Filters are not pills: type tabs, the Calendar's kind and view choices and the theme switch are text, and the chosen one is underlined. An applied filter is its word with a blue underline and a cross.
- **No drop shadows.** The only `box-shadow` values are inset bars and rings that mark a state: a 2px blue bar on the selected row, a 3px ink bar on a featured row, a 4px red bar on breaking news, a 2px ring for "today" on the calendar.
- Depth comes from hairlines (`--ln`) and, once per section, a 2px ink rule above the heaviest section (From The Yappie and Top headlines on Today).

## Spacing

Rows have 9–14px of padding; on Today, sections are 26–32px apart and the page gutter is 16px on a phone and 28px on a wide screen. Space between things that belong together is smaller than the space between things that do not.

## Components

| Component | What it is | Notes |
|---|---|---|
| Header | Logo, section tabs, search, Light / Dark switch | Navy on both themes; tabs are Today, News, Policy, Advocacy, Research, Issues, Calendar, Organizations, Saved |
| Row | Time, source, topic, headline, star | The list item used on News, Policy, Research, Saved. Selected row: blue bar and tint. Two sections bend it: Advocacy leads with the group and sets the headline in the serif face; Research sets a figure from the headline (a percentage, a dollar amount, "N million", "1 in 5") large above it |
| Row badge | A boxed fact that tells rows apart | Bill number (ink border), deadline (ink or amber), related issue (dashed), research type (ink). Everything else on a row is plain muted text |
| Type tabs | Text with a 2px underline (blue) under the chosen one | Policy, News and Research types; Calendar kinds and views |
| Details pane | Right column on wide screens, a sheet on phones | Holds the facts that rows leave out, including why an item is marked relevant |
| Today sections | From The Yappie (picture lead and three pictured stories), Top headlines (ranked list), Policy watch (table with days left, then a plain list), Coming up (date list), Latest statements, Since your last visit, Issues, Organization of the day | A section with nothing to show is left out |
| Issue card | Issue name, its newest headline, its counts | The most active issue spans two columns and is set larger |
| Calendar | Month grid and list | Event kinds are outlined in ink; amber marks deadlines |
| Reader | In-portal article view | Links in the body are blue and underlined |
| Footer | One help control for the keyboard shortcuts, with the switch that turns them off | Desktop only; shortcuts are for keyboards |

## Banned patterns

- A grid of identical boxed cards used as a page layout.
- The same badge on every row ("Government statement", "Impacts AAPIs"). If it is always there, it is not information.
- Colour as decoration: a stripe, a wash, a tinted card. Blue is for actions and the selection.
- Radii above 6px on boxes; pill-shaped filters or switches; drop shadows; gradients; glass or blur; emoji or stock icons.
- Arrows or other glyphs on the end of links ("All headlines →"); the link says where it goes. The ↗ that marks a link to another site is the one exception.
- Stock phrases ("weighed in", "all caught up", "spotlight", "explore", "discover"): say what the thing is.
- Centered, repeated instruction lines in the middle of a page (they go in the footer).
- A title bar that repeats the tab above it. The heading stays in the page for screen readers.
- Metadata in capitals or below 13px.
- Meaning carried by colour alone: every state also has a word, a shape or a position.
- Invented numbers, quotes, testimonials or "trusted by" strips.

## Accessibility rules every change must keep

- Text contrast 4.5:1 or better in both themes; keyboard focus is a visible 2px ring in the action colour.
- Controls are at least 24 by 24px (44px on phones for the main ones); the page works with the keyboard alone and keeps a skip link.
- Every page has one `h1`; a heading that repeats the tab is hidden visually, not removed.
- Pictures from stories are decorative on Today (empty `alt`), because the headline beside them says the same thing.
- Motion is limited to short transitions and respects `prefers-reduced-motion`.
- The meta Content-Security-Policy forbids inline event handlers and inline scripts that are not hashed; run `bash scripts/pages.sh .` after every change to `index.html`.

## Before adding anything

Does it say something no other part of the page says? Is it plain text, a rule, or a box that someone can act on? Does it use only the tokens above? Does it work in the dark theme, on a 390px screen, and with the keyboard? If any answer is no, change it first.
