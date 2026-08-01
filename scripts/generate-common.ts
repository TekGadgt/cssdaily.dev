import * as fs from 'fs';
import * as path from 'path';
import type { Difficulty } from '../src/utils/types';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * True when this date+difficulty is already fully generated.
 *
 * Both files must be present, not just the JSON: a crashed run can leave a
 * WebP with no JSON, and that pair must still be repairable.
 *
 * Days before the multi-difficulty rollout use unsuffixed `<date>.json` /
 * `<date>.webp` (100 CSS days and 84 Tailwind days still do). Such a day is
 * treated as complete for EVERY difficulty, because the challenge JSON carries
 * its own `difficulty` field and the site groups challenges by `date` — so
 * generating suffixed siblings would render two challenges of the same
 * difficulty for that date, on top of spending API credits.
 */
export function alreadyGenerated(
  challengesDir: string,
  targetsDir: string,
  date: string,
  difficulty: Difficulty
): boolean {
  const suffixed =
    fs.existsSync(path.join(challengesDir, `${date}-${difficulty}.json`)) &&
    fs.existsSync(path.join(targetsDir, `${date}-${difficulty}.webp`));
  if (suffixed) return true;

  return (
    fs.existsSync(path.join(challengesDir, `${date}.json`)) &&
    fs.existsSync(path.join(targetsDir, `${date}.webp`))
  );
}

export interface RunDifficultiesOptions {
  date: string;
  /** Used only in the ::warning:: label, e.g. "CSS" or "Tailwind". */
  mode: string;
  challengesDir: string;
  targetsDir: string;
  /** Titles from recent days, fed to the generator as an avoid-list. */
  recentTitles: string[];
  /** Generates one challenge and returns its title. */
  generateOne: (difficulty: Difficulty, avoidTitles: string[]) => Promise<string>;
}

/**
 * Runs every difficulty for one date, skipping any that already exist.
 *
 * Throws only when everything actually attempted failed. Comparing against
 * DIFFICULTIES.length instead would wrongly pass a backfill run whose single
 * missing difficulty failed.
 */
export async function runDifficulties(opts: RunDifficultiesOptions): Promise<void> {
  const { date, mode, challengesDir, targetsDir, recentTitles, generateOne } = opts;
  const todaysTitles: string[] = [];
  const failures: Difficulty[] = [];
  let attempted = 0;

  for (const difficulty of DIFFICULTIES) {
    if (alreadyGenerated(challengesDir, targetsDir, date, difficulty)) {
      console.log(`[${difficulty}] already present for ${date} — skipping`);
      continue;
    }
    attempted++;
    try {
      const title = await generateOne(difficulty, [...todaysTitles, ...recentTitles]);
      todaysTitles.push(title);
    } catch (err) {
      console.error(`[${difficulty}] generation failed:`, err);
      console.log(`::warning::${mode} ${difficulty} challenge generation failed for ${date}`);
      failures.push(difficulty);
    }
  }

  if (attempted === 0) {
    console.log(`Nothing to generate for ${date} — all difficulties already present`);
    return;
  }
  if (failures.length === attempted) {
    throw new Error(`All ${attempted} attempted generation(s) failed for ${date}`);
  }
  if (failures.length > 0) {
    console.warn(`Completed with failures: ${failures.join(', ')}`);
  }
}
