# Cloudflare migration, user accounts, per-challenge feedback, and rated exemplars — design

**Date:** 2026-11-10
**Status:** Approved (design, 2026-11-10); pending implementation plans

## Goal

Linked changes, shipped as separate PRs in dependency order:

1. **Hosting:** move the site from GitHub Pages to Cloudflare, with no behavior change. This includes moving DNS to Cloudflare.
2. **Data and assets:** move challenge data into D1 and target images into R2, served from Cloudflare's CDN. After this the repo holds code only.
3. **Accounts:** optional sign-in. Signed-in players get their challenge results saved to the account and synced across devices.
4. **Feedback:** signed-in players can give a thumbs up or down on a challenge from the results modal. One vote per user per challenge, and they can change it.
5. **Generator exemplars:** the daily generator gets a rotating set of highly rated past challenges as quality examples.

Every phase has to leave the site working for anonymous players exactly as it does today. Accounts add features on top; nothing requires them.

## Decisions (owner, 2026-11-10)

- **DNS is not on Cloudflare yet.** The zone migration is part of Phase 1.
- **Auth:** prefer Cloudflare's own service if there is one. GitHub sign-in is a good fit because players don't have to create a new account. **No Google SSO.**
- **Signed-out modal:** show "Sign in to rate".
- **Ratings:** a player can rate only after the results modal has shown a real submitted result. Votes can be changed. Aggregates must stay correct when votes change, and repeated toggling must not let anyone push a score up or down.
- **Deploys** run from GitHub Actions. **Assets move out of the repo** to a proper Cloudflare CDN setup.
- **Traffic** is about 14 visits and 61 page views per 7 days (Cloudflare Web Analytics). There's no participation tracking today.
- **Registrar is Porkbun.** Nameservers currently point to DigitalOcean DNS, which points at GitHub Pages.
- **Challenge JSON moves into D1** too, alongside users. This ends the daily bot commits.
- **Auth library:** Better Auth is fine if it's free. It is: the library is MIT-licensed open source and runs inside our Worker. Its optional paid hosted add-ons aren't needed.
- **Exemplars:** use highly rated challenges and fall back to recent ones. No hand-curated pins, because the challenges are all fairly similar without feedback.
- **Targets are always Playwright screenshots** of the generated HTML/CSS rendered in Chromium. The model never generates images, and that stays the case.

## Current state (as of `0c44560`)

- The Astro 5 site is **fully static** (no adapter). 556 CSS challenge JSONs live in `src/data/challenges/`, with Tailwind ones beside them. Target WebPs are in `public/targets/` (~17 MB) and get committed daily by the generator.
- `.github/workflows/deploy.yml` runs test → build → `deploy-pages` on every push to `main`. `generate-challenge.yml` generates (06:00 UTC cron), commits to `main`, then builds and deploys again itself, because pushes made with `GITHUB_TOKEN` don't trigger other workflows.
- `src/pages/404.astro` + `ChallengeRedirect.astro` rely on the host serving `404.html` **at the requested URL**, so hand-typed or future dates get clamped and redirected.
- All player state lives in `localStorage` (`src/utils/storage.ts`). `migrateHistoryShape` is where everything read from storage gets validated.
- **Target WebPs are display-only.** `<img>` in the Target and Overlay tabs is the only place they're used. Both scoring components work from a **live render of the target**, not the WebP. `compareToTarget*` in `src/utils/diff.ts` renders the user's code and the target code in hidden iframes, then runs:
  - the pixel diff on the two snapdom captures, and
  - the structural / computed-size score on element rects measured from those same renders.

  Because of this, serving images from another origin can't cause canvas/CORS problems or affect scoring.
- Cloudflare Web Analytics is already loaded through the JS beacon in `src/layouts/Layout.astro`, which works without Cloudflare DNS.

---

## Phase 1 — DNS to Cloudflare, then GitHub Pages → Cloudflare Workers (static assets)

### 1a. Zone migration (no hosting change yet)

Today the registrar is **Porkbun**, the nameservers are **DigitalOcean DNS**, and the records point at **GitHub Pages**. Only the nameserver layer changes: DigitalOcean is replaced by Cloudflare, and Porkbun stays the registrar.

1. Export the full zone from DigitalOcean (Networking → Domains → `cssdaily.dev`). Note every record, not just the GitHub Pages A/AAAA/CNAME ones, including verification TXT records such as GitHub's Pages domain verification. There's no email on this domain, so there are no MX records to carry over.
2. Add `cssdaily.dev` to Cloudflare (Free plan). Compare Cloudflare's auto-imported records against the DigitalOcean export and fix any gaps. Set the GitHub Pages records to **DNS only (grey cloud)** for now, which keeps GitHub's own certificate in charge while only the nameservers change.
3. **DNSSEC:** check Porkbun's domain details. If DNSSEC/DS records are set there, remove them *before* switching. Turn DNSSEC back on afterwards with Cloudflare's DS record.
4. In Porkbun, replace the DigitalOcean nameservers (`ns1/2/3.digitalocean.com`) with the two that Cloudflare assigns. Wait for the zone to show **Active**. `.dev` is HSTS-preloaded, so it's HTTPS-only and a certificate gap is an outage. Keeping the records grey-clouded avoids that, because GitHub Pages' certificate keeps serving throughout.
5. Confirm the site still works, then delete the zone from DigitalOcean so there aren't two stale sources of truth.

This step is a pure DNS move with no hosting change, so problems with it are easy to tell apart from problems with step 1b. Step 1b then proxies those records and puts a Worker route in front of them.

### 1b. Hosting on Workers Static Assets

**Recommendation: Cloudflare Workers with Static Assets rather than Cloudflare Pages.** Cloudflare now steers new projects to Workers, and Phase 3 needs a Worker anyway.

- `wrangler.jsonc`:
  - `assets.directory: "./dist"`
  - `assets.not_found_handling: "404-page"`: serves `404.html` at the requested URL, which is the contract `ChallengeRedirect` depends on. The redirect logic stays as is.
  - `assets.html_handling: "auto-trailing-slash"` (the default).
- Delete `public/CNAME`. Serve `cssdaily.dev/*` through a **Worker route** on proxied records rather than a Worker custom domain (revised 2026-11-10 in the 1b plan). While GitHub Pages is still published, deleting the route falls straight back to GitHub, and nothing new is provisioned at cutover. Once GitHub is retired, the records become proxied `100::` placeholders.
- **Deploys stay in GitHub Actions.** The lockfile-pinned Wrangler runs directly (`npx wrangler deploy`) with secrets `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` passed as env. No third-party deploy action is used. In both workflows, `wrangler deploy` replaces `upload-pages-artifact`/`deploy-pages`. Drop `pages: write` / `id-token: write`.
- **Cutover:** deploy to `*.workers.dev` and smoke-test there: redirects from `/` and `/tailwind/`, a future-date URL (must clamp), a nonexistent path, the about page, and images. Then add the route, and only after that disable GitHub Pages. Full steps: `docs/superpowers/plans/2026-11-10-cloudflare-workers-hosting.md`.
- **Keep the exact origin `https://cssdaily.dev`.** `localStorage` is scoped per origin, so a `www` or subdomain switch would silently wipe every player's history and streak.

---

## Phase 2 — Challenge data to D1, target images to R2 + CDN

After this phase the repo holds code only. Each challenge is stored as a **D1 row** (its text) plus an **R2 object** (its screenshot).

### What doesn't change: how a challenge gets made

The generation pipeline stays the same:

1. The model returns **text only**: title, HTML, target CSS, starter CSS (or target/starter HTML for Tailwind).
2. Playwright renders that text in Chromium, measures it, and retries if it's oversize.
3. Playwright screenshots the accepted render, and the screenshot is encoded as a lossless WebP.

Only step 4, where the two outputs get **saved**, changes:

| | Today | After Phase 2 |
|---|---|---|
| 4a | write WebP to `public/targets/` | upload WebP to R2 |
| 4b | write challenge JSON to `src/data/` | insert challenge row into D1 |
| 4c | git commit + push | *(nothing to commit)* |

The challenge data already exists in memory before the screenshot, because it's what Playwright rendered. "Image before data" only describes the order in which the two outputs are saved. It's the same ordering `generate-challenge.ts` uses today ("screenshot BEFORE writing the JSON"): the D1 insert is the **publish** step, so a challenge row can never reference an image that failed to upload. An orphan image in R2 with no row is harmless.

### D1 `challenges` table

```sql
CREATE TABLE challenges (
  mode         TEXT NOT NULL CHECK (mode IN ('css','tailwind')),
  date         TEXT NOT NULL,
  difficulty   TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  title        TEXT NOT NULL,
  time_limit   INTEGER NOT NULL,
  target_image TEXT NOT NULL,   -- R2 key
  body         TEXT NOT NULL,   -- JSON: starter/target exactly as in today's files
  generation   TEXT,            -- JSON: provider, model, exemplars used (Phase 6)
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (mode, date, difficulty)
);
```

The challenge payload stays one JSON `body` column. That way the site's `Challenge`/`TailwindChallenge` shapes and `challenge-artifacts.ts` keep working as they do today, and the two modes' different shapes don't need separate schemas. Legacy unsuffixed days are imported with the `difficulty` from their own JSON, so `alreadyGenerated`'s "legacy day counts for every difficulty" rule becomes a plain row lookup.

The table lives in the **same D1 database** as users, results and ratings. The FK manifest in Phase 4 then becomes a real FK to `challenges`, and Phase 6 gets exemplar content and vote counts from a single join.

### Site build reads D1 (pages stay prerendered)

- An Astro content-layer collection with a custom loader (`src/content.config.ts`) replaces the `import.meta.glob` calls in `src/utils/challenges.ts`. `cssChallengesByDate` / `tailwindChallengesByDate` / `*Dates` keep the same exports, so the pages don't change.
- In CI, the loader queries D1 over the REST API (`CLOUDFLARE_API_TOKEN` with D1 read). Locally, `npm run data:pull` writes a gitignored snapshot (`.data/`) that the loader reads when no token is set. `npm run dev` then works offline and never touches production.
- **Why not render pages at request time from D1?** That would remove the daily rebuild, but it puts a database query and the Worker on every page view, and it's a bigger change than this migration needs. The generate workflow already ends in build + deploy, so prerendering costs nothing extra. It can be revisited later.

### R2 layout

- R2 bucket `cssdaily-assets` behind the custom domain **`assets.cssdaily.dev`**, which puts it behind Cloudflare's CDN cache.
- Keys: `targets/css/<name>.webp`, `targets/tailwind/<name>.webp`.
- New images get content-hashed names (`<date>-<difficulty>-<sha256[0..12]>.webp`) with `Cache-Control: public, max-age=31536000, immutable`. A regenerated target gets a new URL automatically. Legacy images keep their names and get the same header, since they never change.
- One helper, `targetImageUrl(mode, challenge)`, replaces the inline `targetSrc` builders at `ChallengePlayer.tsx:192` / `TailwindPlayer.tsx:193`. Its base comes from `PUBLIC_ASSET_BASE`. `Layout.astro` adds a `preconnect` to that host.
- CORS isn't needed because the images are display-only (see Current state).

### Generator changes

- Uploads go through R2's **S3-compatible API** (`@aws-sdk/client-s3`, keys scoped to the bucket). D1 inserts go through the REST API with `INSERT ... ON CONFLICT DO NOTHING`, so a rerun can never overwrite a published challenge.
- `alreadyGenerated`: a D1 row exists for the mode, date and difficulty. A legacy day stored as medium-only still counts as complete, as described above.
- `collectRecentTitles` becomes a D1 query.
- The workflow drops the commit step. It ends: generate → build (loader reads D1) → `wrangler deploy`.
- **Backups:** D1 Time Travel gives 30-day point-in-time restore. In addition, a weekly `wrangler d1 export` to R2, because challenge history is no longer in git.

### Migration order

1. Create the D1 database and bucket. Run the import script, which loads every JSON into `challenges` and every WebP into R2. Each step is idempotent, and the script verifies row and object counts against the files.
2. PR: the site reads from D1 and loads images from R2. Diffing the old `dist/` build against the new one should show only image URLs changing.
3. PR: the generator writes to D1/R2 and stops committing.
4. A follow-up PR deletes `src/data/challenges/`, `src/data/tailwind-challenges/` and `public/targets/` once production has run from D1/R2 for about a week. `src/data/tailwind-classes.json` is code config, not challenge data, and stays. Git history keeps the old files, which is fine at this size.

---

## Phase 3 — Server runtime + accounts

### Runtime

- Add `@astrojs/cloudflare`, keeping `output: 'static'`. All pages stay prerendered. Only `src/pages/api/**` uses `export const prerender = false`. Static asset requests don't run the Worker script.
- The database is **D1**, bound as `DB`, with migrations in `migrations/` (`wrangler d1 migrations apply`, run from CI before deploy).
- API calls stay on the same origin, so there's no CORS. Cookies are `HttpOnly; Secure; SameSite=Lax`.

### Auth — why Cloudflare's product isn't the answer, and what replaces it

Cloudflare doesn't offer a consumer identity product. **Cloudflare Access** (including the 2026 "Access for Workers" integration) is a Zero Trust product for internal apps:

- It's billed per seat: free up to 50 users, then about $7/user/month.
- It works as a gate on a whole app or path, not as optional sign-in on a public page.

That's the wrong shape for public, optional player accounts.

**Decision: run auth entirely on Cloudflare primitives (Workers + D1) with GitHub OAuth as the only provider, using Better Auth** (MIT-licensed and free; owner approved 2026-11-10). Data stays in our D1 database with no third-party identity SaaS, so it's as Cloudflare-native as possible without Access. Better Auth handles the OAuth state/PKCE checks, session rotation and account deletion, all of which are easy to get subtly wrong by hand. *Verify during the plan:* its current D1 integration path and how the instance is constructed per request on Workers.

A second provider (e.g. email one-time code) can come later. Google won't be added.

### UI

- `AccountMenu` React island in `Header.astro`. It renders signed-out on the static page, then hydrates from `GET /api/me`. Shows "Sign in with GitHub" or an avatar menu (sign out, delete account). `returnTo` sends the player back to the challenge they were on.

### Privacy

Store only what's needed: GitHub id, display name and avatar URL, plus email if the library requires it. Add an "Accounts & data" section to the about page. Account deletion cascades to results and ratings.

### Participation counter (anonymous, new)

There's currently no way to know how many people actually *play*. `POST /api/plays` is sent on submit by **every** player, signed in or not. It stores `(mode, date, difficulty, day_bucket)` counts and nothing else: no IP, no user id. It's cheap, it's private, and Phase 5 needs it to tell whether the rating volume can support the feature.

---

## Phase 4 — Results saved to accounts

### Schema

```sql
CREATE TABLE results (
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('css','tailwind')),
  date        TEXT NOT NULL,
  difficulty  TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  time_spent  INTEGER NOT NULL CHECK (time_spent >= 0),
  submission  TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('live','import')),
  PRIMARY KEY (user_id, mode, date, difficulty)
);
```

### Rules

- **Submission is final** (owner ruling, 2026-07-11). The server enforces it with `INSERT ... ON CONFLICT DO NOTHING`, so the first recorded result wins.
- Endpoints: `POST /api/results` (live), `POST /api/results/import` (batch from localStorage on sign-in), `GET /api/results?mode=` (also returns the player's own votes).
- **Validation:**
  - `(mode, date, difficulty)` must name a real challenge. This is enforced by an FK from `results` to `challenges` (Phase 2), so no separate manifest is needed.
  - Live submits must be for a date ≤ today + 1.
  - Submissions and batches have size caps.
- **Client:**
  - `storage.ts` stays the local cache and the only code path for anonymous players.
  - When signed in, submit writes locally first, then POSTs the result (and retries on next load if that fails).
  - On sign-in, local and server history are merged: server rows win, and local-only rows get imported.
  - The merged history goes back through `migrateHistoryShape`, so `computeStats` stays client-side and doesn't change.

### Trust model and dependency

- Scores are computed client-side and the server can't verify them. That's acceptable because there are no leaderboards, which stay out of scope.
- **Land the keep-tweaking spec's D1 (stale-score submit fix) first.** Once results are server-side and final, a wrongly recorded score is permanent across devices.

---

## Phase 5 — Thumbs up/down in the results modal

### Schema: votes are rows, aggregates are derived

```sql
CREATE TABLE ratings (
  user_id     TEXT NOT NULL,
  mode        TEXT NOT NULL,
  date        TEXT NOT NULL,
  difficulty  TEXT NOT NULL,
  value       INTEGER NOT NULL CHECK (value IN (-1, 1)),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, mode, date, difficulty),
  FOREIGN KEY (user_id, mode, date, difficulty)
    REFERENCES results(user_id, mode, date, difficulty) ON DELETE CASCADE
);
CREATE INDEX ratings_by_challenge ON ratings (mode, difficulty, date);
```

### Spam- and drift-proofing

Each piece below maps to one of the owner's requirements:

| Concern | Mechanism |
|---|---|
| Only rate after a real result | The FK to `results` means a vote can't exist without the player's own recorded submission. The endpoint returns 403 when there's no result row, and the client only shows the buttons after a submitted result is in the modal. |
| One vote per user per challenge | Primary key `(user_id, mode, date, difficulty)`. Writes are `INSERT ... ON CONFLICT DO UPDATE SET value = excluded.value`, so a toggle **replaces** the vote rather than adding one. |
| Toggling can't push a score up or down | **There are no counter columns.** Aggregates are always `SUM(value = 1)` / `SUM(value = -1)` over the rows, so whatever is toggled, a user contributes at most one vote. Any +1/−1 counter scheme drifts on races and retries; derived counts can't. At this scale the `GROUP BY` costs almost nothing. If it ever needs caching, a materialized table gets rebuilt from the rows, never incremented. |
| Request flooding | Workers **Rate Limiting binding** on `PUT /api/ratings/*`, keyed by user id (e.g. 20 writes/min). Writes that don't change anything (same value as stored) return 204 without writing. |
| Many accounts voting | Accepted risk at this scale. It needs multiple GitHub accounts that each played the challenge. If it ever matters, a minimum account age can be added. |

### API and UI

- `PUT /api/ratings/:mode/:date/:difficulty` with `{ value: 1 | -1 | null }`. `null` deletes the vote.
- `ResultsModal.tsx` (shared by both players) shows "How was this challenge?" with 👍/👎 as `aria-pressed` toggles. Updates are optimistic and revert if the request fails. It appears **only when the modal shows a submitted result**, and also when revisiting a finished challenge.
- **Signed out:** shows a "Sign in to rate this challenge" link instead.
- The wording makes clear the vote rates the *challenge*, not the player's score.

---

## Phase 6 — Highly rated exemplars in the generator prompt

### Candidate sources: rated first, recent as fallback

At ~14 visits/week, most challenges will get zero votes for a long time. So each run fills its `N = 2` exemplar slots in this order:

1. **Rated:** same mode and difficulty, at least `MIN_VOTES = 3` votes, Wilson lower bound (95%) ≥ 0.6, ranked by that bound. The Wilson lower bound is a confidence-adjusted approval score that heavily discounts small vote counts, so a 1/1 challenge never outranks a 9/10 one.
2. **Recent fallback:** fills any empty slots from the same mode and difficulty within the **last 30 days**, picked with a PRNG **seeded by target date + difficulty**. Reruns and backfills stay reproducible, and the picks rotate day to day.

Every challenge has a **net-negative rating veto**: anything with more 👎 than 👍 is never chosen by either path, so a challenge players disliked can't come back in through the fallback.

**Known risk of the fallback:** showing the model its own recent output reinforces whatever it already does, and the owner already notes challenges are "pretty same-same". Three mitigations:

- picking at random within the 30-day window, rather than always taking the newest two,
- the "do not reuse themes, layouts, or copy" instruction, with exemplar titles added to the avoid-list, and
- the eval record below, which shows whether exemplars help or just increase sameness.

If the eval shows sameness increasing, the fallback can be switched off (`EXEMPLAR_FALLBACK=off`) without touching the rated path.

### Query (one round trip, since challenges and ratings share a D1 database)

```sql
SELECT c.date, c.title, c.body,
       COALESCE(SUM(r.value = 1), 0)  AS up,
       COALESCE(SUM(r.value = -1), 0) AS down
FROM challenges c LEFT JOIN ratings r USING (mode, date, difficulty)
WHERE c.mode = ?1 AND c.difficulty = ?2 AND c.date < ?3
GROUP BY c.mode, c.date, c.difficulty;
```

The generator runs this through the D1 REST API (`scripts/exemplars.ts`, a plain `fetch` that tests can stub). It's the same token that Phase 2's generator already uses for D1. `selectExemplars(rows, targetDate, difficulty)` is pure: it runs the ranking, the fallback, the veto and the seeded pick. That covers all the selection logic, and it's unit-tested.

### Prompt, failure policy, eval

- Exemplars go in the **user** prompt after the avoid-list: "These are past {difficulty} challenges — match their polish, visual hierarchy, and difficulty calibration; do **not** reuse their themes, layouts, or copy." Each exemplar includes its HTML + target CSS, or target HTML for Tailwind. The system prompt doesn't change.
- **Best-effort:** if the exemplar query fails, the run generates exactly as it does today and logs a `::notice::`. Exemplars never cause a missing day.
- The `generation` column records `{ provider, model, exemplars: [{ id, source: "rated" | "recent" }] }`. Once there are enough votes, this allows comparing approval rates for no exemplars vs. recent vs. rated.
- Cost: about 3–6k extra input tokens per generation.

---

## PR sequence

| # | PR | Depends on |
|---|----|-----------|
| 1a | DNS: DigitalOcean → Cloudflare nameservers (Porkbun + dashboard, no code) | — |
| 1b | Workers Static Assets hosting + deploy workflows | 1a |
| 2a | D1 + R2 import script; site build reads D1, images from `assets.cssdaily.dev` | 1a, 1b |
| 2b | Generator writes D1/R2, stops committing (+ later PR deleting repo data) | 2a |
| 3 | Astro adapter + Better Auth (GitHub) + AccountMenu + plays counter | 2a |
| — | keep-tweaking D1 fix (existing spec) | — |
| 4 | Results sync | 3, keep-tweaking D1 |
| 5 | Ratings | 4 |
| 6 | Generator exemplars | 2b; rated path becomes meaningful after 5 |

Phase 6 can ship straight after 2b using only the recent fallback. Rated exemplars start appearing automatically once votes cross `MIN_VOTES`.

## Remaining open questions

None. Resolved 2026-11-10: there's no email on `cssdaily.dev` (no MX or forwarding records to carry over in 1a), and the 30-day fallback window stands.
