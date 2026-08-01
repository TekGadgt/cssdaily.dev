import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Difficulty } from '../src/utils/types';
import { DIFFICULTIES, alreadyGenerated, runDifficulties } from './generate-common';

// These two functions guard real money: they decide whether a paid API call
// is made and whether an existing challenge gets clobbered. Everything here
// runs against throwaway temp directories with a stubbed `generateOne` — the
// actual generator scripts are never imported, because constructing their
// Anthropic client costs money.

const DATE = '2026-07-30';

let tmpRoot: string;
let challengesDir: string;
let targetsDir: string;

/** Lays down the artifacts a completed generation would have left behind. */
function seed(difficulty: Difficulty, parts: { json?: boolean; webp?: boolean }) {
  if (parts.json) {
    fs.writeFileSync(path.join(challengesDir, `${DATE}-${difficulty}.json`), '{}');
  }
  if (parts.webp) {
    fs.writeFileSync(path.join(targetsDir, `${DATE}-${difficulty}.webp`), 'not-really-a-webp');
  }
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'generate-common-'));
  challengesDir = path.join(tmpRoot, 'challenges');
  targetsDir = path.join(tmpRoot, 'targets');
  fs.mkdirSync(challengesDir);
  fs.mkdirSync(targetsDir);
  // runDifficulties is chatty by design (the ::warning:: lines are read by
  // GitHub Actions); keep the test output readable.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('alreadyGenerated', () => {
  it('is true only when both the JSON and the WebP exist', () => {
    seed('easy', { json: true, webp: true });
    expect(alreadyGenerated(challengesDir, targetsDir, DATE, 'easy')).toBe(true);
  });

  it('is false when only the JSON exists', () => {
    seed('easy', { json: true });
    expect(alreadyGenerated(challengesDir, targetsDir, DATE, 'easy')).toBe(false);
  });

  it('is false when only the WebP exists, so a crashed run stays repairable', () => {
    seed('easy', { webp: true });
    expect(alreadyGenerated(challengesDir, targetsDir, DATE, 'easy')).toBe(false);
  });

  it('is false when neither exists', () => {
    expect(alreadyGenerated(challengesDir, targetsDir, DATE, 'easy')).toBe(false);
  });

  it('does not confuse one difficulty with another', () => {
    seed('easy', { json: true, webp: true });
    expect(alreadyGenerated(challengesDir, targetsDir, DATE, 'medium')).toBe(false);
  });

  it('does not confuse one date with another', () => {
    seed('easy', { json: true, webp: true });
    expect(alreadyGenerated(challengesDir, targetsDir, '2026-07-31', 'easy')).toBe(false);
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
    return runDifficulties({
      date: DATE,
      mode: 'CSS',
      challengesDir,
      targetsDir,
      recentTitles,
      generateOne,
    });
  }

  it('generates every difficulty when nothing exists yet', async () => {
    const { calls, generateOne } = recorder();
    await expect(run(generateOne)).resolves.toBeUndefined();
    expect(calls.map((c) => c.difficulty)).toEqual(DIFFICULTIES);
  });

  it('skips difficulties that already exist and generates only the missing ones', async () => {
    seed('easy', { json: true, webp: true });
    seed('hard', { json: true, webp: true });
    const { calls, generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(calls.map((c) => c.difficulty)).toEqual(['medium']);
  });

  it('regenerates a difficulty whose WebP is orphaned by a crashed run', async () => {
    seed('easy', { webp: true });
    const { calls, generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(calls.map((c) => c.difficulty)).toContain('easy');
  });

  it('resolves without calling the generator when all three already exist', async () => {
    for (const difficulty of DIFFICULTIES) seed(difficulty, { json: true, webp: true });
    const { generateOne } = recorder();

    await expect(run(generateOne)).resolves.toBeUndefined();

    expect(generateOne).not.toHaveBeenCalled();
  });

  it('rejects when the only difficulty it attempted fails, even though two were skipped', async () => {
    // The regression this guards: comparing failures.length against
    // DIFFICULTIES.length instead of `attempted` would let a backfill run
    // whose single missing difficulty failed exit 0, and the workflow would
    // report success while producing nothing.
    seed('easy', { json: true, webp: true });
    seed('hard', { json: true, webp: true });
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
