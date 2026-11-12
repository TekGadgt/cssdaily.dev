/**
 * Workers' fetch sends no User-Agent by default, and github.com blocks
 * requests without one ("Access to this site has been restricted"). Better
 * Auth sets one for api.github.com calls but not for the OAuth token
 * exchange (github.com/login/oauth/access_token), so sign-in failed with
 * invalid_code in production (2026-11-12).
 *
 * Imported first by src/lib/auth.ts so the wrapper is in place before
 * Better Auth captures fetch. Only GitHub hosts are touched, and an
 * existing User-Agent is never overwritten.
 */
export const USER_AGENT = 'cssdaily.dev (+https://cssdaily.dev)';
const GITHUB_HOSTS = new Set(['github.com', 'api.github.com']);

export function withGitHubUserAgent(baseFetch: typeof fetch): typeof fetch {
  return (input, init) => {
    const request = new Request(input as RequestInfo, init);
    if (!GITHUB_HOSTS.has(new URL(request.url).hostname) || request.headers.has('user-agent')) {
      return baseFetch(request);
    }
    const headers = new Headers(request.headers);
    headers.set('user-agent', USER_AGENT);
    return baseFetch(new Request(request, { headers }));
  };
}

const marker = Symbol.for('cssdaily.githubUserAgent');
const g = globalThis as typeof globalThis & { [marker]?: true };
if (!g[marker]) {
  globalThis.fetch = withGitHubUserAgent(globalThis.fetch.bind(globalThis));
  g[marker] = true;
}
