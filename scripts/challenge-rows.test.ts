import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  MODES, fromRow, hashedImageName, isLegacyFileName, repoFileName, serializeChallenge, toRow,
  type ChallengeJson,
} from './challenge-rows';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'challenges');

const fixtures = MODES.flatMap((mode) =>
  fs.readdirSync(path.join(FIXTURES, mode)).map((file) => {
    const raw = fs.readFileSync(path.join(FIXTURES, mode, file), 'utf8');
    return { mode, file, raw, json: JSON.parse(raw) as ChallengeJson };
  })
);

describe('challenge row mapping', () => {
  it.each(fixtures.map((f) => [`${f.mode}/${f.file}`, f]))('%s round-trips losslessly', (_name, f) => {
    const row = toRow(f.mode, f.json, { legacy: isLegacyFileName(f.file), createdAt: 1 });
    expect(fromRow(row)).toEqual(f.json);
    expect(repoFileName(row)).toBe(f.file);
  });

  it('reproduces the generator byte format for current files', () => {
    for (const f of fixtures.filter((x) => !isLegacyFileName(x.file))) {
      const row = toRow(f.mode, f.json, { legacy: false, createdAt: 1 });
      expect(serializeChallenge(fromRow(row))).toBe(f.raw);
    }
  });

  it('stores generation metadata as JSON, or null', () => {
    const f = fixtures[0];
    expect(toRow(f.mode, f.json, { legacy: false, createdAt: 1 }).generation).toBeNull();
    expect(toRow(f.mode, f.json, { legacy: false, createdAt: 1, generation: { model: 'm' } }).generation).toBe('{"model":"m"}');
  });

  it('rejects anything the row cannot represent', () => {
    const base = fixtures[1].json;
    expect(() => toRow('css', { ...base, extra: 1 } as ChallengeJson, { legacy: false, createdAt: 1 })).toThrow(/unexpected keys extra/);
    expect(() => toRow('css', { ...base, difficulty: 'expert' } as unknown as ChallengeJson, { legacy: false, createdAt: 1 })).toThrow(/bad difficulty/);
    expect(() => toRow('css', { ...base, date: '2026-1-1' }, { legacy: false, createdAt: 1 })).toThrow(/bad date/);
    expect(() => toRow('css', { ...base, targetImage: '' }, { legacy: false, createdAt: 1 })).toThrow(/missing/);
  });
});

describe('file and image names', () => {
  it('recognizes legacy file names', () => {
    expect(isLegacyFileName('2026-03-05.json')).toBe(true);
    expect(isLegacyFileName('2026-11-11-easy.json')).toBe(false);
    expect(isLegacyFileName('notes.json')).toBe(false);
  });

  it('hashes images deterministically into the expected format', () => {
    const bytes = new TextEncoder().encode('webp');
    const name = hashedImageName('2026-11-14', 'medium', bytes);
    expect(name).toMatch(/^2026-11-14-medium-[0-9a-f]{12}\.webp$/);
    expect(hashedImageName('2026-11-14', 'medium', bytes)).toBe(name);
    expect(hashedImageName('2026-11-14', 'medium', new TextEncoder().encode('other'))).not.toBe(name);
  });
});
