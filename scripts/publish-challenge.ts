import { d1Query } from './cloudflare/d1';
import { r2Client, type R2Client } from './cloudflare/r2';
import { hashedImageName, insertStatement, toRow, type ChallengeJson, type Mode } from './challenge-rows';
import type { ExistingChallenge } from './generate-common';

const IMMUTABLE = { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' };

type Query = (sql: string, params?: unknown[]) => Promise<unknown[]>;
const defaultQuery: Query = (sql, params) => d1Query(sql, params);

/** This mode's rows for one date: what runDifficulties needs to skip work. */
export async function existingChallenges(mode: Mode, date: string, query: Query = defaultQuery): Promise<ExistingChallenge[]> {
  return (await query('SELECT difficulty, legacy FROM challenges WHERE mode = ? AND date = ?', [mode, date])) as ExistingChallenge[];
}

/** Recent titles for the generator's avoid-list (90 rows ≈ 30 days at three a day). */
export async function recentTitles(mode: Mode, query: Query = defaultQuery): Promise<string[]> {
  const rows = (await query('SELECT title FROM challenges WHERE mode = ? ORDER BY date DESC, difficulty LIMIT 90', [mode])) as { title: string }[];
  return rows.map((r) => r.title);
}

export interface PublishDeps {
  r2: Pick<R2Client, 'putIfAbsent'>;
  query: Query;
}

/**
 * Publishes one generated challenge: target screenshot to R2 under a
 * content-hashed name, THEN the row to D1. The insert is the publish step, so
 * a row never references an image that wasn't stored — any upload failure
 * (HTTP error, network, refusal to overwrite) throws before D1 is touched.
 * An 'identical' upload is a rerun after a failed insert, so it still inserts.
 */
export async function publishChallenge(
  mode: Mode,
  json: ChallengeJson,
  webp: Uint8Array,
  generation: unknown,
  deps: PublishDeps = { r2: r2Client('cssdaily-assets'), query: defaultQuery }
): Promise<{ inserted: boolean; targetImage: string }> {
  const targetImage = hashedImageName(json.date, json.difficulty, webp);
  await deps.r2.putIfAbsent(`targets/${mode}/${targetImage}`, webp, IMMUTABLE);

  const row = toRow(mode, { ...json, targetImage }, { legacy: false, createdAt: Date.now(), generation });
  const { sql, params } = insertStatement([row], { returning: true });
  const inserted = (await deps.query(sql, params)).length === 1;
  if (!inserted) {
    console.log(`::warning::${mode} ${json.date}-${json.difficulty} was already published by another run; kept the existing row`);
  }
  return { inserted, targetImage };
}
