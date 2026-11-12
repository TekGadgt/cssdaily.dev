import { describe, expect, it } from 'vitest';
import { ROW_COLUMNS, insertStatement, type ChallengeRow } from './challenge-rows';
import { insertBatches } from './import-challenges';

const row = (i: number, bodyBytes = 100): ChallengeRow => ({
  mode: 'css', date: `2026-01-${String(i).padStart(2, '0')}`, difficulty: 'easy', title: `t${i}`,
  time_limit: 600, target_image: `${i}.webp`, body: 'x'.repeat(bodyBytes), legacy: 0, generation: null, created_at: 1,
});

describe('import batching', () => {
  it('never exceeds 100 bound parameters per statement', () => {
    const batches = insertBatches(Array.from({ length: 25 }, (_, i) => row(i + 1)));
    expect(batches.map((b) => b.length)).toEqual([10, 10, 5]);
    for (const b of batches) expect(insertStatement(b).params.length).toBeLessThanOrEqual(100);
  });

  it('splits large bodies by size', () => {
    const batches = insertBatches(Array.from({ length: 10 }, (_, i) => row(i + 1, 20_000)));
    expect(batches.every((b) => b.length <= 4)).toBe(true);
    expect(batches.flat()).toHaveLength(10);
  });

  it('builds a non-overwriting insert with columns in schema order', () => {
    const { sql, params } = insertStatement([row(1), row(2)]);
    expect(sql).toMatch(/^INSERT INTO challenges \(mode, date, difficulty, title, time_limit, target_image, body, legacy, generation, created_at\) VALUES \(\?(, \?){9}\), \(\?(, \?){9}\) ON CONFLICT DO NOTHING$/);
    expect(params).toHaveLength(2 * ROW_COLUMNS.length);
    expect(params.slice(0, 3)).toEqual(['css', '2026-01-01', 'easy']);
  });
});
