/**
 * Node's fetch reports transport failures (dropped keep-alive sockets, DNS,
 * TLS) as a bare "TypeError: fetch failed"; the actual reason sits in
 * `cause`. These helpers surface it and decide what's safe to retry.
 */
export function describeError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof Error) {
      const code = (current as { code?: string }).code;
      parts.push(`${current.message}${code ? ` (${code})` : ''}`);
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.join(' ← ');
}

/** A request that never got an HTTP response — retryable when the operation is idempotent. */
export const isNetworkError = (err: unknown): boolean =>
  err instanceof TypeError && /fetch failed|network|socket|terminated/i.test(err.message);

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retries `fn` on network errors only (HTTP failures are handled by the
 * callers' own status checks). Exponential backoff with jitter.
 */
export async function withNetworkRetry<T>(fn: () => Promise<T>, retries = 3, baseMs = 300): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isNetworkError(err) || attempt >= retries) throw err;
      await sleep(baseMs * 2 ** attempt * (0.5 + Math.random()));
    }
  }
}
