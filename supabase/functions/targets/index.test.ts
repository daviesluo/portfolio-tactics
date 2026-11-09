// Pins the targets function's request handling (index.ts): each path checks its own credential first; the cron path
// writes its beat before its work (0075) and never when the bearer is wrong; the page's GET needs the app token.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type Deps, handle } from "./index.ts";
import { roTargets as viewerTargets } from "../data/ro_view.ts";
import { BAKED_RISKS } from "./baked_risks.ts";

const URL_ = "https://x.supabase.co/functions/v1/targets";
function deps(over: Partial<Deps> = {}) {
  const log: string[] = [];
  const d: Deps = {
    cronSecret: "s3cret",
    beat: (k) => { log.push(`beat:${k}`); return Promise.resolve(true); },
    run: (force) => { log.push(`run:${force}`); return Promise.resolve({ slot: "x", written: 1, errors: [] }); },
    read: () => { log.push("read"); return Promise.resolve({ slot: null, asOf: null, rows: {} }); },
    verify: (t) => { log.push(`verify:${t}`); return Promise.resolve(t === "good" ? { role: "ro" } : null); },
    report: (kind) => { log.push(`report:${kind}`); return Promise.resolve(); },
    kept: () => { log.push("kept"); return Promise.resolve(new Set(["ACME"])); },
    ...over,
  };
  return { d, log };
}

Deno.test("the cron path: bearer checked, then the beat, then the run", async () => {
  const { d, log } = deps();
  const res = await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), d);
  assertEquals([res.status, log], [200, ["beat:targets", "run:false"]]);
  const forced = deps();
  await handle(new Request(`${URL_}?force=1`, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), forced.d);
  assertEquals(forced.log, ["beat:targets", "run:true"]);
});

Deno.test("a wrong or missing bearer: 403, no beat, no run", async () => {
  for (const h of [{ Authorization: "Bearer nope" }, {} as Record<string, string>]) {
    const { d, log } = deps();
    const res = await handle(new Request(URL_, { method: "POST", headers: h }), d);
    assertEquals([res.status, log], [403, []]);
  }
  // An unset secret opens nothing.
  const { d, log } = deps({ cronSecret: "" });
  assertEquals([(await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer " } }), d)).status, log], [403, []]);
});

Deno.test("a run's errors are reported once; a beat that fails does not stop the run", async () => {
  const { d, log } = deps({ run: () => Promise.resolve({ errors: ["yahoo: no crumb"] }), beat: () => Promise.reject(new Error("db down")) });
  const res = await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), d);
  assertEquals([res.status, log], [200, ["report:targets.run"]]);
});

Deno.test("the page's GET: the app token, then the read; without it 401 and nothing read", async () => {
  const ok = deps();
  const res = await handle(new Request(URL_, { headers: { "x-app-token": "good" } }), ok.d);
  assertEquals([res.status, ok.log, await res.json()], [200, ["verify:good", "read", "kept"], { slot: null, asOf: null, rows: {}, risks: null }]);
  const bad = deps();
  assertEquals([(await handle(new Request(URL_, { headers: { "x-app-token": "bad" } }), bad.d)).status, bad.log], [401, ["verify:bad"]]);
  const put = deps();
  assertEquals([(await handle(new Request(URL_, { method: "PUT" }), put.d)).status, put.log], [405, []]);
});

Deno.test("a hand-targets failure is reported as it starts, under its own kind, and does not make the run an error", async () => {
  const { d, log } = deps({ run: () => Promise.resolve({ skipped: "no slot due", errors: [], notices: ["hand-targets: HAND_TARGETS.json: btc.rows[0]: url is not https"] }) });
  const res = await handle(new Request(URL_, { method: "POST", headers: { Authorization: "Bearer s3cret" } }), d);
  assertEquals([res.status, log], [200, ["beat:targets", "report:targets.hand"]]);
});

// Davies, 2026-11-09: "访客可以看不到历史记录". The job keeps a row for every holding the book ever had, and the viewer was
// sent all of them. Made-up tickers and figures.
Deno.test("a read-only token gets the board's own holdings' rows and Key risks; an admin all of them", async () => {
  const body = {
    slot: "s", asOf: "a",
    rows: { ACME: { mean: 10 }, SOLDCO: { mean: 5 }, "MBG.SG": { mean: 1 } },
    risks: { asOf: "d", risks: { ACME: [{ text: "a" }], SOLDCO: [{ text: "b" }], SAND: [{ text: "c" }] } },
  };
  assertEquals(viewerTargets(body, new Set(["ACME", "CASH"])), {
    slot: "s", asOf: "a", rows: { ACME: { mean: 10 } }, risks: { asOf: "d", risks: { ACME: [{ text: "a" }] } },
  });
  // A listing the page shows by another name keeps its note under that name (MBG.SG as SAND).
  assertEquals((viewerTargets(body, new Set(["MBG.SG"])) as any).risks.risks, { SAND: [{ text: "c" }] });
  const viewer = deps({ read: () => Promise.resolve(body) });
  const v = await handle(new Request(URL_, { headers: { "x-app-token": "good" } }), viewer.d);
  assertEquals(JSON.stringify(await v.json()).includes("SOLDCO"), false);
  const admin = deps({ read: () => Promise.resolve(body), verify: () => Promise.resolve({ role: "admin" }) });
  const a = await handle(new Request(URL_, { headers: { "x-app-token": "good" } }), admin.d);
  assertEquals(await a.json(), body);
  assertEquals(admin.log.includes("kept"), false);
  // No board to cut against: a 503, never the whole table.
  const blind = deps({ read: () => Promise.resolve(body), kept: () => Promise.resolve(null) });
  assertEquals((await handle(new Request(URL_, { headers: { "x-app-token": "good" } }), blind.d)).status, 503);
});

Deno.test("the baked Key risks: 1 to 3 notes a holding, dated ones with a New York date, RKLB's computed note by placeholder", () => {
  for (const [k, notes] of Object.entries(BAKED_RISKS.risks)) {
    assertEquals(notes.length >= 1 && notes.length <= 3, true, k);
    for (const n of notes) if (n.until) assertEquals(/^2026-\d{2}-\d{2}$/.test(n.until), true, k);
  }
  assertEquals(BAKED_RISKS.risks.RKLB.some((n) => n.text === "@lowest-target"), true);
});
