import { readEnv, requireEnv } from './env';
import { sleep, withNetworkRetry } from './errors';

export interface D1QueryOptions {
  /** Overrides the D1_WRITE_TOKEN → D1_READ_TOKEN fallback. */
  token?: string;
  env?: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  /** Retries for 429/5xx before giving up. */
  retries?: number;
  retryDelayMs?: number;
}

interface D1ApiResponse<T> {
  success?: boolean;
  errors?: { code?: number; message?: string }[];
  result?: { success?: boolean; results?: T[] }[];
}


/**
 * Runs one SQL statement through the D1 REST API and returns its rows.
 * Throws on any HTTP failure or `success: false`, with the API's messages
 * (never the token).
 */
export async function d1Query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  opts: D1QueryOptions = {}
): Promise<T[]> {
  const env = opts.env ?? process.env;
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID', env);
  const databaseId = requireEnv('D1_DATABASE_ID', env);
  const token = opts.token ?? readEnv('D1_WRITE_TOKEN', env) ?? readEnv('D1_READ_TOKEN', env);
  if (!token) throw new Error('D1_WRITE_TOKEN or D1_READ_TOKEN is required');

  const doFetch = opts.fetch ?? fetch;
  const retries = opts.retries ?? 3;
  const retryDelayMs = opts.retryDelayMs ?? 500;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  for (let attempt = 0; ; attempt++) {
    // A dropped connection never reached D1's response, so resending is safe
    // for reads; inserts are ON CONFLICT DO NOTHING, so a duplicate is a no-op.
    const res = await withNetworkRetry(() => doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    }), retries, retryDelayMs);
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(retryDelayMs * 2 ** attempt);
      continue;
    }

    let payload: D1ApiResponse<T> | null = null;
    try {
      payload = (await res.json()) as D1ApiResponse<T>;
    } catch {
      // Non-JSON body (e.g. an HTML error page) — reported below
    }
    const first = payload?.result?.[0];
    if (!res.ok || !payload?.success || !first || first.success === false) {
      const messages = payload?.errors?.map((e) => e.message).filter(Boolean).join('; ');
      throw new Error(`D1 query failed (HTTP ${res.status})${messages ? `: ${messages}` : ''}`);
    }
    return first.results ?? [];
  }
}
