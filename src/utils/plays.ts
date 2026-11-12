/**
 * Counts one submission, anonymously (mode, date, difficulty only).
 * Fire-and-forget: never awaited, never blocks or affects the submit flow.
 */
export function recordPlay(mode: 'css' | 'tailwind', date: string, difficulty: string): void {
  try {
    navigator.sendBeacon?.('/api/plays', JSON.stringify({ mode, date, difficulty }));
  } catch {
    // Counting is best effort
  }
}
