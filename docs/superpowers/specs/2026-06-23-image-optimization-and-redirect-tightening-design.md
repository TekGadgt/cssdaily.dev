# Image optimization + redirect tightening + a11y/SEO — design

**Date:** 2026-06-23
**Status:** Approved (design); pending implementation plan

## Problem

Two issues surfaced during testing:

1. **Challenge target images are unoptimized.** 256 PNGs (136 in `public/targets/`, 120 in `public/targets/tailwind/`) are served untouched — `public/` bypasses Astro's asset pipeline. They are flat-color CSS screenshots that compress well.
2. **A redirect chain on first load.** Visiting `cssdaily.dev` produces two hops: `/` →(client-side JS, loading the full `Layout` + analytics beacon)→ `/challenge/<date>` →(GitHub Pages 301, directory trailing-slash)→ `/challenge/<date>/`. The same non-trailing-slash 301 applies to every internal route link (`/about`, `/tailwind`, date navigation).
3. **Accessibility/SEO gaps flagged by audits.** The CodeMirror editors expose no accessible name, the preview/capture iframes have no `title`, and the challenge pages have no `main` landmark (Google/Lighthouse flags the missing landmark).

Browser caching was investigated and intentionally left as-is: the site is hosted on **GitHub Pages**, which gives no control over response headers (fixed `Cache-Control: max-age=600` + ETag). Long-lived/immutable caching would require fronting the domain with a CDN (e.g. Cloudflare); the owner chose to stay on GitHub Pages. Each target image already lives at a unique date-keyed URL, so ETag revalidation is adequate. **No caching changes in this work.**

## Scope

In scope:
- Convert all target images PNG → **lossless WebP** (existing files + generation pipeline).
- Eliminate the redirect chain: collapse the root bounce directly to the trailing-slash challenge URL, and remove the trailing-slash 301 from all internal links.
- Accessibility/SEO fixes: accessible names on the CodeMirror editors, `title` on all iframes, a `main` landmark on the challenge pages.

Out of scope (flagged, not addressed here):
- A latent redirect-loop risk: if a user's local date is ahead of the latest built challenge, `/` → missing date → `404` → `/` can loop. Pre-existing.
- Any CDN/hosting migration.

## Verification already performed

A throwaway probe (`sharp` 0.34.5, already present transitively) encoded every `public/targets/*.png` to WebP and compared:

| Encoding | Aggregate size vs PNG | Fidelity |
|---|---|---|
| **Lossless WebP** (`effort: 6`) | **−40.5%** | **byte-identical pixels** — max channel diff `0`, `0` differing channels across every file |
| near-lossless | −42.4% | ~identical |
| lossy q90 | −43.5% | artifacts possible; larger than lossless on some files |

**Decision: lossless WebP.** Lossy buys only ~3% more aggregate while risking artifacts (and sometimes producing *larger* files, since these flat images are already near-optimal for lossless). 40% off the repo's image weight with zero fidelity loss.

### Why this cannot affect challenge integrity

Scoring does not read the image file. `compareToTarget` (`src/utils/diff.ts:244`) live-renders both the user's CSS and `challenge.target.css` via `snapdom → SVG → canvas`, then pixel-diffs those two canvases (`computeDiffScore`). The target PNG/WebP (`targetSrc`) is used **only** as the reference picture displayed in the target tab and overlay (`ChallengePlayer.tsx:301/309`, `TailwindPlayer.tsx`). Two consequences:

- The pixel-diff is format-agnostic — it never touches the file, so WebP vs PNG is irrelevant to scoring.
- Even the *displayed* reference is unchanged: lossless WebP decodes to identical RGBA bytes.

## Design

### Part A — Lossless WebP target images

**A1. Generation pipeline.** In the two daily generators (`scripts/generate-challenge.ts`, `scripts/generate-tailwind-challenge.ts`):
- Screenshot to a buffer, encode with `sharp(buf).webp({ lossless: true, effort: 6 })`, write `${date}-${difficulty}.webp`.
- Set the JSON `targetImage` field to the `.webp` filename.
- Preserve the existing ordering guarantee: image must be written successfully *before* the challenge JSON, so a screenshot failure never leaves a JSON whose target image 404s.

**A2. Regeneration helper.** `scripts/generate-targets.ts` currently hardcodes `${challenge.date}.png`, ignoring the JSON's `targetImage` (a latent multi-difficulty bug). Update it to honor `challenge.targetImage` (extension swapped to `.webp`) and emit lossless WebP.

**A3. One-time migration script.** Add a script that:
- Walks `public/targets/**/*.png` (both the root and `tailwind/` subdir).
- For each PNG: encode lossless WebP sibling (`effort: 6`), write `.webp`, delete the `.png`.
- Update every challenge JSON in `src/data/challenges/` and `src/data/tailwind-challenges/`: set `targetImage` to the `.webp` name (`.png` → `.webp`, or add `${date}.webp` for legacy entries that omit the field).
- Idempotent and re-runnable (skip already-converted files).

**A4. Frontend fallback.** Change the fallback default in `ChallengePlayer.tsx:182` and `TailwindPlayer.tsx:183` from `${challenge.date}.png` to `${challenge.date}.webp`, so any legacy entry without an explicit `targetImage` still resolves.

**A5. Dependency.** Add `sharp` to `package.json` (currently transitive-only). Already used by the daily generation workflow environment via Playwright/Astro; making it explicit keeps the generators honest.

### Part B — Redirect tightening

**B1. Collapse the root bounce to the final URL.** The end state is always the trailing-slash challenge URL, and the date is per-user/timezone-dependent (a static build-time redirect would point at the wrong date — the generator commits *tomorrow's* challenge). So keep the client-side redirect but:
- Rewrite `src/pages/index.astro` and `src/pages/tailwind/index.astro` as **bare redirect stubs** — no `Layout`, no analytics beacon — that set `window.location.replace` directly to the trailing-slash URL (`/challenge/<date>/`, `/tailwind/<date>/`). Use `replace` so the stub doesn't pollute history.
- Apply the same slimming to `src/pages/404.astro` (redirects to `/`).

Result: root = one near-empty, instant redirect straight to the final URL. No second 301, no Layout/analytics load on the bounce page.

**B2. Remove the trailing-slash 301 from internal links.** GitHub Pages 301s any directory path missing its trailing slash. Append `/` to every internal route link:
- `src/components/ChallengePlayer.tsx` (194, 200) — `/challenge/<date>/`
- `src/components/TailwindPlayer.tsx` (195, 201) — `/tailwind/<date>/`
- `src/components/HistoryView.tsx` (65) — `${basePath}/<date>/`
- `src/components/ResultsModal.tsx` (94, 97) — `${basePath}/<date>/`
- `src/components/Header.astro` — `/tailwind/`, `/about/` (root `/` is already fine)
- the two index redirect targets and (already) trailing-slash challenge URLs

**B3. Config hygiene.** Add `trailingSlash: 'always'` to `astro.config.mjs`. Astro's `build.format` already defaults to `directory` (produces `/challenge/<date>/index.html`), so this is consistency/dev-server alignment, not a behavior change to the build output.

### Part C — Accessibility / SEO

**C1. Accessible names on the CodeMirror editors.** A bare `aria-label` on the wrapper `<div>` is not enough — the focusable element is CodeMirror's inner `role="textbox"` (`.cm-content`). Label that element directly via the `EditorView.contentAttributes.of({ 'aria-label': '…' })` extension when constructing each view:
- `CodeEditor.tsx` — CSS view (`:52`) → `"CSS editor"`; HTML view (`:72`) → `"HTML editor (read-only)"`.
- `TailwindEditor.tsx` — view (`:165`) → `"Tailwind HTML editor"`.

**C2. `title` on all iframes.**
- `Preview.tsx:21` and `TailwindPreview.tsx:21` (visible preview frames) → `title="Live preview of your code"`.
- The two hidden capture iframes in `diff.ts` (`:34`, `:271`) → set `iframe.title` (e.g. `"Offscreen render for scoring"`). Off-screen and transient, but titling them is trivial and silences strict scanners.

**C3. `main` landmark on the challenge pages.** Wrap the challenge player(s) in a single `<main>` in `src/pages/challenge/[date].astro` (`:31`) and `src/pages/tailwind/[date].astro` (`:31`), leaving the site `Header` outside it. Preserve the existing flex layout (the `<main>` takes the `flex-1 min-h-0 flex flex-col` role the players rely on). `about.astro` already has a `<main>` — no change.

## Testing / acceptance

- **Build:** `npm run build` succeeds; `dist/` contains `.webp` targets and no orphan `.png` under `targets/`.
- **WebP fidelity:** migration reports the same ~40% aggregate reduction; spot-check a converted reference image renders correctly in the target tab/overlay.
- **Scoring unchanged:** play a challenge and confirm score/heatmap behave exactly as before (they depend on `target.css`, not the image).
- **Redirects:** from a cold load, `cssdaily.dev` lands on `/challenge/<today>/` with no intermediate `/challenge/<today>` 301 (verify via network panel — single navigation after the JS bounce). Internal nav links (date arrows, header, history) navigate with no 301.
- **No regressions:** legacy challenges (no `targetImage`) still display their reference image.
- **Accessibility:** the CodeMirror textbox elements expose their `aria-label` (verify in the accessibility tree / via a screen reader or axe); every iframe has a `title`; each challenge page exposes exactly one `main` landmark and a Lighthouse/axe pass no longer reports the missing-landmark or unnamed-frame issues.
