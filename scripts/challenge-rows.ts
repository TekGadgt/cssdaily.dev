import { createHash } from 'crypto';
import type { Difficulty } from '../src/utils/types';

export type Mode = 'css' | 'tailwind';
export const MODES: Mode[] = ['css', 'tailwind'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** A challenge exactly as the site consumes it (and as the repo files stored it). */
export interface ChallengeJson {
  title: string;
  difficulty: Difficulty;
  date: string;
  timeLimit: number;
  starter: Record<string, string>;
  target: Record<string, string>;
  targetImage: string;
}

/** One row of the D1 `challenges` table (migrations/0001_challenges.sql). */
export interface ChallengeRow {
  mode: Mode;
  date: string;
  difficulty: Difficulty;
  title: string;
  time_limit: number;
  target_image: string;
  /** JSON {"starter":…,"target":…} */
  body: string;
  legacy: 0 | 1;
  generation: string | null;
  created_at: number;
}

export const ROW_COLUMNS = [
  'mode', 'date', 'difficulty', 'title', 'time_limit',
  'target_image', 'body', 'legacy', 'generation', 'created_at',
] as const satisfies readonly (keyof ChallengeRow)[];

const JSON_KEYS = new Set(['title', 'difficulty', 'date', 'timeLimit', 'starter', 'target', 'targetImage']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maps a challenge to its row. Throws on anything the row can't represent —
 * an unknown top-level key would otherwise be silently dropped, and this
 * mapping is what the migration's losslessness rests on.
 */
export function toRow(
  mode: Mode,
  json: ChallengeJson,
  meta: { legacy: boolean; createdAt: number; generation?: unknown }
): ChallengeRow {
  const extra = Object.keys(json).filter((k) => !JSON_KEYS.has(k));
  if (extra.length) throw new Error(`${mode} ${json.date}: unexpected keys ${extra.join(', ')}`);
  if (!DATE_RE.test(json.date)) throw new Error(`${mode}: bad date ${json.date}`);
  if (!DIFFICULTIES.includes(json.difficulty)) throw new Error(`${mode} ${json.date}: bad difficulty ${json.difficulty}`);
  if (!json.title || !json.targetImage || !Number.isInteger(json.timeLimit)) {
    throw new Error(`${mode} ${json.date}-${json.difficulty}: missing title, targetImage, or timeLimit`);
  }
  if (!json.starter || !json.target) throw new Error(`${mode} ${json.date}-${json.difficulty}: missing starter/target`);
  return {
    mode,
    date: json.date,
    difficulty: json.difficulty,
    title: json.title,
    time_limit: json.timeLimit,
    target_image: json.targetImage,
    body: JSON.stringify({ starter: json.starter, target: json.target }),
    legacy: meta.legacy ? 1 : 0,
    generation: meta.generation === undefined ? null : JSON.stringify(meta.generation),
    created_at: meta.createdAt,
  };
}

/**
 * Rebuilds the challenge from its row, in the key order each mode's
 * generator has always written (so restored files match the originals).
 */
export function fromRow(row: Pick<ChallengeRow, 'mode' | 'date' | 'difficulty' | 'title' | 'time_limit' | 'target_image' | 'body'>): ChallengeJson {
  const { starter, target } = JSON.parse(row.body) as Pick<ChallengeJson, 'starter' | 'target'>;
  const common = { title: row.title, difficulty: row.difficulty };
  return row.mode === 'css'
    ? { ...common, target, starter, date: row.date, timeLimit: row.time_limit, targetImage: row.target_image }
    : { ...common, date: row.date, timeLimit: row.time_limit, starter, target, targetImage: row.target_image };
}

/** The generators' file format: 2-space JSON, no trailing newline. */
export const serializeChallenge = (json: ChallengeJson) => JSON.stringify(json, null, 2);

/** Unsuffixed `YYYY-MM-DD.json`: a day from before multiple difficulties. */
export const isLegacyFileName = (file: string) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file);

/** The repo file name a row came from (or would be restored to). */
export const repoFileName = (row: Pick<ChallengeRow, 'date' | 'difficulty' | 'legacy'>) =>
  row.legacy ? `${row.date}.json` : `${row.date}-${row.difficulty}.json`;

/**
 * Content-addressed target name: a regenerated target gets a new URL, so
 * immutable caching is always safe and published objects never change.
 */
export function hashedImageName(date: string, difficulty: Difficulty, webp: Uint8Array): string {
  const hash = createHash('sha256').update(webp).digest('hex').slice(0, 12);
  return `${date}-${difficulty}-${hash}.webp`;
}
