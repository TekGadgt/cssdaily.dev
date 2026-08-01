# Backfill dispatch + missing-date fallback — design

**Date:** 2026-08-01
**Status:** Approved (design); pending implementation plan

## Problem

Two related failures, both visible in the repo right now.

1. **No way to backfill a missed day.** `Generate Daily Challenge` has `workflow_dispatch`, but the date is computed unconditionally as `+1 day`, so a manual run can only ever produce tomorrow's challenge. When the cron fails, the gap is permanent. `src/data/challenges/` currently jumps from `2026-07-30` to `2026-08-02` — `2026-07-31` and `2026-08-01` are missing. Separately, `2026-07-30` has all three CSS difficulties but is missing the Tailwind **hard**, so partial-day failures are also real.

2. **A missing day puts the site in an infinite redirect loop.** `index.astro` computes today's date client-side and redirects to `/challenge/<today>/` without consulting what was built. If that page does not exist, GitHub Pages serves `404.astro`, which redirects to `/`, which redirects back. Neither page ever reads the set of available dates.

Failure 2 was identified and deliberately deferred in
`2026-06-23-image-optimization-and-redirect-tightening-design.md` (Out of scope, line 24):
*"A latent redirect-loop risk: if a user's local date is ahead of the latest built challenge, `/` → missing date → `404` → `/` can loop. Pre-existing."*
This design closes it.

### Inherited constraints

From that same prior design, and preserved here:

- **B1** — `index.astro`, `tailwind/index.astro`, and `404.astro` are deliberately bare redirect stubs: no `Layout`, no analytics beacon, and they use `window.location.replace` so the stub never enters history. The new shared redirect component must stay equally bare.
- **B3** — `trailingSlash: 'always'`. Every redirect target keeps its trailing slash, and the 404 path parser must tolerate one.

## Scope

In scope:
- An optional `date` input on `workflow_dispatch` for backfilling one day.
- Skip-if-already-present behavior in both generator scripts, so backfill is idempotent and repairs partial days.
- Resolve `/` and `404` against the dates that actually exist, replacing the loop.
- A test runner (`vitest`) and unit tests for the new date-resolution function.

Out of scope:
- Multi-date or date-range backfill. One date per run; a two-day gap is two runs.
- Any UI announcing that a fallback occurred. The redirect is silent — the page already displays its own date and prev/next nav already works.
- Backfilling the currently-missing days. That is an operational follow-up, not part of the change.

## Design

### Part A — Backfill via `workflow_dispatch`

**A1. Workflow input.** Add to `.github/workflows/generate-challenge.yml`:

```yaml
workflow_dispatch:
  inputs:
    date:
      description: 'Challenge date (YYYY-MM-DD). Leave blank for tomorrow.'
      required: false
      type: string
```

Scheduled runs leave `inputs.date` unset, which renders as an empty string, so the cron path is unchanged.

**A2. Date resolution and validation.** The existing "Compute challenge date" step becomes:

- If the input is empty → `date -u -d '+1 day' '+%Y-%m-%d'` (current behavior, untouched).
- Otherwise validate twice: `^[0-9]{4}-[0-9]{2}-[0-9]{2}$` for shape, then `date -u -d "$INPUT_DATE"` to reject calendar-invalid values such as `2026-02-31`. Fail the step with `::error::` on either.

**A3. No shell interpolation of untrusted input.** The input reaches the shell through `env:`, never via `${{ }}` spliced directly into a `run:` line — a raw `workflow_dispatch` string interpolated into a shell command is a script-injection vector. The two `npx tsx scripts/generate-*.ts` steps also move to reading the date from `env` rather than inline `${{ steps.date.outputs.value }}`, for consistency. This costs the same amount of YAML.

**A4. Skip existing challenges.** In the per-difficulty loop of both `scripts/generate-challenge.ts` and `scripts/generate-tailwind-challenge.ts`, before calling the API:

- Skip the difficulty when **both** `${date}-${difficulty}.json` (in the challenges dir) and `${date}-${difficulty}.webp` (in the targets dir) already exist.
- Requiring both, rather than the JSON alone, means a half-written pair from a crashed run is still repaired. The generators already write the image before the JSON, so this is a belt-and-braces check.
- Log the skip explicitly so the run's output shows what happened.

**A5. Skips are not failures.** A skipped difficulty counts as neither success nor failure in the existing `failures` accounting, so the "all difficulties failed" throw does not fire for a fully-present date. That run exits 0, stages nothing, and the existing `git diff --cached --quiet ||` guard makes the commit step a no-op.

Net effect: re-running `2026-07-30` generates only the missing Tailwind hard — one API call, not six — and re-running a complete date is free.

### Part B — Fallback instead of the redirect loop

**B1. The resolution rule.** One pure function in `src/utils/date.ts`:

```ts
/** Latest available date <= ceiling; if none, the earliest available. null when the list is empty. */
export function resolveAvailableDate(available: string[], ceiling: string): string | null
```

ISO `YYYY-MM-DD` sorts lexicographically, so this is a filter and a last-element read. The function sorts its input defensively rather than trusting callers. The happy path needs no special case: when today's challenge exists, today is itself `<= today` and is the maximum, so it wins.

**B2. Shared challenge loading.** New `src/utils/challenges.ts` owns the `import.meta.glob` calls for both challenge directories and exports the grouped-by-date maps plus sorted date lists. That glob-and-group block is currently copy-pasted between `challenge/[date].astro` and `tailwind/[date].astro`; both switch to importing it, so the two new fallback consumers do not add a third and fourth copy.

**B3. Shared redirect component.** New `src/components/ChallengeRedirect.astro` holds the redirect script once and takes `mode: 'challenge' | 'tailwind' | 'auto'`. It stays a bare stub per the inherited B1 constraint — no `Layout`, no analytics — and continues to use `window.location.replace`. Three consumers:

| Page | Mode | Ceiling |
|---|---|---|
| `index.astro` | `challenge` | today |
| `tailwind/index.astro` | `tailwind` | today |
| `404.astro` | `auto` — mode and date parsed from `location.pathname` | `min(requested, today)` |

The date lists are embedded at build time in a `<script type="application/json">` tag, and a normal (bundled, module) Astro `<script>` reads that tag and calls `resolveAvailableDate` imported from `date.ts`. A single-mode stub embeds only its own list; `mode: 'auto'` embeds both, since it does not know which mode was requested until it parses the path at runtime. ~250 dates is a couple of KB and gzips well; a separate manifest *fetch* would add a network round trip before the redirect could even start.

**Why not `define:vars`.** `define:vars` requires `is:inline`, and inline scripts cannot `import`. That would force the resolution logic to exist twice — typed and tested in `date.ts`, and again as literal script text in the component — with only one copy covered by tests, on precisely the logic this change exists to fix. The bundled script keeps a single tested implementation at the cost of one extra ~1KB same-origin request on the stub. That request is the accepted price; drift on the resolution rule is not.

**B4. The ceiling is always clamped to today.** This is what stops tomorrow's pre-generated challenge from leaking. `2026-08-02` exists on disk right now, so without the clamp a hand-typed future URL would spoil it.

**B5. `404.astro` path parsing.** Match `^/(challenge|tailwind)/(\d{4}-\d{2}-\d{2})/?$` against `location.pathname` (GitHub Pages preserves the requested URL when serving `404.html`). A match resolves within that mode; anything else redirects to `/`, which is now always safe because `/` itself always resolves to a real page.

**B6. No-JS handling.** `404.astro` loses its `<meta http-equiv="refresh" content="0; url=/">`, since resolution now requires JS. Its `<noscript>` link points at `/about/` — a real link rather than a refresh into nothing.

**B7. Navigation needs no change.** Prev/next in `ChallengePlayer.tsx` and `TailwindPlayer.tsx` already walks `allDates`, so it steps over gaps on its own.

### Case walk-through

With today = `2026-08-01` and the repo's current data:

| Entry point | Resolves to | Why |
|---|---|---|
| `/` | `/challenge/2026-07-30/` | latest `<= 2026-08-01` |
| `/challenge/2026-07-31/` (shared link to a missed day) | `/challenge/2026-07-30/` | 404 → nearest at-or-before |
| `/challenge/2027-01-01/` | `/challenge/2026-07-30/` | clamped to today, so `2026-08-02` stays hidden |
| `/challenge/2020-01-01/` | earliest available | nothing at or before it; never a dead end |
| `/some-garbage` | `/` | which now always resolves |
| empty challenges dir | `/about/` | the one terminal state |

### Part C — Test runner

Add `vitest` as a devDependency and a `"test": "vitest run"` script. `resolveAvailableDate` is pure TypeScript with no Astro or Vite imports, so it needs no `vitest.config` — default discovery of `src/**/*.test.ts` suffices.

`src/utils/date.test.ts` covers `resolveAvailableDate`:

- ceiling present in the list → returns the ceiling itself
- ceiling absent → returns the latest date before it
- ceiling before every available date → returns the earliest available
- empty list → `null`
- unsorted input → still correct (the defensive sort)
- single-element list, both when it is at-or-before the ceiling and when it is after

## Testing / acceptance

- **Unit:** `npm test` passes, covering every `resolveAvailableDate` case above.
- **Build:** `npm run build` succeeds and emits `404.html` plus both index stubs.
- **Loop is gone:** with `2026-08-01` absent, loading `/` lands on `/challenge/2026-07-30/` in a single hop — verify in the network panel that there is no `/` ↔ `/404` oscillation.
- **Deep link:** `/challenge/2026-07-31/` resolves to `2026-07-30` rather than looping.
- **No spoiler:** `/challenge/2027-01-01/` resolves to `2026-07-30`, not `2026-08-02`.
- **Happy path unregressed:** with today's challenge present, `/` still goes straight to today in one hop, and the stub still loads no `Layout` or analytics (inherited B1).
- **Trailing slashes:** every resolved target ends in `/`, producing no GitHub Pages 301 (inherited B3).
- **Backfill:** a `workflow_dispatch` run with `date=2026-07-31` generates that day and commits it; a second run for `2026-07-30` generates only the missing Tailwind hard; a run for a fully-present date makes no commit and exits 0.
- **Input validation:** `date=garbage` and `date=2026-02-31` both fail the compute step with a clear error before any API call.
