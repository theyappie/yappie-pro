// Starts the "update-feed" workflow every time Cloudflare runs this Worker's cron trigger (set it to */10 * * * *).
// GitHub's own scheduler starts runs late and skips some, so this gives an exact 10-minute rhythm.
// The only secret is GITHUB_TOKEN (a fine-grained token limited to this one repository with "Actions: Read and write"). Nothing is public: this Worker has no web address that does anything.
const REPO = "theyappie/yappie-pro", WORKFLOW = "update.yml", BRANCH = "main";

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(start(env));
  },
  async fetch() {
    return new Response("This Worker only runs on its schedule.", { status: 404 });
  },
};

async function start(env) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "yappie-pro-trigger",
    },
    body: JSON.stringify({ ref: BRANCH }),
  });
  // GitHub answers 204 when the run was started. Anything else shows up under the Worker's Logs.
  if (res.status !== 204) console.log("GitHub answered", res.status, (await res.text()).slice(0, 300));
}
