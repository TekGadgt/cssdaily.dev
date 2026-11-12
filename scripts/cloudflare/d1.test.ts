import { describe, expect, it, vi } from 'vitest';
import { d1Query } from './d1';

const ENV = { CLOUDFLARE_ACCOUNT_ID: 'acct', D1_DATABASE_ID: 'db', D1_WRITE_TOKEN: 'write-tok' };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (results: unknown[]) => json(200, { success: true, errors: [], result: [{ success: true, results }] });

describe('d1Query', () => {
  it('posts the statement to the query endpoint and returns rows', async () => {
    const fetch = vi.fn(async () => ok([{ n: 1 }]));
    const rows = await d1Query('SELECT ? AS n', [1], { env: ENV, fetch });
    expect(rows).toEqual([{ n: 1 }]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/acct/d1/database/db/query');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer write-tok');
    expect(JSON.parse(init.body as string)).toEqual({ sql: 'SELECT ? AS n', params: [1] });
  });

  it('falls back to the read token when the write token is blank', async () => {
    const fetch = vi.fn(async () => ok([]));
    await d1Query('SELECT 1', [], { env: { ...ENV, D1_WRITE_TOKEN: ' ', D1_READ_TOKEN: 'read-tok' }, fetch });
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer read-tok');
  });

  it('throws when no token is configured', async () => {
    await expect(d1Query('SELECT 1', [], { env: { ...ENV, D1_WRITE_TOKEN: '' } })).rejects.toThrow(/D1_WRITE_TOKEN or D1_READ_TOKEN/);
  });

  it('throws on HTTP errors with the API messages, never the token', async () => {
    const fetch = vi.fn(async () => json(403, { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }));
    const err = await d1Query('SELECT 1', [], { env: ENV, fetch }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/HTTP 403.*Authentication error/);
    expect((err as Error).message).not.toContain('write-tok');
  });

  it('throws when the body reports success: false despite HTTP 200', async () => {
    const fetch = vi.fn(async () => json(200, { success: false, errors: [{ message: 'no such table: x' }] }));
    await expect(d1Query('SELECT * FROM x', [], { env: ENV, fetch })).rejects.toThrow(/no such table/);
  });

  it('retries 429/5xx, then succeeds', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(json(503, {}))
      .mockResolvedValueOnce(json(429, {}))
      .mockResolvedValueOnce(ok([{ n: 2 }]));
    await expect(d1Query('SELECT 2', [], { env: ENV, fetch, retryDelayMs: 0 })).resolves.toEqual([{ n: 2 }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('throws once retries are exhausted', async () => {
    const fetch = vi.fn(async () => json(500, { success: false }));
    await expect(d1Query('SELECT 1', [], { env: ENV, fetch, retries: 2, retryDelayMs: 0 })).rejects.toThrow(/HTTP 500/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('retries dropped connections, then succeeds', async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error('other side closed') }))
      .mockResolvedValueOnce(ok([{ n: 3 }]));
    await expect(d1Query('SELECT 3', [], { env: ENV, fetch, retryDelayMs: 0 })).resolves.toEqual([{ n: 3 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('propagates network failures once retries are exhausted', async () => {
    const fetch = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(d1Query('SELECT 1', [], { env: ENV, fetch, retries: 2, retryDelayMs: 0 })).rejects.toThrow(/fetch failed/);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
