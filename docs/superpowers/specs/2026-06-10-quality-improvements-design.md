# Quality Improvements — Design

**Date:** 2026-06-10
**Status:** Approved

Four work packages addressing player-reported issues, sequenced by priority. Each package ships independently.

## Background

Findings from codebase analysis that motivated this design:

- 61 of 99 CSS challenges contain emoji, but no emoji font is pinned. The target PNG is rendered by Playwright on Linux CI while players render previews on their own OS, so the reference screenshot shows different emoji glyphs than the player's preview. Scoring is unaffected (both diff inputs render client-side), but the reference is misleading.
- 98 of 99 challenges are labeled `medium` because the model picks the difficulty itself.
- The generator trusts the prompt's "max 520×320px" constraint with no post-generation validation, causing occasional clipped targets.
- Target and starter HTML are identical in both game modes, which makes element-level structural comparison trivial (1:1 correspondence by tree order).

## Package 1: Generator hardening

### 1a. Emoji consistency (Noto Color Emoji webfont)

Pin emoji rendering to one font everywhere a challenge renders:

- `FONT_LINK` in `src/utils/code.ts` adds the Google Fonts request for Noto Color Emoji alongside Inter.
- `BASE_STYLES` font-family becomes `'Inter', 'Noto Color Emoji', sans-serif`.
- `buildTailwindSrcdoc` body font class gains the same fallback.

Because the Playwright screenshot env, the player preview iframes, and the snapdom diff captures all build HTML through these same helpers, the generator and every player OS render identical emoji.

**No backfill:** existing target PNGs stay as-is — the emoji mismatch on past challenges is a known issue and they remain archival. The fix applies to challenges generated from this point forward (the player-side font change does apply everywhere, since previews render live).

### 1b. Oversize validation with retry loop

In `scripts/generate-challenge.ts` and `scripts/generate-tailwind-challenge.ts`, after rendering the target in Playwright:

1. Measure the rendered component's bounding box (union of `document.body` children rects).
2. If it exceeds 520×320, append a follow-up user message to the same conversation: the measured W×H, the limit, and an instruction to regenerate smaller. Re-extract, re-render, re-measure.
3. Up to 3 retries; if still oversize, the script exits nonzero (the workflow's `continue-on-error` already tolerates a failed day).

### 1c. Semantic HTML prompt guidance

Add a system-prompt line instructing the generator to prefer semantic elements (`nav`, `article`, `section`, `button`, `figure`, etc.) where they fit naturally. Guidance only — not validated.

## Package 2: Layout toggle (rows ⇄ columns)

A manual layout toggle for both `ChallengePlayer` and `TailwindPlayer`:

- **Rows (current/default):** previews side-by-side on top, editor full-width below.
- **Columns:** the two preview panels stacked vertically in a left column, editor filling the right column.

Details:

- Toggle button in the player header (icon button, e.g. layout glyphs).
- Preference persisted to localStorage under a single shared key — one preference covers both game modes.
- Manual only; no breakpoint-driven switching.

## Package 3: Three difficulties daily

Replace the model-chosen single difficulty with three generated challenges per day per mode: one easy, one medium, one hard.

### Generation

- Each generator script loops over the three difficulties, producing three challenges per run. Each difficulty generates independently (a failure in one does not abort the others); the script exits nonzero only if all three fail, and the CI step summary reports per-difficulty outcomes.
- The prompt receives concrete per-difficulty criteria (approximate element count, CSS property count, layout nesting depth — exact rubric defined during implementation).
- `timeLimit` mapping stays: easy 300s, medium 600s, hard 900s.
- 6 API calls/day total across both modes.

### Data layout

- New files: `src/data/challenges/YYYY-MM-DD-easy.json`, `-medium.json`, `-hard.json`; targets `public/targets/YYYY-MM-DD-easy.png`, etc. Same shape as today (each JSON already carries `difficulty`).
- Existing single files (`YYYY-MM-DD.json` / `.png`) remain valid as-is; they are treated as the sole challenge for their date.

### Pages and player

- `getStaticPaths` groups challenge files by date; each `/challenge/[date]` (and `/tailwind/[date]`) page receives all difficulties available for that date as props. Still fully static.
- The player shows an Easy / Medium / Hard toggle beside the title. Switching swaps the active challenge in place (editor content, target image, timer, score state) without navigation. Each difficulty's in-progress editor state is kept separately while on the page.
- Last-played difficulty persisted to localStorage and used as the default selection.
- Dates with a single legacy challenge hide the toggle.
- Target image paths come from a challenge-derived key (`date` for legacy, `date-difficulty` for new) rather than date alone.

### Results and stats

- Storage schema becomes `history[date][difficulty]` with separate score/time/submission per difficulty, for both the CSS and Tailwind storage keys.
- One-time migration on first read: existing flat entries move to `history[date][difficulty]` using the entry's challenge difficulty when known, else `medium` (98/99 accurate).
- Streaks: a day counts as played if any difficulty was submitted that day.
- Stats (games played, average) count each submitted difficulty as a game.
- Share card lists each attempted difficulty with its score.

## Package 4: Structural scoring

Add an element-level metric so correct structure/size/position is rewarded, not just pixel color overlap.

### Generation side

After the target render in Playwright, walk every element inside `body` in document order and record its bounding box (`x`, `y`, `width`, `height`, viewport-relative). Store as `targetRects: Rect[]` in the challenge JSON.

### Client side

- After each diff render, measure the same elements in the user's preview iframe in document order (`getBoundingClientRect`), producing 1:1 pairs with `targetRects` (HTML structure is identical by construction). The player preview iframe and the generation viewport are both 600×400, so rects compare directly with no scaling.
- Per-element score: IoU (intersection-over-union) of user rect vs target rect; 0 when disjoint.
- Structural score = mean IoU across elements, as 0–100.

### Blending

- `finalScore = round(0.6 * pixelScore + 0.4 * structuralScore)` — weights are named constants, tunable.
- `pixelScore` is the existing power-curved pixel diff score.
- Challenges without `targetRects` (all existing ones) score pixel-only — no retroactive changes.
- The score display may show the two components in a tooltip/breakdown (implementation detail).

### Tailwind mode

Works identically: the DOM structure is fixed (players edit only class values), so tree-order correspondence holds. Generation-side rects are measured in the same Playwright render that produces the Tailwind target screenshot.

## Out of scope

- Selector hover highlighting in the preview — dropped: it cannot achieve parity between CSS and Tailwind modes (Tailwind players don't write selectors).
- Reactive/breakpoint-driven layout switching (manual toggle only).
- Difficulty-based scoring adjustments or leaderboards.

## Sequencing

1. Generator hardening — kills both live bugs (clipping, emoji mismatch).
2. Layout toggle — small UX win; lands before the player components get reworked by Package 3.
3. Three difficulties daily — largest change (generation, data, pages, storage migration).
4. Structural scoring — additive, builds on the generation pipeline as it stands after Package 3.

Each package is a separate implementation plan and PR-sized unit of work.
