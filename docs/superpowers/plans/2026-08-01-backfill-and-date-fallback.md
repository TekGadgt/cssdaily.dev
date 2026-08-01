# Backfill Dispatch + Missing-Date Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the daily-challenge workflow backfill a specific missed date, and make the site fall back to the most recent existing challenge instead of looping between `/` and `404`.

**Architecture:** One pure function, `resolveAvailableDate(available, ceiling)`, becomes the single rule for "which date should we show." A shared `challenges.ts` module owns the `import.meta.glob` of both challenge directories; a shared `ChallengeRedirect.astro` stub applies the rule on `/`, `/tailwind/`, and `404`. Independently, the two generator scripts learn to skip already-present date+difficulty pairs, which makes a manual `workflow_dispatch` run with a custom date both safe and cheap.

**Tech Stack:** Astro 5 (static output, `directory` build format), React 19, TypeScript (`astro/tsconfigs/strict`), tsx for the Node generator scripts, vitest (added by this plan), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-01-backfill-and-date-fallback-design.md`

## Global Constraints

- **Redirect stubs stay bare.** `index.astro`, `tailwind/index.astro`, and `404.astro` must not import `Layout` or emit an analytics beacon. Inherited from `2026-06-23-image-optimization-and-redirect-tightening-design.md` B1.
- **All redirect targets keep a trailing slash** — `/challenge/<date>/`, `/tailwind/<date>/`, `/about/`. Inherited from that spec's B2/B3; avoids a GitHub Pages 301.
- **Redirects use `window.location.replace`**, never `.href`, so the stub never enters browser history. Inherited from B1.
- **Do not modify `astro.config.mjs`.** It currently reads `trailingSlash: 'ignore'`. That differs from what the 2026-06-23 spec proposed, but the build format already emits `/<route>/index.html` and every link carries its slash, so it is out of scope here.
- **The resolution ceiling is always clamped to today.** `2026-08-02` exists on disk while today is `2026-08-01`; no code path may resolve to a future date.
- **Date format is `YYYY-MM-DD` throughout**, which sorts lexicographically. Never parse to `Date` for comparison.
- **Never interpolate `${{ inputs.* }}` directly into a `run:` block.** Pass through `env:` — a workflow input spliced into a shell line is a script-injection vector.
- **Generator output naming is fixed:** `${date}-${difficulty}.json` in the challenges dir, `${date}-${difficulty}.webp` in the targets dir. Difficulties are `easy`, `medium`, `hard`.

---

### Task 1: `resolveAvailableDate` + vitest

Adds the test runner and the one rule every later task depends on.

**Files:**
- Modify: `package.json` (add `vitest` devDependency, add `test` script)
- Modify: `src/utils/date.ts` (append one exported function)
- Test: `src/utils/date.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `resolveAvailableDate(available: string[], ceiling: string): string | null` — exported from `src/utils/date.ts`. Returns the latest entry of `available` that is `<= ceiling`; if no entry qualifies, returns the earliest entry; returns `null` only when `available` is empty. Sorts a copy of its input, so callers need not pass sorted data.

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"` (alongside the existing `dev`/`build`/`preview` entries):

```json
    "test": "vitest run",
```

No `vitest.config.*` is needed. The function under test is plain TypeScript with no Astro or Vite imports, and vitest's default discovery already picks up `src/**/*.test.ts`.

- [ ] **Step 3: Write the failing test**

Create `src/utils/date.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { resolveAvailableDate } from './date';

describe('resolveAvailableDate', () => {
  const dates = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-08-02'];

  it('returns the ceiling itself when it is available', () => {
    expect(resolveAvailableDate(dates, '2026-07-29')).toBe('2026-07-29');
  });

  it('returns the latest date before the ceiling when the ceiling is missing', () => {
    expect(resolveAvailableDate(dates, '2026-08-01')).toBe('2026-07-30');
  });

  it('never returns a date after the ceiling', () => {
    // 2026-08-02 is present but must not leak for an earlier ceiling
    expect(resolveAvailableDate(dates, '2026-07-31')).toBe('2026-07-30');
  });

  it('returns the earliest available date when the ceiling precedes all of them', () => {
    expect(resolveAvailableDate(dates, '2020-01-01')).toBe('2026-07-28');
  });

  it('returns null for an empty list', () => {
    expect(resolveAvailableDate([], '2026-08-01')).toBeNull();
  });

  it('sorts unsorted input defensively', () => {
    const shuffled = ['2026-08-02', '2026-07-29', '2026-07-28', '2026-07-30'];
    expect(resolveAvailableDate(shuffled, '2026-08-01')).toBe('2026-07-30');
  });

  it('does not mutate the caller array', () => {
    const shuffled = ['2026-08-02', '2026-07-28'];
    resolveAvailableDate(shuffled, '2026-08-01');
    expect(shuffled).toEqual(['2026-08-02', '2026-07-28']);
  });

  it('handles a single date at or before the ceiling', () => {
    expect(resolveAvailableDate(['2026-07-30'], '2026-08-01')).toBe('2026-07-30');
  });

  it('handles a single date after the ceiling', () => {
    expect(resolveAvailableDate(['2026-09-01'], '2026-08-01')).toBe('2026-09-01');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `resolveAvailableDate is not a function` (or a TypeScript resolution error), because `date.ts` does not export it yet.

- [ ] **Step 5: Write the implementation**

Append to `src/utils/date.ts` (keep the existing three functions untouched):

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/utils/date.ts src/utils/date.test.ts
git commit -m "Add resolveAvailableDate and vitest test runner"
```

---

### Task 2: Shared challenge loader (pure refactor)

Extracts the glob-and-group block duplicated across the two `[date].astro` pages, so Task 3's new consumers do not add a third and fourth copy. No behavior change.

**Files:**
- Create: `src/utils/challenges.ts`
- Modify: `src/pages/challenge/[date].astro:6-25` (replace `getStaticPaths` body and add the import)
- Modify: `src/pages/tailwind/[date].astro:6-25` (same)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces, all exported from `src/utils/challenges.ts`:
  - `cssChallengesByDate: Record<string, Challenge[]>` — keyed by `YYYY-MM-DD`, each array pre-sorted easy → medium → hard.
  - `tailwindChallengesByDate: Record<string, Challenge[]>` — same shape.
  - `cssDates: string[]` — sorted ascending.
  - `tailwindDates: string[]` — sorted ascending.
  - `type Challenge = any` — the JSON shapes differ between modes (CSS challenges carry `target.css`, Tailwind ones do not), and the existing pages already treat them as `any`. Do not tighten this here; it is out of scope.

- [ ] **Step 1: Create the shared module**

Create `src/utils/challenges.ts`:

```ts
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
```

- [ ] **Step 2: Rewrite the CSS challenge page's `getStaticPaths`**

In `src/pages/challenge/[date].astro`, add the import and replace lines 6–25 so the frontmatter reads:

```astro
---
import Layout from '../../layouts/Layout.astro';
import Header from '../../components/Header.astro';
import ChallengePlayer from '../../components/ChallengePlayer.tsx';
import { cssChallengesByDate, cssDates } from '../../utils/challenges';

export async function getStaticPaths() {
  return Object.entries(cssChallengesByDate).map(([date, set]) => ({
    params: { date },
    props: { challenges: set, allDates: cssDates },
  }));
}

const { challenges, allDates } = Astro.props;
const availableDifficulties = challenges.map((c: any) => c.difficulty);
---
```

Leave the template below `---` exactly as it is.

- [ ] **Step 3: Rewrite the Tailwind challenge page's `getStaticPaths`**

In `src/pages/tailwind/[date].astro`, the same change against the Tailwind exports:

```astro
---
import Layout from '../../layouts/Layout.astro';
import Header from '../../components/Header.astro';
import TailwindPlayer from '../../components/TailwindPlayer.tsx';
import { tailwindChallengesByDate, tailwindDates } from '../../utils/challenges';

export async function getStaticPaths() {
  return Object.entries(tailwindChallengesByDate).map(([date, set]) => ({
    params: { date },
    props: { challenges: set, allDates: tailwindDates },
  }));
}

const { challenges, allDates } = Astro.props;
const availableDifficulties = challenges.map((c: any) => c.difficulty);
---
```

Leave the template below `---` exactly as it is.

- [ ] **Step 4: Verify the build produces identical routes**

```bash
ls dist/challenge | wc -l && ls dist/tailwind | wc -l
npm run build
ls dist/challenge | wc -l && ls dist/tailwind | wc -l
```

Expected: the counts after the build match the counts before it. This is a pure refactor — if a route count moved, the grouping changed and something is wrong.

- [ ] **Step 5: Spot-check a rendered page**

```bash
npx astro preview --port 4321 &
sleep 3
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:4321/challenge/2026-07-30/
curl -sS -o /dev/null -w '%{http_code}\n' http://localhost:4321/tailwind/2026-07-30/
kill %1
```

Expected: `200` for both. The difficulty switcher on `/challenge/2026-07-30/` should still list easy, medium, hard in that order.

- [ ] **Step 6: Commit**

```bash
git add src/utils/challenges.ts src/pages/challenge/\[date\].astro src/pages/tailwind/\[date\].astro
git commit -m "Extract shared challenge loader from the date pages"
```

---

### Task 3: Fallback redirect stub (fixes the loop)

**Files:**
- Create: `src/components/ChallengeRedirect.astro`
- Modify: `src/pages/index.astro` (replace the inline redirect script)
- Modify: `src/pages/tailwind/index.astro` (same)
- Modify: `src/pages/404.astro` (same; also drop the `<meta http-equiv="refresh">`)

**Interfaces:**
- Consumes: `resolveAvailableDate` from Task 1; `cssDates` and `tailwindDates` from Task 2.
- Produces: `ChallengeRedirect.astro`, an Astro component with props
  `{ mode: 'challenge' | 'tailwind' | 'auto'; cssDates?: string[]; tailwindDates?: string[] }`.
  It renders only a JSON data tag, a module script, and a `<noscript>` link — no `Layout`, no analytics.

- [ ] **Step 1: Create the redirect component**

Create `src/components/ChallengeRedirect.astro`:

```astro
---
interface Props {
  mode: 'challenge' | 'tailwind' | 'auto';
  cssDates?: string[];
  tailwindDates?: string[];
}

const { mode, cssDates = [], tailwindDates = [] } = Astro.props;
const payload = JSON.stringify({ mode, cssDates, tailwindDates });
---
<script type="application/json" id="redirect-data" set:html={payload}></script>
<script>
  import { resolveAvailableDate } from '../utils/date';

  const el = document.getElementById('redirect-data');
  const { mode, cssDates, tailwindDates } = JSON.parse(el!.textContent!);

  // Local calendar date, matching how the site has always keyed challenges.
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  let target = mode;
  let ceiling = today;

  if (mode === 'auto') {
    // GitHub Pages serves 404.html while preserving the requested URL.
    const match = location.pathname.match(/^\/(challenge|tailwind)\/(\d{4}-\d{2}-\d{2})\/?$/);
    if (!match) {
      // Not a challenge URL. "/" always resolves to a real page now, so
      // this cannot loop.
      location.replace('/');
    } else {
      target = match[1];
      // Clamp to today so a hand-typed future URL cannot reveal a
      // pre-generated challenge.
      ceiling = match[2] < today ? match[2] : today;
    }
  }

  if (target !== 'auto') {
    const dates = target === 'tailwind' ? tailwindDates : cssDates;
    const resolved = resolveAvailableDate(dates, ceiling);
    // /about/ is the one terminal state: nothing has been built at all.
    location.replace(resolved ? `/${target}/${resolved}/` : '/about/');
  }
</script>
<noscript><a href="/about/">CSS Daily</a></noscript>
```

- [ ] **Step 2: Rewrite `src/pages/index.astro`**

Replace the whole file:

```astro
---
import ChallengeRedirect from '../components/ChallengeRedirect.astro';
import { cssDates } from '../utils/challenges';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>CSS Daily</title>
    <ChallengeRedirect mode="challenge" cssDates={cssDates} />
  </head>
  <body></body>
</html>
```

- [ ] **Step 3: Rewrite `src/pages/tailwind/index.astro`**

Replace the whole file:

```astro
---
import ChallengeRedirect from '../../components/ChallengeRedirect.astro';
import { tailwindDates } from '../../utils/challenges';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Tailwind Daily - CSS Daily</title>
    <ChallengeRedirect mode="tailwind" tailwindDates={tailwindDates} />
  </head>
  <body></body>
</html>
```

- [ ] **Step 4: Rewrite `src/pages/404.astro`**

Replace the whole file. Note the `<meta http-equiv="refresh" content="0; url=/">` is deliberately gone — resolution now needs JS, and a no-JS refresh to `/` would bounce into a page that also needs JS. The `<noscript>` link inside the component points at `/about/` instead.

```astro
---
import ChallengeRedirect from '../components/ChallengeRedirect.astro';
import { cssDates, tailwindDates } from '../utils/challenges';
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Not Found - CSS Daily</title>
    <ChallengeRedirect mode="auto" cssDates={cssDates} tailwindDates={tailwindDates} />
  </head>
  <body></body>
</html>
```

- [ ] **Step 5: Build and confirm the stubs stay bare**

```bash
npm run build
grep -c 'cloudflareinsights' dist/index.html dist/404.html
```

Expected: `0` for both files. `Layout.astro` is the only thing that emits the Cloudflare beacon, so a non-zero count means a `Layout` import crept into a stub — a violation of the inherited B1 constraint.

- [ ] **Step 6: Verify the loop is gone, by hand**

The repo is currently missing `2026-07-31` and `2026-08-01`, so the bug reproduces without any setup.

```bash
npm run build
npx astro preview --port 4321 &
sleep 3
```

Open a browser to `http://localhost:4321/` with the network panel recording, then check each case:

| Visit | Expected landing URL |
|---|---|
| `/` | `/challenge/2026-07-30/` |
| `/tailwind/` | `/tailwind/2026-07-30/` |
| `/challenge/2026-07-31/` | `/challenge/2026-07-30/` |
| `/challenge/2027-01-01/` | `/challenge/2026-07-30/` — **not** `2026-08-02` |
| `/challenge/2020-01-01/` | `/challenge/2026-03-05/` (earliest available) |
| `/nonsense` | `/` then `/challenge/2026-07-30/` |

In every case the network panel must show the sequence terminating. Before this change, `/` oscillated between `/` and `404` indefinitely.

Then `kill %1`.

- [ ] **Step 7: Confirm the happy path still works**

Every case in Step 6 exercises a *missing* date. Prove the normal path too, by briefly fabricating today's challenge from an existing one. Run from the repo root; these are throwaway files inside the working tree, removed at the end of this step.

```bash
for d in easy medium hard; do
  sed 's/2026-07-30/2026-08-01/g' src/data/challenges/2026-07-30-$d.json > src/data/challenges/2026-08-01-$d.json
  cp public/targets/2026-07-30-$d.webp public/targets/2026-08-01-$d.webp
done
npm run build
npx astro preview --port 4321 &
sleep 3
```

Visit `http://localhost:4321/` and confirm it lands on `/challenge/2026-08-01/` — today's date, in a single hop, with no intermediate `404`.

Then stop the server and remove the fabricated files:

```bash
kill %1
rm src/data/challenges/2026-08-01-*.json public/targets/2026-08-01-*.webp
git status --short
```

Expected: `git status --short` reports no untracked or modified files under `src/data/` or `public/targets/`. If it lists anything there, the cleanup missed a file — remove it before committing.

- [ ] **Step 8: Commit**

```bash
git add src/components/ChallengeRedirect.astro src/pages/index.astro src/pages/tailwind/index.astro src/pages/404.astro
git commit -m "Fall back to the latest existing challenge instead of looping"
```

---

### Task 4: Skip already-present challenges, via a shared generator module

Makes a backfill run idempotent and able to repair a partial day. `2026-07-30` is a live example: all three CSS difficulties exist, but the Tailwind **hard** is missing.

The skip check and the difficulty loop would otherwise be duplicated verbatim across the two generator scripts, so both move into a shared module that each script calls with its own directories and its own `generateOne` closure.

**Files:**
- Create: `scripts/generate-common.ts`
- Modify: `scripts/generate-challenge.ts` (import the shared module; replace the loop body in `generateChallenge`, currently lines 226–242; drop the now-shared `DIFFICULTIES` constant at line 48)
- Modify: `scripts/generate-tailwind-challenge.ts` (same, loop currently at lines 228–244, `DIFFICULTIES` at line 48)

**Interfaces:**
- Consumes: nothing from earlier tasks. These are Node scripts run by tsx; they must NOT import from `src/utils/challenges.ts`, which uses Vite-only `import.meta.glob` and would crash under tsx.
- Produces, exported from `scripts/generate-common.ts`:
  - `DIFFICULTIES: Difficulty[]` — `['easy', 'medium', 'hard']`, moved out of the two scripts.
  - `alreadyGenerated(challengesDir: string, targetsDir: string, date: string, difficulty: Difficulty): boolean`
  - `runDifficulties(opts: RunDifficultiesOptions): Promise<void>` — see the interface in Step 1.

- [ ] **Step 1: Create the shared module**

Create `scripts/generate-common.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import type { Difficulty } from '../src/utils/types';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * True when this date+difficulty is already fully generated.
 *
 * Both files must be present, not just the JSON: a crashed run can leave a
 * WebP with no JSON, and that pair must still be repairable.
 */
export function alreadyGenerated(
  challengesDir: string,
  targetsDir: string,
  date: string,
  difficulty: Difficulty
): boolean {
  return (
    fs.existsSync(path.join(challengesDir, `${date}-${difficulty}.json`)) &&
    fs.existsSync(path.join(targetsDir, `${date}-${difficulty}.webp`))
  );
}

export interface RunDifficultiesOptions {
  date: string;
  /** Used only in the ::warning:: label, e.g. "CSS" or "Tailwind". */
  mode: string;
  challengesDir: string;
  targetsDir: string;
  /** Titles from recent days, fed to the generator as an avoid-list. */
  recentTitles: string[];
  /** Generates one challenge and returns its title. */
  generateOne: (difficulty: Difficulty, avoidTitles: string[]) => Promise<string>;
}

/**
 * Runs every difficulty for one date, skipping any that already exist.
 *
 * Throws only when everything actually attempted failed. Comparing against
 * DIFFICULTIES.length instead would wrongly pass a backfill run whose single
 * missing difficulty failed.
 */
export async function runDifficulties(opts: RunDifficultiesOptions): Promise<void> {
  const { date, mode, challengesDir, targetsDir, recentTitles, generateOne } = opts;
  const todaysTitles: string[] = [];
  const failures: Difficulty[] = [];
  let attempted = 0;

  for (const difficulty of DIFFICULTIES) {
    if (alreadyGenerated(challengesDir, targetsDir, date, difficulty)) {
      console.log(`[${difficulty}] already present for ${date} — skipping`);
      continue;
    }
    attempted++;
    try {
      const title = await generateOne(difficulty, [...todaysTitles, ...recentTitles]);
      todaysTitles.push(title);
    } catch (err) {
      console.error(`[${difficulty}] generation failed:`, err);
      console.log(`::warning::${mode} ${difficulty} challenge generation failed for ${date}`);
      failures.push(difficulty);
    }
  }

  if (attempted === 0) {
    console.log(`Nothing to generate for ${date} — all difficulties already present`);
    return;
  }
  if (failures.length === attempted) {
    throw new Error(`All ${attempted} attempted generation(s) failed for ${date}`);
  }
  if (failures.length > 0) {
    console.warn(`Completed with failures: ${failures.join(', ')}`);
  }
}
```

- [ ] **Step 2: Wire the CSS generator to the shared module**

In `scripts/generate-challenge.ts`:

Add the import alongside the existing ones at the top:

```ts
import { DIFFICULTIES, runDifficulties } from './generate-common';
```

Delete the local `const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];` (line 48) — it now comes from the shared module. Keep the `import type { Difficulty }` line; `generateOne` still uses it in its signature.

Replace the body of the `try` block in `generateChallenge` (currently lines 218–242, from `const page = await browser.newPage();` through the final `if (failures.length > 0)` block) with:

```ts
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    await runDifficulties({
      date,
      mode: 'CSS',
      challengesDir: CHALLENGES_DIR,
      targetsDir: TARGETS_DIR,
      recentTitles: collectRecentTitles(),
      generateOne: (difficulty, avoidTitles) =>
        generateOne(client, page, date, difficulty, avoidTitles),
    });
```

Leave the `finally { await browser.close(); }` and everything else in the file unchanged.

- [ ] **Step 3: Wire the Tailwind generator to the shared module**

In `scripts/generate-tailwind-challenge.ts`, make the same three changes — add the import, delete the local `DIFFICULTIES` (line 48), and replace the `try` block body (currently lines 220–244) with the identical call, changing only `mode`:

```ts
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    await runDifficulties({
      date,
      mode: 'Tailwind',
      challengesDir: CHALLENGES_DIR,
      targetsDir: TARGETS_DIR,
      recentTitles: collectRecentTitles(),
      generateOne: (difficulty, avoidTitles) =>
        generateOne(client, page, date, difficulty, avoidTitles),
    });
```

`CHALLENGES_DIR` and `TARGETS_DIR` already point at the Tailwind directories in this file, so the call body is otherwise identical by construction rather than by copy-paste.

- [ ] **Step 4: Typecheck both scripts**

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no errors. If `Difficulty` is reported as unused in either script, the `import type` line can be removed from that file — but only if genuinely unused.

- [ ] **Step 5: Verify the skip path costs nothing**

This must make **no** Anthropic API call, so it is safe to run without credits. Run against a date that is already complete:

```bash
npx tsx scripts/generate-challenge.ts 2026-07-29
```

Expected output: three `already present for 2026-07-29 — skipping` lines, then `Nothing to generate for 2026-07-29 — all difficulties already present`, then `CHALLENGE_DATE=2026-07-29`. Exit code `0`.

Note this launches Chromium before the skip check runs, which is wasteful but harmless — restructuring the browser lifecycle is out of scope.

```bash
git status --short
```

Expected: no changes under `src/data/` or `public/targets/`. Nothing was written.

- [ ] **Step 6: Verify the same for the Tailwind generator**

```bash
npx tsx scripts/generate-tailwind-challenge.ts 2026-07-29
```

Expected: the same three skip lines and `Nothing to generate`, exit code `0`, no files written.

- [ ] **Step 7: Confirm the partial-day gap is what we think it is**

```bash
ls src/data/tailwind-challenges/2026-07-30-*.json
```

Expected: `easy` and `medium` only — no `hard`. So a Tailwind run for `2026-07-30` would skip two difficulties and attempt exactly one.

Do **not** run the Tailwind generator against `2026-07-30` — it would make a real API call. That path is exercised for real in Task 5's post-merge acceptance.

- [ ] **Step 8: Commit**

```bash
git add scripts/generate-common.ts scripts/generate-challenge.ts scripts/generate-tailwind-challenge.ts
git commit -m "Skip already-generated challenges so backfill is idempotent"
```

---

### Task 5: Custom date input on the workflow

**Files:**
- Modify: `.github/workflows/generate-challenge.yml:5` (add `inputs` under `workflow_dispatch`)
- Modify: `.github/workflows/generate-challenge.yml:26-28` (the "Compute challenge date" step)
- Modify: `.github/workflows/generate-challenge.yml:30-42` (route the date through `env` in both generate steps)

**Interfaces:**
- Consumes: the skip behavior from Task 4 — without it, a manual re-run would clobber existing challenges.
- Produces: `steps.date.outputs.value`, a validated `YYYY-MM-DD` string, consumed unchanged by the existing report and commit steps.

- [ ] **Step 1: Add the dispatch input**

Replace line 5 (`  workflow_dispatch: # Manual trigger for testing`) with:

```yaml
  workflow_dispatch: # Manual trigger, also used to backfill a missed day
    inputs:
      date:
        description: 'Challenge date (YYYY-MM-DD). Leave blank for tomorrow.'
        required: false
        type: string
```

Scheduled runs leave `inputs.date` unset, which renders as an empty string — so the cron path is unchanged.

- [ ] **Step 2: Validate and resolve the date**

Replace the "Compute challenge date" step (lines 26–28) with:

```yaml
      - name: Compute challenge date
        id: date
        env:
          # Via env, never inline ${{ }} in run: — a dispatch input
          # interpolated into a shell line is a script-injection vector.
          INPUT_DATE: ${{ inputs.date }}
        run: |
          if [ -z "$INPUT_DATE" ]; then
            echo "value=$(date -u -d '+1 day' '+%Y-%m-%d')" >> "$GITHUB_OUTPUT"
            exit 0
          fi
          if ! printf '%s' "$INPUT_DATE" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
            echo "::error::Invalid date '$INPUT_DATE' — expected YYYY-MM-DD"
            exit 1
          fi
          # Catches shape-valid but calendar-invalid dates like 2026-02-31.
          if ! date -u -d "$INPUT_DATE" >/dev/null 2>&1; then
            echo "::error::'$INPUT_DATE' is not a real calendar date"
            exit 1
          fi
          echo "value=$INPUT_DATE" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 3: Route the date through `env` in both generate steps**

Replace the two generation steps (lines 30–42) with:

```yaml
      - name: Generate CSS challenge
        id: css
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CHALLENGE_DATE: ${{ steps.date.outputs.value }}
        run: npx tsx scripts/generate-challenge.ts "$CHALLENGE_DATE"

      - name: Generate Tailwind challenge
        id: tailwind
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CHALLENGE_DATE: ${{ steps.date.outputs.value }}
        run: npx tsx scripts/generate-tailwind-challenge.ts "$CHALLENGE_DATE"
```

Leave the "Report generation results", "Commit and push", "Build Astro site", "Upload artifact", and `deploy` steps untouched — they already read `steps.date.outputs.value`.

- [ ] **Step 4: Validate the workflow YAML parses**

```bash
npx --yes js-yaml .github/workflows/generate-challenge.yml > /dev/null && echo "YAML OK"
```

Expected: `YAML OK`.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/generate-challenge.yml
git commit -m "Allow a custom date on the challenge generation workflow"
```

- [ ] **Step 6: Acceptance — dry-run the validation on GitHub**

> **Steps 6–8 are NOT for the implementer.** `workflow_dispatch` reads the
> workflow file from the selected ref, so these can only run after this
> branch is merged to the default branch. They also spend Anthropic API
> credits and push commits to `main`. The implementer stops after Step 5;
> these steps are handed to the repository owner as a post-merge checklist.

Bad input, should fail fast with no API spend:

```bash
gh workflow run generate-challenge.yml -f date=garbage
gh run watch
```

Expected: the "Compute challenge date" step fails with `Invalid date 'garbage' — expected YYYY-MM-DD`, and no generation step runs.

```bash
gh workflow run generate-challenge.yml -f date=2026-02-31
gh run watch
```

Expected: fails with `'2026-02-31' is not a real calendar date`.

- [ ] **Step 7: Acceptance — backfill the real gaps**

```bash
gh workflow run generate-challenge.yml -f date=2026-07-31
gh run watch
```

Expected: both modes generate three difficulties, a commit lands titled `Add daily challenges for 2026-07-31`, and the site redeploys.

```bash
gh workflow run generate-challenge.yml -f date=2026-08-01
gh run watch
```

Same expectation.

Then repair the partial day — this is the run that proves the skip logic:

```bash
gh workflow run generate-challenge.yml -f date=2026-07-30
gh run watch
```

Expected: the CSS step skips all three and generates nothing; the Tailwind step skips easy and medium and generates only `hard`. Exactly one challenge is committed, not six.

Finally, confirm idempotence:

```bash
gh workflow run generate-challenge.yml -f date=2026-07-30
gh run watch
```

Expected: both steps skip everything, the run succeeds, and **no commit is created** (the existing `git diff --cached --quiet ||` guard makes the commit step a no-op).

- [ ] **Step 8: Confirm the site now has no gap**

Visit `https://cssdaily.dev/` — with `2026-08-01` present it should land on today's challenge directly. Then visit `https://cssdaily.dev/challenge/2026-07-31/` and confirm it is a real page rather than a fallback.

---

## Notes for the implementer

- **Tasks 1–3 are the site fix; Tasks 4–5 are the backfill.** They are independent and can be reviewed separately, but Task 5's acceptance depends on Task 4 shipping first, or a manual re-run would overwrite existing challenges.
- **Task 3 Step 6 is the only real proof the bug is fixed.** Do not skip it. The repo's current data (missing `2026-07-31` and `2026-08-01`, with `2026-08-02` present) reproduces both the loop and the future-date-leak risk without any setup.
- **Do not backfill before Task 4 merges.** Once the gap is filled the reproduction disappears, and the fallback becomes much harder to test by hand.
