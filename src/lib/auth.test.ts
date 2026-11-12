import { describe, expect, it, vi } from 'vitest';
import { authOptions } from './auth-options';
import { createAuth } from './auth';
import type { Env } from './env';

const config = { baseURL: 'https://cssdaily.dev', secret: 's'.repeat(40), githubClientId: 'id', githubClientSecret: 'secret' };

describe('authOptions', () => {
  const opts = authOptions(config);

  it('trusts only the site origin and serves under /api/auth', () => {
    expect(opts.trustedOrigins).toEqual(['https://cssdaily.dev']);
    expect(opts.basePath).toBe('/api/auth');
    expect(opts.advanced?.useSecureCookies).toBe(true);
    expect(authOptions({ ...config, baseURL: 'http://localhost:8787' }).advanced?.useSecureCookies).toBe(false);
  });

  it('enables account deletion and never sends telemetry', () => {
    expect(opts.user?.deleteUser?.enabled).toBe(true);
    expect(opts.telemetry?.enabled).toBe(false);
  });

  it('stores no session IP address or user agent', async () => {
    const hook = opts.databaseHooks!.session!.create!.before!;
    const result = await hook({ id: 's', userId: 'u', ipAddress: '203.0.113.9', userAgent: 'UA', token: 't' } as never, null);
    expect(result).toMatchObject({ data: { ipAddress: null, userAgent: null, token: 't' } });
  });

  it('stores no GitHub OAuth tokens, on create or update', async () => {
    const account = { id: 'a', accountId: '1', providerId: 'github', userId: 'u', accessToken: 'gho_x', refreshToken: 'r', idToken: 'i', scope: 'user:email' };
    for (const hook of [opts.databaseHooks!.account!.create!.before!, opts.databaseHooks!.account!.update!.before!]) {
      const result = (await hook(account as never, null)) as { data: Record<string, unknown> };
      expect(result.data).toMatchObject({ accessToken: null, refreshToken: null, idToken: null, scope: 'user:email', providerId: 'github' });
    }
  });

  it('records a tombstone after deletion', async () => {
    const onUserDeleted = vi.fn(async () => {});
    await authOptions({ ...config, onUserDeleted }).user!.deleteUser!.afterDelete!({ id: 'user-123' } as never);
    expect(onUserDeleted).toHaveBeenCalledWith('user-123');
  });
});

describe('createAuth', () => {
  it('names every missing setting instead of failing obscurely', () => {
    const env = { DB: {}, SITE_URL: 'https://cssdaily.dev', BETTER_AUTH_SECRET: '', GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: '' } as unknown as Env;
    expect(() => createAuth(env)).toThrow(/missing BETTER_AUTH_SECRET, GITHUB_CLIENT_SECRET/);
  });
});
