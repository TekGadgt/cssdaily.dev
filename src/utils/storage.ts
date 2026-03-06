import type { ChallengeResult, ChallengeHistory, UserStats, StorageData } from './types';

const STORAGE_KEY = 'css-daily-challenge';

function getData(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { history: {} };
}

function setData(data: StorageData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function getResult(date: string): ChallengeResult | null {
  const data = getData();
  return data.history[date] || null;
}

export function saveResult(date: string, result: ChallengeResult): void {
  const data = getData();
  data.history[date] = result;
  setData(data);
}

export function getHistory(): ChallengeHistory {
  return getData().history;
}

export function getStats(): UserStats {
  const history = getHistory();
  const dates = Object.keys(history).sort();
  const gamesPlayed = dates.length;

  if (gamesPlayed === 0) {
    return { gamesPlayed: 0, currentStreak: 0, maxStreak: 0, averageScore: 0 };
  }

  const totalScore = dates.reduce((sum, d) => sum + history[d].score, 0);
  const averageScore = Math.round(totalScore / gamesPlayed);

  // Calculate streaks by checking consecutive days
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

  // Current streak: check if the last entry is today or yesterday
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
