import type { ChallengeResult, ChallengeHistory, UserStats, StorageData, TailwindChallengeResult, TailwindChallengeHistory, TailwindStorageData, GenericHistory, LayoutMode, Difficulty } from './types';
import { adjacentDate } from './date';

const STORAGE_KEY = 'css-daily-challenge';

function isValidResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as { score?: unknown; timeSpent?: unknown };
  // timeSpent feeds minutes/seconds formatting in ResultsModal and share
  // text — a result without it would render NaN:NaN. isFinite also rejects
  // NaN/Infinity (typeof NaN === 'number' would pass a typeof check).
  return Number.isFinite(r.score) && Number.isFinite(r.timeSpent);
}

const DIFFICULTY_KEYS: Difficulty[] = ['easy', 'medium', 'hard'];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Shape alone isn't enough: "2026-99-99" is out of range and "2026-02-31"
// silently rolls over to March 3 — both break history rendering and streak
// math. Validated via explicit UTC construction (not Date's string parser,
// whose date-only handling has been inconsistent in older engines — and a
// false negative here drops user history). The component round-trip catches
// rollover: Date normalizes Feb 31 to Mar 3, so the parts won't match back.
function isValidDateKey(key: string): boolean {
  if (!DATE_KEY_RE.test(key)) return false;
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * One-time migration: v1 stored one flat result per date
 * (`history[date] = {score,...}`); v2 nests results per difficulty
 * (`history[date][difficulty] = {score,...}`). Legacy entries predate
 * multi-difficulty days and map to 'medium' (98 of 99 were medium).
 *
 * Also the single validation choke point: anything that isn't a real result
 * (non-numeric score/timeSpent, non-date keys, unknown keys, null entries)
 * is dropped here, so stats and history rendering downstream never see
 * corrupted data. Pure function, exported for verification.
 */
export function migrateHistoryShape<T extends { score: number; timeSpent: number }>(
  history: unknown
): { history: Record<string, Partial<Record<Difficulty, T>>>; changed: boolean } {
  // A history that isn't a plain object (number, boolean, string, array) is
  // corrupted wholesale — replace with a clean shape and flag the change so
  // it gets written back instead of lingering in storage
  if (!history || typeof history !== 'object' || Array.isArray(history)) {
    return { history: {}, changed: true };
  }
  const out: Record<string, Partial<Record<Difficulty, T>>> = {};
  let changed = false;
  for (const [date, value] of Object.entries(history)) {
    if (!isValidDateKey(date)) {
      // Non-date key (corrupted storage) — would render "Invalid Date" in history
      changed = true;
      continue;
    }
    if (isValidResult(value)) {
      // v1 flat entry
      out[date] = { medium: value as T };
      changed = true;
      continue;
    }
    if (!value || typeof value !== 'object') {
      // Corrupted entry — drop it rather than crash stats/history rendering
      changed = true;
      continue;
    }
    // Nested entry — keep only valid results under known difficulty keys
    const nested: Partial<Record<Difficulty, T>> = {};
    let kept = 0;
    for (const d of DIFFICULTY_KEYS) {
      const entry = (value as Record<string, unknown>)[d];
      if (entry !== undefined) {
        if (isValidResult(entry)) {
          nested[d] = entry as T;
          kept++;
        } else {
          changed = true;
        }
      }
    }
    if (kept < Object.keys(value).length) changed = true;
    if (kept > 0) out[date] = nested;
    else changed = true;
  }
  return { history: out, changed };
}

/** Exported for verification (no test framework in this repo). */
export function computeStats(history: GenericHistory): UserStats {
  const dates = Object.keys(history)
    .filter((d) => Object.keys(history[d]).length > 0)
    .sort();
  const gamesPlayed = dates.reduce((sum, d) => sum + Object.keys(history[d]).length, 0);

  if (gamesPlayed === 0) {
    return { gamesPlayed: 0, currentStreak: 0, maxStreak: 0, averageScore: 0 };
  }

  const totalScore = dates.reduce(
    (sum, d) => sum + Object.values(history[d]).reduce((s, e) => s + (e?.score ?? 0), 0),
    0
  );
  const averageScore = Math.round(totalScore / gamesPlayed);

  let currentStreak = 0;
  let maxStreak = 0;
  let streak = 0;

  // Consecutive-day checks compare date keys via calendar arithmetic
  // (adjacentDate) instead of millisecond diffs, which are exact only when
  // the engine parses date-only strings as UTC — older engines parsed them
  // as local time, where DST days are 23/25 hours and break streaks.
  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      streak = adjacentDate(dates[i - 1], 1) === dates[i] ? streak + 1 : 1;
    }
    maxStreak = Math.max(maxStreak, streak);
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const lastDate = dates[dates.length - 1];

  // Streak is alive if the last play was today or yesterday
  if (lastDate === todayStr || adjacentDate(lastDate, 1) === todayStr) {
    currentStreak = streak;
  } else {
    currentStreak = 0;
  }

  return { gamesPlayed, currentStreak, maxStreak, averageScore };
}

function getData(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Optional chaining: JSON.parse can legally return null/primitives, and
      // those must reach the migration guard to get rewritten, not throw here
      const { history, changed } = migrateHistoryShape<ChallengeResult>(parsed?.history);
      const data: StorageData = { history };
      if (changed) setData(data);
      return data;
    }
  } catch {
    // Unparseable storage is unrecoverable garbage — remove it so read-only
    // sessions self-heal too (a save would overwrite it anyway). Guarded:
    // if we landed here because storage access itself threw, so will this.
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return { history: {} };
}

// Swallows write failures (quota, Safari private mode): persistence is best
// effort — a failed write must never break the submit flow or discard
// history that was read successfully
function setData(data: StorageData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function getResult(date: string, difficulty: Difficulty): ChallengeResult | null {
  const data = getData();
  return data.history[date]?.[difficulty] || null;
}

export function saveResult(date: string, difficulty: Difficulty, result: ChallengeResult): void {
  const data = getData();
  data.history[date] = { ...data.history[date], [difficulty]: result };
  setData(data);
}

export function getHistory(): ChallengeHistory {
  return getData().history;
}

export function getStats(): UserStats {
  return computeStats(getHistory());
}

const TAILWIND_STORAGE_KEY = 'tailwind-daily-challenge';

function getTailwindData(): TailwindStorageData {
  try {
    const raw = localStorage.getItem(TAILWIND_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Optional chaining: see getData
      const { history, changed } = migrateHistoryShape<TailwindChallengeResult>(parsed?.history);
      const data: TailwindStorageData = { history };
      if (changed) setTailwindData(data);
      return data;
    }
  } catch {
    // Self-heal unparseable storage — see getData
    try { localStorage.removeItem(TAILWIND_STORAGE_KEY); } catch {}
  }
  return { history: {} };
}

// Best-effort write — see setData
function setTailwindData(data: TailwindStorageData): void {
  try {
    localStorage.setItem(TAILWIND_STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function getTailwindResult(date: string, difficulty: Difficulty): TailwindChallengeResult | null {
  const data = getTailwindData();
  return data.history[date]?.[difficulty] || null;
}

export function saveTailwindResult(date: string, difficulty: Difficulty, result: TailwindChallengeResult): void {
  const data = getTailwindData();
  data.history[date] = { ...data.history[date], [difficulty]: result };
  setTailwindData(data);
}

export function getTailwindHistory(): TailwindChallengeHistory {
  return getTailwindData().history;
}

export function getTailwindStats(): UserStats {
  return computeStats(getTailwindHistory());
}

// Read counterpart lives in Layout.astro's inline <head> script (which receives
// this key via define:vars) and applies the preference to <html data-layout>
// before first paint to avoid layout flash.
export const LAYOUT_KEY = 'css-daily-layout';

export function saveLayoutPreference(layout: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {}
}
