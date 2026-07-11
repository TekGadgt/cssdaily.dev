# Emoji share grid (Wordle-style heatmap) — design

**Date:** 2026-07-11
**Status:** Draft (direction approved in brainstorming; awaiting spec review)

## Problem

CSS Daily once shared a Wordle-style emoji grid — a downsampled emoji rendering of the submission heatmap — in the copy-share text. It was removed (`840d22c`, 2026-03-06) after user feedback. The owner wants it back if it can be made accurate and legible this time.

Why the original failed:

1. **Comprehension.** The grid stood alone; readers didn't know it was a spatial accuracy map and needed manual explanation.
2. **Feel.** It shipped during the harsh-scoring era, so grids were consistently red — sharing felt like posting a failure.
3. **Accuracy flaws (from the removed code).** `generateShareGrid` sampled alpha off a canvas whose semantics only match the *heatmap* canvas (in today's pipeline `diffCanvas` is the fully-opaque user render — every cell would read 100% diff). All-background cells read as perfect green, so empty corners flattered while content punished. The 5×5 grid on a 600×400 (3:2) preview also distorted spatial mapping.
4. **Staleness (still true of the live heatmap today).** The modal's `heatmapCanvas` is whatever the *last* diff produced — after the practice-mode change (see the 2026-07-11 keep-tweaking spec, D2) that may reflect post-submit tweaking, and on revisiting a completed day it's null.

## Decisions made with the owner

- **Single-difficulty shares.** The share is scoped to the difficulty whose modal you share from: one score, one bar, one grid. The multi-difficulty aggregate share text (easy/medium/hard lines) is **removed** — accepted breaking change; players proud of multiple boards share each one. A day-summary share could return later via the Stats view; out of scope here.
- **Score bar + spatial grid together** (approach "C then narrowed"): the score line and 10-block decile bar do the explaining, the spatial grid provides the distinctive fingerprint. This addresses the comprehension failure without a caption.
- **Computed at submit, stored per result.** The grid string is generated from the submission diff and saved in the per-difficulty result record. Shares are stable and correct forever — no wrong-heatmap or stale-heatmap hazards, works across reloads and days later.
- The red-wall feel problem is addressed jointly by the scoring rework (keep-tweaking spec D4) and by calibrated thresholds + empty-cell texture below.

## Design

### E1 — Grid generation (new pure module `src/utils/emojiGrid.ts`)

`generateEmojiGrid(pixelDiffs: Float32Array, width: number, height: number): string`

Input is the per-pixel diff array `computeDiffScore` already builds (`SKIPPED = -1` for both-background pixels; otherwise normalized RGB distance 0..1). The module recomputes the same per-pixel penalty the score uses (0 within `COLOR_TOLERANCE`, else scaled excess) so the grid and the score never disagree about what counts as a miss.

- **Geometry:** 6×4 cells of 100×100 px over the 600×400 preview (both CSS and Tailwind previews are 600×400). Square cells, spatially true. Derive `cols = width / 100`, `rows = height / 100` rather than hardcoding.
- **Per-cell classification:**
  - `skippedFrac ≥ 0.98` → ⬜ (empty in both renders — honest "nothing here", not fake green)
  - otherwise `p = mean penalty over non-skipped pixels`:
    - `p < 0.05` → 🟩
    - `p < 0.15` → 🟨
    - `p < 0.35` → 🟧
    - else → 🟥
- Thresholds and the skipped cutoff are exported constants — calibration knobs, tuned with the fixtures below. Content-vs-background mismatches carry penalty 1 (as in the score), so missing/extra content reads red, as it should.
- Output: rows joined with `\n` (24 emoji + 3 newlines ≈ a compact 4-line block).

### E2 — Pipeline exposure

`buildDiffResult` (`diff.ts`) passes `pixelDiffs` through to `generateEmojiGrid` and adds `emojiGrid: string` to `DiffResult` (`types.ts`). Cost is negligible (one pass over 240k floats already in memory). Both CSS and Tailwind paths get it for free since they share `buildDiffResult`.

### E3 — Storage (additive, no migration)

`ChallengeResult` and `TailwindChallengeResult` gain `emojiGrid?: string`. `doSubmit` writes it from the submission diff. Notes:

- **Depends on keep-tweaking spec D1** (submit flushes a fresh diff): the stored grid must describe the submitted code, exactly like the recorded score. Implement this feature after (or with) D1; if it somehow ships first, the grid inherits the same staleness as today's score — no worse.
- `migrateHistoryShape` keeps valid result objects wholesale, so the optional field round-trips untouched; old results simply lack it. Defensive touch at the read boundary: when embedding into share text, drop the field unless it matches `^[🟩🟨🟧🟥⬜\n]+$` (storage is user-writable; don't paste arbitrary strings into clipboards).
- Private-mode/quota: when the write is swallowed, the grid lives in component state alongside the in-memory score and shares work for as long as that board stays open — the same guarantee scores have today.

### E4 — Share text (`share.ts` simplification)

`generateShareText` collapses to the single-difficulty format:

```
CSS Daily 2026-07-11 (medium) 💨
Score: 78% | Time: 6:12
🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜

⬜🟩🟩🟩🟩⬜
🟩🟩🟨🟩🟩🟩
🟩🟧🟩🟩🟩🟩
⬜🟩🟩🟥🟩⬜

https://cssdaily.dev
```

- **Bar:** 10 blocks, `round(score / 10)` 🟩 then ⬜ — deciles of the recorded (blended) score.
- **Grid:** the stored `emojiGrid`; omitted (with its surrounding blank line) for legacy results that predate the field. The bar renders regardless (derived from score).
- The multi-entry branch, `ShareEntry[]` plumbing, and the `shareEntries` aggregation memo in both players (with its cross-difficulty storage reads and private-mode fallback dance) are deleted. `ResultsModal` receives one `share: { difficulty, score, timeSpent, emojiGrid? }` object built from the sharing player's own state.
- `speedEmoji` unchanged.

### E5 — Modal display consistency (minor)

The modal's visual heatmap keeps using the live canvas today, which after practice-mode tweaking can show a *practice* heatmap beside the recorded score. Capture the heatmap canvas into a ref at submit time (`submittedHeatmapRef`) and have the modal display that instead — in-memory only, no storage. Revisits after reload show no canvas (as today); the emoji grid in the share is unaffected either way.

## Calibration fixtures

Reuse the scoring spec's empirically-measured scenarios (2026-06-25 medium) to sanity-check thresholds after the D4 scoring rework lands:

- Exact target CSS → grid contains only 🟩/⬜.
- Spacing near-miss (16→14/24→20/12→10 px) → majority 🟩, no more than a couple 🟨/🟧, zero 🟥.
- ¼-of-target attempt → visibly mixed grid (the story of a partial attempt), not a wall of 🟥.
- Starter CSS untouched → mostly 🟥/🟧 with ⬜ texture (an honest zero-effort fingerprint).

## Out of scope

- Reviving any multi-difficulty/day-summary share (possible later from the same stored grids, e.g. in Stats view).
- Showing stored grids in HistoryView.
- Persisting heatmap images (dataURLs) — only the emoji string is stored.
- Threshold auto-tuning; constants + fixtures are enough at this scale.

## Verification plan

1. Unit tests for `emojiGrid.ts` (pure): geometry, skipped-cell cutoff, threshold boundaries, penalty parity with the score math, sanitization regex.
2. Playwright: submit a known attempt → share text matches the stored grid; reload → share still carries the grid; finish a second difficulty → sharing the first still shows the first's grid; practice-tweak after submit → share grid unchanged; legacy result (grid-less record injected into localStorage) → bar renders, grid omitted, no crash.
3. Manual: paste share text into a few real targets (iMessage, Discord, X) to confirm the 6-wide grid renders unwrapped and the blocks read on light and dark backgrounds.
