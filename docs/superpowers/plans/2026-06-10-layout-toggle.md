# Layout Toggle (Rows ⇄ Columns) Implementation Plan

> **Status: COMPLETED 2026-06-10, with an architecture change during review.** The React-state approach below caused a rows→columns flash on every page navigation (each date is a separate static page; state hydrated post-mount). The shipped design instead stamps `data-layout` on `<html>` via a blocking inline script in `Layout.astro` before first paint, with all layout-dependent classes as static Tailwind data-attribute variants (`[[data-layout=columns]_&]:...`). `LayoutToggle` is stateless (flips the attribute + saves), players hold no layout state, `getLayoutPreference` was dropped, and the preview column uses `justify-around` plus the container `w-full` (auto cross-axis margins disable flex stretch, so `mx-auto` alone shrink-wrapped the container). The smoke test was adapted to assert the attribute pre-paint and passed. Task details below reflect the original plan, kept for history.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manual layout toggle in both challenge players that switches between the current rows layout (previews on top, editor below) and a columns layout (previews stacked on the left, editor on the right), persisted to localStorage.

**Architecture:** A `LayoutMode` type and two localStorage helpers go in the existing `src/utils/types.ts` / `src/utils/storage.ts`. A small `LayoutToggle` button component renders in each player's header. Each player holds `layout` state (default `'rows'`, hydrated from localStorage in an effect to avoid SSR/hydration mismatch — Astro pre-renders these components at build time where localStorage doesn't exist) and switches the main-content flex classes conditionally. Both players share one preference key. Spec: `docs/superpowers/specs/2026-06-10-quality-improvements-design.md` (Package 2).

**Tech Stack:** React 19, Tailwind CSS (build-time JIT), Astro static output. No test framework exists in this repo — do not add one; verification is `npm run build` plus a temporary in-repo Playwright smoke script (deleted after use, never committed, relative imports only).

**Context for the implementing engineer:**
- The two players, `src/components/ChallengePlayer.tsx` and `src/components/TailwindPlayer.tsx`, have intentionally parallel structures. Keep edits symmetric.
- Preview panels are fixed 600×400 boxes (the iframes must render at exactly this size for diff fidelity — do NOT scale or resize them). In columns mode the stacked previews may exceed viewport height; the preview column gets `overflow-y-auto`.
- Never write absolute machine paths into any file. Temporary scripts live at the repo root with relative imports and are deleted before commit.

---

### Task 1: LayoutMode type, storage helpers, and LayoutToggle component

**Files:**
- Modify: `src/utils/types.ts` (append)
- Modify: `src/utils/storage.ts` (append)
- Create: `src/components/LayoutToggle.tsx`

- [ ] **Step 1: Add the `LayoutMode` type**

Append to `src/utils/types.ts`:

```ts
/** Player layout arrangement: rows = previews above editor; columns = previews left, editor right */
export type LayoutMode = 'rows' | 'columns';
```

- [ ] **Step 2: Add layout preference helpers**

Append to `src/utils/storage.ts` (and add `LayoutMode` to the existing type import at the top of the file):

```ts
const LAYOUT_KEY = 'css-daily-layout';

export function getLayoutPreference(): LayoutMode {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw === 'rows' || raw === 'columns') return raw;
  } catch {}
  return 'rows';
}

export function saveLayoutPreference(layout: LayoutMode): void {
  try {
    localStorage.setItem(LAYOUT_KEY, layout);
  } catch {}
}
```

The try/catch guards matter: these are also safe to call in non-browser contexts, and a corrupted stored value falls back to `'rows'`.

- [ ] **Step 3: Create the LayoutToggle component**

Create `src/components/LayoutToggle.tsx`. The button shows the icon of the layout it will switch TO (like a play/pause button), styled to match the existing Stats button:

```tsx
import type { LayoutMode } from '../utils/types';

interface LayoutToggleProps {
  layout: LayoutMode;
  onChange: (layout: LayoutMode) => void;
}

export default function LayoutToggle({ layout, onChange }: LayoutToggleProps) {
  const next: LayoutMode = layout === 'rows' ? 'columns' : 'rows';
  return (
    <button
      onClick={() => onChange(next)}
      title={`Switch to ${next} layout`}
      aria-label={`Switch to ${next} layout`}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition"
    >
      {next === 'columns' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6.5" rx="1" />
          <rect x="1" y="8.5" width="6" height="6.5" rx="1" />
          <rect x="8.5" y="1" width="6.5" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6.5" height="6" rx="1" />
          <rect x="8.5" y="1" width="6.5" height="6" rx="1" />
          <rect x="1" y="8.5" width="14" height="6.5" rx="1" />
        </svg>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/types.ts src/utils/storage.ts src/components/LayoutToggle.tsx
git commit -m "Add layout preference storage and LayoutToggle component"
```

---

### Task 2: Wire the toggle into ChallengePlayer

**Files:**
- Modify: `src/components/ChallengePlayer.tsx`

- [ ] **Step 1: Update imports**

Change:

```tsx
import type { Challenge, DiffResult } from '../utils/types';
import { compareToTarget } from '../utils/diff';
import { saveResult, getResult } from '../utils/storage';
```

to:

```tsx
import type { Challenge, DiffResult, LayoutMode } from '../utils/types';
import { compareToTarget } from '../utils/diff';
import { saveResult, getResult, getLayoutPreference, saveLayoutPreference } from '../utils/storage';
```

And add below the other component imports:

```tsx
import LayoutToggle from './LayoutToggle';
```

- [ ] **Step 2: Add layout state**

Next to the other `useState` declarations at the top of the component body, add:

```tsx
const [layout, setLayout] = useState<LayoutMode>('rows');
```

Below the existing "Check for existing result" `useEffect`, add (separate effect — don't merge them):

```tsx
// Hydrate layout preference after mount (localStorage is unavailable during Astro's build-time render)
useEffect(() => {
  setLayout(getLayoutPreference());
}, []);

const handleLayoutChange = useCallback((l: LayoutMode) => {
  setLayout(l);
  saveLayoutPreference(l);
}, []);
```

- [ ] **Step 3: Add the toggle button to the header**

In the header's right-hand button group, insert `<LayoutToggle ... />` immediately BEFORE the Stats button:

```tsx
<LayoutToggle layout={layout} onChange={handleLayoutChange} />
<button
  onClick={() => setShowHistory(true)}
  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition"
>
  Stats
</button>
```

- [ ] **Step 4: Make the main content layout conditional**

Change the main-content wrapper and preview-panels wrapper from:

```tsx
{/* Main Content */}
<div className="max-w-7xl mx-auto p-4 flex flex-col flex-1 min-h-0">
  {/* Preview panels */}
  <div className="flex justify-between mb-4 flex-shrink-0">
```

to:

```tsx
{/* Main Content */}
<div className={`max-w-7xl mx-auto p-4 flex flex-1 min-h-0 ${layout === 'columns' ? 'flex-row gap-4' : 'flex-col'}`}>
  {/* Preview panels */}
  <div className={layout === 'columns' ? 'flex flex-col gap-4 flex-shrink-0 overflow-y-auto' : 'flex justify-between mb-4 flex-shrink-0'}>
```

And change the editor wrapper from:

```tsx
{/* Code Editor */}
<div className="rounded-lg overflow-hidden border border-gray-700 flex-1 min-h-0">
```

to:

```tsx
{/* Code Editor */}
<div className="rounded-lg overflow-hidden border border-gray-700 flex-1 min-h-0 min-w-0">
```

(`min-w-0` lets the editor shrink properly as a flex-row item; it's a no-op in rows mode. Everything inside the two preview panel divs stays untouched — the fixed 600×400 preview boxes must not change.)

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/ChallengePlayer.tsx
git commit -m "Add rows/columns layout toggle to CSS challenge player"
```

---

### Task 3: Wire the toggle into TailwindPlayer

**Files:**
- Modify: `src/components/TailwindPlayer.tsx`

Mirror Task 2 exactly. The structures are parallel; the class strings being replaced are identical.

- [ ] **Step 1: Update imports**

Change:

```tsx
import type { TailwindChallenge, DiffResult } from '../utils/types';
import { compareToTargetTailwind } from '../utils/diff';
import { saveTailwindResult, getTailwindResult, getTailwindHistory, getTailwindStats } from '../utils/storage';
```

to:

```tsx
import type { TailwindChallenge, DiffResult, LayoutMode } from '../utils/types';
import { compareToTargetTailwind } from '../utils/diff';
import { saveTailwindResult, getTailwindResult, getTailwindHistory, getTailwindStats, getLayoutPreference, saveLayoutPreference } from '../utils/storage';
```

And add below the other component imports:

```tsx
import LayoutToggle from './LayoutToggle';
```

- [ ] **Step 2: Add layout state**

Same as Task 2 Step 2, in the same positions:

```tsx
const [layout, setLayout] = useState<LayoutMode>('rows');
```

```tsx
// Hydrate layout preference after mount (localStorage is unavailable during Astro's build-time render)
useEffect(() => {
  setLayout(getLayoutPreference());
}, []);

const handleLayoutChange = useCallback((l: LayoutMode) => {
  setLayout(l);
  saveLayoutPreference(l);
}, []);
```

- [ ] **Step 3: Add the toggle button to the header**

Insert immediately BEFORE the Stats button, identical to Task 2 Step 3:

```tsx
<LayoutToggle layout={layout} onChange={handleLayoutChange} />
```

- [ ] **Step 4: Make the main content layout conditional**

Identical replacements to Task 2 Step 4:

```tsx
{/* Main Content */}
<div className={`max-w-7xl mx-auto p-4 flex flex-1 min-h-0 ${layout === 'columns' ? 'flex-row gap-4' : 'flex-col'}`}>
  {/* Preview panels */}
  <div className={layout === 'columns' ? 'flex flex-col gap-4 flex-shrink-0 overflow-y-auto' : 'flex justify-between mb-4 flex-shrink-0'}>
```

And the editor wrapper (the comment above it reads `{/* Tailwind Editor */}`):

```tsx
{/* Tailwind Editor */}
<div className="rounded-lg overflow-hidden border border-gray-700 flex-1 min-h-0 min-w-0">
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/TailwindPlayer.tsx
git commit -m "Add rows/columns layout toggle to Tailwind challenge player"
```

---

### Task 4: Behavior verification (toggle, persistence, cross-mode sharing)

No files are committed in this task. The smoke script is temporary, lives at the repo root, and is deleted at the end.

- [ ] **Step 1: Build and start the preview server**

```bash
npm run build
npm run preview &
sleep 3
```

The site serves at `http://localhost:4321`.

- [ ] **Step 2: Write the smoke script**

Pick an existing challenge date first: `ls src/data/challenges/ | tail -1` (e.g. `2026-04-09.json` → date `2026-04-09`). Use it (and the matching latest from `src/data/tailwind-challenges/`) in place of the dates below if different.

Write `layout-smoke.ts` at the repo root:

```ts
import { chromium } from 'playwright';

const CSS_URL = 'http://localhost:4321/challenge/2026-04-09';
const TW_URL = 'http://localhost:4321/tailwind/2026-04-09';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

// 1. Default layout is rows
await page.goto(CSS_URL, { waitUntil: 'networkidle' });
const main = page.locator('div.max-w-7xl.p-4');
if (!((await main.getAttribute('class'))?.includes('flex-col'))) fail('default layout should be rows (flex-col)');

// 2. Toggle switches to columns
await page.getByRole('button', { name: 'Switch to columns layout' }).click();
if (!((await main.getAttribute('class'))?.includes('flex-row'))) fail('toggle should switch to columns (flex-row)');

// 3. Preference persists across reload
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(500); // post-mount hydration effect
if (!((await main.getAttribute('class'))?.includes('flex-row'))) fail('columns preference should persist across reload');

// 4. Preference is shared with the Tailwind player
await page.goto(TW_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
const twMain = page.locator('div.max-w-7xl.p-4');
if (!((await twMain.getAttribute('class'))?.includes('flex-row'))) fail('Tailwind player should share the columns preference');

// 5. Toggle back to rows from the Tailwind player
await page.getByRole('button', { name: 'Switch to rows layout' }).click();
if (!((await twMain.getAttribute('class'))?.includes('flex-col'))) fail('toggle back to rows should work');

console.log('PASS');
await browser.close();
```

- [ ] **Step 3: Run it**

```bash
npx tsx layout-smoke.ts
```

Expected output: `PASS`. If any step fails, fix the implementation (Tasks 1–3), rebuild, and re-run — do not weaken the assertions.

- [ ] **Step 4: Clean up**

```bash
rm layout-smoke.ts
kill %1 2>/dev/null || pkill -f "astro preview" || true
git status
```

Expected: clean tree (only the three commits from Tasks 1–3 on the branch).

- [ ] **Step 5: Visual spot-check (manual, controller/user)**

Run `npm run dev`, open a challenge, click the toggle: previews should stack vertically on the left with the editor filling the right; preview column scrolls if the window is short. Toggle back: original layout. This step is for the human to eyeball aesthetics — the structural behavior is already covered by the smoke script.
