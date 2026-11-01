# Admin dashboard (password-protected)

A private page where you log in and approve, edit, retag, keep or delete anything on The Yappie Pro. It runs as one free Cloudflare Worker. The site itself stays a static site: the dashboard saves your decisions to the repository, and the next update applies them.

**What you can do**

- **Live**: every item on the site (all sections: AAPI Media, Mainstream, Statements, Research, Policy, and so on). Search, filter by source, section, topic, community and state, then edit, move back to the approval queue, keep permanently, or delete. Select many at once to retag, move or delete in bulk.
- **Waiting for approval**: new stories that you chose to review before they go live. Approve, edit and approve, or delete.
- **Trash**: deleted items, kept 180 days. Restore any of them. A deleted item is never collected again.
- **Edit**: headline, summary, source, link, date, section, topic, communities and states. The dashboard remembers what was collected, so "Revert to collected" always works.
- **Add an item**: for example a story you write yourself. It can have its own story text, author and picture, and opens inside the portal like a Yappie article.
- **Settings**: choose whether new stories wait for approval: never, always, or only for the sources and sections you pick.
- **Activity**: every change made from the dashboard, from the repository history.

Changes show on the site after the next update, usually two to three minutes after you save (saving starts one). "Update the site now" starts one by hand.

## Set up (about 15 minutes, once)

You need the Cloudflare account that already runs the update timer, and the GitHub repository `theyappie/yappie-pro`.

### 1. A GitHub token for the dashboard
GitHub → your profile photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.

- Resource owner: `theyappie`. Repository access: Only select repositories → `yappie-pro`.
- Repository permissions: **Contents: Read and write** and **Actions: Read and write**. Leave the rest as No access.
- Pick the longest expiry offered and note the date. Copy the token.

(This is a separate token from the one on the timer Worker, which only has Actions. You can use one token with both permissions for both Workers if you prefer.)

### 2. A place to remember logins (free)
Cloudflare dashboard → Storage & databases → KV → Create a namespace named `yappie-admin`. It remembers wrong-password lockouts and sign-outs. The dashboard works without it, but then those are only remembered by one server at a time, so please add it.

### 3. The Worker
1. Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it `yappie-admin` → Deploy.
2. Edit code → delete everything → paste the whole of `tools/admin/worker.js` from this repository → Deploy.
3. Settings → Bindings → Add → KV namespace → variable name **`KV`** → choose `yappie-admin`.
4. Settings → Variables and Secrets → Add:
   - Type **Secret**, name `ADMIN_PASSWORD`: your password. Use at least 12 characters; a long phrase from your password manager is best. (The Worker refuses anything under 10.)
   - Type **Secret**, name `GITHUB_TOKEN`: the token from step 1.
   - Optional, type **Text** (these are the defaults): `GITHUB_REPO` = `theyappie/yappie-pro`, `GITHUB_BRANCH` = `main`, `WORKFLOW_FILE` = `update.yml`, `SITE_ORIGIN` = `https://pro.theyappie.com`.
5. Deploy again so the settings apply.

### 4. A web address
The Worker answers at `yappie-admin.<your-subdomain>.workers.dev`. To use `admin.theyappie.com` instead: the Worker → Settings → Domains & Routes → Add → Custom domain → `admin.theyappie.com`. Cloudflare creates the DNS record itself.

Open the address and log in.

### 5. Optional second lock
For two-step protection, put Cloudflare Access in front: Zero Trust → Access → Applications → Add → Self-hosted → your admin address → a policy that allows only your email address (one-time PIN by email). It is free for up to 50 users. The password still applies after that.

## Day to day

- **Change the password:** edit the `ADMIN_PASSWORD` secret on the Worker. Everyone is signed out at once.
- **Sign everyone out:** Account → Log out on every device.
- **Token expired:** the dashboard says GitHub did not accept the token. Make a new one (step 1) and replace `GITHUB_TOKEN`.
- **Turn approval on:** Settings tab. Items already on the site stay where they are; only new ones wait.

## How it works

- The Worker serves the login page, the dashboard and a small API from one address. After a correct password it sets a cookie that JavaScript cannot read (HttpOnly, Secure, SameSite=Strict, `__Host-` prefix) valid for 12 hours. Every change also needs a per-session token and a matching Origin, so another web page cannot make changes for you.
- Five wrong passwords from one address lock it out for 15 minutes. Passwords are compared in constant time and never stored; the session signing key comes from the password, so changing the password invalidates all sessions.
- Pages are served with a strict Content Security Policy (no outside scripts, fonts or styles), no caching, and `noindex`.
- Decisions are saved as commits to **`data/admin.json`** (each says what changed, for example "admin: Approved 3 items"). Items waiting for approval are written by the collector to **`data/pending.json`**.
- `scripts/fetch.mjs` reads `data/admin.json` on every run and applies it (`scripts/admin.mjs` holds the rules, shared with the Worker). If that file is damaged, the run stops and leaves the site as it was.
- If two saves land at the same moment, the Worker retries. If the update job's push meets a dashboard save, it pulls and pushes again.

## Good to know

- **The repository is public, so `data/admin.json` and `data/pending.json` are readable by anyone who looks.** Stories waiting for approval are visible in `pending.json` before you approve them (their headlines, links and, for stories written here, their text). If that matters, make the repository private (GitHub Pages then needs a paid plan) or keep approval off.
- **Free plan limits:** the Worker uses a few milliseconds per save. That is fine for several hundred saved decisions. If saves ever fail with "exceeded CPU", delete old trash items, or switch the Worker to the $5/month Workers plan.
- **Size:** `data/admin.json` must stay under 900 KB. Old approvals and trash are forgotten after 180 days. The dashboard tells you if the file gets too large.
- An item you **keep permanently** is exempt from the 30-day (news) cut-off. Items you add by hand are kept permanently unless you untick that box.
- The Worker is a single generated file. If you change anything in `src/` or `scripts/admin.mjs`, run `node tools/admin/build.mjs` and paste the new `worker.js` again.

## Files

| File | What it is |
|---|---|
| `worker.js` | The file to paste into Cloudflare (generated). |
| `build.mjs` | Builds `worker.js` from `src/` and `scripts/admin.mjs`. |
| `src/worker-main.js` | Login, sessions, GitHub access and the API. |
| `src/login.html`, `src/app.html` | The login page and the dashboard. |
