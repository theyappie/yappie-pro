// Test-only: Google News (https://news.google.com/...) is answered by the test's mock server (TEST_BASE + "/news.google.com/...").
const real = globalThis.fetch, B = process.env.TEST_BASE, P = "https://news.google.com/";
globalThis.fetch = (u, o) => real(B && String(u).startsWith(P) ? B + "/news.google.com/" + String(u).slice(P.length) : u, o);
