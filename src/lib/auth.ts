// Must stay the first import: wraps fetch before Better Auth loads
import './github-user-agent';
import { betterAuth } from 'better-auth';
import type { Env } from './env';
import { authOptions } from './auth-options';

const REQUIRED = ['SITE_URL', 'BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const;

type Auth = ReturnType<typeof buildAuth>;

// Bindings and secrets belong to the isolate, not the request, so the
// (costly) Better Auth instance is built once per isolate rather than per
// request — production CPU was 7–75 ms per auth request when rebuilt each
// time. Keyed on configuration, not on the env object's identity, so reuse
// doesn't depend on the runtime handing over the same object each time.
let cached: { key: string; auth: Auth } | null = null;

export function createAuth(env: Env): Auth {
  const key = [env.SITE_URL, env.BETTER_AUTH_SECRET, env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET].join('\u0000');
  if (cached?.key !== key) cached = { key, auth: buildAuth(env) };
  return cached.auth;
}

/** `database: env.DB` uses Better Auth's native D1 support. */
function buildAuth(env: Env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Auth is not configured: missing ${missing.join(', ')}`);
  if (!env.DB) throw new Error('Auth is not configured: missing D1 binding DB');

  return betterAuth({
    ...authOptions({
      baseURL: env.SITE_URL,
      secret: env.BETTER_AUTH_SECRET,
      githubClientId: env.GITHUB_CLIENT_ID,
      githubClientSecret: env.GITHUB_CLIENT_SECRET,
      // Tombstones let any restore re-apply deletions (docs/operations/restore.md)
      onUserDeleted: async (userId) => {
        await env.DB.prepare('INSERT OR IGNORE INTO account_deletions (user_id, deleted_at) VALUES (?, ?)')
          .bind(userId, Date.now())
          .run();
      },
    }),
    database: env.DB,
  });
}
