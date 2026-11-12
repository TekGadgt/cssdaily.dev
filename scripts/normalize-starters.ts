/**
 * One-off backfill: rewrites every CSS challenge's starter CSS in D1 to the
 * canonical layout (scripts/starter-css.ts). Dry run unless --apply.
 *
 *   npx tsx scripts/normalize-starters.ts [--apply] [--backup <file>]
 *
 * Guarantees: only starter.css changes, and only in whitespace (plus any
 * reported stray "}"); each UPDATE is conditional on the row being unchanged
 * since it was read; originals are written to --backup before any write.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { isDeepStrictEqual } from 'util';
import { pathToFileURL } from 'url';
import { d1Query } from './cloudflare/d1';
import { describeError } from './cloudflare/errors';
import { normalizeStarterCssDetailed, sameIgnoringWhitespace } from './starter-css';

interface Row { date: string; difficulty: string; body: string }

export interface Plan {
  key: string;
  date: string;
  difficulty: string;
  oldBody: string;
  newBody: string;
  strayBraces: number;
}

/** Pure: the new body for one row, or null when already canonical. Throws on anything but a starter-CSS whitespace change. */
export function planRow(row: Row): Plan | null {
  const body = JSON.parse(row.body) as { starter: { css: string } & Record<string, unknown> } & Record<string, unknown>;
  const { css, strayBraces } = normalizeStarterCssDetailed(body.starter.css, { dropStrayBraces: true });
  if (css === body.starter.css) return null;
  if (!sameIgnoringWhitespace(css, body.starter.css, strayBraces)) throw new Error(`${row.date}-${row.difficulty}: non-whitespace change`);
  const next = { ...body, starter: { ...body.starter, css } };
  // Everything except starter.css must be untouched
  const strip = (b: typeof body) => ({ ...b, starter: { ...b.starter, css: '' } });
  if (!isDeepStrictEqual(strip(next), strip(body))) throw new Error(`${row.date}-${row.difficulty}: unexpected body change`);
  return { key: `css:${row.date}:${row.difficulty}`, date: row.date, difficulty: row.difficulty, oldBody: row.body, newBody: JSON.stringify(next), strayBraces };
}

async function readRows(): Promise<Row[]> {
  const rows: Row[] = [];
  let cursor: [string, string] | null = null;
  for (;;) {
    const page: Row[] = cursor
      ? await d1Query<Row>("SELECT date, difficulty, body FROM challenges WHERE mode = 'css' AND (date, difficulty) > (?, ?) ORDER BY date, difficulty LIMIT 200", cursor)
      : await d1Query<Row>("SELECT date, difficulty, body FROM challenges WHERE mode = 'css' ORDER BY date, difficulty LIMIT 200");
    rows.push(...page);
    if (page.length < 200) return rows;
    cursor = [page[page.length - 1].date, page[page.length - 1].difficulty];
  }
}

async function main() {
  const apply = process.argv.includes('--apply');
  const backupAt = process.argv.indexOf('--backup');
  const backupPath = backupAt >= 0 ? process.argv[backupAt + 1] : 'starter-css-backup.json';

  const rows = await readRows();
  const plans = rows.map(planRow).filter((p): p is Plan => p !== null);
  const strays = plans.filter((p) => p.strayBraces).map((p) => `${p.key} (${p.strayBraces})`);
  console.log(`CSS challenges: ${rows.length}; to rewrite: ${plans.length}; stray "}" removed: ${strays.length ? strays.join(', ') : 'none'}`);
  if (plans[0]) {
    const sample = JSON.parse(plans[0].newBody).starter.css as string;
    console.log(`Sample (${plans[0].key}), last lines:\n${sample.trimEnd().split('\n').slice(-7).join('\n')}`);
  }
  if (!apply) {
    console.log('Dry run — nothing written. Re-run with --apply.');
    return;
  }

  fs.writeFileSync(backupPath, JSON.stringify(plans.map(({ key, oldBody }) => ({ key, oldBody })), null, 1));
  console.log(`Originals saved to ${backupPath}`);

  let updated = 0;
  const conflicts: string[] = [];
  for (const p of plans) {
    // Conditional on the body we read: a concurrent change is never overwritten
    const res = await d1Query("UPDATE challenges SET body = ? WHERE mode = 'css' AND date = ? AND difficulty = ? AND body = ? RETURNING date", [p.newBody, p.date, p.difficulty, p.oldBody]);
    if (res.length === 1) updated++;
    else conflicts.push(p.key);
  }

  const after = await readRows();
  const stillOff = after.map(planRow).filter((p) => p !== null).length;
  console.log(`Updated ${updated}/${plans.length}; conflicts: ${conflicts.length ? conflicts.join(', ') : 'none'}; non-canonical after: ${stillOff}`);
  if (conflicts.length || stillOff) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(describeError(err));
    process.exitCode = 1;
  });
}
