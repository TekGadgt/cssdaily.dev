# Structural Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blend an element-level IoU metric (rewards right elements, right places, right sizes) into the existing pixel-diff score, measured entirely client-side in the diff pipeline's hidden iframes.

**Architecture:** A new pure module `src/utils/structural.ts` holds the rect/IoU/blend math (smoke-testable in node). `src/utils/diff.ts` measures `getBoundingClientRect` for every element in both hidden-iframe renders (user and target — same engine, same 600×400 viewport), pairs them by document order, and blends mean IoU with the power-curved pixel score at 60/40. `DiffResult` carries the components so the score display can show a breakdown tooltip. No generator, JSON, or storage changes; applies to every challenge including legacy. Spec: `docs/superpowers/specs/2026-06-10-quality-improvements-design.md` (Package 4, revised section).

**Tech Stack:** TypeScript, snapdom diff pipeline (existing), React 19. No test framework — do not add one; verification is temporary smoke scripts (repo root, relative imports, deleted after) plus a Playwright browser check.

**Context for the implementing engineer:**
- Read `src/utils/diff.ts` fully first. Scoring is fully client-side: `compareToTarget(html, userCss, targetCss, opts)` renders BOTH the user's CSS and the target CSS in hidden iframes via `renderAndCapture`, captures canvases with snapdom, and computes a pixel score in `computeDiffScore`. The Tailwind twin is `compareToTargetTailwind`/`renderAndCaptureTailwind`. The target PNG shipped by CI is only a visual reference, never a scoring input.
- HTML structure is identical between user and target renders by construction (CSS mode shares the HTML string; Tailwind mode locks edits to class values), so `querySelectorAll('*')` yields 1:1 element lists. If lengths differ anyway (corrupted markup), structural scoring must be skipped — pixel-only, never misaligned pairs.
- Both iframes are 600×400; rects compare directly, no scaling.
- Temp verification scripts live at the repo root with relative imports and are deleted before commit — never absolute paths, never /tmp.

**File map:**
- Create: `src/utils/structural.ts` (ElementRect, rectIoU, computeStructuralScore, weights, blendScores)
- Modify: `src/utils/diff.ts` (measure rects in both render paths, thread through, blend)
- Modify: `src/utils/types.ts` (DiffResult gains `pixelScore`, `structuralScore`)
- Modify: `src/components/ScoreDisplay.tsx` (optional breakdown tooltip)
- Modify: `src/components/ChallengePlayer.tsx`, `src/components/TailwindPlayer.tsx` (pass breakdown)

---

### Task 1: Pure structural-scoring module

**Files:**
- Create: `src/utils/structural.ts`

- [ ] **Step 1: Create `src/utils/structural.ts`**

```ts
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Final score = PIXEL_WEIGHT * pixelScore + STRUCTURAL_WEIGHT * structural*100.
// Tunable. The structural component is linear for now; if unstyled-starter
// inflation shows up in practice (default block layout already overlaps
// targets), a power curve like the pixel score's SCORE_EXPONENT is the knob.
export const PIXEL_WEIGHT = 0.6;
export const STRUCTURAL_WEIGHT = 0.4;

/**
 * Intersection-over-union of two viewport-relative rects. 0 when disjoint;
 * two zero-area rects (e.g. both hidden) count as a match.
 */
export function rectIoU(a: ElementRect, b: ElementRect): number {
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA === 0 && areaB === 0) return 1;

  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Mean IoU across 1:1 element pairs (matched by document order), 0..1.
 * Returns null when the lists can't be paired (length mismatch — corrupted
 * markup) or there is nothing to measure; callers fall back to pixel-only.
 */
export function computeStructuralScore(
  userRects: ElementRect[],
  targetRects: ElementRect[]
): number | null {
  if (userRects.length !== targetRects.length || targetRects.length === 0) return null;
  const total = targetRects.reduce((sum, t, i) => sum + rectIoU(userRects[i], t), 0);
  return total / targetRects.length;
}

/**
 * Blend the power-curved pixel score (0-100 int) with the structural score
 * (0..1 or null). Null structural -> pixel-only.
 */
export function blendScores(pixelScore: number, structural: number | null): number {
  if (structural === null) return pixelScore;
  return Math.round(PIXEL_WEIGHT * pixelScore + STRUCTURAL_WEIGHT * structural * 100);
}
```

- [ ] **Step 2: Smoke-test the pure functions**

Write `structural-smoke.ts` at the repo root (delete after):

```ts
import { rectIoU, computeStructuralScore, blendScores } from './src/utils/structural';

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function approx(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

// Identical rects -> 1
if (!approx(rectIoU(r(10, 10, 100, 50), r(10, 10, 100, 50)), 1)) fail('identical rects should be IoU 1');
// Disjoint -> 0
if (rectIoU(r(0, 0, 10, 10), r(100, 100, 10, 10)) !== 0) fail('disjoint rects should be IoU 0');
// Half-width overlap of equal rects: inter=50x10=500, union=1000+1000-500=1500 -> 1/3
if (!approx(rectIoU(r(0, 0, 100, 10), r(50, 0, 100, 10)), 1 / 3)) fail('half overlap should be 1/3');
// Contained rect: inter=2500, union=10000 -> 0.25
if (!approx(rectIoU(r(0, 0, 100, 100), r(25, 25, 50, 50)), 0.25)) fail('contained rect should be 0.25');
// Both zero-area -> 1 (hidden elements match)
if (rectIoU(r(5, 5, 0, 0), r(50, 50, 0, 0)) !== 1) fail('two zero-area rects should match');
// One zero-area -> 0
if (rectIoU(r(0, 0, 0, 0), r(0, 0, 10, 10)) !== 0) fail('one zero-area rect should be 0');

// Mean across pairs: [1, 0] -> 0.5
const s = computeStructuralScore(
  [r(0, 0, 10, 10), r(0, 0, 10, 10)],
  [r(0, 0, 10, 10), r(100, 100, 10, 10)]
);
if (s === null || !approx(s, 0.5)) fail(`mean IoU should be 0.5, got ${s}`);
// Length mismatch -> null
if (computeStructuralScore([r(0, 0, 1, 1)], []) !== null) fail('mismatched lengths should be null');
// Empty -> null
if (computeStructuralScore([], []) !== null) fail('empty lists should be null');

// Blend: null structural -> pixel passthrough
if (blendScores(73, null) !== 73) fail('null structural should pass pixel through');
// Blend: 0.6*80 + 0.4*50 = 68
if (blendScores(80, 0.5) !== 68) fail(`blend(80, 0.5) should be 68, got ${blendScores(80, 0.5)}`);
// Perfect both -> 100
if (blendScores(100, 1) !== 100) fail('perfect both should be 100');

console.log('PASS');
```

Run: `npx tsx structural-smoke.ts` → `PASS`, then `rm structural-smoke.ts`.

- [ ] **Step 3: Type-check and commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/utils/structural.ts
git commit -m "Add pure structural scoring module (IoU + blend)"
```

---

### Task 2: Wire measurement and blending into the diff pipeline

**Files:**
- Modify: `src/utils/types.ts`
- Modify: `src/utils/diff.ts`

- [ ] **Step 1: Extend `DiffResult`**

In `src/utils/types.ts`, replace:

```ts
export interface DiffResult {
  score: number;
  diffCanvas: HTMLCanvasElement;
  heatmapCanvas: HTMLCanvasElement;
}
```

with:

```ts
export interface DiffResult {
  /** Blended display score (pixel-only when structuralScore is null) */
  score: number;
  /** Power-curved pixel diff component, 0-100 */
  pixelScore: number;
  /** Mean element IoU component, 0-100; null when element lists couldn't be paired */
  structuralScore: number | null;
  diffCanvas: HTMLCanvasElement;
  heatmapCanvas: HTMLCanvasElement;
}
```

- [ ] **Step 2: Measure rects in both render paths**

In `src/utils/diff.ts`:

Add to the imports:

```ts
import { computeStructuralScore, blendScores, type ElementRect } from './structural';
```

Add this helper above `renderAndCapture`:

```ts
/** Viewport-relative rects for every element in body, in document order */
function measureElementRects(doc: Document): ElementRect[] {
  return Array.from(doc.body.querySelectorAll('*')).map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}
```

Change `renderAndCapture`'s signature and return so it also returns rects — from:

```ts
export async function renderAndCapture(
  html: string,
  css: string,
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
```

to:

```ts
export async function renderAndCapture(
  html: string,
  css: string,
  width: number,
  height: number
): Promise<{ canvas: HTMLCanvasElement; rects: ElementRect[] }> {
```

Inside, after the existing `body.getBoundingClientRect(); // Force layout` line, add:

```ts
    const rects = measureElementRects(doc);
```

and change the function's `return canvas;` to `return { canvas, rects };`.

Apply the identical change to `renderAndCaptureTailwind` (same return-type change; add `const rects = measureElementRects(iframe.contentDocument!);` after its `body.getBoundingClientRect(); // Force layout` line; return `{ canvas, rects }`).

- [ ] **Step 3: Blend in both compare functions**

Replace `compareToTarget`'s body — from:

```ts
  const [userCanvas, targetCanvas] = await Promise.all([
    renderAndCapture(html, userCss, width, height),
    renderAndCapture(html, targetCss, width, height),
  ]);

  return computeDiffScore(userCanvas, targetCanvas, width, height);
```

to:

```ts
  const [user, target] = await Promise.all([
    renderAndCapture(html, userCss, width, height),
    renderAndCapture(html, targetCss, width, height),
  ]);

  return buildDiffResult(user, target, width, height);
```

Same for `compareToTargetTailwind` — from:

```ts
  const [userCanvas, targetCanvas] = await Promise.all([
    renderAndCaptureTailwind(userHtml, width, height),
    renderAndCaptureTailwind(targetHtml, width, height),
  ]);

  return computeDiffScore(userCanvas, targetCanvas, width, height);
```

to:

```ts
  const [user, target] = await Promise.all([
    renderAndCaptureTailwind(userHtml, width, height),
    renderAndCaptureTailwind(targetHtml, width, height),
  ]);

  return buildDiffResult(user, target, width, height);
```

Add the shared assembly function next to `computeDiffScore` (which keeps returning the pixel-only result — do not change it):

```ts
/** Assemble the final DiffResult: pixel diff + structural IoU, blended */
function buildDiffResult(
  user: { canvas: HTMLCanvasElement; rects: ElementRect[] },
  target: { canvas: HTMLCanvasElement; rects: ElementRect[] },
  width: number,
  height: number
): DiffResult {
  const pixel = computeDiffScore(user.canvas, target.canvas, width, height);
  const structural = computeStructuralScore(user.rects, target.rects);

  return {
    score: blendScores(pixel.score, structural),
    pixelScore: pixel.score,
    structuralScore: structural === null ? null : Math.round(structural * 100),
    diffCanvas: pixel.diffCanvas,
    heatmapCanvas: pixel.heatmapCanvas,
  };
}
```

`computeDiffScore`'s declared return type is `DiffResult`, which now has more fields — change its return type annotation to the structural-free inline type:

```ts
function computeDiffScore(
  userCanvas: HTMLCanvasElement,
  targetCanvas: HTMLCanvasElement,
  width: number,
  height: number
): { score: number; diffCanvas: HTMLCanvasElement; heatmapCanvas: HTMLCanvasElement } {
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: both clean (players only read `result.score` and the canvases today, so the extra fields are additive).

- [ ] **Step 5: Commit**

```bash
git add src/utils/types.ts src/utils/diff.ts
git commit -m "Blend element IoU structural score into the diff pipeline"
```

---

### Task 3: Score breakdown tooltip

**Files:**
- Modify: `src/components/ScoreDisplay.tsx`
- Modify: `src/components/ChallengePlayer.tsx`
- Modify: `src/components/TailwindPlayer.tsx`

- [ ] **Step 1: Add an optional breakdown to ScoreDisplay**

Replace `src/components/ScoreDisplay.tsx` with:

```tsx
interface ScoreDisplayProps {
  score: number;
  /** Component scores for the hover tooltip; absent until the first diff */
  breakdown?: {
    pixelScore: number;
    structuralScore: number | null;
  };
}

export default function ScoreDisplay({ score, breakdown }: ScoreDisplayProps) {
  let color = 'text-red-400';
  if (score >= 80) color = 'text-green-400';
  else if (score >= 50) color = 'text-yellow-400';

  const title = breakdown
    ? breakdown.structuralScore === null
      ? `Pixel match ${breakdown.pixelScore}%`
      : `Pixel match ${breakdown.pixelScore}% · Structure ${breakdown.structuralScore}%`
    : undefined;

  return (
    <span className={`font-mono text-lg font-bold ${color}`} title={title}>
      {score}%
    </span>
  );
}
```

- [ ] **Step 2: Pass the breakdown from both players**

In `src/components/ChallengePlayer.tsx` AND `src/components/TailwindPlayer.tsx`, change:

```tsx
<ScoreDisplay score={displayScore} />
```

to:

```tsx
<ScoreDisplay
  score={displayScore}
  breakdown={diffResult ? { pixelScore: diffResult.pixelScore, structuralScore: diffResult.structuralScore } : undefined}
/>
```

(Both players already hold `diffResult` state of type `DiffResult | null`.)

- [ ] **Step 3: Type-check, build, commit**

```bash
npx tsc --noEmit -p tsconfig.json && npm run build
git add src/components/ScoreDisplay.tsx src/components/ChallengePlayer.tsx src/components/TailwindPlayer.tsx
git commit -m "Show pixel/structure score breakdown tooltip"
```

---

### Task 4: Browser verification

Nothing committed from this task; the smoke script is temporary.

- [ ] **Step 1: Build and start the preview server**

```bash
npm run build
npm run preview &
sleep 3
```

- [ ] **Step 2: Write and run the E2E smoke**

Pick the latest CSS challenge date: `ls src/data/challenges/ | tail -1` (e.g. `2026-06-12.json`). Write `scoring-smoke.ts` at the repo root, substituting that date in both places:

```ts
import { chromium } from 'playwright';
import * as fs from 'fs';

const DATE = '2026-06-12';
const challenge = JSON.parse(fs.readFileSync(`src/data/challenges/${DATE}.json`, 'utf-8'));

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://localhost:4321/challenge/${DATE}`, { waitUntil: 'networkidle' });

// Type the COMPLETE target CSS into the editor (select-all replaces the starter)
await page.locator('.cm-content').first().click();
await page.keyboard.press('ControlOrMeta+a');
await page.keyboard.insertText(challenge.target.css);

// Debounced diff runs 1.5s after the last edit; give rendering headroom
await page.waitForTimeout(4000);

const scoreEl = page.locator('span.font-mono.text-lg.font-bold', { hasText: '%' }).first();
const scoreText = await scoreEl.textContent();
const score = parseInt(scoreText ?? '0', 10);
const title = await scoreEl.getAttribute('title');
console.log(`score with exact target CSS: ${score}%, tooltip: "${title}"`);

// Exact target CSS should produce a near-perfect blended score
if (score < 95) fail(`exact target CSS should score >=95, got ${score}`);
// Tooltip must report both components, structure near-perfect
if (!title || !/Structure (9[5-9]|100)%/.test(title)) fail(`tooltip should show near-perfect structure, got "${title}"`);
if (!/Pixel match \d+%/.test(title)) fail(`tooltip should show pixel component, got "${title}"`);

console.log('PASS');
await browser.close();
```

Run: `npx tsx scoring-smoke.ts`
Expected: `PASS` with score ≥95 and a tooltip like `Pixel match 100% · Structure 100%`. If the score is high but structure is unexpectedly low, investigate rect measurement timing (fonts/rendering) before weakening anything.

- [ ] **Step 3: Manual sanity check (human)**

With `npm run dev`, play a challenge normally: the score should move as you type, the tooltip should show both components, and getting boxes to the right size/place should now visibly pay even before colors match.

- [ ] **Step 4: Clean up**

```bash
rm scoring-smoke.ts
pkill -f "astro preview" || true
git status
```

Expected: clean tree; only the Task 1–3 commits on the branch.
