# Admin dashboard (password-protected)

A private page where you log in and approve, edit, retag, keep or delete anything on The Yappie Pro. It runs as one free Cloudflare Worker. The site itself stays a static site: the dashboard saves your decisions to a **separate private GitHub repository**, and the next update applies them.

**What you can do**

- **Live**: every item on the site (all sections: AAPI Media, Mainstream, Statements, Research, Policy, and so on). Search, filter by source, section, topic, community and state, then edit, move back to the approval queue, keep permanently, or delete. Select many at once to retag, move or delete in bulk.
- **Waiting for approval**: new stories that you chose to review before they go live. Approve, edit and approve, or delete.
- **Trash**: deleted items, kept 180 days. Restore any of them. A deleted item is never collected again.
- **Edit**: headline, summary, source, link, date, section, topic, communities and states. The dashboard remembers what was collected, so "Revert to collected" always works.
- **Add an item**: for example a story you write yourself. It can have its own story text, author and picture, and opens inside the portal like a Yappie article.
- **Settings**:
  - **Approval**: choose whether new stories wait for approval: never, always, or only for the sources and sections you pick.
  - **Topics** and **Communities**: add your own. Give each some keywords (words or phrases, one per line or separated by commas) and every new story that mentions one is tagged automatically at the next update; stories already on the site are checked too. A topic or community without keywords is given by hand (Edit, or Retag for many at once). Keywords match whole words in any capitals, a plural also matches, and anything you type is taken literally (it is never treated as a pattern). A story that contains one of your topic's keywords goes under your topic instead of a built-in one. Up to 30 of each, 40 keywords each. Removing one takes it off every story.
  - **News categories** and **News sources**: the News page has two categories, AAPI Media and Mainstream. Add more (for example “Faith media”), then put each source in one of them from the table (search, tick several, move them together). It applies to all of the source's stories, new and old. A story you move by hand with Edit keeps its own choice. Choosing a source's usual category again removes your choice. Statements, Research and the Policy pages are not News categories.
- **Policy relevancy** (Edit, or Retag for many): set a Policy item to *Impacts AAPIs* or *Related issue*. **Research page type** (Edit, or Retag): set an item to *Report*, *Survey* or *Data* (or *Not on the Research page*, or *Automatic*, which reads the headline and summary as before). Revert to collected undoes either.
- **Activity**: every change made from the dashboard, from the private repository's history.

Changes show on the site after the next update, usually two to three minutes after you save (saving starts one). "Update the site now" starts one by hand.

## Why there are two repositories

`theyappie/yappie-pro` is public, and GitHub Pages publishes everything in it. So anything the dashboard keeps there would be readable by anyone, including stories you have not approved yet. Instead:

| Repository | Visible to | Holds |
|---|---|---|
| `theyappie/yappie-pro` (the site) | everyone | the website, the feed, the collector |
| `theyappie/yappie-pro-admin` (new, **private**) | only you | `admin.json` (your decisions) and `pending.json` (stories waiting for approval) |

It costs nothing: a private repository is free, and the update job still runs in the public repository, which has unlimited free Actions minutes.

## Set up (about 20 minutes, once)

You need the Cloudflare account that already runs the update timer, and the two GitHub repositories.

### 1. The private repository
GitHub → New repository → Owner `theyappie`, name `yappie-pro-admin`, choose **Private**, tick **Add a README file** (the repository must not be empty), Create.

### 2. A GitHub token
GitHub → your profile photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

- Resource owner: `theyappie`. Repository access: Only select repositories → **both** `yappie-pro` and `yappie-pro-admin`.
- Repository permissions: **Contents: Read and write** and **Actions: Read and write**. Leave the rest as No access.
- Pick the longest expiry offered and put the date in your calendar. Copy the token.

(This is a separate token from the one on the timer Worker, which only has Actions.)

### 3. Give the update job access to the private repository
In the **site** repository (`yappie-pro`): Settings → Secrets and variables → Actions → New repository secret. Name `ADMIN_DATA_TOKEN`, value: the token from step 2.

Only if you named the private repository something else: Variables tab → New repository variable → `ADMIN_DATA_REPO` = `owner/name`.

From then on every update fetches your decisions from the private repository and saves the waiting list back to it. Without this secret the update job still runs, but your decisions are not applied (the run log says so), so please add it before using the dashboard. The job also stops with an error if the repository is ever made public by mistake.

### 4. A place to remember logins (free)
Cloudflare dashboard → Storage & databases → KV → Create a namespace named `yappie-admin`. It remembers wrong-password lockouts and sign-outs. The dashboard works without it, but then those are only remembered by one server at a time, so please add it.

### 5. The Worker
1. Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it `yappie-admin` → Deploy.
2. Edit code → delete everything → paste the whole of `tools/admin/worker.js` from this repository → Deploy.
3. Settings → Bindings → Add → KV namespace → variable name **`KV`** → choose `yappie-admin`.
4. Settings → Variables and Secrets → Add:
   - Type **Secret**, name `ADMIN_PASSWORD`: your password. Use at least 12 characters; a long phrase from your password manager is best. (The Worker refuses anything under 10.)
   - Type **Secret**, name `GITHUB_TOKEN`: the token from step 2.
   - Optional, type **Text** (these are the defaults): `GITHUB_REPO` = `theyappie/yappie-pro`, `GITHUB_BRANCH` = `main`, `DATA_REPO` = `theyappie/yappie-pro-admin`, `DATA_BRANCH` = `main`, `WORKFLOW_FILE` = `update.yml`, `SITE_ORIGIN` = `https://pro.theyappie.com`.
5. Deploy again so the settings apply.

### 6. A web address
The Worker answers at `yappie-admin.<your-subdomain>.workers.dev`. To use `admin.theyappie.com` instead: the Worker → Settings → Domains & Routes → Add → Custom domain → `admin.theyappie.com`. Cloudflare creates the DNS record itself.

Open the address and log in.

### 7. The site's fonts on the login page (optional)
The login page uses the same Adobe Fonts as the site (Corsario and Tablet Gothic). Adobe only serves them to addresses on the project's list: fonts.adobe.com → your web project → Domains → add `admin.theyappie.com` (or the `workers.dev` address). If you skip this, the login page still works and falls back to ordinary system fonts.

### 8. Optional second lock
For two-step protection, put Cloudflare Access in front: Zero Trust → Access → Applications → Add → Self-hosted → your admin address → a policy that allows only your email address (one-time PIN by email). It is free for up to 50 users. The password still applies after that.

## Day to day

- **Change the password:** edit the `ADMIN_PASSWORD` secret on the Worker. Everyone is signed out at once.
- **Sign everyone out:** Account → Log out on every device.
- **Token expired:** the dashboard says GitHub did not accept the token, and the update job (Actions tab) fails at "Get the admin data" until you replace it. Make a new token (step 2), then replace `GITHUB_TOKEN` on the Worker and the `ADMIN_DATA_TOKEN` secret on the site repository.
- **Turn approval on:** Settings tab. Items already on the site stay where they are; only new ones wait.

## How it works

- The Worker serves the login page, the dashboard and a small API from one address. After a correct password it sets a cookie that JavaScript cannot read (HttpOnly, Secure, SameSite=Strict, `__Host-` prefix) valid for 12 hours. Every change also needs a per-session token and a matching Origin, so another web page cannot make changes for you.
- Five wrong passwords from one address lock it out for 15 minutes. Passwords are compared in constant time and never stored; the session signing key comes from the password, so changing the password invalidates all sessions.
- Pages are served with a strict Content Security Policy (no outside scripts), no caching, and `noindex`. The login page may also load the site's fonts from Adobe Fonts (`use.typekit.net`, `p.typekit.net`); the dashboard loads nothing from outside.
- Your own topics, communities and categories are part of `admin.json`. The Worker never publishes their keywords: the feed (`data/feed.json`) carries only their names (`taxo`), which the public page uses to show them as filters without a new release.
- Decisions are saved as commits to **`admin.json`** in the private repository (each says what changed, for example "admin: Approved 3 items"). Items waiting for approval are written by the update job to **`pending.json`** in the same repository.
- The Worker refuses to read or save anything if the data repository is public or is the same repository as the site. The update job makes the same check.
- `scripts/fetch.mjs` reads `admin.json` on every run and applies it (`scripts/admin.mjs` holds the rules, shared with the Worker). If that file is damaged, the run stops and leaves the site as it was.
- If two saves land at the same moment, the Worker retries. If the update job's push meets a dashboard save, it pulls and pushes again.

## Good to know

- **Nothing unpublished is on the public site.** Stories waiting for approval, your edits to them, and everything in the Trash live only in the private repository. Once you approve a story, it is published like any other (its headline, link and text are then in the feed).
- **Free plan limits:** the Worker uses a few milliseconds per save. That is fine for several hundred saved decisions. If saves ever fail with "exceeded CPU", delete old trash items, or switch the Worker to the $5/month Workers plan.
- **Size:** `admin.json` must stay under 900 KB. Old approvals and trash are forgotten after 180 days. The dashboard tells you if the file gets too large.
- An item you **keep permanently** is exempt from the 30-day (news) cut-off. Items you add by hand are kept permanently unless you untick that box.
- The Worker is a single generated file. If you change anything in `src/` or `scripts/admin.mjs`, run `node tools/admin/build.mjs` and paste the new `worker.js` again.

## Files

| File | What it is |
|---|---|
| `worker.js` | The file to paste into Cloudflare (generated). |
| `build.mjs` | Builds `worker.js` from `src/` and `scripts/admin.mjs`. |
| `src/worker-main.js` | Login, sessions, GitHub access and the API. |
| `src/login.html`, `src/app.html` | The login page and the dashboard. |
| `src/yappie-pro-logo.svg` | The wordmark shown on the login page (built into `worker.js`). |
