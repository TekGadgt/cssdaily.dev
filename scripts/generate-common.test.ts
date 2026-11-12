import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Difficulty } from '../src/utils/types';
import { DIFFICULTIES, isComplete, runDifficulties, type ExistingChallenge } from './generate-common';

// These two functions guard real money: they decide whether a paid API call
// is made and whether an existing challenge gets clobbered. Everything here
// runs against in-memory row fixtures with a stubbed `generateOne` — the
// actual generator scripts are never imported, because constructing their
// provider client costs money.

const DATE = '2026-07-30';

/** The rows D1 would return for this mode and date. */
let existing: ExistingChallenge[];
const seed = (difficulty: Difficulty, legacy = 0) => existing.push({ difficulty, legacy });

beforeEach(() => {
  existing = [];
  // runDifficulties is chatty by design (the ::warning:: lines are read by
  // GitHub Actions); keep the test output readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isComplete', () => {
  it('is true when a row exists for the difficulty', () => {
    seed('easy');
    expect(isComplete(existing, 'easy')).toBe(true);
  });

  it('is false when no row exists', () => {
    expect(isComplete(existing, 'easy')).toBe(false);
  });

  it('does not confuse one difficulty with another', () => {
    seed('easy');
    expect(isComplete(existing, 'medium')).toBe(false);
  });

  // Days predating the multi-difficulty rollout were unsuffixed files (100 CSS
  // days, 84 Tailwind); they import as one row with legacy = 1, and
  // backfilling one must not bolt siblings onto it.
  describe('legacy days', () => {
    it('counts a legacy day as complete for every difficulty', () => {
      seed('medium', 1);
      for (const difficulty of DIFFICULTIES) expect(isComplete(existing, difficulty)).toBe(true);
    });

    it('makes runDifficulties a no-op on a legacy day', async () => {
      seed('easy', 1);
      const generateOne = vi.fn(async () => 'should never be called');

      await runDifficulties({ date: DATE, mode: 'CSS', existing, recentTitles: [], generateOne });

      expect(generateOne).not.toHaveBeenCalled();
    });
  });
});

describe('runDifficulties', () => {
  /** Records every (difficulty, avoidTitles) pair the callback was handed. */
  function recorder(behavior: Partial<Record<Difficulty, 'throw'>> = {}) {
    const calls: Array<{ difficulty: Difficulty; avoidTitles: string[] }> = [];
    const generateOne = vi.fn(async (difficulty: Difficulty, avoidTitles: string[]) => {
      calls.push({ difficulty, avoidTitles: [...avoidTitles] });
      if (behavior[difficulty] === 'throw') throw new Error(`boom: ${difficulty}`);
      return `Title ${difficulty}`;
    });
    return { calls, generateOne };
  }

  type GenerateOne = Parameters<typeof runDifficulties>[0]['generateOne'];

  function run(generateOne: GenerateOne, recentTitles: string[] = []) {
    return runDifficulties({ date: DATE, mode: 'CSS', existing, recentTitles, generateOne });
  }

  it('generates every difficulty when nothing exists yet', async () => {
    const { calls, generateOne } = recorder();
    await expect(run(generateOne)).resolves.toBeUndefined();
    expect(calls.map((c) => c.difficulty)).toEqual(DIFFICULTIES);
  });

  it('skips difficulties that already exist and generates only the missing ones', async () => {
    seed('easy');
    seed('hard');
    const { calls, generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(calls.map((c) => c.difficulty)).toEqual(['medium']);
  });

  it('regenerates a difficulty whose run crashed before its row was inserted', async () => {
    // An uploaded image with no row (crash between R2 and D1) leaves the
    // difficulty absent from `existing`, so it is generated again.
    seed('hard');
    const { calls, generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(calls.map((c) => c.difficulty)).toEqual(['easy', 'medium']);
  });

  it('resolves without calling the generator when all three already exist', async () => {
    for (const difficulty of DIFFICULTIES) seed(difficulty);
    const { generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(generateOne).not.toHaveBeenCalled();
  });

  it('rejects when the only difficulty it attempted fails, even though two were skipped', async () => {
    // The regression this guards: comparing failures.length against
    // DIFFICULTIES.length instead of `attempted` would let a backfill run
    // whose single missing difficulty failed exit 0, and the workflow would
    // report success while producing nothing.
    seed('easy');
    seed('hard');
    const { calls, generateOne } = recorder({ medium: 'throw' });

    await expect(run(generateOne)).rejects.toThrow(/All 1 attempted generation\(s\) failed/);

    expect(calls.map((c) => c.difficulty)).toEqual(['medium']);
  });

  it('rejects when every difficulty fails on a full run', async () => {
    const { generateOne } = recorder({ easy: 'throw', medium: 'throw', hard: 'throw' });

    await expect(run(generateOne)).rejects.toThrow(/All 3 attempted generation\(s\) failed/);
  });

  it('resolves on partial failure, because there is still usable output', async () => {
    const { calls, generateOne } = recorder({ medium: 'throw' });

    await expect(run(generateOne)).resolves.toBeUndefined();

    // A failure must not abort the remaining difficulties.
    expect(calls.map((c) => c.difficulty)).toEqual(DIFFICULTIES);
  });

  it('accumulates this run\'s titles into the avoid-list ahead of recentTitles', async () => {
    const { calls, generateOne } = recorder();

    await run(generateOne, ['Old A', 'Old B']);

    expect(calls[0].avoidTitles).toEqual(['Old A', 'Old B']);
    expect(calls[1].avoidTitles).toEqual(['Title easy', 'Old A', 'Old B']);
    expect(calls[2].avoidTitles).toEqual(['Title easy', 'Title medium', 'Old A', 'Old B']);
  });

  it('does not put a failed generation\'s title into the avoid-list', async () => {
    const { calls, generateOne } = recorder({ easy: 'throw' });

    await run(generateOne, ['Old A']);

    expect(calls[1].avoidTitles).toEqual(['Old A']);
    expect(calls[2].avoidTitles).toEqual(['Title medium', 'Old A']);
  });
});
