# Exact 10-minute trigger (optional, free)

GitHub's own scheduler starts scheduled runs late and sometimes skips them. A Cloudflare Worker with a cron trigger is on time, and it is free.

1. **GitHub token.** github.com → your profile photo → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Resource owner: theyappie. Repository access: Only select repositories → `yappie-pro`. Permissions → Repository permissions → **Actions: Read and write**. Choose the longest expiry offered, copy the token, and note the expiry date (the trigger stops then, and the backup schedules take over until you make a new token).
2. **Worker.** Cloudflare dashboard → Workers & Pages → Create → Create Worker → name it `yappie-pro-trigger` → Deploy → Edit code → replace everything with `worker.js` from this folder → Deploy.
3. **Secret.** The Worker → Settings → Variables and Secrets → Add → type **Secret**, name `GITHUB_TOKEN`, value: the token → Deploy.
4. **Timer.** The Worker → Settings → Trigger Events → Cron Triggers → Add → `*/10 * * * *` → Save.

Each run starts `update.yml` on the main branch. To check it, open the repository's Actions tab: a new `update-feed` run should appear every 10 minutes, and `workflow_dispatch` is its trigger.
