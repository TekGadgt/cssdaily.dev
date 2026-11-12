import { describe, expect, it, vi } from 'vitest';
import worker from './worker';
import type { Env } from './lib/env';

function fakeEnv() {
  const run = vi.fn(async () => ({}));
  const bind = vi.fn(() => ({ run }));
  const env = {
    ASSETS: { fetch: vi.fn(async () => new Response('404 page', { status: 404 })) },
    DB: { prepare: vi.fn(() => ({ bind })) },
    PLAYS_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    SITE_URL: 'https://cssdaily.dev',
    GITHUB_DISPATCH_TOKEN: 'tok',
  };
  return { env: env as unknown as Env, raw: env, bind, run };
}

const play = (origin: string | null, body = '{"mode":"css","date":"2026-11-14","difficulty":"easy"}') =>
  new Request('https://cssdaily.dev/api/plays', {
    method: 'POST',
    headers: { 'content-type': 'text/plain;charset=UTF-8', ...(origin ? { origin } : {}) },
    body,
  });

const fetchWith = (req: Request, env: Env) => worker.fetch(req as never, env) as Promise<Response>;

describe('worker routing', () => {
  it('records a same-origin play', async () => {
    const { env, bind, run } = fakeEnv();
    const res = await fetchWith(play('https://cssdaily.dev'), env);
    expect(res.status).toBe(204);
    expect(bind).toHaveBeenCalledWith('css', '2026-11-14', 'easy', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(run).toHaveBeenCalled();
  });

  it.each([
    ['foreign origin', play('https://evil.example')],
    ['missing origin', play(null)],
    ['malformed body', play('https://cssdaily.dev', 'not json')],
    ['oversize body', play('https://cssdaily.dev', `{"x":"${'a'.repeat(600)}"}`)],
  ])('drops a %s without writing', async (_label, req) => {
    const { env, raw } = fakeEnv();
    expect((await fetchWith(req, env)).status).toBe(204);
    expect(raw.DB.prepare).not.toHaveBeenCalled();
  });

  it('respects the rate limiter', async () => {
    const { env, raw } = fakeEnv();
    raw.PLAYS_LIMITER.limit.mockResolvedValueOnce({ success: false });
    expect((await fetchWith(play('https://cssdaily.dev'), env)).status).toBe(204);
    expect(raw.DB.prepare).not.toHaveBeenCalled();
  });

  it('rejects other methods on the API route', async () => {
    const { env } = fakeEnv();
    const res = await fetchWith(new Request('https://cssdaily.dev/api/plays'), env);
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('hands every other unmatched path to the assets 404 page', async () => {
    const { env, raw } = fakeEnv();
    const res = await fetchWith(new Request('https://cssdaily.dev/challenge/2099-01-01/'), env);
    expect(res.status).toBe(404);
    expect(raw.ASSETS.fetch).toHaveBeenCalledTimes(1);
  });

  it('answers get-session for signed-out visitors without loading Better Auth', async () => {
    const { env } = fakeEnv();
    const res = await fetchWith(new Request('https://cssdaily.dev/api/auth/get-session', { headers: { cookie: 'theme=dark' } }), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});
