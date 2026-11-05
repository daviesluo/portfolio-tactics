// Pins the repository reads of github_read.ts: with the read token, the contents API asked for raw bytes and carrying
// the token; without, the anonymous raw URL of the repository's public days.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { gitBasicAuth, githubApiHeaders, repoFileRequest, withRepoReadToken } from "./github_read.ts";

Deno.test("repoFileRequest: the contents API with the token, the raw URL without", () => {
  assertEquals(repoFileRequest("o/r", "main", "docs/a b/x.json.gz", "tok", "ua"), {
    url: "https://api.github.com/repos/o/r/contents/docs/a%20b/x.json.gz?ref=main",
    headers: { Accept: "application/vnd.github.raw", "User-Agent": "ua", "X-GitHub-Api-Version": "2022-11-28", Authorization: "Bearer tok" },
  });
  assertEquals(repoFileRequest("o/r", "main", "docs/x.json", null, "ua"), { url: "https://raw.githubusercontent.com/o/r/main/docs/x.json", headers: { "User-Agent": "ua" } });
});

Deno.test("githubApiHeaders and gitBasicAuth: the token only when there is one", () => {
  assertEquals("Authorization" in githubApiHeaders(null, "a", "ua"), false);
  assertEquals(githubApiHeaders("t", "a", "ua").Authorization, "Bearer t");
  assertEquals(atob(gitBasicAuth("t").slice(6)), "x-access-token:t");
});

Deno.test("withRepoReadToken: the repository's raw reads become the token's contents-API reads; nothing else changes", async () => {
  const seen: Array<[string, string | null, string | null]> = [];
  const f = ((u: string | URL | Request, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    seen.push([String(u), h.get("Authorization"), h.get("Accept")]);
    return Promise.resolve(new Response("ok"));
  }) as typeof fetch;
  const signal = AbortSignal.timeout(1000);
  const w = withRepoReadToken(f, "o/r", "tok", "ua");
  await w("https://raw.githubusercontent.com/o/r/main/docs/data/x.json.gz", { signal });
  await w("https://raw.githubusercontent.com/other/r/main/x.json");
  await w("https://api.example.com/q");
  assertEquals(seen, [
    ["https://api.github.com/repos/o/r/contents/docs/data/x.json.gz?ref=main", "Bearer tok", "application/vnd.github.raw"],
    ["https://raw.githubusercontent.com/other/r/main/x.json", null, null],
    ["https://api.example.com/q", null, null],
  ]);
  // No token: the very same fetch, untouched.
  assertEquals(withRepoReadToken(f, "o/r", null, "ua"), f);
});
