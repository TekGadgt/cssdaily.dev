/**
 * Weekly backup to the PRIVATE cssdaily-backups bucket (no public domain,
 * its own credentials): the full D1 export plus every target image, with a
 * checksum manifest. Each run also rehearses a restore — the export is
 * loaded into a throwaway local D1 and its row count must match production —
 * so a broken backup fails the run when it is made, not when it is needed.
 *
 *   npx tsx scripts/backup.ts
 *
 * Needs CLOUDFLARE_ACCOUNT_ID, D1_DATABASE_ID, D1_WRITE_TOKEN (wrangler's
 * export requires D1 write), R2_BACKUP_ACCESS_KEY_ID/SECRET. Images are read
 * from the public asset URL, whose ETag is the object's MD5.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { d1Query } from './cloudflare/d1';
import { requireEnv } from './cloudflare/env';
import { describeError, withNetworkRetry } from './cloudflare/errors';
import { md5Hex, r2Client, type R2Client } from './cloudflare/r2';
import { assetBase } from './data-pull';

export const KEEP_EXPORTS = 12;
const CONCURRENCY = 8;
const NO_STORE = 'no-store';

/** Old dated objects to prune: everything but the newest `keep` (keys sort by date). */
export function keysToPrune(keys: string[], keep: number): string[] {
  return [...keys].sort().slice(0, Math.max(0, keys.length - keep));
}

/** Image backup keys mirror the assets bucket layout. */
export const imageKey = (row: { mode: string; target_image: string }) => `targets/${row.mode}/${row.target_image}`;

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

function wrangler(args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync('npx', ['wrangler', ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Copies an image from the public URL into the backup, verified by MD5. Returns its MD5. */
async function backupImage(backups: R2Client, base: string, key: string): Promise<string> {
  const existing = await backups.head(key);
  if (existing) return existing.etag;
  const res = await withNetworkRetry(() => fetch(`${base}/${key}`));
  if (!res.ok) throw new Error(`${key}: download HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const md5 = md5Hex(bytes);
  const etag = (res.headers.get('etag') ?? '').replace(/"/g, '');
  if (/^[0-9a-f]{32}$/.test(etag) && etag !== md5) throw new Error(`${key}: downloaded bytes don't match the source checksum`);
  await backups.putIfAbsent(key, bytes, { contentType: 'image/webp', cacheControl: NO_STORE });
  return md5;
}

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  const accountId = requireEnv('CLOUDFLARE_ACCOUNT_ID');
  const d1Token = requireEnv('D1_WRITE_TOKEN');
  const backups = r2Client('cssdaily-backups');
  const base = assetBase();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cssdaily-backup-'));
  const failures: string[] = [];

  try {
    // 1. Row inventory (what the export and the image copy must cover)
    const rows = await d1Query<{ mode: string; target_image: string }>('SELECT mode, target_image FROM challenges');
    console.log(`D1: ${rows.length} challenges`);

    // 2. Export (wrangler needs D1 write for export; it briefly locks the database)
    const sqlPath = path.join(tmp, 'd1.sql');
    wrangler(['d1', 'export', 'cssdaily', '--remote', '--output', sqlPath], { ...process.env, CLOUDFLARE_API_TOKEN: d1Token, CLOUDFLARE_ACCOUNT_ID: accountId });
    const sql = fs.readFileSync(sqlPath);

    // 3. Restore rehearsal into a throwaway local D1
    const state = path.join(tmp, 'restore-state');
    const localEnv = { ...process.env, CLOUDFLARE_API_TOKEN: '' };
    wrangler(['d1', 'execute', 'cssdaily', '--local', '--persist-to', state, '--file', sqlPath], localEnv);
    const restored = JSON.parse(wrangler(['d1', 'execute', 'cssdaily', '--local', '--persist-to', state, '--json', '--command', 'SELECT COUNT(*) AS n FROM challenges'], localEnv));
    const restoredCount = restored[0]?.results?.[0]?.n;
    if (restoredCount !== rows.length) failures.push(`restore rehearsal: ${restoredCount} rows restored, expected ${rows.length}`);
    else console.log(`Restore rehearsal: ${restoredCount} rows restored from the export`);

    // 4. Store the export
    const sqlKey = `d1/${date}.sql`;
    await backups.put(sqlKey, sql, { contentType: 'application/sql', cacheControl: NO_STORE });

    // 5. Images: copy anything not yet backed up, verified against the source MD5
    const images: Record<string, string> = {};
    await pool(rows, CONCURRENCY, async (row) => {
      const key = imageKey(row);
      try {
        images[key] = await backupImage(backups, base, key);
      } catch (err) {
        failures.push(`${key}: ${describeError(err)}`);
      }
    });
    console.log(`Images: ${Object.keys(images).length} backed up`);

    // 6. Manifest
    const manifest = {
      date,
      d1: { key: sqlKey, bytes: sql.length, md5: createHash('md5').update(sql).digest('hex'), rows: rows.length, restoredRows: restoredCount },
      images,
      failures,
    };
    await backups.put(`manifests/${date}.json`, JSON.stringify(manifest, null, 2), { contentType: 'application/json', cacheControl: NO_STORE });

    // 7. Retention: last KEEP_EXPORTS exports and manifests; images are kept forever
    if (failures.length === 0) {
      for (const prefix of ['d1/', 'manifests/']) {
        for (const key of keysToPrune(await backups.list(prefix), KEEP_EXPORTS)) await backups.delete(key);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`${failures.length} backup failure(s):\n${failures.slice(0, 20).join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log(`Backup ${date} complete.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(describeError(err));
    process.exitCode = 1;
  });
}
