import { createHash } from 'crypto';
import { AwsClient } from 'aws4fetch';
import { requireEnv } from './env';

export type Bucket = 'cssdaily-assets' | 'cssdaily-backups';

// Each bucket has its own key pair, scoped to that bucket only: the public
// assets bucket and the private backup bucket never share credentials.
const CREDENTIALS: Record<Bucket, [string, string]> = {
  'cssdaily-assets': ['R2_ASSETS_ACCESS_KEY_ID', 'R2_ASSETS_SECRET_ACCESS_KEY'],
  'cssdaily-backups': ['R2_BACKUP_ACCESS_KEY_ID', 'R2_BACKUP_SECRET_ACCESS_KEY'],
};

const KEY_RE = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

export interface PutOptions {
  contentType: string;
  cacheControl: string;
}

export interface R2Client {
  /**
   * Creates the object only if the key is free. If it already exists with
   * identical bytes (ETag = MD5 of a single-part upload) that's a no-op;
   * different bytes throw — published objects are never overwritten.
   */
  putIfAbsent(key: string, body: Uint8Array, opts: PutOptions): Promise<'created' | 'identical'>;
  /** Unconditional write: only for mutable keys (the data snapshot, backups). */
  put(key: string, body: Uint8Array | string, opts: PutOptions): Promise<void>;
  /** null only for 404; any other failure throws. */
  head(key: string): Promise<{ size: number; etag: string } | null>;
  get(key: string): Promise<Uint8Array>;
}

export const md5Hex = (bytes: Uint8Array) => createHash('md5').update(bytes).digest('hex');

export function r2Client(
  bucket: Bucket,
  opts: { env?: NodeJS.ProcessEnv; retries?: number; retryDelayMs?: number } = {}
): R2Client {
  const env = opts.env ?? process.env;
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID', env);
  const [idVar, secretVar] = CREDENTIALS[bucket];
  const aws = new AwsClient({
    accessKeyId: requireEnv(idVar, env),
    secretAccessKey: requireEnv(secretVar, env),
    service: 's3',
    region: 'auto',
    // aws4fetch retries 429/5xx itself and then *returns* the last response
    // (it doesn't throw), so every call below still checks res.ok.
    retries: opts.retries ?? 3,
    initRetryMs: opts.retryDelayMs ?? 200,
  });
  const base = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`;

  const url = (key: string) => {
    if (!KEY_RE.test(key) || key.split('/').some((seg) => seg === '.' || seg === '..')) {
      throw new Error(`Invalid R2 key: ${key}`);
    }
    return `${base}/${key}`;
  };
  const fail = (op: string, key: string, res: Response) =>
    new Error(`R2 ${op} ${bucket}/${key} failed: HTTP ${res.status}`);

  const head: R2Client['head'] = async (key) => {
    // Explicit method everywhere: aws4fetch defaults to POST when a body is
    // present and GET otherwise.
    const res = await aws.fetch(url(key), { method: 'HEAD' });
    if (res.status === 404) return null;
    if (!res.ok) throw fail('HEAD', key, res);
    return {
      size: Number(res.headers.get('content-length')),
      etag: (res.headers.get('etag') ?? '').replace(/"/g, ''),
    };
  };

  return {
    async putIfAbsent(key, body, { contentType, cacheControl }) {
      const res = await aws.fetch(url(key), {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl, 'If-None-Match': '*' },
        // TS 5.7+ types Uint8Array<ArrayBufferLike> as not BodyInit; it is at runtime
        body: body as BodyInit,
      });
      if (res.ok) return 'created';
      if (res.status !== 412) throw fail('PUT', key, res);
      const existing = await head(key);
      if (!existing) throw new Error(`R2 ${bucket}/${key}: precondition failed but object not found`);
      if (existing.etag !== md5Hex(body)) {
        throw new Error(`Refusing to overwrite ${bucket}/${key}: existing object has different content`);
      }
      return 'identical';
    },

    async put(key, body, { contentType, cacheControl }) {
      const res = await aws.fetch(url(key), {
        method: 'PUT',
        headers: { 'Content-Type': contentType, 'Cache-Control': cacheControl },
        // TS 5.7+ types Uint8Array<ArrayBufferLike> as not BodyInit; it is at runtime
        body: body as BodyInit,
      });
      if (!res.ok) throw fail('PUT', key, res);
    },

    head,

    async get(key) {
      const res = await aws.fetch(url(key), { method: 'GET' });
      if (!res.ok) throw fail('GET', key, res);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
