// Test-only: the pages of the fake Yappie site (https://yp.example/...) are served by the test's mock server (TEST_BASE + "/yp/...").
const real = globalThis.fetch, B = process.env.TEST_BASE, P = "https://yp.example/";
globalThis.fetch = (u, o) => real(B && String(u).startsWith(P) ? B + "/yp/" + String(u).slice(P.length) : u, o);
