import { afterEach, describe, expect, it, vi } from 'vitest';
import { md5Hex, r2Client } from './r2';

const ENV = {
  CLOUDFLARE_ACCOUNT_ID: 'acct',
  R2_ASSETS_ACCESS_KEY_ID: 'assets-id',
  R2_ASSETS_SECRET_ACCESS_KEY: 'assets-secret',
  R2_BACKUP_ACCESS_KEY_ID: 'backup-id',
  R2_BACKUP_SECRET_ACCESS_KEY: 'backup-secret',
};
const BYTES = new TextEncoder().encode('webp-bytes');
const IMMUTABLE = { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' };

// aws4fetch signs a Request and hands it to the global fetch.
function stubFetch(...responses: (Response | Error)[]) {
  const calls: Request[] = [];
  const fn = vi.fn(async (input: Request) => {
    calls.push(input);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const client = () => r2Client('cssdaily-assets', { env: ENV, retries: 0 });

afterEach(() => vi.unstubAllGlobals());

describe('r2Client', () => {
  it('putIfAbsent sends an explicit conditional PUT with metadata', async () => {
    const calls = stubFetch(new Response(null, { status: 200 }));
    await expect(client().putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).resolves.toBe('created');
    const req = calls[0];
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('https://acct.r2.cloudflarestorage.com/cssdaily-assets/targets/css/a.webp');
    expect(req.headers.get('if-none-match')).toBe('*');
    expect(req.headers.get('content-type')).toBe('image/webp');
    expect(req.headers.get('cache-control')).toBe(IMMUTABLE.cacheControl);
    expect(req.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=assets-id\//);
  });

  it('putIfAbsent treats an existing identical object as a no-op', async () => {
    stubFetch(
      new Response(null, { status: 412 }),
      new Response(null, { status: 200, headers: { etag: `"${md5Hex(BYTES)}"`, 'content-length': String(BYTES.length) } })
    );
    await expect(client().putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).resolves.toBe('identical');
  });

  it('putIfAbsent refuses to overwrite different content', async () => {
    stubFetch(
      new Response(null, { status: 412 }),
      new Response(null, { status: 200, headers: { etag: '"0123456789abcdef0123456789abcdef"', 'content-length': '5' } })
    );
    await expect(client().putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).rejects.toThrow(/Refusing to overwrite/);
  });

  it.each([
    ['403', () => new Response(null, { status: 403 })],
    ['500 after retries', () => new Response(null, { status: 500 })],
  ])('putIfAbsent throws on %s', async (_label, make) => {
    stubFetch(make());
    await expect(client().putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).rejects.toThrow(/PUT .* failed: HTTP/);
  });

  it('retries a dropped connection and still never overwrites', async () => {
    // The PUT may have landed before the connection dropped: the retry then
    // sees 412, compares checksums, and reports 'identical'.
    stubFetch(
      new TypeError('fetch failed', { cause: new Error('other side closed') }),
      new Response(null, { status: 412 }),
      new Response(null, { status: 200, headers: { etag: `"${md5Hex(BYTES)}"`, 'content-length': String(BYTES.length) } })
    );
    const retrying = r2Client('cssdaily-assets', { env: ENV, retries: 2, retryDelayMs: 0 });
    await expect(retrying.putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).resolves.toBe('identical');
  });

  it('putIfAbsent propagates network failures', async () => {
    stubFetch(new TypeError('fetch failed'));
    await expect(client().putIfAbsent('targets/css/a.webp', BYTES, IMMUTABLE)).rejects.toThrow(/fetch failed/);
  });

  it('head returns null only for 404 and throws on other failures', async () => {
    stubFetch(new Response(null, { status: 404 }));
    await expect(client().head('targets/css/missing.webp')).resolves.toBeNull();
    stubFetch(new Response(null, { status: 403 }));
    await expect(client().head('targets/css/a.webp')).rejects.toThrow(/HEAD .* HTTP 403/);
  });

  it('head returns size and unquoted etag', async () => {
    const calls = stubFetch(new Response(null, { status: 200, headers: { etag: '"abc"', 'content-length': '42' } }));
    await expect(client().head('targets/css/a.webp')).resolves.toEqual({ size: 42, etag: 'abc' });
    expect(calls[0].method).toBe('HEAD');
  });

  it('uses the backup bucket with its own credentials', async () => {
    const calls = stubFetch(new Response(null, { status: 200 }));
    await r2Client('cssdaily-backups', { env: ENV, retries: 0 }).put('d1/2026-11-15.sql', 'sql', { contentType: 'application/sql', cacheControl: 'no-store' });
    expect(calls[0].url).toBe('https://acct.r2.cloudflarestorage.com/cssdaily-backups/d1/2026-11-15.sql');
    expect(calls[0].headers.get('authorization')).toMatch(/Credential=backup-id\//);
  });

  it('rejects unsafe keys before any request', async () => {
    stubFetch();
    await expect(client().head('../etc/passwd')).rejects.toThrow(/Invalid R2 key/);
    await expect(client().head('targets//a.webp')).rejects.toThrow(/Invalid R2 key/);
  });

  it('fails fast when the bucket credentials are missing', () => {
    expect(() => r2Client('cssdaily-backups', { env: { ...ENV, R2_BACKUP_SECRET_ACCESS_KEY: '' } })).toThrow(/R2_BACKUP_SECRET_ACCESS_KEY/);
  });
});
