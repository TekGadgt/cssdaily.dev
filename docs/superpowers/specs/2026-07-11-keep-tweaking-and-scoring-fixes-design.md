# Keep Tweaking + dual-scoring fixes — design

**Date:** 2026-07-11
**Status:** Draft (findings verified; awaiting approval)

## Problem

Two field reports:

1. "The **Keep Tweaking** button in the submission/end modal doesn't always work" (not reproducible by the owner).
2. "Scoring is **substantially worse/harder** and sometimes **appears stuck** since the dual scoring setup (pixel diff + computed layout comparison)."

Both were investigated end-to-end with live browser repros against the dev server (Playwright, 2026-06-23/24/25/26 challenges). Every claim below marked **verified** was reproduced; hypotheses that failed reproduction are listed under *Ruled out*.

## Findings

### F1 (verified) — "Keep Tweaking" closes the modal but returns to a dead state

The button itself works: it fires `onClose` and the modal closes every time. What's broken is the state it returns you to. `doSubmit` (`ChallengePlayer.tsx:116`, `TailwindPlayer.tsx:115`) sets `phase = 'finished'`, and there is **no path out of `finished`**:

- The **Submit button is gone** (replaced by "Results"), so further tweaks can never be recorded.
- The **timer is stopped** and never resumes.
- The **displayed score is frozen** at `submittedScore` (`displayScore = phase === 'finished' ? submittedScore : score`), while `runDiff` continues to update `diffResult` unguarded — so the **hover tooltip breakdown and the Diff heatmap keep live-updating** next to a big score number that never moves.

Repro (2026-06-26 medium): submit at 3% → Keep Tweaking → add a rule that changes the render → tooltip went `Pixel 0% · Structure 6%` → `Pixel 23% · Structure 8%`, heatmap updated, **score stayed 3%**, no Submit button.

This single behavior explains *both* reports: "the button doesn't work" (tweaks visibly do nothing) and "the score appears stuck" (frozen next to a live tooltip). It also applies when revisiting an already-completed day (the `getResult` effect restores `finished`).

### F2 (verified, most severe) — Submit records a stale score

`doSubmit` records `scoreRef.current`, which is whatever the **last completed diff** computed. Diffs are debounced **1.5 s** (`scheduleDiff`) and take further time to run. Any submit that lands inside that window — including **time-up auto-submit**, which by definition fires while the user is mid-tweak — records a score that does not reflect the submitted CSS. The submitted CSS itself (`userCssRef.current`) *is* saved correctly; only the score is stale.

Repro (2026-06-23 medium): established a 2% baseline, pasted the **exact target CSS**, clicked Submit immediately → modal and saved result read **2%**, not 100%. Combined with F1 there is no resubmit, so the wrong score is **locked in permanently**.

This is very likely the source of "scoring is substantially worse" reports that look random: last-second fixes (or time-up during an edit burst) are silently not counted.

### F3 (verified) — The structural score is a cliff, dragging mid-game scores down ~40%

`computeStructuralScore` (`structural.ts:36`) is a plain mean IoU over **every element** in document order, blended at `0.6·pixel + 0.4·structural` (`blendScores`). Measured on 2026-06-25 medium, pasting known fractions of the target CSS:

| Attempt | Pixel | Structure | Blended (today) | Pre-dual (pixel-only) |
|---|---|---|---|---|
| ¼ of target rules | 45% | 7% | **30%** | 45% |
| ½ of target rules | 41% | 8% | **28%** | 41% |
| Spacing slightly off (16→14, 24→20, 12→10px) | 90% | 84% | 88% | 90% |
| Colors off by +12/channel | 99% | 100% | 99% | 99% |
| Exact target CSS | 100% | 100% | 100% | 100% |

Observations:

- Structure sits **flat at ~6–8% for most of the session** (quarter→half of the challenge moved it 7→8) and only converges (84–100%) when the layout is nearly perfect. So mid-game the blend is effectively `0.6 × pixel` — a **~⅓ drop in every displayed score** compared to the pixel-only era, and per-edit movement shrank by the same factor ("feels stuck").
- Scoring is **non-monotonic** with progress (¼ done = 30% > ½ done = 28%).
- The ceiling is intact (perfect = 100), which is why the change is easy to miss when testing with near-complete solutions.

Why the metric cliffs:

1. **Descendant double-counting.** Rects are viewport-absolute, so a mispositioned container drags *every* descendant's IoU to ~0 with it. Until the outer layout is right, most of the per-element mean is ~0.
2. **Unweighted mean.** A 16×16 icon counts the same as the card container, and small rects crater under offsets the pixel tolerance forgives (a 20×20 rect offset 4px in both axes → IoU ≈ 0.47).
3. **Zero-area cliff.** A zero-area rect (default state of many unstyled elements) vs. any non-zero target rect scores exactly 0 — no partial credit for "almost".
4. **Linearity mismatch.** The pixel side is power-curved (`SCORE_EXPONENT = 3`) specifically to shape the feel-curve; the structural side is raw.

Side note: Tailwind mode falls back to **pixel-only** whenever the user's element count differs from the target (`computeStructuralScore` returns null), so CSS mode is systematically harsher than Tailwind mode.

### F4 (code-evident) — Concurrent diffs are dropped, not coalesced

`runDiff` bails when `diffPendingRef.current` is set. Triggers overlap constantly: every keystroke reloads the preview iframe, whose `onLoad` fires `runDiff` ~150 ms later, alongside the 1.5 s debounced call. When the **final** edit's diff is dropped because an earlier render's diff is still in flight, nothing re-triggers — the score stays stale until the next keystroke. Transient, but a plausible contributor to intermittent "stuck" reports, and it widens the F2 window.

### F5 (code-evident, secondary) — Hidden difficulty timers keep running

In a multi-difficulty set all three players stay mounted; visibility is CSS-only (`SET_VISIBILITY`). A hidden player whose phase is `playing` keeps its `setInterval` timer running and will **auto-submit invisibly** (with an F2-stale score) while the user plays a different difficulty. Switching back later reveals an unexpectedly-finished challenge with the results modal already open.

### Ruled out

- **Modal click plumbing.** Backdrop/stopPropagation/button handlers all behave; the modal closed on every attempt, including immediately after time-up auto-submit.
- **Scoring pipeline wedge via hung font requests.** Hypothesis: `renderAndCapture`'s load-wait never settles → `diffPendingRef` never clears → scoring dead for the session. Tested by hanging all `fonts.googleapis.com` requests (34 requests left pending): diffs still completed and no scoring iframes leaked. `document.fonts.ready` resolves when nothing is loading, and the readyState path doesn't block. Not the bug — though a defensive timeout is still cheap insurance (see D6).

## Design

Fixes ordered by user impact. D1–D3 are the core; each applies identically to `ChallengePlayer.tsx` and `TailwindPlayer.tsx` (they are near-duplicates — extracting the shared engine into a `usePlayerEngine` hook is a worthwhile implementation option but not required by this spec).

### D1 — Submit scores the code you submitted (fixes F2)

Make submission compute a **fresh diff of the current code** instead of trusting `scoreRef`:

- `doSubmit` becomes async: cancel the pending debounce timer, then obtain a diff for `userCssRef.current`. If a diff for exactly this CSS just completed, reuse it; otherwise run one (waiting out any in-flight run — see D3's coalescing, which makes this a one-liner: `await ensureFreshDiff()`).
- Track `lastDiffedCode` alongside the result so freshness is checkable.
- UI: the Submit button shows a brief disabled "Scoring…" state while the flush runs (typically < 1 s).
- Failure fallback: if the flush diff throws, record `scoreRef.current` as today (degraded, never blocking submission).
- The **time-up path uses the same flow** — auto-submit must flush too.

Acceptance: paste the exact target CSS, hit Submit within the debounce window → modal and saved result read 100%.

### D2 — Make "Keep Tweaking" an honest practice mode (fixes F1)

Design intent (confirmed by owner): submission is final — the recorded score is the best you could do within the time, and post-submit editing exists as a **learning experience** so players improve on following days. There is **no resubmission and the timer never resumes**. What's missing today is only the feedback loop:

- After submit (or when revisiting a completed day), editing continues to work as now, but the **live score updates visually**: remove the `phaseRef.current !== 'finished'` guard in `runDiff` so `score` tracks the current code, and stop pinning `displayScore` to `submittedScore`.
- Show both numbers so the live value can't be mistaken for the recorded result — e.g. header reads `72% · recorded 68%` (or a "practice" tag on the live score). The results modal, share text, and saved result continue to use the recorded score only.
- The `finished` phase remains terminal: Submit stays hidden, the timer stays stopped, `saveResult` is never called again for that day/difficulty.

This dissolves the frozen-number/live-tooltip inconsistency (F1) without opening any path to gaming the daily score.

### D3 — Coalesce diffs instead of dropping them (fixes F4, enables D1)

Replace the `diffPendingRef` early-return with trailing-run coalescing:

- If `runDiff` is called while a run is in flight, set a `queuedRef` flag and return.
- In `finally`: if `queuedRef` is set **or** `userCssRef.current !== lastDiffedCode`, clear the flag and run again immediately.
- Skip runs whose code equals `lastDiffedCode` (the per-keystroke preview `onLoad` + debounce double-trigger currently does redundant work).

Guarantee: after the last edit settles, the displayed score always reflects the current code.

### D4 — Fix the structural metric's cliff (fixes F3)

Goal: structure should **track progress smoothly** (monotonic-ish, informative mid-game) instead of flat-lining at ~7% and jumping at the end. Three changes to `structural.ts`, keeping the 0.6/0.4 blend:

1. **Parent-relative rects.** Measure each element's rect relative to its offset parent (or subtract the parent's target-vs-user delta) before IoU, so a mispositioned container is penalized once, not once per descendant. `measureElementRects` in `diff.ts` gains the parent link; pairing stays document-order (same starter HTML, so counts always match in CSS mode).
2. **Tolerance slack.** Inflate both rects by a few px (e.g. 4) before IoU — mirrors the pixel side's `COLOR_TOLERANCE` philosophy and stops tiny elements cratering on 2–4 px misses. Also removes the zero-area cliff: a zero-area rect inflated by the slack gets partial credit against a small target rect.
3. **Area weighting.** Weight each element's IoU by `sqrt(target area)` (√ so the page container doesn't drown everything either) instead of an unweighted mean.

Optionally revisit the linearity mismatch after the above (a mild curve like `s^1.5` if structure now reads *too* generous mid-game) — the comment in `structural.ts` already anticipates this knob.

**Interim mitigation option:** if the metric rework needs iteration time, dropping `STRUCTURAL_WEIGHT` to ~0.15–0.2 restores most of the old feel in a one-line change and keeps the tooltip/breakdown infrastructure intact.

**Acceptance (regression fixtures — the exact scenarios measured above, automatable with the repo's existing Playwright dep):**

- Exact target CSS → 100.
- Blended score for ¼-of-target < ½-of-target (monotonic on the fixture).
- ½-of-target blended within ~15% relative of its pixel score (structure no longer a flat drag).
- Spacing near-miss (16→14/24→20/12→10 px) ≥ its current 88.

### D5 — Pause hidden players' timers (fixes F5)

A player in a multi-difficulty set should only tick when it is the active difficulty. Gate `Timer`'s `isRunning` on `phase === 'playing' && isActiveDifficulty` (the active value already lives on `document.documentElement.dataset.difficulty`; observe it via the existing switcher or a small subscription). Elapsed time simply stops accruing while hidden — the user isn't playing that board. No invisible auto-submits.

### D6 — Defensive timeout on capture waits (hardening, optional)

`renderAndCapture` / `renderAndCaptureTailwind` wait on `readyState`/`onload`/`fonts.ready` with no upper bound. Not reproducibly wedgeable (see *Ruled out*), but wrap the wait in a `Promise.race` with a ~5 s timeout so a pathological environment degrades to a slightly-off capture instead of a hung diff. With D3's coalescing, one hung run would otherwise stall the queue.

## Out of scope

- Rebalancing challenge difficulty/time limits on the back of the new curve — watch the feel after D4 ships (per the existing "watch scoring feel" follow-up).
- De-duplicating `ChallengePlayer`/`TailwindPlayer` into a shared hook (nice-to-have; flagged for the implementation plan).
- Any change to share-text format or stored-result schema (resubmission reuses the existing record).

## Verification plan

1. Unit-test `structural.ts` (pure module): IoU slack, area weighting, parent-relative decoupling, zero-area partial credit, null fallback.
2. Playwright script covering the fixture table in D4 plus: perfect-paste-then-instant-submit records 100 (D1); submit → Keep Tweaking → edit → live score updates while the recorded score, modal, and localStorage result stay unchanged, and no Submit button reappears (D2); rapid-typing session always converges to the current code's score (D3); starting easy, switching to medium, waiting past easy's limit does not auto-submit easy (D5).
3. Manual smoke on both `/challenge/` and `/tailwind/` players, including a revisit of a completed day (practice mode).
