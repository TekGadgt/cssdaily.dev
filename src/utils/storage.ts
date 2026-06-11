import type { ChallengeResult, ChallengeHistory, UserStats, StorageData, TailwindChallengeResult, TailwindChallengeHistory, TailwindStorageData, GenericHistory, LayoutMode, Difficulty } from './types';

const STORAGE_KEY = 'css-daily-challenge';

function isValidResult(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const r = value as { score?: unknown; timeSpent?: unknown };
  // timeSpent feeds minutes/seconds formatting in ResultsModal and share
  // text — a result without it would render NaN:NaN
  return typeof r.score === 'number' && typeof r.timeSpent === 'number';
}

const DIFFICULTY_KEYS: Difficulty[] = ['easy', 'medium', 'hard'];
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (!DATE_KEY_RE.test(date)) {
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

function computeStats(history: GenericHistory): UserStats {
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

  for (let i = 0; i < dates.length; i++) {
    if (i === 0) {
      streak = 1;
    } else {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      streak = diffDays === 1 ? streak + 1 : 1;
    }
    maxStreak = Math.max(maxStreak, streak);
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const lastDate = dates[dates.length - 1];

  if (lastDate === todayStr) {
    currentStreak = streak;
  } else {
    const last = new Date(lastDate);
    const diffDays = (today.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
    currentStreak = diffDays <= 1.5 ? streak : 0;
  }

  return { gamesPlayed, currentStreak, maxStreak, averageScore };
}

function getData(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { history, changed } = migrateHistoryShape<ChallengeResult>(parsed.history);
      const data: StorageData = { history };
      // Persist the migrated shape, but never let a write failure (quota,
      // private mode) discard history that was read successfully
      if (changed) try { setData(data); } catch {}
      return data;
    }
  } catch {}
  return { history: {} };
}

function setData(data: StorageData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
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
      const { history, changed } = migrateHistoryShape<TailwindChallengeResult>(parsed.history);
      const data: TailwindStorageData = { history };
      // Persist the migrated shape, but never let a write failure (quota,
      // private mode) discard history that was read successfully
      if (changed) try { setTailwindData(data); } catch {}
      return data;
    }
  } catch {}
  return { history: {} };
}

function setTailwindData(data: TailwindStorageData): void {
  localStorage.setItem(TAILWIND_STORAGE_KEY, JSON.stringify(data));
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
