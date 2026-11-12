export interface Play {
  mode: 'css' | 'tailwind';
  date: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export const MAX_PLAY_BYTES = 512;
const KEYS = ['mode', 'date', 'difficulty'];

/** Validates a play body; anything unexpected (extra keys included) is rejected. */
export function parsePlay(body: unknown): Play | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== KEYS.length || !KEYS.every((k) => k in record)) return null;
  const { mode, date, difficulty } = record;
  if (mode !== 'css' && mode !== 'tailwind') return null;
  if (difficulty !== 'easy' && difficulty !== 'medium' && difficulty !== 'hard') return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { mode, date, difficulty };
}

/** True only when the request came from this origin: a beacon's text/plain body is CORS-safelisted, so foreign pages could otherwise post. */
export function isSameOrigin(originHeader: string | null, requestUrl: string): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Reads at most `limit` bytes from a body stream; returns null when it's
 * larger (stops reading — never buffers an oversize body).
 */
export async function readLimited(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string | null> {
  if (!body) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return new TextDecoder().decode(merged);
}

export const UPSERT_PLAY_SQL =
  'INSERT INTO plays (mode, date, difficulty, day, count) VALUES (?, ?, ?, ?, 1) ' +
  'ON CONFLICT (mode, date, difficulty, day) DO UPDATE SET count = count + 1';

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
