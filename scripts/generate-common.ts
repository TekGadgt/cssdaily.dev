import type { Difficulty } from '../src/utils/types';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** What D1 already holds for one mode and date (see publish-challenge.ts). */
export interface ExistingChallenge {
  difficulty: Difficulty;
  legacy: number;
}

/**
 * True when this date+difficulty is already published.
 *
 * A row is only ever inserted after its image upload succeeded (publish-
 * challenge.ts), so a row's presence means the challenge is complete; a run
 * that crashed between upload and insert leaves no row and stays repairable.
 *
 * Days before the multi-difficulty rollout (`legacy = 1`; 100 CSS days and 84
 * Tailwind days) count as complete for EVERY difficulty: the site groups
 * challenges by date, so generating siblings would show two challenges of
 * the same difficulty for that day, on top of spending API credits.
 */
export function isComplete(existing: ExistingChallenge[], difficulty: Difficulty): boolean {
  return existing.some((row) => row.difficulty === difficulty || row.legacy === 1);
}

export interface RunDifficultiesOptions {
  date: string;
  /** Used only in the ::warning:: label, e.g. "CSS" or "Tailwind". */
  mode: string;
  /** This mode's rows for `date`, queried once by the caller. */
  existing: ExistingChallenge[];
  /** Titles from recent days, fed to the generator as an avoid-list. */
  recentTitles: string[];
  /** Generates and publishes one challenge and returns its title. */
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
  const { date, mode, existing, recentTitles, generateOne } = opts;
  const todaysTitles: string[] = [];
  const failures: Difficulty[] = [];
  let attempted = 0;

  for (const difficulty of DIFFICULTIES) {
    if (isComplete(existing, difficulty)) {
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
