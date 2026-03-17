# Tailwind Challenge Mode Design Spec

## Overview

Add a Tailwind CSS challenge mode to cssdaily.dev at `/tailwind/[date]`. Players see an HTML structure and a target screenshot, then add Tailwind utility classes to match the target. Editing is restricted to `class=""` attribute values only — no CSS, no HTML structure changes. Includes a second daily generation pipeline, Tailwind-specific autocomplete, and a shared constraint tightening for both CSS and Tailwind challenge generation.

## Goals

- **New challenge mode**: Tailwind utility-class challenges alongside existing CSS challenges
- **Class-only editing**: Players can only edit `class` attribute values in the HTML, not the structure
- **Autocomplete**: Tab-to-accept Tailwind class completion, consistent with the CSS editor's autocomplete UX
- **Pure Tailwind**: No custom CSS allowed — only Tailwind utility classes
- **Automated pipeline**: Daily generation via the same cron, second step in existing workflow

## Routing & Navigation

- New route: `/tailwind/[date]` for Tailwind challenges
- New redirect page: `src/pages/tailwind/index.astro` — redirects to today's date (mirrors `src/pages/index.astro` pattern)
- Header (`src/components/Header.astro`): add "Tailwind" nav link alongside "About"
- Home `/` stays as the CSS challenge redirect, unchanged

## Challenge Data & Generation

### Data storage

- Challenge JSON: `src/data/tailwind-challenges/{date}.json`
- Target screenshots: `public/targets/tailwind/{date}.png`

### Challenge JSON structure

```json
{
  "title": "Challenge Name",
  "difficulty": "easy|medium|hard",
  "date": "YYYY-MM-DD",
  "timeLimit": 300|600|900,
  "starter": {
    "html": "<div class=\"\">...</div>"
  },
  "target": {
    "html": "<div class=\"flex items-center gap-4\">...</div>"
  }
}
```

Key differences from CSS challenges:
- No `starter.css` or `target.css` fields
- `starter.html` has `class=""` on every element (all empty)
- `target.html` has the correct Tailwind utility classes
- Both share the same HTML structure — only class values differ

### Generation script: `scripts/generate-tailwind-challenge.ts`

New script with a Tailwind-specific system prompt. Constraints in the prompt:
- Only Tailwind utility classes, no custom CSS
- Every HTML element must have a `class` attribute
- Component must not exceed 520x320px (hard max, no approximations)
- Body background is always #f5f5f5
- Use Tailwind's built-in color palette (no custom colors)
- Focus on: flexbox, grid, spacing, borders, border-radius, typography, colors
- No box-shadow, text-shadow, or background-image utilities

The generation script reads recent challenge titles (up to 30) from `src/data/tailwind-challenges/` and includes them in the prompt to avoid duplicating themes, matching the existing CSS generator's deduplication behavior.

Output format uses XML tags:
- `<title>`, `<difficulty>`, `<targethtml>`, `<starterhtml>`

### Screenshot generation

The `generateTargetPng` function in the Tailwind script loads the Tailwind CDN play script (`https://cdn.tailwindcss.com`) in the Playwright page before setting content, then waits for network idle before screenshotting. Playwright runs a full browser with no sandbox restrictions, so the CDN script executes normally.

### Workflow update

Update `generate-challenge.yml` to add a second step after CSS generation. Both generation steps use `continue-on-error: true` so that if one fails, the other still runs and its output is committed:

```yaml
- name: Generate CSS challenge
  continue-on-error: true
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    OUTPUT=$(npx tsx scripts/generate-challenge.ts)
    echo "$OUTPUT"

- name: Generate Tailwind challenge
  continue-on-error: true
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    OUTPUT=$(npx tsx scripts/generate-tailwind-challenge.ts)
    echo "$OUTPUT"
```

The commit step already uses `git add src/data/challenges/ public/targets/` — extend to include `src/data/tailwind-challenges/` and `public/targets/tailwind/`. The `git diff --cached --quiet` check handles partial output gracefully. The commit message should reflect what was generated (e.g., "Add daily challenges for {date}").

## CSS Generation Prompt Update

Update the existing CSS generation prompt in `scripts/generate-challenge.ts`:
- Change "Component must fit within 560x360px (20px margin from 600x400 viewport)" to "Component must not exceed 520x320px"
- Change "Max width ~320px, max height ~340px" to remove entirely (redundant with the above)
- Use firm language: "must not exceed", no `~` approximations

This is an intentional tightening from the previous soft constraints. Past challenges occasionally overflowed the viewport (e.g., the 2026-03-17 quiz card). The new hard max of 520x320 within the 600x400 viewport provides 80px total margin in each dimension (40px per side).

## TypeScript Types

### New types in `src/utils/types.ts`

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

These are separate types from the CSS challenge types — no `css` fields, `submittedHtml` instead of `submittedCss`.

## Iframe Sandbox & Tailwind Rendering

### The problem

The existing CSS challenge uses iframes with `sandbox="allow-same-origin"` for both the Preview component and the `renderAndCapture` function in the diff pipeline. This sandbox policy blocks script execution, which is fine for CSS (rendered via `<style>` blocks) but breaks Tailwind — the CDN play script (`cdn.tailwindcss.com`) must execute JavaScript to generate styles from utility classes.

### The solution

For Tailwind mode, the iframe sandbox must include `allow-scripts`:
- `sandbox="allow-scripts allow-same-origin"`

This allows the Tailwind CDN script to execute. The security trade-off is acceptable because the iframe content is generated from our own challenge data, not user-provided arbitrary HTML/JS.

Additionally, `buildTailwindSrcdoc` must use the `srcdoc` attribute approach (which the existing Preview already uses) rather than `doc.write()`. The `renderAndCapture` function in diff.ts currently uses `doc.write()` — for Tailwind mode, it should use the iframe's `srcdoc` attribute instead and wait for the iframe to load (including the Tailwind CDN script). This requires a separate `renderAndCaptureTailwind` function.

### Preview component

Create `src/components/TailwindPreview.tsx` — mirrors `Preview.tsx` but:
- Takes only `html` (no `css` prop)
- Uses `buildTailwindSrcdoc(html)` for the srcdoc
- Sets `sandbox="allow-scripts allow-same-origin"`
- The `onLoad` callback should wait slightly longer (~300ms) to allow the Tailwind CDN to process classes after iframe load

## Class-Only Editor

### Component: `src/components/TailwindEditor.tsx`

A CodeMirror 6 editor that displays full HTML but restricts editing to only the values inside `class="..."` attributes.

#### Architecture

- Uses `@codemirror/lang-html` for syntax highlighting
- On load, parses the document to identify all `class="..."` value regions (the text between quotes after `class=`)
- **Transaction filter** (`EditorState.transactionFilter`): rejects any transaction that would modify text outside class value regions
- **Decorations** (`EditorView.decorations`): non-editable regions get a dimmed visual style (e.g., reduced opacity) to signal they're locked. Track editable regions using CodeMirror's `RangeSet` / decoration system which auto-maps positions through transactions, rather than re-parsing the entire document on every change.
- Edge cases to handle: paste (only allow within class regions), undo/redo (should work normally within class regions), cursor movement (free to move anywhere for reading)

#### Tailwind autocomplete

- Custom `CompletionSource` using `@codemirror/autocomplete` (already installed)
- Completion list sourced from `src/data/tailwind-classes.json`
- Activates only when cursor is inside a `class="..."` region
- Tab-to-accept behavior matches the existing CSS editor
- Completions are context-aware: matches against the current word being typed within the class value

Note: the JSON file is a curated "best effort" list. If the challenge generator uses a valid Tailwind class not in the JSON, the player can still type it — they just won't get autocomplete for it. Autocomplete is a convenience, not a constraint.

### Tailwind classes data: `src/data/tailwind-classes.json`

Standalone JSON file organized by category for maintainability:

```json
{
  "layout": ["flex", "grid", "block", "inline", "hidden", "relative", "absolute", ...],
  "spacing": ["p-0", "p-1", "p-2", ..., "m-0", "m-1", ...],
  "sizing": ["w-full", "w-auto", "h-full", "h-screen", ...],
  "typography": ["text-sm", "text-base", "text-lg", "font-bold", "font-medium", ...],
  "colors": ["text-white", "text-gray-500", "bg-blue-500", "border-gray-300", ...],
  "borders": ["border", "border-2", "rounded", "rounded-lg", "rounded-full", ...],
  "flexbox": ["justify-center", "items-center", "gap-2", "gap-4", ...],
  "grid": ["grid-cols-2", "grid-cols-3", "col-span-2", ...]
}
```

The completion source flattens all categories into a single list at import time. Categories are for human organization only, not user-facing.

## Tailwind Challenge Player

### Component: `src/components/TailwindPlayer.tsx`

Mirrors `ChallengePlayer.tsx` structure with Tailwind-specific differences.

#### Same as ChallengePlayer:
- Phase management: idle → playing → finished
- Timer with difficulty-based time limits
- Score display
- Results modal with heatmap
- History view
- Date navigation (prev/next)
- Target panel with target/overlay/diff tabs

#### Different from ChallengePlayer:
- Uses `TailwindEditor` instead of `CodeEditor`
- Uses `TailwindPreview` instead of `Preview` (needs `allow-scripts` sandbox)
- User edits HTML class attributes, not CSS
- No HTML tab in the editor (the editor IS the HTML)
- History stored separately in localStorage: key `tailwind-daily-challenge` (separate from CSS's `css-daily-challenge`)

### Page: `src/pages/tailwind/[date].astro`

Uses Layout, shared Header (with `currentPath="/tailwind"`), and TailwindPlayer. Loads challenges from `src/data/tailwind-challenges/`. The `allDates` array is populated from Tailwind challenge files, not CSS challenge files — the two date lists are independent and may diverge.

## Shared Components: HistoryView & ResultsModal

Both `HistoryView.tsx` and `ResultsModal.tsx` have hardcoded links to `/challenge/{date}`. To reuse them in TailwindPlayer, add a `basePath` prop to each:

### HistoryView changes
- Add `basePath?: string` prop (default: `'/challenge'`)
- Change `href={`/challenge/${date}`}` to `href={`${basePath}/${date}`}`
- Accept `getHistory` and `getStats` functions as props so the caller controls which storage is read. TailwindPlayer passes `getTailwindHistory` and `getTailwindStats`; ChallengePlayer passes the existing `getHistory` and `getStats` (or omits them to use defaults)

### ResultsModal changes
- Add `basePath?: string` prop (default: `'/challenge'`)
- Change prev/next links from `/challenge/${prevDate}` to `${basePath}/${prevDate}`

This keeps backwards compatibility for ChallengePlayer (uses defaults) while allowing TailwindPlayer to pass `basePath="/tailwind"`.

## Storage

### Separate localStorage key: `tailwind-daily-challenge`

Add Tailwind-specific functions to `src/utils/storage.ts`:

```typescript
// Mirror existing functions with Tailwind types and key
const TAILWIND_STORAGE_KEY = 'tailwind-daily-challenge';

export function getTailwindResult(date: string): TailwindChallengeResult | null { ... }
export function saveTailwindResult(date: string, result: TailwindChallengeResult): void { ... }
export function getTailwindHistory(): TailwindChallengeHistory { ... }
export function getTailwindStats(): UserStats { ... }
```

`getTailwindStats()` returns the same `UserStats` type — the stats shape is mode-agnostic (games played, streaks, average score).

## Scoring & Diffing

### New functions in `src/utils/diff.ts`

**`renderAndCaptureTailwind(html: string, width: number, height: number): Promise<HTMLCanvasElement>`**

Similar to `renderAndCapture` but:
- Uses `buildTailwindSrcdoc(html)` instead of `buildSrcdoc(html, css)`
- Sets iframe `sandbox="allow-scripts allow-same-origin"` instead of just `allow-same-origin`
- Uses the iframe's `srcdoc` attribute and waits for the `load` event (instead of `doc.write()`) to ensure the Tailwind CDN script executes
- Waits longer after load (~500ms) for the Tailwind CDN to process all classes before capturing with snapdom

**`compareToTargetTailwind(userHtml: string, targetHtml: string, options: { compareWidth: number; compareHeight: number }): Promise<DiffResult>`**

Same scoring logic as `compareToTarget` but calls `renderAndCaptureTailwind` for both user and target HTML.

### New utility in `src/utils/code.ts`

**`buildTailwindSrcdoc(html: string): string`**

Wraps HTML with:
- `<script src="https://cdn.tailwindcss.com"></script>` in `<head>`
- Inter font link (same as CSS challenges)
- Body background set via Tailwind class on the `<body>` element: `<body class="bg-[#f5f5f5] min-h-screen flex items-center justify-center p-5 font-['Inter']">`
- No `<style>` block with `BASE_STYLES` — Tailwind's preflight provides its own reset. The body styling is handled via Tailwind utility classes to avoid conflicts with preflight.

**`buildTailwindScreenshotHtml(html: string): string`**

Same as `buildTailwindSrcdoc` but used by the Playwright generation script. May be identical, but keeping it separate mirrors the existing `buildScreenshotHtml` / `buildSrcdoc` pattern.

## Files to Create

1. `src/data/tailwind-classes.json` — curated Tailwind utility class list
2. `src/data/tailwind-challenges/` — directory for challenge JSON files
3. `public/targets/tailwind/` — directory for target screenshots
4. `scripts/generate-tailwind-challenge.ts` — Tailwind challenge generation script
5. `src/components/TailwindEditor.tsx` — class-only CodeMirror editor
6. `src/components/TailwindPreview.tsx` — Tailwind-aware preview component (allow-scripts sandbox)
7. `src/components/TailwindPlayer.tsx` — Tailwind challenge player
8. `src/pages/tailwind/index.astro` — redirect to today's Tailwind challenge
9. `src/pages/tailwind/[date].astro` — Tailwind challenge page

## Files to Modify

1. `scripts/generate-challenge.ts` — tighten size constraints in the prompt (520x320 hard max)
2. `src/utils/types.ts` — add `TailwindChallenge`, `TailwindChallengeResult`, `TailwindChallengeHistory`, `TailwindStorageData` types
3. `src/utils/code.ts` — add `buildTailwindSrcdoc` and `buildTailwindScreenshotHtml` functions
4. `src/utils/diff.ts` — add `renderAndCaptureTailwind` and `compareToTargetTailwind` functions
5. `src/utils/storage.ts` — add Tailwind-specific storage functions with `tailwind-daily-challenge` key
6. `src/components/Header.astro` — add "Tailwind" nav link
7. `src/components/HistoryView.tsx` — add `basePath` prop, accept storage functions as props
8. `src/components/ResultsModal.tsx` — add `basePath` prop for prev/next links
9. `.github/workflows/generate-challenge.yml` — add Tailwind generation step, extend git add paths

## Out of Scope

- Mobile-responsive Tailwind challenge layout (same desktop-focused approach as CSS challenges)
- Shared leaderboard or cross-mode stats
- Tailwind config customization (using default Tailwind config only)
- Content copywriting for any new UI text
- Fallback for Tailwind CDN unavailability (acceptable dependency for an internet-required site)
