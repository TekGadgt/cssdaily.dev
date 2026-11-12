# Phase 3 — Worker Runtime, Cron Dispatch, Plays Counter, GitHub Sign-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Steps marked **(owner)** are dashboard, GitHub-settings or secret actions only Ryan can perform; stop and hand off at each.

**Goal:** The Worker gets code for the first time. All pages stay prerendered. On top of that:
- a Cloudflare Cron Trigger starts the daily generator, removing the dependency on GitHub's cron, which is disabled after 60 days without repo activity (**deadline about 2027-01-10**);
- an anonymous plays counter;
- optional sign-in with GitHub through Better Auth.

Players who never sign in see no change, apart from a "Sign in with GitHub" button.

**Spec:** `docs/superpowers/specs/2026-11-10-cloudflare-accounts-and-feedback-design.md`, Phase 3, including "Scheduling: a Cloudflare Cron Trigger dispatches generation".

**Two PRs:**
- **PR F:** the adapter and Worker entrypoint, the cron dispatch, the plays counter, and CI-applied D1 migrations. This covers the deadline-bound work first.
- **PR G:** Better Auth with GitHub sign-in, the AccountMenu, account deletion, and the about-page privacy section.

## Decision: keep prerendering every page

The site keeps `output: 'static'`. Every challenge page, the redirect stubs and `404.html` stay prerendered. Only `src/pages/api/**` routes run on the Worker (`export const prerender = false`). Reasons:

- **Cost and speed.** Requests for static assets never start the Worker: they're free, don't count toward the 100k requests/day, and come straight from Cloudflare's edge. Rendering on demand would make every page view a Worker invocation plus a D1 read.
- **The free plan allows 10 ms of CPU per request.** Rendering a challenge page on the server (React islands, CodeMirror markup, a 16 KB challenge body) would risk going over that on every view. Waiting on D1 doesn't count toward the limit, but rendering does. Prerendered pages use no CPU at all.
- **Scale isn't a concern.** About 520 files today, growing by 2 pages a day. Workers Static Assets allows 20,000 files per version on Free, which is decades of headroom. The build takes about 2.5 s.
- **What prerendering costs.** Every new day needs a rebuild and deploy, but that's already automated: the generator dispatches Deploy. Anything per-user (session, results, ratings) is fetched by islands from `/api/*` after the page loads, which is the design the spec already describes.
- **When to revisit:** if a feature needs per-user content in the first paint, if build time stops being trivial, or if future-dated challenges ever need gating on the server. None of those apply to Phases 3–6.

## Global Constraints

- **The redirect and 404 behavior must not change.** Unmatched paths must still serve `404.html` *at the requested URL* with status 404, because `ChallengeRedirect.astro` depends on it. `/challenge/<date>` must still redirect to `/challenge/<date>/`. Once the Worker has code, any request that doesn't match a static asset reaches the Worker, so this has to be verified again (Task F3), not assumed. The smoke check's HTTP checks 5–7 and browser checks B3–B5 are the gate.
- **Static requests must not start the Worker.** Keep the default asset-first routing (`run_worker_first` unset).
- **Don't hit the free plan's 10 ms CPU limit.** Every on-demand route gets measured with `wrangler tail`, which reports per-invocation CPU time, before merge. A route consistently over about 5 ms gets reworked, or escalated to a Workers Paid decision (owner).
- **D1 migrations only add, and they run before the code that uses them.** CI applies them in the Deploy workflow *before* `wrangler deploy`, so each migration must also work with the currently deployed code: new tables and columns only, nothing destructive.
- **Secrets live only where they're used.** Worker secrets (`wrangler secret put`) hold everything the Worker needs at runtime. GitHub secrets hold what CI needs. Nothing goes in the repo. For local `wrangler dev`, put them in a gitignored `.dev.vars`.
- **No personal data in the plays counter:** no IP address, user ID or user agent is stored.
- **No absolute machine paths in committed files**, and no `${{ }}` inside `run:`.

---

# PR F — Worker runtime, cron dispatch, plays counter

### F0 (owner): Credentials

> **Keep for local use:** nothing in PR F has to be kept locally. The one new secret goes straight into the Worker.

- [ ] **GitHub fine-grained token for the cron dispatch.** GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*:
  - Name: `cssdaily cron dispatch`.
  - Resource owner: your user. **Repository access: Only select repositories → `TekGadgt/cssdaily.dev`.**
  - Repository permissions: **Actions: Read and write**. Leave everything else at No access (Metadata: Read is added automatically).
  - Expiration: the longest offered. **Add a calendar reminder a week before it expires.**
  - The token is shown once, so set it straight away. This needs the Worker to exist, which it does: `npx wrangler secret put GITHUB_DISPATCH_TOKEN`, then paste the token.
- [ ] **Deploy token permission for D1 migrations.** The Deploy workflow will apply D1 migrations using the existing `D1_WRITE_TOKEN` secret, so no new GitHub secret is needed. Nothing to do; this is listed so it isn't a surprise.

### F1: Adapter + Worker entrypoint

**Files:**
- Modify: `package.json` (`@astrojs/cloudflare`, plus `@cloudflare/workers-types` as a dev dependency), `astro.config.mjs`, `wrangler.jsonc`, `tsconfig.json` (types)
- Create: `src/worker.ts`

- [ ] **Install** `@astrojs/cloudflare@^12` (Astro 5 line, which has `workerEntryPoint` since 12.6).
- [ ] **`astro.config.mjs`:** keep `output: 'static'` and add
  ```js
  adapter: cloudflare({
    workerEntryPoint: { path: 'src/worker.ts', namedExports: [] },
  }),
  ```
- [ ] **`src/worker.ts`:** `createExports(manifest)` returns `default: { fetch, scheduled }`, where `fetch` delegates to `handle(manifest, app, request, env, ctx)`, as in the adapter's documented example. `scheduled` is filled in by Task F4.
- [ ] **`wrangler.jsonc`:**
  - `"main": "./dist/_worker.js/index.js"` (verify the path the adapter actually emits);
  - `"assets": { "directory": "./dist", "binding": "ASSETS", "not_found_handling": "404-page", "html_handling": "auto-trailing-slash" }`;
  - `"compatibility_flags": ["nodejs_compat"]`, which PR G's auth needs;
  - `"observability": { "enabled": true }`, so cron failures and CPU times show up in Workers Logs.

  Keep the route, `workers_dev: false`, and the D1 binding.
- [ ] **Keep the Worker's own files out of the public assets.** Confirm the build writes `dist/.assetsignore` excluding `_worker.js` (and `_routes.json`). If it doesn't, add `public/.assetsignore` with those entries. Then check that `/_worker.js/index.js` returns 404 in production.
- [ ] **Verify** with the smoke check against `npm run build && npx wrangler dev`, especially:
  - checks 5–7 and B3–B5: the redirects, and 404 pages served at the requested URL;
  - that a request for a static file doesn't reach the Worker: `wrangler dev` logs Worker invocations, and fetching `/about/` should log none.

  If the adapter's fetch handler answers unmatched paths itself instead of falling through to the asset 404 page, make `src/worker.ts` hand any request without a matching route (`app.match(request)` is undefined) to `env.ASSETS.fetch(request)`. Then re-verify.
- [ ] **Commit** — `Add Cloudflare adapter and Worker entrypoint`

### F2: D1 migrations in CI

**Files:** Modify `.github/workflows/deploy-cloudflare.yml` (and `deploy.yml` to pass the secret through)

- [ ] Before *Deploy to Cloudflare Workers*, add a step **Apply D1 migrations**: `npx wrangler d1 migrations apply cssdaily --remote`, with env `CLOUDFLARE_API_TOKEN: ${{ secrets.D1_WRITE_TOKEN }}` and `CLOUDFLARE_ACCOUNT_ID`. Same `if:` tip-check guard as the deploy step. Add `D1_WRITE_TOKEN` to the reusable workflow's `secrets:`.
- [ ] The step is a no-op when nothing is pending. A failure blocks the deploy, which is correct: new code must not ship ahead of its schema.
- [ ] **Commit** — `Apply D1 migrations before each deploy`

### F3: Plays counter

**Files:**
- Create: `migrations/0002_plays.sql`, `src/pages/api/plays.ts`, `src/lib/plays.ts` + test
- Modify: `src/components/ChallengePlayer.tsx`, `src/components/TailwindPlayer.tsx`

- [ ] **Migration:**
  ```sql
  -- Anonymous submission counts. No user, IP, or agent data — by design.
  CREATE TABLE plays (
    mode       TEXT    NOT NULL CHECK (mode IN ('css', 'tailwind')),
    date       TEXT    NOT NULL,
    difficulty TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    day        TEXT    NOT NULL,           -- UTC day the submit happened
    count      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (mode, date, difficulty, day),
    FOREIGN KEY (mode, date, difficulty) REFERENCES challenges (mode, date, difficulty)
  );
  ```
- [ ] **`src/lib/plays.ts` (pure):** `parsePlay(body): { mode, date, difficulty } | null` validates the shape, and `upsertPlaySql()` returns `INSERT ... ON CONFLICT (mode, date, difficulty, day) DO UPDATE SET count = count + 1`. The foreign key rejects non-existent challenges, and that rejection is reported as a 204 (silently ignored), so a probe learns nothing.
- [ ] **`src/pages/api/plays.ts`** (`prerender = false`, POST only):
  - Rejects bodies over 512 bytes.
  - Gets D1 from `locals.runtime.env.DB`.
  - Always returns **204**. A failure is logged, never exposed. The client doesn't wait for or react to the response.
  - *Abuse:* the counter is informational and holds no personal data. A **Rate Limiting binding** keyed by `cf-connecting-ip`, used only as an in-memory limiter key and never stored, caps writes at 10 per minute per client. *Verify the binding is available on the Free plan.* If it isn't, ship without it and note the accepted risk.
- [ ] **Client:** in both players' submit handler, fire `navigator.sendBeacon('/api/plays', JSON.stringify({ mode, date, difficulty }))`, wrapped in try/catch, with no await. Fire it once per recorded submission, never during keep-tweaking practice.
- [ ] **Tests:** `parsePlay` (valid input, bad mode, bad date, extra fields, oversize body) and the SQL shape. Then, against local D1 (`wrangler d1 migrations apply cssdaily --local`, then `wrangler dev`), a manual curl: two submits for the same challenge → `count = 2`; a submit for a non-existent challenge → 204 and no row.
- [ ] **CPU:** watch `wrangler tail` during a submit and record the `cpuTime`.
- [ ] **Commit** — `Add anonymous plays counter`

### F4: Cron dispatch

**Files:**
- Create: `src/lib/dispatch.ts` + test
- Modify: `src/worker.ts`, `wrangler.jsonc`, `.github/workflows/generate-challenge.yml`, `.github/workflows/backup.yml`

- [ ] **`src/lib/dispatch.ts` (pure, with an injectable `fetch`):**
  - `CRON_WORKFLOWS = { '0 6 * * *': 'generate-challenge.yml', '0 3 * * 0': 'backup.yml' }`.
  - `dispatchWorkflow(file, token, fetchFn)` sends `POST https://api.github.com/repos/TekGadgt/cssdaily.dev/actions/workflows/${file}/dispatches` with body `{"ref":"main"}`. Headers: `Authorization: Bearer`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent: cssdaily-cron`.
  - Anything other than **204** throws, with the status and GitHub's message, never the token.
  - An unknown cron expression also throws.
- [ ] **`scheduled(controller, env, ctx)`** in `src/worker.ts`: `ctx.waitUntil(dispatchWorkflow(CRON_WORKFLOWS[controller.cron], env.GITHUB_DISPATCH_TOKEN))`.
- [ ] **`wrangler.jsonc`:** `"triggers": { "crons": ["0 6 * * *", "0 3 * * 0"] }`.
- [ ] **GitHub's crons become fallbacks:**
  - `generate-challenge.yml` → `'0 9 * * *'`, plus workflow-level `concurrency: { group: generate, cancel-in-progress: false }`.
  - `backup.yml` → `'0 5 * * 0'`.

  A fallback run after a successful primary run skips generation for free (every difficulty is already present) and harmlessly triggers one more Deploy. A second backup on the same day overwrites that day's export and manifest, also harmless.
- [ ] **Tests:**
  - The cron → workflow mapping, including that an unknown expression throws.
  - The request: exact URL, headers and body.
  - 204 resolves; 401, 404 and 422 throw with the status, without leaking the token.
- [ ] **Local check without triggering real generation:**
  - `npx wrangler dev --test-scheduled`, with a *throwaway* `GITHUB_DISPATCH_TOKEN` in `.dev.vars` (e.g. `invalid`).
  - `curl "http://localhost:8787/__scheduled?cron=0+6+*+*+*"`.
  - Expect the logged 401, which proves the request was made and that failures are loud.
- [ ] **Commit** — `Dispatch generation and backups from a Cloudflare Cron Trigger`

**→ PR F** = F1–F4.

- [ ] **(owner) After merge:**
  - Confirm Deploy applied `0002_plays.sql` and deployed.
  - Run `npm run data:pull && npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www`. It must pass all checks.
  - Confirm `https://cssdaily.dev/_worker.js/index.js` returns 404.
- [ ] **(owner) Acceptance on the next 06:00 UTC run:**
  - A Generate run with event `workflow_dispatch`, by the token's owner, at about 06:00.
  - Workers Logs shows the scheduled invocation, with no error logged.
  - The 09:00 fallback run skips everything.
  - The new day is live.

---

# PR G — GitHub sign-in (Better Auth)

### G0 (owner): Credentials

> **Keep for local use:** the **dev** OAuth app's Client ID and Client Secret, and a local `BETTER_AUTH_SECRET`. All three go into a gitignored `.dev.vars` for `wrangler dev`. The **production** values go straight into Worker secrets and never need keeping.

- [ ] **Two GitHub OAuth Apps.** GitHub → Settings → Developer settings → OAuth Apps → *New*:
  - **Production:** homepage `https://cssdaily.dev`, callback `https://cssdaily.dev/api/auth/callback/github`. Copy the Client ID, generate a Client Secret, then run:
    ```
    npx wrangler secret put GITHUB_CLIENT_ID
    npx wrangler secret put GITHUB_CLIENT_SECRET
    npx wrangler secret put BETTER_AUTH_SECRET
    ```
    For `BETTER_AUTH_SECRET`, paste the output of `openssl rand -base64 32`.
  - **Development:** homepage `http://localhost:8787`, callback `http://localhost:8787/api/auth/callback/github`. Its Client ID and Secret, plus a separate `openssl rand -base64 32`, go into `.dev.vars`.

  GitHub OAuth Apps allow one callback URL each, hence two apps.

### G1: Better Auth on D1

**Files:**
- Create: `src/lib/auth.ts`, `src/pages/api/auth/[...all].ts`, `migrations/0003_auth.sql`
- Modify: `package.json`, `.gitignore` (`.dev.vars`)

- [ ] **Install** `better-auth`, `kysely` and `kysely-d1`. Better Auth has no built-in D1 adapter, and Kysely is its native query layer, which avoids pulling in Drizzle. *Verify against current Better Auth docs* whether a first-party D1 path now exists; if it does, use it instead.
- [ ] **`src/lib/auth.ts`:** `createAuth(env)` is called **per request**, since bindings only exist inside a request. It sets:
  - `database: { dialect: new D1Dialect({ database: env.DB }), type: 'sqlite' }`;
  - `baseURL: env.BETTER_AUTH_URL` (`https://cssdaily.dev`, or `http://localhost:8787` in `.dev.vars`);
  - `secret: env.BETTER_AUTH_SECRET`;
  - `socialProviders: { github: { clientId, clientSecret } }`;
  - `user: { deleteUser: { enabled: true } }`;
  - `trustedOrigins: [env.BETTER_AUTH_URL]`;
  - `advanced: { useSecureCookies: true in production }`.

  Request only what's needed: GitHub's default scope plus `user:email`. Better Auth needs an email address, and GitHub may hide it on the profile.
- [ ] **`src/pages/api/auth/[...all].ts`** (`prerender = false`): `ALL = ({ request, locals }) => createAuth(locals.runtime.env).handler(request)`.
- [ ] **Migration `0003_auth.sql`:** generate it with the Better Auth CLI against this config (`npx @better-auth/cli generate`). Review it by hand: tables `user`, `session`, `account`, `verification`, with only additions, then commit it. Phase 4's `results` table will reference `user(id) ON DELETE CASCADE`.
- [ ] **Tests:**
  - `createAuth` builds without touching the network.
  - In local `wrangler dev`, with local D1 migrated and `.dev.vars` filled in: `GET /api/auth/get-session` returns `200 null` when signed out.
  - The full sign-in round trip through the **dev** OAuth app lands back on the original page signed in.
  - Sign-out clears the session.
  - Account deletion removes the `user`, `account` and `session` rows.
- [ ] **CPU:** `wrangler tail` during get-session, the OAuth callback and sign-out. Record each `cpuTime`. They must stay under the 10 ms free limit with headroom. The OAuth exchange is mostly network wait, which doesn't count.
- [ ] **Commit** — `Add Better Auth with GitHub sign-in on D1`

### G2: AccountMenu island

**Files:** Create `src/components/AccountMenu.tsx` + test; Modify `src/components/Header.astro`

- [ ] **Client:** use Better Auth's framework-agnostic client (`better-auth/client`), or plain `fetch` calls to its endpoints if that keeps the island meaningfully smaller. Measure both, and keep the island under about 10 KB gzipped.
- [ ] **States:**
  - **Loading:** a placeholder of the same size, so the header doesn't shift.
  - **Signed out:** "Sign in with GitHub". It starts the social sign-in with `callbackURL` set to the current path, so the player returns to the same challenge.
  - **Signed in:** the avatar, which opens a menu with *Sign out* and *Delete account*. Delete account asks for confirmation and states what gets deleted.
- [ ] **Placement:** `client:idle` in `Header.astro`. The header's static HTML renders exactly as it does today.
- [ ] **Accessibility:** the menu button has `aria-expanded`, Escape closes the menu, and focus returns to the button.
- [ ] **Tests:** rendering each state with a mocked session, and that the callback URL equals the current path.
- [ ] **Commit** — `Add account menu`

### G3: Privacy

- [ ] **About page, "Accounts & data":**
  - Signing in is optional. Stored from GitHub: your GitHub ID, display name, avatar URL and email (Better Auth requires an email).
  - Sign-in lets you keep results across devices (coming next).
  - Deleting your account removes all of this.
  - The anonymous play counter stores only per-challenge, per-day counts.
- [ ] **Commit** — `Document accounts and data`

**→ PR G** = G1–G3.

- [ ] **(owner) After merge:**
  - Sign in on production and confirm you return to the same challenge.
  - Sign out.
  - Optionally sign in again and delete the account.
  - Smoke check passes.
  - Check the `wrangler tail` CPU times in Workers Logs for the auth routes.

## Done when

- The generator runs at 06:00 UTC from the Cloudflare cron. GitHub's cron is only a fallback, so the 60-day inactivity rule no longer matters.
- Every page is still prerendered. Static requests don't start the Worker, and the smoke check, including the 404-in-place checks, passes in production.
- Plays are counted anonymously.
- Players can sign in with GitHub, sign out and delete their account. Every on-demand route stays under the free plan's CPU limit.
