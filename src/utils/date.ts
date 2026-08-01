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

/**
 * The date the site should show, given what was actually built.
 *
 * Returns the latest available date at or before `ceiling`. When nothing is
 * at or before it (e.g. a link predating launch), falls forward to the
 * earliest available date so the user never hits a dead end. `null` only
 * when nothing has been built at all.
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
