/**
 * Publishes the public data snapshot (<asset base>/data/challenges.json)
 * from the .data/ directory a deploy just built from, so the snapshot always
 * matches the live site. Run by the Deploy workflow only, inside its
 * production lock, so publishes never race.
 *
 *   npx tsx scripts/publish-snapshot.ts --source-sha <sha> [--data-dir <dir>]
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { r2Client, type R2Client } from './cloudflare/r2';
import { describeError } from './cloudflare/errors';
import { MODES, type ChallengeJson } from './challenge-rows';
import { DEFAULT_DATA_DIR, type Snapshot } from './data-pull';

export function buildSnapshot(dataDir: string, sourceSha: string | null, now = new Date()): Snapshot {
  const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, 'manifest.json'), 'utf8')) as { legacy: string[] };
  const byMode = Object.fromEntries(
    MODES.map((mode) => {
      const dir = path.join(dataDir, mode);
      const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort() : [];
      if (files.length === 0) throw new Error(`Refusing to publish a snapshot with no ${mode} challenges`);
      return [mode, files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ChallengeJson)];
    })
  ) as Record<'css' | 'tailwind', ChallengeJson[]>;
  return { generatedAt: now.toISOString(), sourceSha, ...byMode, legacy: manifest.legacy ?? [] };
}

export async function publishSnapshot(snapshot: Snapshot, client: Pick<R2Client, 'put'> = r2Client('cssdaily-assets')) {
  await client.put('data/challenges.json', JSON.stringify(snapshot), {
    contentType: 'application/json',
    cacheControl: 'public, max-age=300',
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const shaAt = argv.indexOf('--source-sha');
  const dirAt = argv.indexOf('--data-dir');
  const sourceSha = shaAt >= 0 ? argv[shaAt + 1] ?? null : null;
  const dataDir = dirAt >= 0 && argv[dirAt + 1] ? path.resolve(argv[dirAt + 1]) : DEFAULT_DATA_DIR;
  const snapshot = buildSnapshot(dataDir, sourceSha);
  await publishSnapshot(snapshot);
  console.log(`Published snapshot: css ${snapshot.css.length}, tailwind ${snapshot.tailwind.length}, source ${sourceSha ?? 'unknown'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(describeError(err));
    process.exitCode = 1;
  });
}
