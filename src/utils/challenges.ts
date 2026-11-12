// Challenge JSON shapes differ between modes and the pages already treat
// them loosely; tightening these types is deliberately out of scope.
export type Challenge = any;

const DIFFICULTY_SORT_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };

function groupByDate(modules: Record<string, unknown>): Record<string, Challenge[]> {
  const challenges = Object.values(modules).map((mod: any) => mod.default || mod);
  const byDate: Record<string, Challenge[]> = {};
  for (const c of challenges) {
    (byDate[c.date] ??= []).push(c);
  }
  for (const set of Object.values(byDate)) {
    set.sort((a, b) => DIFFICULTY_SORT_RANK[a.difficulty] - DIFFICULTY_SORT_RANK[b.difficulty]);
  }
  return byDate;
}

// Challenge data lives in D1; `npm run data:pull` writes it to the
// gitignored .data/ directory (CI pulls straight from D1, local dev can use
// the public snapshot). import.meta.glob must be called with literal
// arguments to stay statically analyzable — only the result is passed to
// groupByDate.
export const cssChallengesByDate = groupByDate(
  import.meta.glob('../../.data/challenges/css/*.json', { eager: true })
);
export const tailwindChallengesByDate = groupByDate(
  import.meta.glob('../../.data/challenges/tailwind/*.json', { eager: true })
);

// An empty build would deploy a site that redirects every visitor to
// /about/ — fail loudly instead.
if (Object.keys(cssChallengesByDate).length === 0 || Object.keys(tailwindChallengesByDate).length === 0) {
  throw new Error('No challenge data in .data/ — run "npm run data:pull" first');
}

export const cssDates = Object.keys(cssChallengesByDate).sort();
export const tailwindDates = Object.keys(tailwindChallengesByDate).sort();
