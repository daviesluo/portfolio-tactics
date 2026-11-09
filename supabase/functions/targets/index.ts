// Supabase Edge Function: targets — the analyst targets behind the "Target price" page (Davies, 2026-10-21).
//
//   POST (Bearer CRON_SECRET)  the job: called every minute by the one-minute job (the watchdog, 0134), it runs only when a
//                              slot is due (schedule.ts: 04:00, 09:30 and the close ET on a US trading day, 09:30 ET on any
//                              other day) and writes each holding's snapshot (run.ts, compute.ts) to `analyst_targets`.
//                              `?force=1` runs it now (an operator's first fill).
//   GET  (x-app-token)         the page's read, through the app's preload: every snapshot, the slot it is from and when
//                              the run was, and the Key risks. Read-only viewers get the board's own holdings' alone
//                              (`roTargets`, ../data/ro_view.ts): the job keeps a row for every holding ever held.
//
// Deployed with `--no-verify-jwt` (PUBLIC_FNS in edge-functions.yml): the cron bearer is not a Supabase JWT, so each
// path checks its own credential first. The cron path writes its beat before anything else (`_shared/beats.ts`, 0075).
// It imports `fundamentals/_yahoo.ts`'s crumb handshake and `fundamentals/_shared.ts`'s ticker filter: a change to
// either should redeploy this function too.

import { beatKeyOfRequest, writeBeat } from "../_shared/beats.ts";
import { reportServerError } from "../_shared/ops.ts";
import { constantTimeEqual, verifyToken } from "../_shared/token.ts";
import { makeDb } from "../agents/db.ts";
import { getYahooCrumb } from "../fundamentals/_yahoo.ts";
import { readTargets, runTargets, type RunReport } from "./run.ts";
import { keptTickers, roTargets } from "../data/ro_view.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-app-token",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" } });

export type Deps = {
  cronSecret: string;
  beat: (key: string) => Promise<unknown>;
  run: (force: boolean) => Promise<RunReport>;
  read: () => Promise<unknown>;
  verify: (token: string) => Promise<unknown>;
  report: (kind: string, message: string) => Promise<void>;
  /** The tickers the stored board shows a viewer (`keptTickers`), or null when it could not be read. */
  kept: () => Promise<Set<string> | null>;
};


/** A request's way through: its credential, then (the cron path) its beat, then its work. Exported so the order is pinned. */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  try {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (req.method === "GET") {
      const verified = await deps.verify(req.headers.get("x-app-token") ?? "");
      if (!verified) return json(401, { error: "invalid token" });
      if ((verified as { role?: string }).role === "admin") return json(200, await deps.read());
      // Any other token: only the board's own holdings (`roTargets`, ../data/ro_view.ts); no board to cut against, no answer.
      const [body, kept] = await Promise.all([deps.read(), deps.kept()]);
      if (!kept) return json(503, { error: "board unavailable" });
      return json(200, roTargets(body, kept));
    }
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const auth = req.headers.get("Authorization") ?? "";
    if (!deps.cronSecret || !constantTimeEqual(auth, `Bearer ${deps.cronSecret}`)) return json(403, { error: "forbidden" });
    await deps.beat(beatKeyOfRequest("targets", req.url)).catch(() => false);
    const report = await deps.run(new URL(req.url).searchParams.get("force") === "1");
    // A run that read Yahoo and found it down says so once a run (three a trading day at most).
    if (report.errors.length) await deps.report("targets.run", report.errors.join("; ").slice(0, 500));
    // A hand-targets failure is reported when it starts, once; the run keeps the baked tables until it clears (hand.ts).
    for (const n of report.notices ?? []) await deps.report("targets.hand", n.slice(0, 500));
    return json(200, report);
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    await deps.report("targets.unhandled", msg.slice(0, 500)).catch(() => {});
    return json(500, { error: "internal" });
  }
}

if (import.meta.main) {
  const url = Deno.env.get("SUPABASE_URL") ?? "", key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = makeDb(url, key);
  Deno.serve((req) => handle(req, {
    cronSecret: Deno.env.get("CRON_SECRET") ?? "",
    beat: (k) => writeBeat(k),
    run: (force) => runTargets({ db, now: Date.now(), crumb: getYahooCrumb, avKey: Deno.env.get("ALPHAVANTAGE_API_KEY") ?? null, force, hand: true }),
    read: () => readTargets(db),
    verify: (t) => verifyToken(t),
    report: (kind, message) => reportServerError(kind, { message }),
    kept: async () => {
      const rows = await db.select<{ data: unknown }>("board_data", "id=eq.1&select=data").catch(() => null);
      return Array.isArray(rows) && rows[0] ? keptTickers(rows[0].data) : null;
    },
  }));
}
