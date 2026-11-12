import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type { ChallengeJson } from './challenge-rows';
import { existingChallenges, publishChallenge, recentTitles } from './publish-challenge';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'challenges', 'css', '2026-11-11-easy.json');
const json = (): ChallengeJson => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const WEBP = new TextEncoder().encode('webp-bytes');

beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => vi.restoreAllMocks());

describe('publishChallenge', () => {
  it('uploads the image under a hashed name before inserting the row', async () => {
    const order: string[] = [];
    const r2 = { putIfAbsent: vi.fn(async (key: string) => { order.push(`r2 ${key}`); return 'created' as const; }) };
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      order.push('d1');
      expect(sql).toMatch(/^INSERT INTO challenges .* ON CONFLICT DO NOTHING RETURNING mode, date, difficulty$/);
      expect(params?.slice(0, 3)).toEqual(['css', '2026-11-11', 'easy']);
      return [{ mode: 'css', date: '2026-11-11', difficulty: 'easy' }];
    });

    const result = await publishChallenge('css', json(), WEBP, { provider: 'openai', model: 'm' }, { r2, query });

    expect(result.inserted).toBe(true);
    expect(result.targetImage).toMatch(/^2026-11-11-easy-[0-9a-f]{12}\.webp$/);
    expect(order).toEqual([`r2 targets/css/${result.targetImage}`, 'd1']);
    expect(r2.putIfAbsent).toHaveBeenCalledWith(`targets/css/${result.targetImage}`, WEBP, {
      contentType: 'image/webp', cacheControl: 'public, max-age=31536000, immutable',
    });
    const params = query.mock.calls[0][1] as unknown[];
    expect(params).toContain(result.targetImage);
    expect(params).toContain('{"provider":"openai","model":"m"}');
  });

  it.each([
    ['HTTP 403', new Error('R2 PUT cssdaily-assets/targets/css/x.webp failed: HTTP 403')],
    ['exhausted 5xx retries', new Error('R2 PUT cssdaily-assets/targets/css/x.webp failed: HTTP 503')],
    ['network rejection', new TypeError('fetch failed')],
    ['refusal to overwrite', new Error('Refusing to overwrite cssdaily-assets/targets/css/x.webp')],
  ])('never touches D1 when the upload fails (%s)', async (_label, error) => {
    const r2 = { putIfAbsent: vi.fn(async () => { throw error; }) };
    const query = vi.fn(async () => []);
    await expect(publishChallenge('css', json(), WEBP, null, { r2, query })).rejects.toThrow(error.message);
    expect(query).not.toHaveBeenCalled();
  });

  it('still inserts after an identical upload (rerun after a failed insert)', async () => {
    const r2 = { putIfAbsent: vi.fn(async () => 'identical' as const) };
    const query = vi.fn(async () => [{}]);
    await expect(publishChallenge('tailwind', { ...json() }, WEBP, null, { r2, query })).resolves.toMatchObject({ inserted: true });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports a conflict without overwriting', async () => {
    const r2 = { putIfAbsent: vi.fn(async () => 'created' as const) };
    const query = vi.fn(async () => []);
    await expect(publishChallenge('css', json(), WEBP, null, { r2, query })).resolves.toMatchObject({ inserted: false });
  });
});

describe('D1 lookups', () => {
  it('existingChallenges filters by mode and date', async () => {
    const query = vi.fn(async () => [{ difficulty: 'easy', legacy: 0 }]);
    await expect(existingChallenges('tailwind', '2026-11-14', query)).resolves.toEqual([{ difficulty: 'easy', legacy: 0 }]);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/WHERE mode = \? AND date = \?/), ['tailwind', '2026-11-14']);
  });

  it('recentTitles returns the latest 90 titles for the mode', async () => {
    const query = vi.fn(async () => [{ title: 'A' }, { title: 'B' }]);
    await expect(recentTitles('css', query)).resolves.toEqual(['A', 'B']);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/ORDER BY date DESC, difficulty LIMIT 90/), ['css']);
  });
});
