/**
 * One-time import of the repo's challenge data into D1 + R2, then exhaustive
 * verification. Idempotent: images are create-if-absent (identical bytes are
 * a no-op, different bytes abort) and rows are INSERT … ON CONFLICT DO
 * NOTHING, so it can be rerun for the frozen catch-up before the switch.
 *
 *   npm run data:import              import, verify, publish the first snapshot
 *   npm run data:import -- --dry-run verify only; writes nothing remote
 *
 * Writes import-report-<sha7>.json (gitignored) and exits 1 on any failure.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import { d1Query } from './cloudflare/d1';
import { md5Hex, r2Client } from './cloudflare/r2';
import { MODES, ROW_COLUMNS, isLegacyFileName, toRow, type ChallengeJson, type ChallengeRow, type Mode } from './challenge-rows';
import { REPO_DIRS, challengeKey, pullFromD1, writeDataLayout } from './data-pull';
import { buildSnapshot, publishSnapshot } from './publish-snapshot';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMMUTABLE = { contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable' };
// D1 allows 100 bound parameters per statement: 10 columns × 10 rows.
const MAX_ROWS_PER_INSERT = Math.floor(100 / ROW_COLUMNS.length);
// Keep each statement's payload modest (hard targets are ~16 KB each).
const MAX_INSERT_BYTES = 90_000;
const IMAGE_CONCURRENCY = 8;

interface Source {
  mode: Mode;
  file: string;
  json: ChallengeJson;
  legacy: boolean;
  imageKey: string;
  image: Uint8Array;
}

const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function readSources(): Source[] {
  const sources: Source[] = [];
  for (const mode of MODES) {
    const dir = path.join(ROOT, REPO_DIRS[mode].json);
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as ChallengeJson;
      const legacy = isLegacyFileName(file);
      toRow(mode, json, { legacy, createdAt: 0 }); // validate before touching anything remote
      const imagePath = path.join(ROOT, REPO_DIRS[mode].images, json.targetImage);
      if (!fs.existsSync(imagePath)) throw new Error(`${mode}/${file}: target image missing at ${path.relative(ROOT, imagePath)}`);
      sources.push({ mode, file, json, legacy, imageKey: `targets/${mode}/${json.targetImage}`, image: fs.readFileSync(imagePath) });
    }
  }
  const keys = new Set(sources.map((s) => challengeKey(s.mode, s.json)));
  if (keys.size !== sources.length) throw new Error('Duplicate (mode, date, difficulty) in the repo data');
  return sources;
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Groups rows into multi-row INSERTs within the parameter and size limits. */
export function insertBatches(rows: ChallengeRow[]): ChallengeRow[][] {
  const batches: ChallengeRow[][] = [];
  let current: ChallengeRow[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = row.body.length + row.title.length + 200;
    if (current.length && (current.length === MAX_ROWS_PER_INSERT || bytes + size > MAX_INSERT_BYTES)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function insertStatement(batch: ChallengeRow[]): { sql: string; params: unknown[] } {
  const placeholders = `(${ROW_COLUMNS.map(() => '?').join(', ')})`;
  return {
    sql: `INSERT INTO challenges (${ROW_COLUMNS.join(', ')}) VALUES ${batch.map(() => placeholders).join(', ')} ON CONFLICT DO NOTHING`,
    params: batch.flatMap((row) => ROW_COLUMNS.map((c) => row[c])),
  };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const unknown = process.argv.slice(2).filter((a) => a !== '--dry-run');
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`);

  // 1. Freeze: the report must name exactly the tree that was imported.
  const sha = git('rev-parse', 'HEAD');
  const dirty = git('status', '--porcelain', '--', 'src/data/challenges', 'src/data/tailwind-challenges', 'public/targets');
  if (dirty) throw new Error(`Uncommitted changes under the challenge data; commit or discard them first:\n${dirty}`);

  const sources = readSources();
  const counts = Object.fromEntries(MODES.map((m) => [m, sources.filter((s) => s.mode === m).length]));
  console.log(`Source ${sha.slice(0, 7)}: css ${counts.css}, tailwind ${counts.tailwind}${dryRun ? ' (dry run)' : ''}`);

  const r2 = r2Client('cssdaily-assets');
  const failures: string[] = [];
  const imageResults = { created: 0, identical: 0 };

  if (!dryRun) {
    // 2. Images first: a row must never reference a missing image.
    await pool(sources, IMAGE_CONCURRENCY, async (s) => {
      const result = await r2.putIfAbsent(s.imageKey, s.image, IMMUTABLE); // throws on overwrite attempt
      imageResults[result]++;
    });
    console.log(`Images: ${imageResults.created} uploaded, ${imageResults.identical} already present`);

    // 3. Rows.
    const createdAt = Date.now();
    const rows = sources.map((s) => toRow(s.mode, s.json, { legacy: s.legacy, createdAt }));
    for (const batch of insertBatches(rows)) {
      const { sql, params } = insertStatement(batch);
      await d1Query(sql, params);
    }
    console.log(`Rows: ${rows.length} inserted or already present`);
  }

  // 4. Exhaustive verification — every row, every image.
  const pulled = await pullFromD1();
  const byKey = new Map(pulled.map((p) => [challengeKey(p.mode, p.json), p]));
  const sourceKeys = new Set(sources.map((s) => challengeKey(s.mode, s.json)));
  for (const s of sources) {
    const key = challengeKey(s.mode, s.json);
    const row = byKey.get(key);
    if (!row) { failures.push(`${key}: no row in D1`); continue; }
    if (!isDeepStrictEqual(row.json, s.json)) failures.push(`${key}: row content differs from ${s.file}`);
    if (row.legacy !== s.legacy) failures.push(`${key}: legacy ${row.legacy}, expected ${s.legacy}`);
  }
  for (const key of byKey.keys()) {
    if (!sourceKeys.has(key)) failures.push(`${key}: row in D1 has no source file`);
  }
  let imagesVerified = 0;
  await pool(sources, IMAGE_CONCURRENCY, async (s) => {
    const meta = await r2.head(s.imageKey);
    if (!meta) failures.push(`${s.imageKey}: missing in R2`);
    else if (meta.size !== s.image.length) failures.push(`${s.imageKey}: size ${meta.size}, expected ${s.image.length}`);
    else if (meta.etag !== md5Hex(s.image)) failures.push(`${s.imageKey}: checksum differs`);
    else imagesVerified++;
  });

  // 5. First public snapshot, from exactly the verified data (later deploys replace it).
  let snapshotPublished = false;
  if (!dryRun && failures.length === 0) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cssdaily-import-'));
    try {
      writeDataLayout(pulled, tmp, 'd1');
      await publishSnapshot(buildSnapshot(tmp, sha));
      snapshotPublished = true;
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  // 6. Report.
  const report = {
    sourceSha: sha,
    dryRun,
    finishedAt: new Date().toISOString(),
    sourceCounts: counts,
    d1Rows: pulled.length,
    images: { ...imageResults, verified: imagesVerified },
    snapshotPublished,
    failures,
  };
  const reportPath = path.join(ROOT, `import-report-${sha.slice(0, 7)}${dryRun ? '-dry-run' : ''}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`D1 rows: ${pulled.length}; images verified: ${imagesVerified}/${sources.length}`);
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  if (failures.length) {
    console.error(`${failures.length} verification failure(s):\n${failures.slice(0, 20).join('\n')}${failures.length > 20 ? '\n…' : ''}`);
    process.exitCode = 1;
  } else {
    console.log(dryRun ? 'Dry run complete (nothing written).' : 'Import verified with zero failures.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
