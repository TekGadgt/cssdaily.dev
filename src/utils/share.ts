import type { Difficulty } from './types';
import { DIFFICULTY_ORDER, TIME_LIMITS } from './difficulty';

export interface ShareEntry {
  difficulty: Difficulty;
  score: number;
  timeSpent: number;
}

function speedEmoji(timeSpent: number, timeLimit: number): string {
  const pctUsed = timeSpent / timeLimit;
  if (pctUsed < 0.25) return ' ⚡';            // lightning
  if (pctUsed < 0.50) return ' 🏃';      // runner
  if (pctUsed < 0.75) return ' 💨';      // dashing away
  return '';
}

export function generateShareText(date: string, entries: ShareEntry[]): string {
  const sorted = DIFFICULTY_ORDER.filter((d) => entries.some((e) => e.difficulty === d))
    .map((d) => entries.find((e) => e.difficulty === d)!);

  if (sorted.length === 1) {
    const e = sorted[0];
    const minutes = Math.floor(e.timeSpent / 60);
    const seconds = e.timeSpent % 60;
    const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;
    return `CSS Daily ${date} (${e.difficulty})${speedEmoji(e.timeSpent, TIME_LIMITS[e.difficulty])}\nScore: ${e.score}% | Time: ${timeStr}\n\nhttps://cssdaily.dev`;
  }

  const lines = sorted.map(
    (e) => `${e.difficulty}: ${e.score}%${speedEmoji(e.timeSpent, TIME_LIMITS[e.difficulty])}`
  );
  return `CSS Daily ${date}\n${lines.join('\n')}\n\nhttps://cssdaily.dev`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const result = document.execCommand('copy');
    document.body.removeChild(textarea);
    return result;
  }
}
