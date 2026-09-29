// Blogs on their own subdomains (pb_hooks/hosts.pb.js, lib/tenancy.js): the
// on-demand TLS check answers 200 only for the subdomain of an existing site,
// and slugs stay DNS-shaped and clear of the platform's own hosts. Runs after
// rules.mjs, which leaves the Verbatim site and a "propaganda" one behind.
import PocketBase from "pocketbase";
const URL = "http://127.0.0.1:8091";
process.on("unhandledRejection",e=>{console.log("ERR",e.status,e.url,JSON.stringify(e.response));process.exit(1)});
let fails = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"}  ${name} ${extra}`); if (!cond) fails++; };
const tls = async (domain) => (await fetch(`${URL}/api/propaganda/tls-check?domain=${encodeURIComponent(domain)}`)).status;

check("an existing site's subdomain gets a certificate", (await tls("verbatim.propaganda.pub")) === 200);
check("…in any case, with a trailing dot", (await tls("Verbatim.Propaganda.pub.")) === 200);
check("…and so does a site created later", (await tls("propaganda.propaganda.pub")) === 200);
check("an unknown subdomain doesn't", (await tls("nobody-here.propaganda.pub")) === 404);
check("the app host gets a certificate too", (await tls("app.propaganda.pub")) === 200);
check("two labels deep isn't a blog", (await tls("a.verbatim.propaganda.pub")) === 404);
check("the bare platform domain isn't a blog", (await tls("propaganda.pub")) === 404);
check("a lookalike suffix isn't the platform", (await tls("verbatim.propaganda.pub.evil.test")) === 404);
check("another domain isn't one (custom domains come later)", (await tls("verbatim.ayadighaith.com")) === 404);
check("no domain at all", (await tls("")) === 404);

// Sign-ins are rate-limited (PocketBase's default: 2 every 3 s per client) and
// the suites before this one just used them: wait out a 429 and try again.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const signIn = async (pb, email, pass) => {
  for (let attempt = 1; ; attempt++) {
    try { return await pb.collection("users").authWithPassword(email, pass); }
    catch (e) { if (e.status !== 429 || attempt >= 5) throw e; await sleep(4000); }
  }
};
const stranger = new PocketBase(URL);
stranger.autoCancellation(false);
await signIn(stranger, "stranger@test.local", "strangerpass1");
const create = async (slug) => {
  try { await stranger.send("/api/propaganda/sites", { method: "POST", body: { name: "X", slug } }); return 200; }
  catch (e) { return e.status; }
};
check("a platform host can't be a slug", (await create("domains")) === 400);
check("nor can an IDN-style label", (await create("xn--nxasmq6b")) === 400);
check("nor any label with -- in third and fourth place", (await create("ab--cd")) === 400);

console.log(fails ? `${fails} FAILED` : "HOSTS: ALL PASS");
process.exitCode = fails ? 1 : 0;
