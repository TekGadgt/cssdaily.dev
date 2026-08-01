export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function formatDate(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const date = parseLocalDate(dateStr);
  return date.toLocaleDateString('en-US', options || { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function adjacentDate(dateStr: string, offset: number): string {
  const date = parseLocalDate(dateStr);
  date.setDate(date.getDate() + offset);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Today's local calendar date as `YYYY-MM-DD`, matching how challenges are keyed. */
export function localToday(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * The dates the prev/next arrows are allowed to reach.
 *
 * Everything at or before `ceiling`, plus `current` itself so a page that is
 * already showing a future date still finds its own index (and can navigate
 * back) instead of falling off the list. Lexicographic comparison only.
 */
export function navigableDates(allDates: string[], current: string, ceiling: string): string[] {
  const kept = new Set(allDates.filter((date) => date <= ceiling));
  kept.add(current);
  return [...kept].sort();
}

/**
 * The date the site should show, given what was actually built.
 *
 * Returns the latest available date at or before `ceiling`. When nothing is
 * at or before it (e.g. a link predating launch), falls forward to the
 * earliest available date so the user never hits a dead end — and that
 * fall-forward result CAN be a date after `ceiling`. That exception is
 * intended: reaching a real page beats a dead end. It also means "never
 * returns a future date" is not an unconditional property of this function;
 * it holds for this repo only because the corpus's earliest date is well in
 * the past, so the fall-forward branch is unreachable for any present-day
 * ceiling. `null` only when nothing has been built at all.
 *
 * ISO YYYY-MM-DD sorts lexicographically, so this is a filter plus a
 * last-element read — no Date parsing, and no timezone hazards.
 */
export function resolveAvailableDate(available: string[], ceiling: string): string | null {
  if (available.length === 0) return null;
  const sorted = [...available].sort();
  let best: string | null = null;
  for (const date of sorted) {
    if (date > ceiling) break;
    best = date;
  }
  return best ?? sorted[0];
}
