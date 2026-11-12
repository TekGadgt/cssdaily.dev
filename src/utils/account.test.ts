import { describe, expect, it, vi } from 'vitest';
import { deleteAccount, getSession, returnPath, startGitHubSignIn } from './account';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('account client', () => {
  it('reads the signed-in user, or null', async () => {
    const user = { name: 'Ryan', email: 'r@example.com', image: 'https://avatars.example/1' };
    await expect(getSession(vi.fn(async () => res(200, { user, session: {} })))).resolves.toEqual(user);
    await expect(getSession(vi.fn(async () => res(200, null)))).resolves.toBeNull();
    await expect(getSession(vi.fn(async () => { throw new TypeError('offline'); }))).resolves.toBeNull();
  });

  it('returns players to the same page, with or without the confirm-delete flag', () => {
    expect(returnPath({ pathname: '/challenge/2026-11-12/', search: '' })).toBe('/challenge/2026-11-12/');
    expect(returnPath({ pathname: '/tailwind/2026-11-12/', search: '?x=1' }, true)).toBe('/tailwind/2026-11-12/?x=1&confirm-delete=1');
    expect(returnPath({ pathname: '/about/', search: '?confirm-delete=1' })).toBe('/about/');
  });

  it('starts GitHub sign-in with the return path', async () => {
    const fetchFn = vi.fn(async () => res(200, { url: 'https://github.com/login/oauth/authorize?x', redirect: true }));
    await expect(startGitHubSignIn('/challenge/2026-11-12/', fetchFn)).resolves.toBe('https://github.com/login/oauth/authorize?x');
    const init = (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ provider: 'github', callbackURL: '/challenge/2026-11-12/' });
    await expect(startGitHubSignIn('/', vi.fn(async () => res(403, {})))).rejects.toThrow(/could not start/);
  });

  it('maps deletion outcomes, including a stale session needing re-authentication', async () => {
    await expect(deleteAccount(vi.fn(async () => res(200, { success: true })))).resolves.toBe('deleted');
    await expect(deleteAccount(vi.fn(async () => res(400, { code: 'SESSION_EXPIRED' })))).resolves.toBe('reauth');
    await expect(deleteAccount(vi.fn(async () => res(403, { code: 'SESSION_NOT_FRESH' })))).resolves.toBe('reauth');
    await expect(deleteAccount(vi.fn(async () => res(500, {})))).resolves.toBe('error');
  });
});
