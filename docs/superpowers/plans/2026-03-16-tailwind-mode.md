# Tailwind Challenge Mode Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Tailwind CSS challenge mode at `/tailwind/[date]` where players edit only `class` attribute values to match a target screenshot, with autocomplete, scoring, generation pipeline, and security mitigations.

**Architecture:** New parallel challenge mode sharing the same game shell (timer, scoring, history, results) but with a class-only CodeMirror editor, Tailwind CDN rendering in iframes, and a separate generation pipeline. Shared components (HistoryView, ResultsModal) get parameterized with `basePath` for reuse.

**Tech Stack:** Astro 5.x, React 19, CodeMirror 6 (transaction filters, decorations, custom CompletionSource), Tailwind CDN (`cdn.tailwindcss.com`), @zumer/snapdom, Playwright, Claude API

**Spec:** `docs/superpowers/specs/2026-03-16-tailwind-mode-design.md`

---

## Chunk 1: Foundation — Types, Storage, CSS Prompt Tightening

### Task 1: Tighten CSS generation prompt constraints

**Files:**
- Modify: `scripts/generate-challenge.ts:12-33` (SYSTEM_PROMPT)

- [ ] **Step 1: Update the SYSTEM_PROMPT size constraints**

In `scripts/generate-challenge.ts`, replace the two size constraint lines in `SYSTEM_PROMPT`:
```
- Component must fit within 560x360px (20px margin from 600x400 viewport)
- Max width ~320px, max height ~340px
```
with the single line:
```
- Component must not exceed 520x320px (hard max within 600x400 viewport)
```

- [ ] **Step 2: Verify the build still passes**

Run: `npx astro check 2>&1 | tail -5`
Expected: No errors related to generate-challenge.ts

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-challenge.ts
git commit -m "chore: tighten CSS generation prompt to 520x320px hard max"
```

---

### Task 2: Add Tailwind TypeScript types

**Files:**
- Modify: `src/utils/types.ts`

- [ ] **Step 1: Add Tailwind types to types.ts**

Append after the existing `DiffResult` interface (after line 42):

```typescript
export interface TailwindChallenge {
  date: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number;
  starter: {
    html: string;
  };
  target: {
    html: string;
  };
}

export interface TailwindChallengeResult {
  date: string;
  score: number;
  timeSpent: number;
  submittedHtml: string;
}

export interface TailwindChallengeHistory {
  [date: string]: TailwindChallengeResult;
}

export interface TailwindStorageData {
  history: TailwindChallengeHistory;
}
```

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/types.ts
git commit -m "feat: add Tailwind challenge TypeScript types"
```

---

### Task 3: Add Tailwind storage functions

**Files:**
- Modify: `src/utils/storage.ts`

- [ ] **Step 1: Add Tailwind storage functions**

Add imports at line 1 — extend the existing import to include Tailwind types:
```typescript
import type { ChallengeResult, ChallengeHistory, UserStats, StorageData, TailwindChallengeResult, TailwindChallengeHistory, TailwindStorageData } from './types';
```

Append after the existing `getStats()` function (after line 75):

```typescript
const TAILWIND_STORAGE_KEY = 'tailwind-daily-challenge';

function getTailwindData(): TailwindStorageData {
  try {
    const raw = localStorage.getItem(TAILWIND_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { history: {} };
}

function setTailwindData(data: TailwindStorageData): void {
  localStorage.setItem(TAILWIND_STORAGE_KEY, JSON.stringify(data));
}

export function getTailwindResult(date: string): TailwindChallengeResult | null {
  const data = getTailwindData();
  return data.history[date] || null;
}

export function saveTailwindResult(date: string, result: TailwindChallengeResult): void {
  const data = getTailwindData();
  data.history[date] = result;
  setTailwindData(data);
}

export function getTailwindHistory(): TailwindChallengeHistory {
  return getTailwindData().history;
}

export function getTailwindStats(): UserStats {
  const history = getTailwindHistory();
  const dates = Object.keys(history).sort();
  const gamesPlayed = dates.length;

  if (gamesPlayed === 0) {
    return { gamesPlayed: 0, currentStreak: 0, maxStreak: 0, averageScore: 0 };
  }

  const totalScore = dates.reduce((sum, d) => sum + history[d].score, 0);
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

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/storage.ts
git commit -m "feat: add Tailwind challenge localStorage functions"
```

---

## Chunk 2: Rendering Utilities — buildTailwindSrcdoc, renderAndCaptureTailwind, compareToTargetTailwind

### Task 4: Add buildTailwindSrcdoc and buildTailwindScreenshotHtml

**Files:**
- Modify: `src/utils/code.ts`

- [ ] **Step 1: Add Tailwind srcdoc builders**

Append after the existing `buildScreenshotHtml` function (after line 31):

```typescript
/**
 * Sanitize a string for safe insertion into an HTML attribute value.
 * Strips characters that could break out of class="..." context.
 */
export function sanitizeClassValue(value: string): string {
  return value.replace(/[^a-zA-Z0-9\s\-_:\/\[\]\.%#(),!]/g, '');
}

export function buildTailwindSrcdoc(html: string): string {
  // Sanitize all class attribute values in the HTML for defense-in-depth
  const sanitizedHtml = html.replace(
    /class="([^"]*)"/g,
    (_, value) => `class="${sanitizeClassValue(value)}"`
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="${FONT_LINK}">
</head>
<body class="bg-[#f5f5f5] min-h-screen flex items-center justify-center p-5 font-['Inter']">
${sanitizedHtml}
</body>
</html>`;
}

export function buildTailwindScreenshotHtml(html: string): string {
  return buildTailwindSrcdoc(html);
}
```

Note on the script tag: When this string is used as `srcdoc`, the browser handles the script tag correctly. The closing `</script>` inside an srcdoc attribute is safe because srcdoc values are HTML-escaped by the browser when set via the `srcDoc` React prop. In the Playwright generation script, `page.setContent()` also handles this correctly.

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/utils/code.ts
git commit -m "feat: add buildTailwindSrcdoc with class value sanitization"
```

---

### Task 5: Add renderAndCaptureTailwind and compareToTargetTailwind

**Files:**
- Modify: `src/utils/diff.ts`

- [ ] **Step 1: Add import for buildTailwindSrcdoc**

At line 2, extend the import:
```typescript
import { buildSrcdoc, buildTailwindSrcdoc } from './code';
```

- [ ] **Step 2: Add renderAndCaptureTailwind after renderAndCapture (after line 71)**

```typescript
/**
 * Render Tailwind HTML in a hidden iframe using srcdoc + Tailwind CDN.
 * Uses srcdoc attribute (not doc.write) so the CDN script executes.
 */
export async function renderAndCaptureTailwind(
  html: string,
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
  const { snapdom } = await import('@zumer/snapdom');

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.border = 'none';
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

  const srcdoc = buildTailwindSrcdoc(html);
  iframe.srcdoc = srcdoc;
  document.body.appendChild(iframe);

  try {
    // Wait for iframe to load (including Tailwind CDN)
    await new Promise<void>((resolve) => {
      iframe.onload = () => resolve();
    });

    // Wait for Tailwind CDN to process classes + fonts
    await new Promise<void>((resolve) => {
      const doc = iframe.contentDocument!;
      if (doc.fonts && doc.fonts.ready) {
        doc.fonts.ready.then(() => setTimeout(resolve, 500));
      } else {
        setTimeout(resolve, 700);
      }
    });

    const body = iframe.contentDocument!.body;
    body.getBoundingClientRect(); // Force layout
    const snap = await snapdom(body);
    const svgImg = await snap.toSvg();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(svgImg, 0, 0, width, height);

    return canvas;
  } finally {
    document.body.removeChild(iframe);
  }
}
```

- [ ] **Step 3: Add compareToTargetTailwind after compareToTarget (after the existing `return { score, diffCanvas, heatmapCanvas };` line)**

```typescript
/**
 * Compare user Tailwind HTML against target Tailwind HTML.
 * Same scoring algorithm as compareToTarget but renders via Tailwind CDN.
 */
export async function compareToTargetTailwind(
  userHtml: string,
  targetHtml: string,
  options: { compareWidth: number; compareHeight: number }
): Promise<DiffResult> {
  const { compareWidth: width, compareHeight: height } = options;

  const [userCanvas, targetCanvas] = await Promise.all([
    renderAndCaptureTailwind(userHtml, width, height),
    renderAndCaptureTailwind(targetHtml, width, height),
  ]);

  const userCtx = userCanvas.getContext('2d')!;
  const targetCtx = targetCanvas.getContext('2d')!;

  const userData = userCtx.getImageData(0, 0, width, height);
  const targetData = targetCtx.getImageData(0, 0, width, height);

  const userPixels = userData.data;
  const targetPixels = targetData.data;

  const totalPixels = width * height;

  const bgR = targetPixels[0];
  const bgG = targetPixels[1];
  const bgB = targetPixels[2];

  const isBackgroundColor = (r: number, g: number, b: number): boolean => {
    return rgbDistance(r, g, b, bgR, bgG, bgB) <= BG_TOLERANCE;
  };

  const SKIPPED = -1;
  const pixelDiffs = new Float32Array(totalPixels);
  let skippedCount = 0;

  for (let px = 0; px < totalPixels; px++) {
    const i = px * 4;

    const ur = userPixels[i], ug = userPixels[i + 1], ub = userPixels[i + 2], ua = userPixels[i + 3];
    const tr = targetPixels[i], tg = targetPixels[i + 1], tb = targetPixels[i + 2], ta = targetPixels[i + 3];

    const userIsBg = isBackgroundColor(ur, ug, ub);
    const targetIsBg = isBackgroundColor(tr, tg, tb);
    const effectiveUserA = userIsBg ? 0 : ua;
    const effectiveTargetA = targetIsBg ? 0 : ta;

    if (effectiveUserA === 0 && effectiveTargetA === 0) {
      pixelDiffs[px] = SKIPPED;
      skippedCount++;
      continue;
    }

    if ((effectiveUserA === 0 && effectiveTargetA > 0) ||
        (effectiveUserA > 0 && effectiveTargetA === 0)) {
      pixelDiffs[px] = 1;
      continue;
    }

    const dist = rgbDistance(ur, ug, ub, tr, tg, tb);
    pixelDiffs[px] = dist / MAX_RGB_DISTANCE;
  }

  const effectivePixels = totalPixels - skippedCount;
  const normalizedTolerance = COLOR_TOLERANCE / MAX_RGB_DISTANCE;

  let totalDiff = 0;
  for (let px = 0; px < totalPixels; px++) {
    const diff = pixelDiffs[px];
    if (diff === SKIPPED) continue;

    if (diff <= normalizedTolerance) {
      // Within tolerance = full match
    } else {
      const excess = diff - normalizedTolerance;
      const maxExcess = 1 - normalizedTolerance;
      totalDiff += excess / maxExcess;
    }
  }

  const rawScore = effectivePixels > 0
    ? Math.max(0, Math.min(1, 1 - totalDiff / effectivePixels))
    : 0;

  const SCORE_EXPONENT = 3;
  const score = Math.round(Math.pow(rawScore, SCORE_EXPONENT) * 100);

  const heatmapCanvas = document.createElement('canvas');
  heatmapCanvas.width = width;
  heatmapCanvas.height = height;
  const heatmapCtx = heatmapCanvas.getContext('2d')!;
  const heatmapData = heatmapCtx.createImageData(width, height);

  for (let px = 0; px < totalPixels; px++) {
    const diff = pixelDiffs[px];
    const i = px * 4;

    if (diff === SKIPPED || diff <= normalizedTolerance) {
      heatmapData.data[i] = 0;
      heatmapData.data[i + 1] = 0;
      heatmapData.data[i + 2] = 0;
      heatmapData.data[i + 3] = 0;
      continue;
    }

    const hue = (1 - diff) * 0.67;
    const [r, g, b] = hslToRgb(hue, 1, 0.5);
    heatmapData.data[i] = r;
    heatmapData.data[i + 1] = g;
    heatmapData.data[i + 2] = b;
    heatmapData.data[i + 3] = 255;
  }

  heatmapCtx.putImageData(heatmapData, 0, 0);

  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext('2d')!;
  diffCtx.drawImage(userCanvas, 0, 0);

  return { score, diffCanvas, heatmapCanvas };
}
```

- [ ] **Step 4: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add src/utils/diff.ts
git commit -m "feat: add renderAndCaptureTailwind and compareToTargetTailwind"
```

---

## Chunk 3: Shared Component Updates & TailwindPreview

### Task 6: Parameterize HistoryView with basePath and storage functions

**Files:**
- Modify: `src/components/HistoryView.tsx`

- [ ] **Step 1: Add a minimal shared history entry type to types.ts**

HistoryView only needs `score` from each history entry — it doesn't care about `submittedCss` vs `submittedHtml`. Add a minimal type to `src/utils/types.ts` (append after `TailwindStorageData`):

```typescript
/** Minimal history entry — used by HistoryView which only needs the score */
export interface HistoryEntry {
  score: number;
}

export interface GenericHistory {
  [date: string]: HistoryEntry;
}
```

Both `ChallengeHistory` and `TailwindChallengeHistory` structurally satisfy `GenericHistory` since they both have `score: number`.

- [ ] **Step 2: Update HistoryView props and implementation**

Key changes:
- Add `basePath`, `getHistoryFn`, `getStatsFn` optional props with defaults
- Use `GenericHistory` type for the history prop (not `ChallengeHistory`) so both CSS and Tailwind histories work
- Use props instead of direct imports for storage reads
- Use `basePath` in href

Update imports:
```typescript
import { getHistory as getDefaultHistory, getStats as getDefaultStats } from '../utils/storage';
import { formatDate } from '../utils/date';
import type { GenericHistory, UserStats } from '../utils/types';
```

Update the interface:
```typescript
interface HistoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  basePath?: string;
  getHistoryFn?: () => GenericHistory;
  getStatsFn?: () => UserStats;
}
```

Update the component signature:
```typescript
export default function HistoryView({
  isOpen,
  onClose,
  basePath = '/challenge',
  getHistoryFn = getDefaultHistory,
  getStatsFn = getDefaultStats,
}: HistoryViewProps) {
```

Update state type:
```typescript
  const [history, setHistory] = useState<GenericHistory>({});
```

Update useEffect to use props:
```typescript
  useEffect(() => {
    if (isOpen) {
      setHistory(getHistoryFn());
      setStats(getStatsFn());
    }
  }, [isOpen, getHistoryFn, getStatsFn]);
```

Update the href on line 59:
```typescript
                  href={`${basePath}/${date}`}
```

- [ ] **Step 2: Verify ChallengePlayer still works (no breaking changes)**

Run: `npx astro check 2>&1 | tail -5`
Expected: No errors — ChallengePlayer uses HistoryView without the new props, which default to the existing behavior.

- [ ] **Step 3: Commit**

```bash
git add src/components/HistoryView.tsx
git commit -m "feat: parameterize HistoryView with basePath and storage function props"
```

---

### Task 7: Parameterize ResultsModal with basePath

**Files:**
- Modify: `src/components/ResultsModal.tsx`

- [ ] **Step 1: Add basePath prop to ResultsModal**

Add `basePath?: string` to the `ResultsModalProps` interface.

In the destructured props, add `basePath = '/challenge'`.

Replace the two hardcoded `/challenge/` links at lines 91-96:
```typescript
          <a href={`${basePath}/${prevDate}`} className="text-blue-400 hover:text-blue-300">
```
and:
```typescript
          <a href={`${basePath}/${nextDate}`} className="text-blue-400 hover:text-blue-300">
```

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/ResultsModal.tsx
git commit -m "feat: parameterize ResultsModal with basePath prop"
```

---

### Task 8: Create TailwindPreview component

**Files:**
- Create: `src/components/TailwindPreview.tsx`

- [ ] **Step 1: Create TailwindPreview.tsx**

```typescript
import { forwardRef, useCallback } from 'react';
import { buildTailwindSrcdoc } from '../utils/code';

export const TAILWIND_PREVIEW_WIDTH = 600;
export const TAILWIND_PREVIEW_HEIGHT = 400;

interface TailwindPreviewProps {
  html: string;
  onLoad?: () => void;
}

const TailwindPreview = forwardRef<HTMLIFrameElement, TailwindPreviewProps>(({ html, onLoad }, ref) => {
  const handleLoad = useCallback(() => {
    if (onLoad) {
      // Wait longer for Tailwind CDN to process classes after iframe load
      setTimeout(onLoad, 300);
    }
  }, [onLoad]);

  return (
    <iframe
      ref={ref}
      srcDoc={buildTailwindSrcdoc(html)}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, border: 'none', background: '#f5f5f5' }}
      onLoad={handleLoad}
    />
  );
});

TailwindPreview.displayName = 'TailwindPreview';
export default TailwindPreview;
```

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/TailwindPreview.tsx
git commit -m "feat: add TailwindPreview component with CDN script support"
```

---

## Chunk 4: TailwindEditor — Class-Only CodeMirror with Autocomplete

### Task 9: Create tailwind-classes.json

**Files:**
- Create: `src/data/tailwind-classes.json`

- [ ] **Step 1: Create the curated Tailwind class list**

Create `src/data/tailwind-classes.json` with a comprehensive set of Tailwind utility classes organized by category. This is a large data file.

The file should cover the utilities the generation prompt focuses on: flexbox, grid, spacing, borders, border-radius, typography, colors. Include common scale values (e.g., `p-0` through `p-12`, `p-px`, `p-0.5`; `m-0` through `m-12`, `m-auto`; `gap-0` through `gap-8`; etc.).

Categories to include:
- **layout**: flex, grid, block, inline, inline-flex, inline-grid, hidden, contents
- **positioning**: relative, absolute, fixed, sticky, static, top-0, right-0, bottom-0, left-0, inset-0
- **flexbox**: flex-row, flex-col, flex-wrap, flex-nowrap, justify-start/center/end/between/around/evenly, items-start/center/end/stretch/baseline, self-start/center/end/auto, flex-1/auto/initial/none, grow, shrink
- **grid**: grid-cols-1 through 12, col-span-1 through 12, col-span-full, grid-rows-1 through 6, row-span-1 through 6, row-span-full
- **gap**: gap-0 through 12 (including half values), gap-px, gap-x-* and gap-y-* variants
- **spacing (padding)**: p-0 through p-16 (including half values), p-px, px-/py-/pt-/pr-/pb-/pl-* variants
- **spacing (margin)**: m-0 through m-16 (including half values), m-auto, m-px, mx-/my-/mt-/mr-/mb-/ml-* variants, negative margins -m-1 through -m-8
- **sizing**: w-0 through w-96 (key values), w-auto/full/screen/min/max/fit, w-1/2/1/3/2/3/1/4/3/4; h-* equivalents; min-w-*/max-w-*/min-h-*/max-h-*
- **typography**: text-xs through text-5xl, font-thin through font-black, leading-none through leading-loose, tracking-tighter through tracking-widest, text-left/center/right/justify, uppercase/lowercase/capitalize/normal-case, truncate, whitespace-*, break-*
- **colors (text)**: text-transparent/current/black/white, text-{color}-{50-950} for: slate, gray, zinc, neutral, stone, red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose
- **colors (bg)**: bg-transparent/current/black/white, bg-{color}-{50-950} same palette
- **colors (border)**: border-transparent/current/black/white, border-{color}-{50-950} same palette
- **borders**: border, border-0/2/4/8, border-t/r/b/l variants
- **border-radius**: rounded-none/sm/md/lg/xl/2xl/3xl/full, directional variants
- **opacity**: opacity-0 through opacity-100 at standard stops
- **overflow**: overflow-auto/hidden/visible/scroll, overflow-x-*/overflow-y-*

Note: this is a curated "best effort" list. Players can type classes not in the list; they just won't get autocomplete for them.

- [ ] **Step 2: Verify it's valid JSON**

Run: `node -e "require('./src/data/tailwind-classes.json'); console.log('Valid JSON')"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add src/data/tailwind-classes.json
git commit -m "feat: add curated Tailwind utility class list for autocomplete"
```

---

### Task 10: Create TailwindEditor component

**Files:**
- Create: `src/components/TailwindEditor.tsx`

- [ ] **Step 1: Create the TailwindEditor component**

This is the most complex component. It needs:

1. **CodeMirror setup** with `@codemirror/lang-html` for syntax highlighting, oneDark theme
2. **Parse class regions** on load: find all `class="..."` ranges in the document
3. **Transaction filter** (`EditorState.transactionFilter`): reject changes outside class value regions. Also reject characters outside the allowed set: `[a-zA-Z0-9\s\-_:\/\[\]\.%#(),!]`
4. **Decorations** (`EditorView.decorations`): dim non-editable regions with reduced opacity. Use `EditorView.decorations.compute(['doc'], ...)` which recomputes when the doc changes.
5. **Autocomplete** (`CompletionSource`): only activate inside class regions, match against flattened tailwind-classes.json
6. **Tab-to-accept** matching existing CodeEditor pattern: `Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }]))`
7. **onChange callback**: fires with the full HTML document whenever a class value changes

```typescript
import { useRef, useEffect } from 'react';
import { EditorState, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Transaction } from '@codemirror/state';
import { EditorView, Decoration, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { autocompletion, acceptCompletion } from '@codemirror/autocomplete';
import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { basicSetup } from 'codemirror';
import tailwindClasses from '../data/tailwind-classes.json';

// Flatten all categories into a single list
const ALL_CLASSES: string[] = Object.values(tailwindClasses).flat();

// Allowed characters in class attribute values
const ALLOWED_CLASS_CHARS = /^[a-zA-Z0-9\s\-_:\/\[\]\.%#(),!]*$/;

interface TailwindEditorProps {
  initialHtml: string;
  onChange: (html: string) => void;
}

/** Find all class="..." value regions (positions of text between quotes) */
function findClassRegions(doc: string): { from: number; to: number }[] {
  const regions: { from: number; to: number }[] = [];
  const regex = /class="([^"]*)"/g;
  let match;
  while ((match = regex.exec(doc)) !== null) {
    const valueStart = match.index + 'class="'.length;
    const valueEnd = valueStart + match[1].length;
    regions.push({ from: valueStart, to: valueEnd });
  }
  return regions;
}

/** Check if a position is inside any class value region */
function isInClassRegion(pos: number, regions: { from: number; to: number }[]): boolean {
  return regions.some((r) => pos >= r.from && pos <= r.to);
}

/** Build decorations that dim everything outside class value regions */
function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc.toString();
  const regions = findClassRegions(doc);
  const builder = new RangeSetBuilder<Decoration>();

  const dimMark = Decoration.mark({ class: 'cm-tw-locked' });
  let pos = 0;

  for (const region of regions) {
    if (pos < region.from) {
      builder.add(pos, region.from, dimMark);
    }
    pos = region.to;
  }
  if (pos < doc.length) {
    builder.add(pos, doc.length, dimMark);
  }

  return builder.finish();
}

/** Tailwind class completion source */
function tailwindCompletion(context: CompletionContext): CompletionResult | null {
  const doc = context.state.doc.toString();
  const regions = findClassRegions(doc);

  if (!isInClassRegion(context.pos, regions)) return null;

  // Find the current word (class name being typed)
  const wordMatch = context.matchBefore(/[\w\-\[\]\.:%\/!#]+/);
  if (!wordMatch && !context.explicit) return null;

  const from = wordMatch ? wordMatch.from : context.pos;
  const prefix = wordMatch ? wordMatch.text : '';

  const options = ALL_CLASSES
    .filter((cls) => cls.startsWith(prefix))
    .map((cls) => ({ label: cls, type: 'class' }));

  return { from, options, filter: false };
}

export default function TailwindEditor({ initialHtml, onChange }: TailwindEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!editorRef.current) return;

    const decorationField = EditorView.decorations.compute(['doc'], (state) => {
      return buildDecorations(state);
    });

    const transactionFilter = EditorState.transactionFilter.of((tr: Transaction) => {
      if (!tr.docChanged) return tr;

      const doc = tr.startState.doc.toString();
      const regions = findClassRegions(doc);

      // Check each change is within a class region and uses allowed chars
      let valid = true;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        if (!valid) return;

        // Deletion: check the deleted range is within a class region
        if (fromA !== toA) {
          if (!regions.some((r) => fromA >= r.from && toA <= r.to)) {
            valid = false;
            return;
          }
        }

        // Insertion: check position is in a class region and chars are allowed
        if (inserted.length > 0) {
          if (!isInClassRegion(fromA, regions)) {
            valid = false;
            return;
          }
          const text = inserted.toString();
          if (!ALLOWED_CLASS_CHARS.test(text)) {
            valid = false;
            return;
          }
        }
      });

      return valid ? tr : [];
    });

    const state = EditorState.create({
      doc: initialHtml,
      extensions: [
        basicSetup,
        html(),
        oneDark,
        EditorView.theme({
          '&': { height: '100%' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-tw-locked': { opacity: '0.4' },
        }),
        keymap.of([indentWithTab, ...defaultKeymap]),
        Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
        autocompletion({ override: [tailwindCompletion] }),
        EditorState.tabSize.of(2),
        transactionFilter,
        decorationField,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: editorRef.current });
    viewRef.current = view;

    return () => view.destroy();
  }, [initialHtml]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-gray-700">
        <div className="px-4 py-2 text-sm font-medium bg-gray-800 text-white border-b-2 border-blue-500">
          HTML (class editing only)
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <div ref={editorRef} className="h-full" />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/TailwindEditor.tsx
git commit -m "feat: add TailwindEditor with class-only editing, transaction filter, and autocomplete"
```

---

## Chunk 5: TailwindPlayer & Pages

### Task 11: Create TailwindPlayer component

**Files:**
- Create: `src/components/TailwindPlayer.tsx`

- [ ] **Step 1: Create TailwindPlayer.tsx**

Mirrors ChallengePlayer.tsx structure but with Tailwind-specific differences:
- Uses `TailwindEditor` instead of `CodeEditor`
- Uses `TailwindPreview` instead of `Preview`
- Tracks `userHtml` instead of `userCss`
- Calls `compareToTargetTailwind` instead of `compareToTarget`
- Uses `saveTailwindResult`/`getTailwindResult` instead of `saveResult`/`getResult`
- Passes `basePath="/tailwind"` and Tailwind storage functions to HistoryView and ResultsModal
- Target image path: `/targets/tailwind/${challenge.date}.png`
- Date nav links: `/tailwind/${date}` instead of `/challenge/${date}`

Reference `src/components/ChallengePlayer.tsx` for the full structure. The component is ~300 lines and structurally identical except for the differences listed above. Key prop type is `TailwindChallenge` (not `Challenge`).

The full component code is provided in the spec at the "Tailwind Challenge Player" section. Key interface:

```typescript
interface TailwindPlayerProps {
  challenge: TailwindChallenge;
  allDates: string[];
}
```

Key imports:
```typescript
import type { TailwindChallenge, DiffResult } from '../utils/types';
import { compareToTargetTailwind } from '../utils/diff';
import { saveTailwindResult, getTailwindResult, getTailwindHistory, getTailwindStats } from '../utils/storage';
import TailwindPreview, { TAILWIND_PREVIEW_WIDTH, TAILWIND_PREVIEW_HEIGHT } from './TailwindPreview';
import TailwindEditor from './TailwindEditor';
```

Key differences in the JSX:
- `<TailwindPreview html={userHtml} onLoad={handlePreviewLoad} />` instead of `<Preview html={...} css={userCss} onLoad={...} />`
- `<TailwindEditor initialHtml={challenge.starter.html} onChange={handleHtmlChange} />` instead of `<CodeEditor ...>`
- `<img src={'/targets/tailwind/${challenge.date}.png'} ...>` for target images
- `<ResultsModal ... basePath="/tailwind" />`
- `<HistoryView ... basePath="/tailwind" getHistoryFn={getTailwindHistory} getStatsFn={getTailwindStats} />`
- Date nav: `href={'/tailwind/${prevDate}'}` and `href={'/tailwind/${nextDate}'}`

The `runDiff` callback calls `compareToTargetTailwind(userHtmlRef.current, challenge.target.html, ...)` instead of `compareToTarget(challenge.starter.html, userCssRef.current, challenge.target.css, ...)`.

The `doSubmit` saves `submittedHtml: userHtmlRef.current` instead of `submittedCss`.

- [ ] **Step 2: Verify build**

Run: `npx astro check 2>&1 | tail -5`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/components/TailwindPlayer.tsx
git commit -m "feat: add TailwindPlayer component"
```

---

### Task 12: Create Tailwind pages and update Header

**Files:**
- Create: `src/pages/tailwind/index.astro`
- Create: `src/pages/tailwind/[date].astro`
- Create: `src/data/tailwind-challenges/` (directory with `.gitkeep`)
- Create: `public/targets/tailwind/` (directory with `.gitkeep`)
- Modify: `src/components/Header.astro`

- [ ] **Step 1: Create data directories**

```bash
mkdir -p src/data/tailwind-challenges public/targets/tailwind
touch src/data/tailwind-challenges/.gitkeep public/targets/tailwind/.gitkeep
```

- [ ] **Step 2: Create `src/pages/tailwind/index.astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';
---
<Layout title="Tailwind Daily - CSS Daily">
  <div id="redirect"></div>
  <script>
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    window.location.href = `/tailwind/${yyyy}-${mm}-${dd}`;
  </script>
</Layout>
```

- [ ] **Step 3: Create `src/pages/tailwind/[date].astro`**

```astro
---
import Layout from '../../layouts/Layout.astro';
import Header from '../../components/Header.astro';
import TailwindPlayer from '../../components/TailwindPlayer.tsx';

export async function getStaticPaths() {
  const challengeFiles = import.meta.glob('../../data/tailwind-challenges/*.json', { eager: true });
  const challenges = Object.values(challengeFiles).map((mod: any) => mod.default || mod);
  const allDates = challenges.map((c: any) => c.date).sort();

  return challenges.map((challenge: any) => ({
    params: { date: challenge.date },
    props: { challenge, allDates },
  }));
}

const { challenge, allDates } = Astro.props;
---
<Layout title={`${challenge.title} - Tailwind Daily`}>
  <div class="flex flex-col h-screen">
    <Header currentPath="/tailwind" />
    <TailwindPlayer client:load challenge={challenge} allDates={allDates} />
  </div>
</Layout>
```

- [ ] **Step 4: Add "Tailwind" nav link to Header.astro**

In `src/components/Header.astro`, inside the `<nav>` element, add a "Tailwind" link before the About link:

```html
        <a
          href="/tailwind"
          aria-current={currentPath === '/tailwind' ? 'page' : undefined}
          class:list={[
            'transition hover:text-white',
            currentPath === '/tailwind' ? 'text-white' : 'text-gray-400'
          ]}
        >
          Tailwind
        </a>
```

- [ ] **Step 5: Verify build**

Run: `npx astro build 2>&1 | tail -10`
Expected: Build succeeds. Tailwind pages won't generate routes yet since there are no challenge JSON files, but there should be no build errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/tailwind/ src/data/tailwind-challenges/.gitkeep public/targets/tailwind/.gitkeep src/components/Header.astro
git commit -m "feat: add Tailwind challenge pages, routes, and nav link"
```

---

## Chunk 6: Generation Pipeline

### Task 13: Create Tailwind challenge generation script

**Files:**
- Create: `scripts/generate-tailwind-challenge.ts`

- [ ] **Step 1: Create the generation script**

The script mirrors `scripts/generate-challenge.ts` with these differences:
- Uses `CHALLENGES_DIR = 'src/data/tailwind-challenges'` and `TARGETS_DIR = 'public/targets/tailwind'`
- Tailwind-specific `SYSTEM_PROMPT` (see spec section "Generation script")
- Extracts `<targethtml>` and `<starterhtml>` XML tags (not `<html>`, `<targetcss>`, `<startercss>`)
- Challenge JSON has `starter: { html }` and `target: { html }` (no css fields)
- `generateTargetPng` uses `buildTailwindScreenshotHtml` and waits for `networkidle`
- Imports `buildTailwindScreenshotHtml` from `'../src/utils/code'`

The SYSTEM_PROMPT should include:
```
STRICT CONSTRAINTS:
- ONLY Tailwind utility classes, NO custom CSS
- Every HTML element MUST have a class attribute
- Component must not exceed 520x320px (hard max within 600x400 viewport)
- Body background is always #f5f5f5 (set by environment)
- Use Tailwind's built-in color palette (no custom colors)
- Focus on: flexbox, grid, spacing, borders, border-radius, typography, colors
- NO box-shadow, text-shadow, or background-image utilities
- NO font-family declarations (Inter font is loaded by the environment)
- The starter HTML and target HTML must have the SAME structure — only class values differ
- Starter HTML has class="" (empty) on every element
- Target HTML has the correct Tailwind utility classes
```

Output tags: `<title>`, `<difficulty>`, `<targethtml>`, `<starterhtml>`

- [ ] **Step 2: Verify the script file is syntactically valid**

Run: `node -e "require('fs').readFileSync('scripts/generate-tailwind-challenge.ts', 'utf-8')" && echo "File readable"`
Expected: `File readable`

- [ ] **Step 3: Commit**

```bash
git add scripts/generate-tailwind-challenge.ts
git commit -m "feat: add Tailwind challenge generation script"
```

---

### Task 14: Update GitHub Actions workflow

**Files:**
- Modify: `.github/workflows/generate-challenge.yml`

- [ ] **Step 1: Update the workflow**

Replace the single "Generate challenge" step (lines 27-34) with two steps, both using `continue-on-error: true`. Add `id: generate` to the CSS step to preserve the date output:

```yaml
      - name: Generate CSS challenge
        id: generate
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          OUTPUT=$(npx tsx scripts/generate-challenge.ts)
          echo "$OUTPUT"
          CHALLENGE_DATE=$(echo "$OUTPUT" | grep '^CHALLENGE_DATE=' | cut -d= -f2)
          echo "date=$CHALLENGE_DATE" >> "$GITHUB_OUTPUT"

      - name: Generate Tailwind challenge
        continue-on-error: true
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          OUTPUT=$(npx tsx scripts/generate-tailwind-challenge.ts)
          echo "$OUTPUT"
```

Update the `git add` line in the commit step to include Tailwind paths:
```yaml
          git add src/data/challenges/ public/targets/ src/data/tailwind-challenges/ public/targets/tailwind/
```

Update the commit message:
```yaml
          git diff --cached --quiet || (git commit -m "Add daily challenges for ${{ steps.generate.outputs.date }}" && git push)
```

- [ ] **Step 2: Verify YAML syntax**

Run: `node -e "console.log('YAML file exists:', require('fs').existsSync('.github/workflows/generate-challenge.yml'))"`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/generate-challenge.yml
git commit -m "feat: add Tailwind generation step to daily workflow"
```

---

## Chunk 7: Integration Testing & Verification

### Task 15: Generate a test Tailwind challenge and verify end-to-end

- [ ] **Step 1: Generate a test challenge**

If `ANTHROPIC_API_KEY` is available:
Run: `npx tsx scripts/generate-tailwind-challenge.ts 2026-03-17`

If not, manually create a minimal test challenge:
```bash
mkdir -p src/data/tailwind-challenges public/targets/tailwind
```
Then create `src/data/tailwind-challenges/2026-03-17.json` with a simple test challenge.

- [ ] **Step 2: Build the site**

Run: `npx astro build 2>&1 | tail -15`
Expected: Build succeeds, generates `/tailwind/2026-03-17` route

- [ ] **Step 3: Run dev server and verify manually**

Run: `npx astro dev` and visit `http://localhost:4321/tailwind/2026-03-17`:
- Verify: class-only editing works (can type in `class=""` values, locked outside)
- Verify: preview updates when class values change
- Verify: "Tailwind" link appears in the header nav
- Verify: target image loads
- Verify: autocomplete appears when typing in class regions
- Verify: timer starts when you begin editing
- Verify: submit works and shows results modal

- [ ] **Step 3b: Test `allow-scripts` without `allow-same-origin` (per spec)**

The spec asks us to test whether `allow-scripts` alone (without `allow-same-origin`) is sufficient for the Tailwind CDN. In the browser devtools console on the Tailwind challenge page, temporarily modify the preview iframe's sandbox attribute to just `allow-scripts` and check if Tailwind still renders. If it works, update `TailwindPreview.tsx` and `renderAndCaptureTailwind` in `diff.ts` to drop `allow-same-origin` for better security.

- [ ] **Step 4: Decide on test data**

If the generated challenge should persist, commit it. Otherwise clean it up:
```bash
rm src/data/tailwind-challenges/2026-03-17.json public/targets/tailwind/2026-03-17.png 2>/dev/null
```

- [ ] **Step 5: Final full build verification**

Run: `npx astro build 2>&1 | tail -10`
Expected: Clean build with no errors
