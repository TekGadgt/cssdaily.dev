import type { BetterAuthOptions } from 'better-auth';

export interface AuthConfig {
  /** Canonical site URL (SITE_URL), e.g. https://cssdaily.dev */
  baseURL: string;
  secret: string;
  githubClientId: string;
  githubClientSecret: string;
  /** Records a deletion tombstone (src/lib/auth.ts); absent when generating the schema. */
  onUserDeleted?: (userId: string) => Promise<void>;
}

// GitHub's OAuth tokens are never used after sign-in (no API calls on the
// player's behalf), so they're not kept at all.
const TOKEN_FIELDS = ['accessToken', 'refreshToken', 'idToken', 'accessTokenExpiresAt', 'refreshTokenExpiresAt'] as const;
const withoutTokens = <T extends Record<string, unknown>>(account: T) =>
  ({ data: { ...account, ...Object.fromEntries(TOKEN_FIELDS.map((f) => [f, null])) } });

/**
 * Everything except `database`, shared by the Worker (src/lib/auth.ts) and
 * the schema generator (scripts/generate-auth-migration.ts), so the D1
 * schema is generated from exactly the options that run in production.
 */
export function authOptions(config: AuthConfig): Omit<BetterAuthOptions, 'database'> {
  return {
    appName: 'CSS Daily',
    // Never report anything to a third party
    telemetry: { enabled: false },
    baseURL: config.baseURL,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.baseURL],
    socialProviders: {
      github: {
        clientId: config.githubClientId,
        clientSecret: config.githubClientSecret,
        // Better Auth's defaults (read:user, user:email) are all that's
        // needed: it requires an email, which GitHub may hide from the profile
      },
    },
    user: {
      deleteUser: {
        enabled: true,
        // Deleting an OAuth-only account requires a fresh session (default
        // freshAge: 1 day); the account menu handles re-authentication.
        afterDelete: async (user) => {
          await config.onUserDeleted?.(user.id);
        },
      },
    },
    account: {
      // Belt and braces: tokens are nulled below; encrypt anything that slips through
      encryptOAuthTokens: true,
    },
    advanced: {
      // The real client IP on Cloudflare; used in memory for Better Auth's
      // rate limiting, never stored (see the session hook below)
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      useSecureCookies: config.baseURL.startsWith('https://'),
    },
    databaseHooks: {
      session: {
        create: {
          // Sessions don't keep the player's IP address or user agent
          before: async (session) => ({ data: { ...session, ipAddress: null, userAgent: null } }),
        },
      },
      account: {
        create: { before: async (account) => withoutTokens(account) },
        update: { before: async (account) => withoutTokens(account) },
      },
    },
  };
}
