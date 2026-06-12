# Three Difficulties Daily Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate three challenges per day per mode (easy/medium/hard), playable via an in-player difficulty switcher, with separate results per difficulty and full back-compat for the ~100 existing single-challenge dates.

**Architecture:** Generators loop over the three difficulties (difficulty is assigned by the script, not chosen by the model), writing `YYYY-MM-DD-{difficulty}.json`/`.png`; legacy single files stay untouched. Pages group challenge files by date and render one player per difficulty; visibility is driven by a `data-difficulty` attribute on `<html>` (same pre-paint inline-script + Tailwind data-attribute-variant pattern as the layout toggle — no flash, no React state). Storage moves to `history[date][difficulty]` with a one-time read-path migration. Spec: `docs/superpowers/specs/2026-06-10-quality-improvements-design.md` (Package 3).

**Tech Stack:** TypeScript, Anthropic SDK, Playwright, Astro static output, React 19, Tailwind CSS. No test framework — do not add one. Verification: tsc, build, temporary in-repo smoke scripts (relative imports, deleted after, never committed).

**Context for the implementing engineer:**
- Study the layout-toggle precedent first: `src/layouts/Layout.astro` (inline `define:vars` script), `src/components/LayoutToggle.tsx`, and the `[[data-layout=columns]_&]:` classes in the players. The difficulty switcher uses the identical pattern with `data-difficulty`.
- Tailwind JIT only generates classes that appear as complete literal strings in source files. Never construct variant classes with template interpolation — use lookup maps of full literals.
- The two players (`ChallengePlayer.tsx`, `TailwindPlayer.tsx`) are intentionally parallel. Keep edits symmetric.
- Players keep all their per-challenge state (editor, timer, score). With one player rendered per difficulty (inactive ones CSS-hidden), each difficulty's in-progress state is preserved automatically while on the page. A started timer keeps running while another difficulty is viewed — this is accepted behavior (honest elapsed time).
- Never write absolute machine paths into any file; temp scripts at repo root, deleted before commit.
- The CI workflow (`.github/workflows/generate-challenge.yml`) needs NO changes: each generator script internally loops the three difficulties and exits nonzero only when all three fail, which composes with the existing per-mode `continue-on-error`.

**File map:**
- Modify: `src/utils/types.ts` (Difficulty type, nested history types, `targetImage`)
- Create: `src/utils/difficulty.ts` (order, storage key, save helper, visibility class map)
- Modify: `src/utils/storage.ts` (nested schema + migration), `src/utils/share.ts` (difficulty in share text)
- Modify: `src/components/ResultsModal.tsx`, `src/components/HistoryView.tsx`
- Modify: `src/layouts/Layout.astro` (extend inline script)
- Create: `src/components/DifficultySwitcher.tsx`
- Modify: `src/components/ChallengePlayer.tsx`, `src/components/TailwindPlayer.tsx`
- Modify: `src/pages/challenge/[date].astro`, `src/pages/tailwind/[date].astro`
- Modify: `scripts/generate-challenge.ts`, `scripts/generate-tailwind-challenge.ts`

---

### Task 1: Difficulty type, history types, and difficulty utils

**Files:**
- Modify: `src/utils/types.ts`
- Create: `src/utils/difficulty.ts`

- [ ] **Step 1: Add `Difficulty` and update types**

In `src/utils/types.ts`:

Add at the top of the file:

```ts
export type Difficulty = 'easy' | 'medium' | 'hard';
```

In `Challenge`, change `difficulty: 'easy' | 'medium' | 'hard';` to:

```ts
  difficulty: Difficulty;
  /** Target PNG filename (e.g. "2026-06-12-easy.png"); legacy challenges omit it and use `${date}.png` */
  targetImage?: string;
```

In `TailwindChallenge`, change `difficulty: 'easy' | 'medium' | 'hard';` to the same two lines.

Replace the two history interfaces:

```ts
export interface ChallengeHistory {
  [date: string]: Partial<Record<Difficulty, ChallengeResult>>;
}
```

```ts
export interface TailwindChallengeHistory {
  [date: string]: Partial<Record<Difficulty, TailwindChallengeResult>>;
}
```

And replace `GenericHistory`:

```ts
export interface GenericHistory {
  [date: string]: Partial<Record<Difficulty, HistoryEntry>>;
}
```

- [ ] **Step 2: Create `src/utils/difficulty.ts`**

```ts
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
```

- [ ] **Step 3: Type-check** — `npx tsc --noEmit -p tsconfig.json`. Expected: errors ONLY in `storage.ts`/`HistoryView.tsx` (they still use the old flat history shape — fixed in Tasks 2–3). If those are the only errors, proceed; this task's commit is types-only groundwork and the next two tasks land before any build is needed. If OTHER files error, fix before committing.

Actually, to keep every commit green, do Tasks 1–3 as ONE commit at the end of Task 3 (see Task 3 Step 5). Do not commit yet.

### Task 2: Storage schema migration

**Files:**
- Modify: `src/utils/storage.ts`

- [ ] **Step 1: Add the pure migration helper and rework the CSS-mode store**

In `src/utils/storage.ts`, update the type import to include `Difficulty`, then add near the top (below the imports):

```ts
/**
 * One-time migration: v1 stored one flat result per date
 * (`history[date] = {score,...}`); v2 nests results per difficulty
 * (`history[date][difficulty] = {score,...}`). Legacy entries predate
 * multi-difficulty days and map to 'medium' (98 of 99 were medium).
 * Pure function, exported for verification.
 */
export function migrateHistoryShape<T extends { score: number }>(
  history: Record<string, unknown>
): { history: Record<string, Partial<Record<Difficulty, T>>>; changed: boolean } {
  const out: Record<string, Partial<Record<Difficulty, T>>> = {};
  let changed = false;
  for (const [date, value] of Object.entries(history)) {
    if (value && typeof value === 'object' && 'score' in (value as object)) {
      out[date] = { medium: value as T };
      changed = true;
    } else {
      out[date] = value as Partial<Record<Difficulty, T>>;
    }
  }
  return { history: out, changed };
}
```

Replace `getData` with (migration applied and persisted on read):

```ts
function getData(): StorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { history, changed } = migrateHistoryShape<ChallengeResult>(parsed.history || {});
      const data: StorageData = { history };
      if (changed) setData(data);
      return data;
    }
  } catch {}
  return { history: {} };
}
```

Replace `getResult` and `saveResult`:

```ts
export function getResult(date: string, difficulty: Difficulty): ChallengeResult | null {
  const data = getData();
  return data.history[date]?.[difficulty] || null;
}

export function saveResult(date: string, difficulty: Difficulty, result: ChallengeResult): void {
  const data = getData();
  data.history[date] = { ...data.history[date], [difficulty]: result };
  setData(data);
}
```

- [ ] **Step 2: Rework `computeStats` for the nested shape**

Replace `computeStats` with (streaks count a day if ANY difficulty was submitted; games/average count every submitted difficulty):

```ts
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
```

- [ ] **Step 3: Mirror for the Tailwind store**

Replace `getTailwindData`, `getTailwindResult`, `saveTailwindResult` the same way:

```ts
function getTailwindData(): TailwindStorageData {
  try {
    const raw = localStorage.getItem(TAILWIND_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const { history, changed } = migrateHistoryShape<TailwindChallengeResult>(parsed.history || {});
      const data: TailwindStorageData = { history };
      if (changed) setTailwindData(data);
      return data;
    }
  } catch {}
  return { history: {} };
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
```

- [ ] **Step 4: Smoke-test the migration function**

Write `migration-smoke.ts` at the repo root (delete after):

```ts
import { migrateHistoryShape } from './src/utils/storage';

const legacy = {
  '2026-04-01': { date: '2026-04-01', score: 85, timeSpent: 300, submittedCss: 'x' },
  '2026-04-02': { medium: { date: '2026-04-02', score: 70, timeSpent: 200, submittedCss: 'y' } },
};

const { history, changed } = migrateHistoryShape(legacy as any);
if (!changed) { console.error('FAIL: should report changed'); process.exit(1); }
if ((history['2026-04-01'] as any).medium?.score !== 85) { console.error('FAIL: flat entry not nested under medium'); process.exit(1); }
if ((history['2026-04-02'] as any).medium?.score !== 70) { console.error('FAIL: already-nested entry mangled'); process.exit(1); }

const second = migrateHistoryShape(history as any);
if (second.changed) { console.error('FAIL: migration must be idempotent'); process.exit(1); }

console.log('PASS');
```

Run: `npx tsx migration-smoke.ts` → `PASS`, then `rm migration-smoke.ts`.

Do not commit yet (combined commit in Task 3).

### Task 3: Share text, ResultsModal, HistoryView

**Files:**
- Modify: `src/utils/share.ts`, `src/components/ResultsModal.tsx`, `src/components/HistoryView.tsx`

- [ ] **Step 1: Rework share text to list every attempted difficulty**

Replace `generateShareText` in `src/utils/share.ts` with (spec: "Share card lists each attempted difficulty with its score"; single-entry shares keep the time readout, multi-entry shares show one compact scoreline per difficulty):

```ts
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
```

(`copyToClipboard` is unchanged.)

- [ ] **Step 2: Thread share entries through ResultsModal**

In `src/components/ResultsModal.tsx`:

- Add to the imports: `import type { ShareEntry } from '../utils/share';`
- In the props interface, replace `timeLimit: number;` with:

```ts
  timeLimit: number;
  /** Every submitted difficulty for this date; the share text lists them all */
  shareEntries: ShareEntry[];
```

- Add `shareEntries` to the destructured params, and change the share call to:

```ts
    const text = generateShareText(date, shareEntries);
```

(The modal's on-screen score/time display is unchanged — it shows the just-submitted difficulty; only the share text aggregates.)

- [ ] **Step 3: Rework HistoryView for the nested history**

In `src/components/HistoryView.tsx`, add the import:

```ts
import { DIFFICULTY_ORDER } from '../utils/difficulty';
```

Replace the `sortedDates.map(...)` block with (one row per date, a score chip per submitted difficulty, first letter capitalized as the label):

```tsx
            {sortedDates.map((date) => {
              const entries = history[date];
              return (
                <a
                  key={date}
                  href={`${basePath}/${date}`}
                  className="flex justify-between items-center py-2 px-3 rounded hover:bg-gray-700 transition"
                >
                  <span className="text-sm text-gray-300">
                    {formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className="flex gap-3 font-mono font-bold text-sm">
                    {DIFFICULTY_ORDER.filter((d) => entries[d]).map((d) => {
                      const score = entries[d]!.score;
                      let scoreColor = 'text-red-400';
                      if (score >= 80) scoreColor = 'text-green-400';
                      else if (score >= 50) scoreColor = 'text-yellow-400';
                      return (
                        <span key={d} className={scoreColor} title={d}>
                          {d.charAt(0).toUpperCase()}&thinsp;{score}%
                        </span>
                      );
                    })}
                  </span>
                </a>
              );
            })}
```

- [ ] **Step 4: Type-check**

`npx tsc --noEmit -p tsconfig.json` — expected: errors remain ONLY in `ChallengePlayer.tsx` and `TailwindPlayer.tsx` (old storage call signatures and the missing `shareEntries` modal prop — fully reworked in Tasks 5–6). To commit green, fix those call sites minimally NOW as part of this commit:

In `ChallengePlayer.tsx`:
- `getResult(challenge.date)` → `getResult(challenge.date, challenge.difficulty)`
- `saveResult(challenge.date, {...})` → `saveResult(challenge.date, challenge.difficulty, {...})`
- Above the `return`, compute the submitted entries for this date (re-evaluated every render, so it's fresh after a submit):

```tsx
  const shareEntries = (['easy', 'medium', 'hard'] as const)
    .map((d) => ({ d, r: getResult(challenge.date, d) }))
    .filter((x) => x.r !== null)
    .map((x) => ({ difficulty: x.d, score: x.r!.score, timeSpent: x.r!.timeSpent }));
```

- Add `shareEntries={shareEntries}` to the `<ResultsModal ... />` props.

In `TailwindPlayer.tsx`: same three changes using `getTailwindResult`/`saveTailwindResult`.

Re-run tsc (clean) and `npm run build` (clean).

- [ ] **Step 5: Commit Tasks 1–3 together**

```bash
git add src/utils/types.ts src/utils/difficulty.ts src/utils/storage.ts src/utils/share.ts src/components/ResultsModal.tsx src/components/HistoryView.tsx src/components/ChallengePlayer.tsx src/components/TailwindPlayer.tsx
git commit -m "Move results storage to per-difficulty schema with migration"
```

---

### Task 4: Pre-paint difficulty attribute + DifficultySwitcher component

**Files:**
- Modify: `src/layouts/Layout.astro`
- Create: `src/components/DifficultySwitcher.tsx`

- [ ] **Step 1: Extend the inline script**

In `src/layouts/Layout.astro` frontmatter, change the storage import line to:

```ts
import { LAYOUT_KEY } from '../utils/storage';
import { DIFFICULTY_KEY } from '../utils/difficulty';
```

Replace the inline script with:

```html
    <!-- Apply layout + difficulty preferences before first paint to avoid flashes on every page load -->
    <script is:inline define:vars={{ LAYOUT_KEY, DIFFICULTY_KEY }}>
      try {
        document.documentElement.dataset.layout = localStorage.getItem(LAYOUT_KEY) === 'columns' ? 'columns' : 'rows';
        const d = localStorage.getItem(DIFFICULTY_KEY);
        document.documentElement.dataset.difficulty = d === 'easy' || d === 'hard' ? d : 'medium';
      } catch (e) {
        document.documentElement.dataset.layout = 'rows';
        document.documentElement.dataset.difficulty = 'medium';
      }
    </script>
```

- [ ] **Step 2: Create `src/components/DifficultySwitcher.tsx`**

Stateless, same pattern as LayoutToggle: clicking stamps the attribute and saves; the active button highlights via data-attribute variants (full literals, colors matching the existing difficulty badge palette):

```tsx
import type { Difficulty } from '../utils/types';
import { DIFFICULTY_ORDER, saveDifficultyPreference } from '../utils/difficulty';

interface DifficultySwitcherProps {
  available: Difficulty[];
}

const ACTIVE_CLASSES: Record<Difficulty, string> = {
  easy: '[[data-difficulty=easy]_&]:bg-green-900 [[data-difficulty=easy]_&]:text-green-300',
  medium: '[[data-difficulty=medium]_&]:bg-yellow-900 [[data-difficulty=medium]_&]:text-yellow-300',
  hard: '[[data-difficulty=hard]_&]:bg-red-900 [[data-difficulty=hard]_&]:text-red-300',
};

export default function DifficultySwitcher({ available }: DifficultySwitcherProps) {
  const select = (d: Difficulty) => {
    document.documentElement.dataset.difficulty = d;
    saveDifficultyPreference(d);
  };

  return (
    <div className="flex text-xs rounded overflow-hidden border border-gray-700">
      {DIFFICULTY_ORDER.filter((d) => available.includes(d)).map((d) => (
        <button
          key={d}
          onClick={() => select(d)}
          className={`px-2 py-0.5 capitalize text-gray-500 hover:text-white ${ACTIVE_CLASSES[d]}`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Verify and commit**

`npx tsc --noEmit -p tsconfig.json && npm run build` — both clean. Then check the built HTML has the difficulty default: `grep -o 'dataset.difficulty[^;]*' dist/challenge/*/index.html | head -2` shows the inline logic.

```bash
git add src/layouts/Layout.astro src/components/DifficultySwitcher.tsx
git commit -m "Add pre-paint difficulty attribute and DifficultySwitcher component"
```

---

### Task 5: ChallengePlayer set-awareness

**Files:**
- Modify: `src/components/ChallengePlayer.tsx`

- [ ] **Step 1: Imports and props**

Add imports:

```tsx
import DifficultySwitcher from './DifficultySwitcher';
import { SET_VISIBILITY } from '../utils/difficulty';
```

Add `Difficulty` to the types import. Change the props interface to:

```tsx
interface ChallengePlayerProps {
  challenge: Challenge;
  allDates: string[];
  /** All difficulties available on this date; when >1 the player is one of a CSS-switched set */
  availableDifficulties?: Difficulty[];
}
```

And the signature to:

```tsx
export default function ChallengePlayer({ challenge, allDates, availableDifficulties = [challenge.difficulty] }: ChallengePlayerProps) {
  const multi = availableDifficulties.length > 1;
```

- [ ] **Step 2: Fallback effect for dates missing the preferred difficulty**

Below the existing "Check for existing result" effect, add:

```tsx
  // If the stamped preference isn't available on this date (legacy pages),
  // point the attribute at a difficulty that exists. Display-only — does
  // not overwrite the saved preference. Idempotent across the set's players.
  useEffect(() => {
    if (!multi) return;
    const current = document.documentElement.dataset.difficulty as Difficulty | undefined;
    if (!current || !availableDifficulties.includes(current)) {
      document.documentElement.dataset.difficulty = availableDifficulties.includes('medium')
        ? 'medium'
        : availableDifficulties[0];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

- [ ] **Step 3: Root visibility**

Change the root div from:

```tsx
    <div className="flex-1 flex flex-col min-h-0 bg-gray-900 text-white">
```

to:

```tsx
    <div className={`flex-1 flex flex-col min-h-0 bg-gray-900 text-white${multi ? ` ${SET_VISIBILITY[challenge.difficulty]}` : ''}`}>
```

(Tailwind emits `.hidden` after `.flex` in its output, so `hidden` wins at equal specificity and the `[[data-difficulty=X]_&]:flex` variant — higher specificity — reveals only the matching player. The literals live in `SET_VISIBILITY`, so JIT sees them.)

- [ ] **Step 4: Switcher replaces the static badge when multi**

Replace the difficulty badge span in the header:

```tsx
            <span className={`text-xs px-2 py-0.5 rounded ${challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
              challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                'bg-red-900 text-red-300'
              }`}>
              {challenge.difficulty}
            </span>
```

with:

```tsx
            {multi ? (
              <DifficultySwitcher available={availableDifficulties} />
            ) : (
              <span className={`text-xs px-2 py-0.5 rounded ${challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
                challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                  'bg-red-900 text-red-300'
                }`}>
                {challenge.difficulty}
              </span>
            )}
```

- [ ] **Step 5: Difficulty-aware target image and results**

The storage calls and `shareEntries` modal prop were already updated in Task 3. Now define once, just above the `return`:

```tsx
  const targetSrc = `/targets/${challenge.targetImage ?? `${challenge.date}.png`}`;
```

Replace both `src={`/targets/${challenge.date}.png`}` occurrences (target tab and overlay tab) with `src={targetSrc}`.

- [ ] **Step 6: Verify and commit**

`npx tsc --noEmit -p tsconfig.json && npm run build` — both clean (pages still pass a single challenge; `availableDifficulties` defaults keep behavior identical).

```bash
git add src/components/ChallengePlayer.tsx
git commit -m "Make CSS player difficulty-set aware"
```

---

### Task 6: TailwindPlayer set-awareness

**Files:**
- Modify: `src/components/TailwindPlayer.tsx`

Mirror Task 5 exactly, with these differences:

- Props interface name stays `TailwindPlayerProps`; same `availableDifficulties?: Difficulty[]` addition, same default, same `multi` const.
- Same fallback effect, same root-div visibility change (the root className string is identical), same switcher-or-badge replacement (the badge JSX is identical).
- Target image: define `const targetSrc = `/targets/tailwind/${challenge.targetImage ?? `${challenge.date}.png`}`;` and replace both `src={`/targets/tailwind/${challenge.date}.png`}` occurrences. (The `shareEntries` modal prop was already added in Task 3.)

- [ ] **Step 1: Apply all changes above** (read the final `ChallengePlayer.tsx` from Task 5 as reference; keep the two files symmetric)
- [ ] **Step 2: Verify** — `npx tsc --noEmit -p tsconfig.json && npm run build`, both clean
- [ ] **Step 3: Commit**

```bash
git add src/components/TailwindPlayer.tsx
git commit -m "Make Tailwind player difficulty-set aware"
```

---

### Task 7: Pages group challenges by date

**Files:**
- Modify: `src/pages/challenge/[date].astro`
- Modify: `src/pages/tailwind/[date].astro`

- [ ] **Step 1: Rewrite `src/pages/challenge/[date].astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';
import Header from '../../components/Header.astro';
import ChallengePlayer from '../../components/ChallengePlayer.tsx';

export async function getStaticPaths() {
  const challengeFiles = import.meta.glob('../../data/challenges/*.json', { eager: true });
  const challenges = Object.values(challengeFiles).map((mod: any) => mod.default || mod);

  const byDate: Record<string, any[]> = {};
  for (const c of challenges) {
    (byDate[c.date] ??= []).push(c);
  }

  const order: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
  const allDates = Object.keys(byDate).sort();

  return Object.entries(byDate).map(([date, set]) => ({
    params: { date },
    props: {
      challenges: set.sort((a, b) => order[a.difficulty] - order[b.difficulty]),
      allDates,
    },
  }));
}

const { challenges, allDates } = Astro.props;
const availableDifficulties = challenges.map((c: any) => c.difficulty);
---
<Layout title={`${challenges[0].date} - CSS Daily`}>
  <div class="flex flex-col h-screen">
    <Header currentPath="/challenge" />
    {challenges.map((challenge: any) => (
      <ChallengePlayer
        client:load
        challenge={challenge}
        allDates={allDates}
        availableDifficulties={availableDifficulties}
      />
    ))}
  </div>
</Layout>
```

- [ ] **Step 2: Rewrite `src/pages/tailwind/[date].astro`** — identical structure with: glob `'../../data/tailwind-challenges/*.json'`, component `TailwindPlayer` (import from `'../../components/TailwindPlayer.tsx'`), `Header currentPath="/tailwind"`, and title `` `${challenges[0].date} - Tailwind Daily` ``.

- [ ] **Step 3: Verify and commit**

`npx tsc --noEmit -p tsconfig.json && npm run build` — clean; the build still emits one page per date (all current dates are single-challenge sets, `availableDifficulties` has length 1, so players render exactly as before — badge, always visible).

```bash
git add src/pages/challenge/[date].astro src/pages/tailwind/[date].astro
git commit -m "Group challenge pages by date for multi-difficulty sets"
```

---

### Task 8: CSS generator — three difficulties per run

**Files:**
- Modify: `scripts/generate-challenge.ts`

- [ ] **Step 1: System prompt changes**

In `SYSTEM_PROMPT`:

1. Replace the first line with:

```
You are a CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained CSS challenge that users will try to replicate. The user prompt names the target difficulty — calibrate the challenge to it.
```

2. After the `SIZING STRATEGY` block, add:

```
DIFFICULTY CRITERIA (the size budget always applies — hard means denser, not bigger):
- easy: 3-5 elements, one flex container, ~8-15 CSS properties in the target, 2-3 colors. A single small card, badge, button group, or alert.
- medium: 6-9 elements, nested flexbox or a simple grid, ~16-30 properties, 3-5 colors. Cards with header/body/footer, profile rows, pricing blocks.
- hard: 10-14 elements, grid AND nested flex, ~30-50 properties, 5+ colors, varied border-radius and typography. Dashboard widgets, media players, stat panels.
```

3. In `OUTPUT FORMAT`, delete the line `<difficulty>easy|medium|hard</difficulty>` (difficulty is assigned by the script now).

- [ ] **Step 2: Rework the script body**

Add to the imports at the top of the file:

```ts
import type { Difficulty } from '../src/utils/types';
import { TIME_LIMITS } from '../src/utils/difficulty';
```

Then replace everything from `const MAX_ATTEMPTS = 4;` down to (but excluding) the CLI block with:

```ts
const MAX_ATTEMPTS = 4; // 1 initial generation + 3 size-fix retries

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

interface ChallengeFields {
  title: string;
  html: string;
  targetCss: string;
  starterCss: string;
}

function extractChallenge(text: string): ChallengeFields {
  const extract = (tag: string): string => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) throw new Error(`Missing <${tag}> in response:\n${text.substring(0, 500)}`);
    return match[1].trim();
  };

  return {
    title: extract('title'),
    html: extract('html'),
    targetCss: extract('targetcss'),
    starterCss: extract('startercss'),
  };
}

function collectRecentTitles(): string[] {
  const titles: string[] = [];
  if (fs.existsSync(CHALLENGES_DIR)) {
    const files = fs.readdirSync(CHALLENGES_DIR).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 30);
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, file), 'utf-8'));
        if (data.title) titles.push(data.title);
      } catch {}
    }
  }
  return titles;
}

/** Generate one challenge at the given difficulty. Returns its title (fed into later calls' avoid-list). */
async function generateOne(
  client: Anthropic,
  page: import('playwright').Page,
  date: string,
  difficulty: Difficulty,
  avoidTitles: string[]
): Promise<string> {
  let userPrompt = `Generate a ${difficulty} CSS challenge for date ${date}.`;
  if (avoidTitles.length > 0) {
    userPrompt += `\n\nRecent challenges (do NOT repeat these themes or similar variations):\n${avoidTitles.map((t) => `- ${t}`).join('\n')}`;
  }

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
  let fields: ChallengeFields | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      messages,
      system: SYSTEM_PROMPT,
    });

    const block = message.content[0];
    if (!block || block.type !== 'text') {
      throw new Error(`Unexpected response content on attempt ${attempt}: ${JSON.stringify(message.content).substring(0, 200)}`);
    }
    const text = block.text;

    let parsed: ChallengeFields;
    try {
      parsed = extractChallenge(text);
    } catch (err) {
      console.warn(`[${difficulty}] Attempt ${attempt}: failed to parse response — ${(err as Error).message}`);
      if (attempt === MAX_ATTEMPTS) throw err;
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: 'Your previous response was missing required XML tags. Output the complete challenge again with ALL of these tags: <title>, <html>, <targetcss>, <startercss>.',
      });
      continue;
    }

    // Render the target and measure the component (this render is also
    // reused for the screenshot once the size is accepted)
    await page.setContent(buildScreenshotHtml(parsed.html, parsed.targetCss), { waitUntil: 'networkidle' });
    // Only assign fields after a successful render so fields, the rendered
    // page, and the eventual screenshot always correspond to the same attempt.
    fields = parsed;
    const size = await measureComponent(page);

    if (!isOversize(size)) {
      console.log(`[${difficulty}] Attempt ${attempt}: component is ${size.width}x${size.height}px — OK`);
      break;
    }

    console.warn(`[${difficulty}] Attempt ${attempt}: component is ${size.width}x${size.height}px (max ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT})`);

    if (attempt === MAX_ATTEMPTS) {
      // Ship it anyway — a slightly clipped challenge beats a missing day
      console.log(`::warning::CSS ${difficulty} challenge for ${date} shipped oversize at ${size.width}x${size.height}px after ${MAX_ATTEMPTS} attempts`);
      break;
    }

    messages.push({ role: 'assistant', content: text });
    messages.push({
      role: 'user',
      content: `Your component rendered at ${size.width}x${size.height}px, which exceeds the ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px maximum. Regenerate the challenge with a more compact layout that fits within ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px — reduce padding, font sizes, or element count as needed. Output all the XML tags again in full.`,
    });
  }

  if (!fields) throw new Error('Generation produced no challenge');

  const challenge = {
    title: fields.title,
    difficulty,
    target: { html: fields.html, css: fields.targetCss },
    starter: { html: fields.html, css: fields.starterCss },
    date,
    timeLimit: TIME_LIMITS[difficulty],
    targetImage: `${date}-${difficulty}.png`,
  };

  fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
  const jsonPath = path.join(CHALLENGES_DIR, `${date}-${difficulty}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
  console.log(`Saved challenge JSON: ${jsonPath}`);

  // Screenshot the last rendered attempt (accepted, or shipped-anyway oversize)
  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  const pngPath = path.join(TARGETS_DIR, `${date}-${difficulty}.png`);
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`Saved target PNG: ${pngPath}`);

  return fields.title;
}

async function generateChallenge(date: string) {
  const client = new Anthropic();

  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    const recentTitles = collectRecentTitles();
    const todaysTitles: string[] = [];
    const failures: Difficulty[] = [];

    for (const difficulty of DIFFICULTIES) {
      try {
        const title = await generateOne(client, page, date, difficulty, [...todaysTitles, ...recentTitles]);
        todaysTitles.push(title);
      } catch (err) {
        console.error(`[${difficulty}] generation failed:`, err);
        console.log(`::warning::CSS ${difficulty} challenge generation failed for ${date}`);
        failures.push(difficulty);
      }
    }

    if (failures.length === DIFFICULTIES.length) {
      throw new Error(`All ${DIFFICULTIES.length} difficulty generations failed for ${date}`);
    }
    if (failures.length > 0) {
      console.warn(`Completed with failures: ${failures.join(', ')}`);
    }
  } finally {
    await browser.close();
  }
}
```

Keep the CLI block at the bottom unchanged (it already calls `generateChallenge(date)` and sets `process.exitCode = 1` on failure).

- [ ] **Step 3: Verify and commit**

`npx tsc --noEmit -p tsconfig.json` — clean.

```bash
git add scripts/generate-challenge.ts
git commit -m "Generate three CSS challenges daily, one per difficulty"
```

---

### Task 9: Tailwind generator — three difficulties per run

**Files:**
- Modify: `scripts/generate-tailwind-challenge.ts`

Mirror Task 8 on the Tailwind script. Read the final `scripts/generate-challenge.ts` as the structural reference; the differences:

1. **System prompt:** first line becomes:

```
You are a Tailwind CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained Tailwind challenge where users add utility classes to HTML elements to match a target design. The user prompt names the target difficulty — calibrate the challenge to it.
```

After the `SIZING STRATEGY` block add:

```
DIFFICULTY CRITERIA (the size budget always applies — hard means denser, not bigger):
- easy: 3-5 elements, one flex container, ~2-5 utility classes per element, 2-3 colors. A single small card, badge, button group, or alert.
- medium: 6-9 elements, nested flexbox or a simple grid, ~4-8 utilities per element, 3-5 colors. Cards with header/body/footer, profile rows, pricing blocks.
- hard: 10-14 elements, grid AND nested flex, ~6-12 utilities per element, 5+ colors, varied rounding and typography. Dashboard widgets, media players, stat panels.
```

Delete the `<difficulty>easy|medium|hard</difficulty>` line from `OUTPUT FORMAT`.

2. **Fields:** `TailwindChallengeFields { title; targetHtml; starterHtml; }` (difficulty removed); extraction tags `<title>`, `<targethtml>`, `<starterhtml>`; keep the existing `class="\s*"` → `class="  "` normalization on `starterHtml`.
3. **Parse-retry message tag list:** `<title>, <targethtml>, <starterhtml>`.
4. **Render call:** `buildTailwindScreenshotHtml(parsed.targetHtml)`.
5. **Challenge object** (keeping existing Tailwind field order, plus `targetImage`):

```ts
  const challenge = {
    title: fields.title,
    difficulty,
    date,
    timeLimit: TIME_LIMITS[difficulty],
    starter: { html: fields.starterHtml },
    target: { html: fields.targetHtml },
    targetImage: `${date}-${difficulty}.png`,
  };
```

6. **Log/warning wording:** "Tailwind" everywhere the reference says "CSS" (e.g. `::warning::Tailwind ${difficulty} challenge ...`), "reduce padding, text sizes, or element count" in the oversize retry message, `Saved Tailwind challenge JSON:` / `Saved Tailwind target PNG:`.
7. Save paths unchanged (`src/data/tailwind-challenges/`, `public/targets/tailwind/`); filenames gain `-${difficulty}`.

- [ ] **Step 1: Apply all changes above**
- [ ] **Step 2: Verify** — `npx tsc --noEmit -p tsconfig.json`, clean
- [ ] **Step 3: Commit**

```bash
git add scripts/generate-tailwind-challenge.ts
git commit -m "Generate three Tailwind challenges daily, one per difficulty"
```

---

### Task 10: End-to-end verification

Nothing committed from this task; fixtures and smoke scripts are temporary.

- [ ] **Step 1: Create multi-difficulty fixtures for a sentinel date**

Copy an existing challenge to three fixture difficulties (adjusting `difficulty`, `title`, `timeLimit`, and adding `targetImage`), and copy its PNG three times. Run from the repo root:

```bash
node -e "
const fs = require('fs');
const base = JSON.parse(fs.readFileSync('src/data/challenges/2026-06-11.json', 'utf-8'));
for (const [d, t] of [['easy', 300], ['medium', 600], ['hard', 900]]) {
  const c = { ...base, date: '2099-01-01', difficulty: d, title: base.title + ' (' + d + ')', timeLimit: t, targetImage: '2099-01-01-' + d + '.png' };
  fs.writeFileSync('src/data/challenges/2099-01-01-' + d + '.json', JSON.stringify(c, null, 2));
  fs.copyFileSync('public/targets/2026-06-11.png', 'public/targets/2099-01-01-' + d + '.png');
}
console.log('fixtures written');
"
npm run build
npm run preview &
sleep 3
```

- [ ] **Step 2: Write and run the smoke script**

Write `multi-difficulty-smoke.ts` at the repo root:

```ts
import { chromium } from 'playwright';

const MULTI_URL = 'http://localhost:4321/challenge/2099-01-01';
const LEGACY_URL = 'http://localhost:4321/challenge/2026-06-11';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const visiblePlayers = () =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('div.flex-1.bg-gray-900'))
      .filter((el) => getComputedStyle(el).display !== 'none').length
  );
const difficultyAttr = () => page.evaluate(() => document.documentElement.dataset.difficulty);

// 1. Multi-difficulty page: defaults to medium, exactly one player visible
await page.goto(MULTI_URL, { waitUntil: 'networkidle' });
if ((await difficultyAttr()) !== 'medium') fail('default difficulty should be medium');
if ((await visiblePlayers()) !== 1) fail('exactly one player should be visible');
if (!(await page.getByRole('button', { name: 'hard' }).first().isVisible())) fail('switcher should be visible on multi pages');

// 2. Switch to hard: attribute flips, still exactly one visible, title updates
await page.getByRole('button', { name: 'hard' }).first().click();
if ((await difficultyAttr()) !== 'hard') fail('clicking hard should set data-difficulty=hard');
if ((await visiblePlayers()) !== 1) fail('exactly one player should be visible after switch');
if (!(await page.getByText('(hard)').first().isVisible())) fail('hard challenge title should be visible');

// 3. Preference persists pre-paint across reload
await page.reload({ waitUntil: 'commit' });
const early = await page.evaluate(() => document.documentElement.dataset.difficulty);
if (early !== 'hard') fail('difficulty should be hard at document commit (pre-paint)');

// 4. Legacy single-challenge page: player visible even though preference is hard (challenge is medium), no switcher
await page.goto(LEGACY_URL, { waitUntil: 'networkidle' });
if ((await visiblePlayers()) !== 1) fail('legacy page should show its single player');
if ((await page.getByRole('button', { name: 'easy' }).count()) !== 0) fail('legacy page should not render a switcher');

// 5. Storage migration: seed v1 flat history, verify stats read + rewrite nested
await page.evaluate(() => {
  localStorage.setItem('css-daily-challenge', JSON.stringify({
    history: { '2026-04-01': { date: '2026-04-01', score: 85, timeSpent: 300, submittedCss: 'x' } },
  }));
});
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Stats' }).first().click();
if (!(await page.getByText('M 85%').first().isVisible({ timeout: 3000 }).catch(() => false))) {
  // chip renders as "M<thinsp>85%" — match loosely
  const chip = await page.getByText(/M.?85%/).first().isVisible().catch(() => false);
  if (!chip) fail('migrated legacy result should appear as a medium chip in stats');
}
const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem('css-daily-challenge')!));
if (!migrated.history['2026-04-01'].medium || migrated.history['2026-04-01'].medium.score !== 85) {
  fail('legacy history should be rewritten nested under medium');
}

console.log('PASS');
await browser.close();
```

Run: `npx tsx multi-difficulty-smoke.ts` → `PASS`. If any assertion fails, fix the implementation — do not weaken assertions.

- [ ] **Step 3: Clean up fixtures**

```bash
rm multi-difficulty-smoke.ts
rm src/data/challenges/2099-01-01-*.json public/targets/2099-01-01-*.png
pkill -f "astro preview" || true
git status
```

Expected: clean tree.

- [ ] **Step 4: Live generator run (requires ANTHROPIC_API_KEY — present in the gitignored `.env`; ~6 Sonnet calls, ~$0.10)**

```bash
set -a; source .env; set +a
npx tsx scripts/generate-challenge.ts 2099-01-02
npx tsx scripts/generate-tailwind-challenge.ts 2099-01-02
```

Expected: each script logs three `[easy]`/`[medium]`/`[hard]` generation sequences with size measurements and saves six files total per mode-pair (`2099-01-02-{easy,medium,hard}.json` + PNGs). Inspect one JSON per mode: `difficulty` matches the filename, `targetImage` present, structure matches existing files otherwise. Open the three CSS PNGs and confirm a visible complexity gradient (easy notably simpler than hard).

- [ ] **Step 5: Full-stack check with real generated data, then clean up**

```bash
npm run build
npm run preview &
sleep 3
```

Manually open `http://localhost:4321/challenge/2099-01-02` — switcher shows all three; switching swaps target images and editors. Then:

```bash
pkill -f "astro preview" || true
rm src/data/challenges/2099-01-02-*.json public/targets/2099-01-02-*.png
rm src/data/tailwind-challenges/2099-01-02-*.json public/targets/tailwind/2099-01-02-*.png
git status
```

Expected: clean tree; only the Task 1–9 commits on the branch.
