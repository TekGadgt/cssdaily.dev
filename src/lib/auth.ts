import { betterAuth } from 'better-auth';
import type { Env } from './env';
import { authOptions } from './auth-options';

const REQUIRED = ['SITE_URL', 'BETTER_AUTH_SECRET', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'] as const;

/**
 * Built per request: Worker bindings (D1) only exist inside a request.
 * `database: env.DB` uses Better Auth's native D1 support.
 */
export function createAuth(env: Env) {
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
