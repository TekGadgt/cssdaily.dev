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

Output format uses XML tags:
- `<title>`, `<difficulty>`, `<targethtml>`, `<starterhtml>`

### Screenshot generation

The `generateTargetPng` function in the Tailwind script loads the Tailwind CDN play script (`https://cdn.tailwindcss.com`) in the Playwright page before setting content, then waits for network idle before screenshotting.

### Workflow update

Update `generate-challenge.yml` to add a second step after CSS generation:
```yaml
- name: Generate Tailwind challenge
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    OUTPUT=$(npx tsx scripts/generate-tailwind-challenge.ts)
    echo "$OUTPUT"
```

The commit step already uses `git add src/data/challenges/ public/targets/` — extend to include `src/data/tailwind-challenges/` and `public/targets/tailwind/`.

## CSS Generation Prompt Update

Update the existing CSS generation prompt in `scripts/generate-challenge.ts`:
- Change "Component must fit within 560x360px (20px margin from 600x400 viewport)" to "Component must not exceed 520x320px"
- Change "Max width ~320px, max height ~340px" to remove entirely (redundant with the above)
- Use firm language: "must not exceed", no `~` approximations

## Class-Only Editor

### Component: `src/components/TailwindEditor.tsx`

A CodeMirror 6 editor that displays full HTML but restricts editing to only the values inside `class="..."` attributes.

#### Architecture

- Uses `@codemirror/lang-html` for syntax highlighting
- On load, parses the document to identify all `class="..."` value regions (the text between quotes after `class=`)
- **Transaction filter** (`EditorState.transactionFilter`): rejects any transaction that would modify text outside class value regions
- **Decorations** (`EditorView.decorations`): non-editable regions get a dimmed visual style (e.g., reduced opacity) to signal they're locked
- As the user types within class value regions, the region positions are recalculated to account for text growing/shrinking
- Edge cases to handle: paste (only allow within class regions), undo/redo (should work normally within class regions), cursor movement (free to move anywhere for reading)

#### Tailwind autocomplete

- Custom `CompletionSource` using `@codemirror/autocomplete` (already installed)
- Completion list sourced from `src/data/tailwind-classes.json`
- Activates only when cursor is inside a `class="..."` region
- Tab-to-accept behavior matches the existing CSS editor
- Completions are context-aware: matches against the current word being typed within the class value

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
- User edits HTML class attributes, not CSS
- Preview renders HTML with Tailwind CDN loaded in the iframe
- No HTML tab in the editor (the editor IS the HTML)
- History stored separately in localStorage: `tailwind-result-{date}` key prefix (vs `result-{date}` for CSS)

### Page: `src/pages/tailwind/[date].astro`

Uses Layout, shared Header (with `currentPath="/tailwind"`), and TailwindPlayer. Loads challenges from `src/data/tailwind-challenges/`.

## Scoring & Diffing

- Reuses `compareToTarget` from `src/utils/diff.ts` — no changes needed
- The `renderAndCapture` function uses `buildSrcdoc` to create iframe content — the Tailwind variant uses a new utility

### New utility: `buildTailwindSrcdoc(html: string)` in `src/utils/code.ts`

Wraps HTML with:
- The Tailwind CDN play script (`<script src="https://cdn.tailwindcss.com"></script>`)
- Standard viewport setup (body background #f5f5f5, margin, font)
- No `<style>` block (all styling via Tailwind classes)

The `compareToTarget` function signature changes slightly for Tailwind mode — instead of taking separate `html` and `css` params, it takes a single `html` param and uses `buildTailwindSrcdoc`. This could be handled by:
- A new `compareToTargetTailwind` function, or
- An options flag on the existing function

The simpler approach is a new function to avoid complicating the existing one.

## Files to Create

1. `src/data/tailwind-classes.json` — curated Tailwind utility class list
2. `src/data/tailwind-challenges/` — directory for challenge JSON files
3. `public/targets/tailwind/` — directory for target screenshots
4. `scripts/generate-tailwind-challenge.ts` — Tailwind challenge generation script
5. `src/components/TailwindEditor.tsx` — class-only CodeMirror editor
6. `src/components/TailwindPlayer.tsx` — Tailwind challenge player
7. `src/pages/tailwind/index.astro` — redirect to today's Tailwind challenge
8. `src/pages/tailwind/[date].astro` — Tailwind challenge page

## Files to Modify

1. `scripts/generate-challenge.ts` — tighten size constraints in the prompt (520x320 hard max)
2. `src/utils/code.ts` — add `buildTailwindSrcdoc` function
3. `src/utils/diff.ts` — add `compareToTargetTailwind` function (or similar)
4. `src/utils/storage.ts` — add Tailwind-specific save/get functions with separate key prefix
5. `src/components/Header.astro` — add "Tailwind" nav link
6. `.github/workflows/generate-challenge.yml` — add Tailwind generation step, extend git add paths

## Out of Scope

- Mobile-responsive Tailwind challenge layout (same desktop-focused approach as CSS challenges)
- Shared leaderboard or cross-mode stats
- Tailwind config customization (using default Tailwind config only)
- Content copywriting for any new UI text
