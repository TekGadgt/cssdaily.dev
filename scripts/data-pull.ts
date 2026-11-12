/**
 * Pulls every challenge into local files.
 *
 *   npm run data:pull -- [--require-d1] [--layout data|repo] [--with-images] [--out <dir>]
 *
 * Source: D1 when a D1 token is set; otherwise the public snapshot at
 * <PUBLIC_ASSET_BASE>/data/challenges.json, so contributors need no
 * credentials. --require-d1 (CI, rollback) refuses that fallback.
 *
 * Layouts:
 *   data (default) .data/challenges/<mode>/<date>-<difficulty>.json + manifest.json — what the site builds from
 *   repo           src/data/challenges + src/data/tailwind-challenges under the
 *                  original file names — rollback only (see the Phase 2 plan, Task 9)
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { d1Query } from './cloudflare/d1';
import { describeError } from './cloudflare/errors';
import { readEnv } from './cloudflare/env';
import { md5Hex, r2Client } from './cloudflare/r2';
import {
  MODES, fromRow, repoFileName, serializeChallenge, toRow,
  type ChallengeJson, type ChallengeRow, type Mode,
} from './challenge-rows';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ASSET_BASE = 'https://assets.cssdaily.dev';
export const DEFAULT_DATA_DIR = path.join(ROOT, '.data', 'challenges');
const PAGE_SIZE = 200;

export interface PulledChallenge {
  mode: Mode;
  json: ChallengeJson;
  legacy: boolean;
}

/** Public snapshot format, written by publish-snapshot.ts after each deploy. */
export interface Snapshot {
  generatedAt: string;
  sourceSha: string | null;
  css: ChallengeJson[];
  tailwind: ChallengeJson[];
  /** `<mode>:<date>:<difficulty>` of legacy (unsuffixed, pre-multi-difficulty) rows */
  legacy: string[];
}

export const challengeKey = (mode: Mode, json: Pick<ChallengeJson, 'date' | 'difficulty'>) =>
  `${mode}:${json.date}:${json.difficulty}`;

export function assetBase(env: NodeJS.ProcessEnv = process.env): string {
  return (readEnv('PUBLIC_ASSET_BASE', env) ?? DEFAULT_ASSET_BASE).replace(/\/+$/, '');
}

export function selectSource(env: NodeJS.ProcessEnv, requireD1: boolean): 'd1' | 'snapshot' {
  if (readEnv('D1_WRITE_TOKEN', env) ?? readEnv('D1_READ_TOKEN', env)) return 'd1';
  if (requireD1) throw new Error('--require-d1: set D1_READ_TOKEN (or D1_WRITE_TOKEN), CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID');
  return 'snapshot';
}

type Query = (sql: string, params?: unknown[]) => Promise<ChallengeRow[]>;
type RowPick = Pick<ChallengeRow, 'mode' | 'date' | 'difficulty' | 'title' | 'time_limit' | 'target_image' | 'body' | 'legacy'>;

/**
 * Keyset pagination on the primary key: rows inserted mid-pull can't make
 * existing rows be skipped or repeated (OFFSET paging could).
 */
export async function pullFromD1(query: Query = (sql, params) => d1Query<ChallengeRow>(sql, params)): Promise<PulledChallenge[]> {
  const columns = 'mode, date, difficulty, title, time_limit, target_image, body, legacy';
  const out: PulledChallenge[] = [];
  let cursor: [string, string, string] | null = null;
  for (;;) {
    const rows: RowPick[] = cursor
      ? await query(`SELECT ${columns} FROM challenges WHERE (mode, date, difficulty) > (?, ?, ?) ORDER BY mode, date, difficulty LIMIT ${PAGE_SIZE}`, cursor)
      : await query(`SELECT ${columns} FROM challenges ORDER BY mode, date, difficulty LIMIT ${PAGE_SIZE}`);
    for (const row of rows) out.push({ mode: row.mode, json: fromRow(row), legacy: row.legacy === 1 });
    if (rows.length < PAGE_SIZE) return out;
    const last = rows[rows.length - 1];
    cursor = [last.mode, last.date, last.difficulty];
  }
}

export function readSnapshot(snapshot: Snapshot): PulledChallenge[] {
  if (!Array.isArray(snapshot?.css) || !Array.isArray(snapshot?.tailwind) || !Array.isArray(snapshot?.legacy)) {
    throw new Error('Snapshot is malformed (expected css, tailwind and legacy arrays)');
  }
  const legacy = new Set(snapshot.legacy);
  return MODES.flatMap((mode) =>
    snapshot[mode].map((json) => ({ mode, json, legacy: legacy.has(challengeKey(mode, json)) }))
  );
}

export async function pullFromSnapshot(base: string, fetchFn: typeof fetch = fetch): Promise<PulledChallenge[]> {
  const url = `${base}/data/challenges.json`;
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`Snapshot download failed: ${url} → HTTP ${res.status}`);
  return readSnapshot((await res.json()) as Snapshot);
}

/** Every challenge must map back to a valid row, keys must be unique, and neither mode may be empty. */
export function validate(challenges: PulledChallenge[]): void {
  const seen = new Set<string>();
  for (const c of challenges) {
    toRow(c.mode, c.json, { legacy: c.legacy, createdAt: 0 }); // throws on malformed input
    const key = challengeKey(c.mode, c.json);
    if (seen.has(key)) throw new Error(`Duplicate challenge ${key}`);
    seen.add(key);
  }
  for (const mode of MODES) {
    if (!challenges.some((c) => c.mode === mode)) throw new Error(`No ${mode} challenges pulled`);
  }
}

export function writeDataLayout(challenges: PulledChallenge[], outDir: string, source: string): void {
  for (const mode of MODES) {
    const dir = path.join(outDir, mode);
    fs.rmSync(dir, { recursive: true, force: true }); // rows removed upstream must not linger
    fs.mkdirSync(dir, { recursive: true });
  }
  for (const { mode, json } of challenges) {
    fs.writeFileSync(path.join(outDir, mode, `${json.date}-${json.difficulty}.json`), serializeChallenge(json));
  }
  const legacy = challenges.filter((c) => c.legacy).map((c) => challengeKey(c.mode, c.json)).sort();
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ source, pulledAt: new Date().toISOString(), legacy }, null, 2)
  );
}

export const REPO_DIRS: Record<Mode, { json: string; images: string }> = {
  css: { json: path.join('src', 'data', 'challenges'), images: path.join('public', 'targets') },
  tailwind: { json: path.join('src', 'data', 'tailwind-challenges'), images: path.join('public', 'targets', 'tailwind') },
};

export function writeRepoLayout(challenges: PulledChallenge[], rootDir: string): void {
  for (const mode of MODES) {
    const dir = path.join(rootDir, REPO_DIRS[mode].json);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) fs.rmSync(path.join(dir, f));
  }
  for (const { mode, json, legacy } of challenges) {
    const name = repoFileName({ date: json.date, difficulty: json.difficulty, legacy: legacy ? 1 : 0 });
    fs.writeFileSync(path.join(rootDir, REPO_DIRS[mode].json, name), serializeChallenge(json));
  }
}

/** Rollback: download every referenced target, verified against R2's ETag (MD5). */
async function downloadImages(challenges: PulledChallenge[], rootDir: string): Promise<void> {
  const r2 = r2Client('cssdaily-assets');
  for (const { mode, json } of challenges) {
    const key = `targets/${mode}/${json.targetImage}`;
    const meta = await r2.head(key);
    if (!meta) throw new Error(`Missing image in R2: ${key}`);
    const bytes = await r2.get(key);
    if (md5Hex(bytes) !== meta.etag) throw new Error(`Checksum mismatch downloading ${key}`);
    const dir = path.join(rootDir, REPO_DIRS[mode].images);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, json.targetImage), bytes);
  }
}

interface Args { requireD1: boolean; layout: 'data' | 'repo'; withImages: boolean; out: string }

export function parseArgs(argv: string[]): Args {
  const args: Args = { requireD1: false, layout: 'data', withImages: false, out: DEFAULT_DATA_DIR };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--require-d1') args.requireD1 = true;
    else if (a === '--with-images') args.withImages = true;
    else if (a === '--layout' && (argv[i + 1] === 'data' || argv[i + 1] === 'repo')) args.layout = argv[++i] as Args['layout'];
    else if (a === '--out' && argv[i + 1]) args.out = path.resolve(argv[++i]);
    else throw new Error(`Unknown or incomplete argument: ${a}`);
  }
  if (args.layout === 'repo' && !args.requireD1) throw new Error('--layout repo restores production data and requires --require-d1');
  if (args.withImages && args.layout !== 'repo') throw new Error('--with-images is only for --layout repo');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = selectSource(process.env, args.requireD1);
  const challenges = source === 'd1' ? await pullFromD1() : await pullFromSnapshot(assetBase());
  validate(challenges);

  if (args.layout === 'repo') {
    writeRepoLayout(challenges, ROOT);
    if (args.withImages) await downloadImages(challenges, ROOT);
  } else {
    writeDataLayout(challenges, args.out, source);
  }
  const counts = MODES.map((m) => `${m} ${challenges.filter((c) => c.mode === m).length}`).join(', ');
  console.log(`Pulled ${counts} from ${source === 'd1' ? 'D1' : 'the public snapshot'} → ${args.layout === 'repo' ? 'repo layout' : path.relative(ROOT, args.out)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(describeError(err));
    process.exitCode = 1;
  });
}
