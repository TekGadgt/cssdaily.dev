import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { isLegacyFileName, toRow, MODES, type ChallengeJson, type ChallengeRow } from './challenge-rows';
import { md5Hex } from './cloudflare/r2';
import {
  assetBase, downloadImages, parseArgs, pullFromD1, pullFromSnapshot, readSnapshot, selectSource, validate,
  writeDataLayout, writeRepoLayout, type PulledChallenge,
} from './data-pull';
import { buildSnapshot, publishSnapshot } from './publish-snapshot';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'challenges');

const fixtures: (PulledChallenge & { file: string; raw: string })[] = MODES.flatMap((mode) =>
  fs.readdirSync(path.join(FIXTURES, mode)).sort().map((file) => {
    const raw = fs.readFileSync(path.join(FIXTURES, mode, file), 'utf8');
    return { mode, json: JSON.parse(raw) as ChallengeJson, legacy: isLegacyFileName(file), file, raw };
  })
);
const pulled = (): PulledChallenge[] => fixtures.map(({ mode, json, legacy }) => ({ mode, json, legacy }));
const rows = (): ChallengeRow[] =>
  fixtures
    .map((f) => toRow(f.mode, f.json, { legacy: f.legacy, createdAt: 1 }))
    .sort((a, b) => `${a.mode}${a.date}${a.difficulty}`.localeCompare(`${b.mode}${b.date}${b.difficulty}`));

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'data-pull-')); });
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('source selection', () => {
  it('uses D1 when a token is set, the snapshot otherwise', () => {
    expect(selectSource({ D1_READ_TOKEN: 't' }, false)).toBe('d1');
    expect(selectSource({ D1_WRITE_TOKEN: 't' }, true)).toBe('d1');
    expect(selectSource({}, false)).toBe('snapshot');
  });

  it('treats blank tokens as unset', () => {
    expect(selectSource({ D1_READ_TOKEN: '', D1_WRITE_TOKEN: '  ' }, false)).toBe('snapshot');
  });

  it('--require-d1 refuses the snapshot fallback', () => {
    expect(() => selectSource({ D1_READ_TOKEN: '' }, true)).toThrow(/--require-d1/);
  });

  it('defaults the asset base when blank', () => {
    expect(assetBase({ PUBLIC_ASSET_BASE: ' ' })).toBe('https://assets.cssdaily.dev');
    expect(assetBase({ PUBLIC_ASSET_BASE: 'http://localhost:9000/' })).toBe('http://localhost:9000');
  });
});

describe('arguments', () => {
  it('requires --require-d1 for the repo layout and repo layout for images', () => {
    expect(() => parseArgs(['--layout', 'repo'])).toThrow(/requires --require-d1/);
    expect(() => parseArgs(['--with-images'])).toThrow(/only for --layout repo/);
    expect(parseArgs(['--layout', 'repo', '--require-d1', '--with-images'])).toMatchObject({ layout: 'repo', withImages: true });
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown/);
  });
});

describe('pullFromD1', () => {
  it('pages by primary key until a short page', async () => {
    const all = Array.from({ length: 450 }, (_, i) => ({ ...rows()[0], date: `2026-01-01`, difficulty: 'easy', title: `t${i}` }))
      .map((r, i) => ({ ...r, date: `2026-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}` })) as ChallengeRow[];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      const start = params ? all.findIndex((r) => r.date === params[1]) + 1 : 0;
      expect(sql).toMatch(params ? /\(mode, date, difficulty\) > \(\?, \?, \?\)/ : /^SELECT .* FROM challenges ORDER BY/);
      return all.slice(start, start + 200);
    });
    const out = await pullFromD1(query);
    expect(out).toHaveLength(450);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][1]).toEqual([all[199].mode, all[199].date, all[199].difficulty]);
  });

  it('carries the legacy flag', async () => {
    const out = await pullFromD1(async () => rows());
    expect(out.filter((c) => c.legacy).map((c) => `${c.mode}:${c.json.date}`).sort()).toEqual(['css:2026-03-05', 'tailwind:2026-03-17']);
  });
});

describe('validate', () => {
  it('rejects duplicates and an empty mode', () => {
    const data = pulled();
    expect(() => validate([...data, data[0]])).toThrow(/Duplicate/);
    expect(() => validate(data.filter((c) => c.mode === 'css'))).toThrow(/No tailwind/);
    expect(() => validate(data)).not.toThrow();
  });
});

describe('writers', () => {
  it('data layout: one file per challenge, manifest with legacy keys, stale files cleared', () => {
    fs.mkdirSync(path.join(tmp, 'css'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'css', 'stale.json'), '{}');
    writeDataLayout(pulled(), tmp, 'd1');
    expect(fs.readdirSync(path.join(tmp, 'css')).sort()).toEqual(['2026-03-05-easy.json', '2026-06-24-hard.json', '2026-11-11-easy.json']);
    const manifest = JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ source: 'd1', legacy: ['css:2026-03-05:easy', 'tailwind:2026-03-17:medium'] });
  });

  it('repo layout restores original file names and content', () => {
    writeRepoLayout(pulled(), tmp);
    for (const f of fixtures) {
      const dir = f.mode === 'css' ? 'src/data/challenges' : 'src/data/tailwind-challenges';
      const restored = fs.readFileSync(path.join(tmp, dir, f.file), 'utf8');
      expect(JSON.parse(restored)).toEqual(f.json);
      if (!f.legacy) expect(restored).toBe(f.raw);
    }
  });
});

describe('snapshot', () => {
  it('round-trips: data layout → snapshot → pulled challenges', async () => {
    writeDataLayout(pulled(), tmp, 'd1');
    const snapshot = buildSnapshot(tmp, 'abc1234', new Date('2026-11-11T00:00:00Z'));
    expect(snapshot).toMatchObject({ sourceSha: 'abc1234', generatedAt: '2026-11-11T00:00:00.000Z' });
    const back = readSnapshot(JSON.parse(JSON.stringify(snapshot)));
    const sortKey = (c: PulledChallenge) => `${c.mode}:${c.json.date}:${c.json.difficulty}`;
    expect(back.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))).toEqual(pulled().sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
  });

  it('refuses to build a snapshot with an empty mode', () => {
    writeDataLayout(pulled().filter((c) => c.mode === 'css'), tmp, 'd1');
    expect(() => buildSnapshot(tmp, null)).toThrow(/no tailwind/);
  });

  it('publishes to the mutable snapshot key with a short cache', async () => {
    const put = vi.fn(async () => {});
    writeDataLayout(pulled(), tmp, 'd1');
    await publishSnapshot(buildSnapshot(tmp, null), { put });
    expect(put).toHaveBeenCalledWith('data/challenges.json', expect.any(String), { contentType: 'application/json', cacheControl: 'public, max-age=300' });
  });

  it('downloads from the asset base and rejects malformed snapshots', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ css: [] }), { status: 200 }));
    await expect(pullFromSnapshot('https://assets.example', fetchFn)).rejects.toThrow(/malformed/);
    expect(fetchFn).toHaveBeenCalledWith('https://assets.example/data/challenges.json');
    const missing = vi.fn(async () => new Response('nope', { status: 404 }));
    await expect(pullFromSnapshot('https://assets.example', missing)).rejects.toThrow(/HTTP 404/);
  });
});

describe('downloadImages (rollback)', () => {
  const bytesFor = (key: string) => new TextEncoder().encode(`img:${key}`);
  const fakeR2 = (corrupt?: string) => ({
    head: vi.fn(async (key: string) => ({ size: 0, etag: md5Hex(bytesFor(key)) })),
    get: vi.fn(async (key: string) => (key === corrupt ? new TextEncoder().encode('tampered') : bytesFor(key))),
  });

  it('writes every image into the repo layout, checksum-verified', async () => {
    await downloadImages(pulled(), tmp, fakeR2());
    for (const f of fixtures) {
      const dir = f.mode === 'css' ? 'public/targets' : 'public/targets/tailwind';
      const file = path.join(tmp, dir, f.json.targetImage);
      expect(fs.readFileSync(file, 'utf8')).toBe(`img:targets/${f.mode}/${f.json.targetImage}`);
    }
  });

  it('fails loudly on a checksum mismatch', async () => {
    const victim = `targets/css/${fixtures[0].json.targetImage}`;
    await expect(downloadImages(pulled(), tmp, fakeR2(victim))).rejects.toThrow(/Checksum mismatch/);
  });
});
