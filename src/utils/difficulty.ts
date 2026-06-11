import type { Difficulty } from './types';

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];

export const TIME_LIMITS: Record<Difficulty, number> = { easy: 300, medium: 600, hard: 900 };

// Read counterpart lives in Layout.astro's inline <head> script (which receives
// this key via define:vars) and applies the preference to <html data-difficulty>
// before first paint, mirroring LAYOUT_KEY.
export const DIFFICULTY_KEY = 'css-daily-difficulty';

export function saveDifficultyPreference(difficulty: Difficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
  } catch {}
}

/**
 * Visibility classes for players inside a multi-difficulty set. The base
 * `hidden` is overridden by the data-attribute variant when <html
 * data-difficulty> matches. Full literal strings — Tailwind JIT cannot see
 * interpolated class names.
 */
export const SET_VISIBILITY: Record<Difficulty, string> = {
  easy: 'hidden [[data-difficulty=easy]_&]:flex',
  medium: 'hidden [[data-difficulty=medium]_&]:flex',
  hard: 'hidden [[data-difficulty=hard]_&]:flex',
};
