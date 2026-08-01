// Challenge JSON shapes differ between modes and the pages already treat
// them loosely; tightening these types is deliberately out of scope.
export type Challenge = any;

const DIFFICULTY_ORDER: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function groupByDate(modules: Record<string, unknown>): Record<string, Challenge[]> {
  const challenges = Object.values(modules).map((mod: any) => mod.default || mod);
  const byDate: Record<string, Challenge[]> = {};
  for (const c of challenges) {
    (byDate[c.date] ??= []).push(c);
  }
  for (const set of Object.values(byDate)) {
    set.sort((a, b) => DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty]);
  }
  return byDate;
}

// import.meta.glob must be called with literal arguments to stay statically
// analyzable — only the result is passed to groupByDate.
export const cssChallengesByDate = groupByDate(
  import.meta.glob('../data/challenges/*.json', { eager: true })
);
export const tailwindChallengesByDate = groupByDate(
  import.meta.glob('../data/tailwind-challenges/*.json', { eager: true })
);

export const cssDates = Object.keys(cssChallengesByDate).sort();
export const tailwindDates = Object.keys(tailwindChallengesByDate).sort();
