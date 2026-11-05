// Reading this repository's own files from an Edge Function (the `targets` function's hand-kept tables, and others).
//
// The repository goes private (Davies, 2026-11-05), and a private repository answers every anonymous read with 404:
// raw.githubusercontent.com, api.github.com and git's ref advertisement alike. So a read carries GITHUB_READ_TOKEN when
// that Edge secret is set (a fine-grained token whose only repository is this one, Contents: read; Davies sets it in the
// Supabase dashboard, it is never printed), through the REST contents API, which serves a file's raw bytes to a token;
// without the secret it stays the anonymous read that worked while the repository was public.

export const GITHUB_READ_TOKEN_ENV = "GITHUB_READ_TOKEN";

/** The read token, or null when the secret is unset (or the environment cannot be read). */
export function githubReadToken(): string | null {
  try {
    const t = Deno.env.get(GITHUB_READ_TOKEN_ENV)?.trim();
    return t ? t : null;
  } catch {
    return null;
  }
}

const API_VERSION = "2022-11-28";

/** Headers for a call to api.github.com: the token when there is one. */
export function githubApiHeaders(token: string | null, accept: string, userAgent: string): Record<string, string> {
  const h: Record<string, string> = { Accept: accept, "User-Agent": userAgent, "X-GitHub-Api-Version": API_VERSION };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Basic auth for git's smart HTTP protocol, which takes a token as the password. */
export function gitBasicAuth(token: string): string {
  return `Basic ${btoa(`x-access-token:${token}`)}`;
}

/**
 * One file of `repo` at `ref` (a commit or a branch): with a token, the contents API asked for the raw bytes; without,
 * raw.githubusercontent.com. Both read the same bytes, so a sha256 pinned on a file holds either way.
 */
export function repoFileRequest(repo: string, ref: string, path: string, token: string | null, userAgent: string): { url: string; headers: Record<string, string> } {
  if (!token) return { url: `https://raw.githubusercontent.com/${repo}/${ref}/${path}`, headers: { "User-Agent": userAgent } };
  const p = path.split("/").map(encodeURIComponent).join("/");
  return {
    url: `https://api.github.com/repos/${repo}/contents/${p}?ref=${encodeURIComponent(ref)}`,
    headers: githubApiHeaders(token, "application/vnd.github.raw", userAgent),
  };
}

/**
 * `f`, with every anonymous raw.githubusercontent.com read of `repo` sent as the token's contents-API read instead; any
 * other URL, and every URL when there is no token, goes through untouched. For a caller whose reading code must stay
 * byte for byte as it is: the wrapper sits in the caller instead.
 */
export function withRepoReadToken(f: typeof fetch, repo: string, token: string | null, userAgent: string): typeof fetch {
  if (!token) return f;
  const prefix = `https://raw.githubusercontent.com/${repo}/`;
  return ((input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith(prefix)) return f(input, init);
    const rest = url.slice(prefix.length), slash = rest.indexOf("/");
    if (slash <= 0) return f(input, init);
    const req = repoFileRequest(repo, rest.slice(0, slash), rest.slice(slash + 1), token, userAgent);
    return f(req.url, { ...init, headers: { ...req.headers } });
  }) as typeof fetch;
}
