# Challenge Data to D1, Target Images to R2 (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Steps marked **(owner)** are Cloudflare-dashboard, Wrangler-login, or GitHub-settings actions that only Ryan can perform. Stop at each one and hand off.

**Goal:** After this phase the repo holds code only. Each challenge is a row in D1 (its text) plus an object in R2 (its Playwright screenshot), and target images are served from `https://assets.cssdaily.dev`. The daily generator stops committing to git. Players see **no change**.

**Architecture:**
- **Site (pages stay prerendered).** The Deploy workflow runs `npm run data:pull -- --require-d1` before `astro build`. That writes a snapshot of the D1 `challenges` table to the gitignored `.data/` directory, in **exactly today's per-challenge JSON shape**. `src/utils/challenges.ts` globs `.data/` instead of `src/data/`, and its exports don't change, so no page changes. Target `<img>` URLs move to `https://assets.cssdaily.dev/targets/{css|tailwind}/<file>`.
- **Generator.** Text generation, Playwright render and measure, and the screenshot pipeline are unchanged. Only the *save* step changes:
  1. upload the WebP to R2 under a content-hashed name, never overwriting;
  2. insert the challenge row into D1. This is the publish step, so a row never references an image that wasn't uploaded.
  3. **trigger the Deploy workflow** instead of committing and building.
- **Deploy is the only builder.** It runs one production run at a time against `main`'s latest commit. After `wrangler deploy` it also publishes the **public snapshot** (`https://assets.cssdaily.dev/data/challenges.json`) from the exact `.data/` it just built.
- **Local development without credentials.** `data:pull` reads D1 when a D1 token is set. Otherwise it downloads the public snapshot, so contributors still get a working `npm run dev` with no Cloudflare access. The snapshot exposes nothing new: every challenge's target code is already embedded in its prerendered page.
- **Backups** go to a separate **private** bucket with its own credentials. They cover both the D1 export and the target images.

**Tech Stack:** Astro 5 (static), Wrangler 4, Cloudflare D1 (REST API from Node scripts; `wrangler d1` for migrations and exports), Cloudflare R2 (S3-compatible API via `aws4fetch`), GitHub Actions, tsx, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-cloudflare-accounts-and-feedback-design.md`, Phase 2.

**Review:** Revised 2026-11-11 after a Codex review. It returned 3 blockers (import verification and image overwrite, deploy-queue replacement, backups in the public bucket) and 8 should-fix findings, and all of them are addressed below.

## Deviations from the spec (decided while planning, 2026-11-11)

1. **Build reads a pulled snapshot, not an Astro content-layer loader.** `data:pull` writes the same JSON files the site globs today, so `challenges.ts`'s exports and every page stay untouched. It also avoids the content layer's persistent data store (`.astro/data-store.json`), which can serve stale entries between builds.
2. **Deploy is the only builder; the generator dispatches it.** Once data lives in D1, the Phase 1 rule "deploy only the commit at `main`'s tip" no longer guarantees the newest *data* ships: a push run that pulled D1 before the generator inserted a day could deploy after it and drop that day. The rules:
   - **One production lock.** Production runs share a **workflow-level** concurrency group, `deploy-production`, so pull → build → deploy never overlaps. Non-`main` runs get a unique group (`deploy-${{ github.run_id }}`), so they can never replace a queued production run.
   - **Build `main`'s current tip, not the commit that triggered the run.** Production builds `actions/checkout` with `ref: main` *inside* the lock. A queued production run only gets replaced by a newer one, and that newer one also builds the current tip with fresher data. A re-run of an old production run therefore still deploys current `main`.
   - **The tip check stays** in the deploy job, as a last guard against `main` moving during a build. If it skips, a newer push run is necessarily queued behind it.
   - **The generator triggers Deploy** with `gh workflow run deploy.yml --ref main`. `GITHUB_TOKEN` is allowed to trigger `workflow_dispatch` (confirmed in review), and the job needs `actions: write`.
3. **New `legacy` column.** It preserves `alreadyGenerated`'s rule that an unsuffixed pre-rollout day (100 CSS, 84 Tailwind) counts as complete for every difficulty. The filename was the only marker, and filenames disappear in D1.
4. **A public data snapshot**, so contributors without credentials can develop locally. Deploy publishes it, serialized by the lock, from the data it actually shipped.
5. **A private backup bucket** (`cssdaily-backups`, no custom domain) with separate credentials. Anything in `cssdaily-assets` is public through `assets.cssdaily.dev`, and Phase 3 adds account data to the same database.

## Global Constraints

- **No player-visible change.** Same pages, URLs and challenge content; only the image host changes. `npm run smoke` passes before and after each PR.
- **Targets are always Playwright screenshots** of the model's text output. Nothing in this plan generates images any other way.
- **Never publish a row without its image.** Upload to R2 first, then insert into D1. Any failed or unconfirmed upload throws before the insert.
- **Never overwrite an existing image.** Every image upload is a create-if-absent (`If-None-Match: *`). If the key already exists, its ETag must equal the MD5 of the local bytes, which makes the upload a no-op. Different content **aborts**.
- **Never overwrite a D1 row.** Every insert is `INSERT ... ON CONFLICT DO NOTHING`.
- **Empty environment values count as unset.** All env reads go through one `readEnv(name)` helper that trims and treats `''` as undefined. A copied `.env.example`, with blank values, must behave exactly like no `.env`.
- **Least-privilege credentials, each only in the jobs that need it:**

  | Secret / variable | Grants | Used by |
  |---|---|---|
  | `CLOUDFLARE_API_TOKEN` (existing) | Workers deploy | Deploy job |
  | `D1_READ_TOKEN` (new) | Account → D1: Read | Deploy build job (`data:pull`) |
  | `D1_WRITE_TOKEN` (new) | Account → D1: Edit | Generator job; backup job (export needs write) |
  | `R2_ASSETS_ACCESS_KEY_ID` / `R2_ASSETS_SECRET_ACCESS_KEY` (new) | Object Read & Write on **`cssdaily-assets` only** | Generator job (targets); Deploy job (snapshot) |
  | `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY` (new) | Object Read & Write on **`cssdaily-backups` only** | Backup job only |
  | `D1_DATABASE_ID` (new **variable**) | — | All of the above |

  Model API keys stay in the generator job only.
- **Never interpolate `${{ ... }}` into a `run:` line.** Use `env:`.
- **Unit tests never touch the network or production data.** D1 and R2 are tested with a stubbed `fetch`. Tests use small committed fixtures, so they keep working after PR E deletes the repo data. Exhaustive migration checks are an **import acceptance step** (Task 5), not unit tests.
- **No absolute machine paths** in committed files; run `grep -rn "/Users/"` before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0001_challenges.sql` | `challenges` table |
| `scripts/cloudflare/env.ts` | `readEnv`: trims values, treats blank as unset |
| `scripts/cloudflare/d1.ts` | `d1Query` over the D1 REST API, with retries |
| `scripts/cloudflare/r2.ts` | `r2Client(bucket)` → `putIfAbsent`, `head`, `get`, `put` |
| `scripts/challenge-rows.ts` | Pure mapping between JSON and row; hashed image name |
| `scripts/__fixtures__/challenges/` | Representative committed challenge files used by the unit tests |
| `scripts/data-pull.ts` | D1 or public snapshot → `.data/challenges/{css,tailwind}/`; `--layout repo` for rollback |
| `scripts/publish-snapshot.ts` | `.data/` → R2 `data/challenges.json` (run by Deploy) |
| `scripts/import-challenges.ts` | Frozen, idempotent import of the repo into D1 and R2, with full verification |
| `scripts/backup.ts` | D1 export + image copy → private bucket, with a checksum manifest |
| `src/utils/assets.ts` | `targetImageUrl(mode, challenge)` |

---

### Task 0 (owner): Create Cloudflare resources and credentials

> **Read first — what you'll need locally.** The import (Task 5) runs on your machine and needs `.env` values for `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_WRITE_TOKEN`, `R2_ASSETS_ACCESS_KEY_ID` and `R2_ASSETS_SECRET_ACCESS_KEY`.
> - Create **separate local credentials** for the last three, as Step 7 below. Don't reuse the CI ones: then nothing has to be copied out of GitHub, and either set can be revoked on its own.
> - Tokens and R2 secret keys are **shown only once**. Paste each one into its destination (GitHub or `.env`) as soon as you create it.
> - Use **Account API tokens**, not User tokens, so automation doesn't depend on a personal login.

- [ ] **Step 1: D1 database.** `npx wrangler d1 create cssdaily` (Wrangler login on your machine). Location hint **ENAM** if asked. Copy the `database_id`.
- [ ] **Step 2: Assets bucket.** R2 → *Create bucket* `cssdaily-assets` (automatic location, Standard).
  - Settings → **Custom Domains → Connect `assets.cssdaily.dev`**.
  - Leave the **r2.dev URL disabled**.
- [ ] **Step 3: Backup bucket.** *Create bucket* `cssdaily-backups`. Give it **no custom domain** and leave r2.dev **disabled**, so it's private.
- [ ] **Step 4: R2 API tokens.** R2 → *Manage API tokens*, twice:
  - **Object Read & Write**, specific bucket **`cssdaily-assets`**. Save its key pair.
  - **Object Read & Write**, specific bucket **`cssdaily-backups`**. Save its key pair.
- [ ] **Step 5: D1 tokens.** My Profile → API Tokens → *Create Custom Token*, twice:
  - `cssdaily D1 read`: **D1 → Read**, your account.
  - `cssdaily D1 write`: **D1 → Edit**, your account.
- [ ] **Step 6: GitHub.**
  - Secrets: `D1_READ_TOKEN`, `D1_WRITE_TOKEN`, `R2_ASSETS_ACCESS_KEY_ID`, `R2_ASSETS_SECRET_ACCESS_KEY`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`. Set each with `gh secret set <name>`, which prompts for the value.
  - Variable: `gh variable set D1_DATABASE_ID --body <id>`.
- [ ] **Step 7: Local credentials → `.env`.**
  - Create a **local** D1 Edit account token and a **local** `cssdaily-assets` Object Read & Write R2 key, separate from the CI ones.
  - Add them to `.env` as `D1_WRITE_TOKEN`, `R2_ASSETS_ACCESS_KEY_ID` and `R2_ASSETS_SECRET_ACCESS_KEY`, along with `CLOUDFLARE_ACCOUNT_ID` (from any dashboard URL) and `D1_DATABASE_ID` (from `npx wrangler d1 list`).
  - Revoke the local pair once Phase 2 is done.
- [ ] **Step 8: Note the Workers plan** (Free or Paid). D1 Time Travel keeps **7 days** of point-in-time restore on Free and **30 days** on Paid. Task 10's retention is set from this.

---

### Task 1: D1 schema + binding

**Files:** Create `migrations/0001_challenges.sql`; Modify `wrangler.jsonc`.

- [ ] **Step 1: Migration**

```sql
-- One row per published challenge. The challenge text lives here; its
-- target screenshot lives in R2 at targets/<mode>/<target_image>.
CREATE TABLE challenges (
  mode         TEXT    NOT NULL CHECK (mode IN ('css', 'tailwind')),
  date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  difficulty   TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  title        TEXT    NOT NULL,
  time_limit   INTEGER NOT NULL,
  target_image TEXT    NOT NULL,
  body         TEXT    NOT NULL,            -- JSON {"starter":…,"target":…}, as in the original files
  legacy       INTEGER NOT NULL DEFAULT 0,  -- 1 = pre-multi-difficulty day (unsuffixed file)
  generation   TEXT,                        -- JSON metadata (provider/model; exemplars in Phase 6)
  created_at   INTEGER NOT NULL,            -- ms since epoch at insert
  PRIMARY KEY (mode, date, difficulty)
);
```

The primary key already covers `(mode, date)` lookups, so no extra index is needed.

- [ ] **Step 2: `wrangler.jsonc`.** Add `d1_databases` with binding `DB`, `database_name: "cssdaily"`, the real `database_id`, and `migrations_dir: "migrations"`. Verified 2026-11-11: a Worker with no script accepts the binding.
- [ ] **Step 3 (owner):**
  - `npx wrangler d1 migrations apply cssdaily --remote`
  - Confirm with `npx wrangler d1 execute cssdaily --remote --command "SELECT name FROM sqlite_master WHERE type='table'"`. It should list `challenges`.
- [ ] **Step 4: Commit** — `Add D1 challenges schema`

---

### Task 2: Cloudflare clients

**Files:**
- Create: `scripts/cloudflare/{env,d1,r2}.ts` + tests
- Modify: `package.json` + `package-lock.json` (`aws4fetch`), `.env.example`

**Interfaces:**
- `readEnv(name): string | undefined`. It trims, and returns undefined for blank values. `requireEnv(name)` throws with the variable's name.
- `d1Query<T>(sql, params?, { token?, fetch? }): Promise<T[]>`
  - Sends `POST https://api.cloudflare.com/client/v4/accounts/{CLOUDFLARE_ACCOUNT_ID}/d1/database/{D1_DATABASE_ID}/query` with `{ sql, params }`, and returns `result[0].results` (endpoint and shape confirmed in review).
  - **Token choice:** an explicit `token` wins; otherwise `readEnv('D1_WRITE_TOKEN') ?? readEnv('D1_READ_TOKEN')`. Because blanks read as unset, an empty write token can't hide a real read token.
  - **Errors:** throws on non-2xx HTTP *and* on body `success: false`, with the API's error text.
  - **Retries:** 429 and 5xx up to 3 times with backoff. Then it throws.
- `r2Client(bucket: 'cssdaily-assets' | 'cssdaily-backups')`
  - Credentials by bucket: `R2_ASSETS_*` or `R2_BACKUP_*`.
  - Uses `aws4fetch` `AwsClient` with `service: 's3'` and `region: 'auto'`, against `https://{CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/{bucket}/{key}`.
  - Every request passes an **explicit `method`**, because `aws4fetch` defaults to POST when there's a body. It checks `response.ok`, and retries 429 and 5xx up to 3 times. Network errors propagate.
  - `putIfAbsent(key, bytes, { contentType, cacheControl })` → `'created' | 'identical'`:
    - Sends `PUT` with `If-None-Match: *`. 2xx means `'created'`.
    - **412** means the key exists. It then calls `head`; if the ETag (the MD5 of a single-part upload) equals the MD5 of `bytes`, it returns `'identical'`, otherwise it **throws "refusing to overwrite"**.
    - *Verify while implementing:* R2's support for conditional `PutObject` with `If-None-Match: *`, and the ETag format.
  - `put(key, bytes, opts)`: unconditional. **Only** for the mutable snapshot key and backup objects.
  - `head(key)` → `{ size, etag } | null`. Only a 404 means absent; any other failure throws.
  - `get(key)` → `Uint8Array`.
- [ ] **Step 1:** `npm install aws4fetch`.
- [ ] **Step 2: Tests first** (stubbed fetch):
  - `readEnv` handles blank and whitespace values.
  - `d1Query`: URL, auth and body are correct; it throws on HTTP 4xx, on `success:false`, and after exhausted 5xx retries; a blank write token falls back to the read token.
  - R2: the explicit PUT method and headers are sent; `putIfAbsent` returns created, identical, and throws on mismatch; `head` returns null only on 404 and throws on 403 and 500; a failed PUT (403, exhausted 5xx, network rejection) throws.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Add `.env.example` names with blank values and a comment each. The blank values are safe because of `readEnv`.
- [ ] **Step 5: Commit** — `Add D1 and R2 clients for scripts`

---

### Task 3: Row mapping + hashed image names (pure)

**Files:** Create `scripts/challenge-rows.ts` + test, and `scripts/__fixtures__/challenges/{css,tailwind}/`.

**Interfaces:**
- `toRow(mode, json, { legacy, createdAt, generation? })` and `fromRow(row)`. `fromRow` returns exactly the original file's shape: `{ title, difficulty, target, starter, date, timeLimit, targetImage }`.
- `hashedImageName(date, difficulty, webp)` → `${date}-${difficulty}-${sha256hex.slice(0,12)}.webp`
- `isLegacyFileName(file)`
- [ ] **Step 1: Fixtures.** Copy six real files: one legacy and one suffixed per mode, plus the largest CSS file and the largest Tailwind file.
- [ ] **Step 2: Tests:**
  - every fixture round-trips with `toEqual`;
  - `hashedImageName` is deterministic and correctly formatted;
  - `isLegacyFileName` handles both forms.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Commit** — `Add challenge row mapping`

---

### Task 4: `data:pull` + snapshot publish

**Files:**
- Create: `scripts/data-pull.ts` + test, `scripts/publish-snapshot.ts` + test
- Modify: `package.json` (`data:pull`), `.gitignore` (`.data/`)

**`data:pull [--require-d1] [--layout data|repo] [--with-images] [--out <dir>]`**
- **Source:** if a D1 token is set, read D1. Otherwise, unless `--require-d1` is given, read `${readEnv('PUBLIC_ASSET_BASE') ?? 'https://assets.cssdaily.dev'}/data/challenges.json`. `--require-d1` without a token fails.
- **D1 paging is keyset, not OFFSET:** `WHERE (mode, date, difficulty) > (?, ?, ?) ORDER BY mode, date, difficulty LIMIT 200`. A concurrent insert can't skip or duplicate existing rows. Afterwards, check that the keys are unique and both modes are non-empty.
- **`--layout data`** (default): writes `.data/challenges/<mode>/<date>-<difficulty>.json`, 2-space indent. It clears each mode directory first.
- **`--layout repo`** (rollback only; requires `--require-d1`): writes `src/data/challenges/` and `src/data/tailwind-challenges/` under the original names (`<date>.json` when `legacy = 1`).
  - `--with-images` also downloads every `target_image` into `public/targets/` (and `public/targets/tailwind/`).
  - Each download is checked against the R2 ETag (MD5) and fails loudly on mismatch.
- The pulled data also records `legacy` per challenge, in a `.data/challenges/manifest.json` that maps each key to `{ legacy, targetImage }`. That keeps the public snapshot and the per-file JSON shape unchanged.

**`publish-snapshot`** (run by Deploy after `wrangler deploy`): reads `.data/challenges/`, then calls `put('data/challenges.json', …)` on the assets bucket with `Cache-Control: public, max-age=300`.
- Format: `{ generatedAt, sourceSha, css: ChallengeJson[], tailwind: ChallengeJson[], legacy: string[] }`, where `legacy` lists the `mode:date` keys of legacy days.
- Before uploading, it refuses to publish if either mode is empty.
- Only Deploy publishes it, serialized by the production lock, so the snapshot always matches the deployed site.
- [ ] **Step 1: Tests:**
  - File paths and contents for both layouts, from fixed rows.
  - Legacy naming in repo layout.
  - Source selection (token / no token / `--require-d1` with no token → error / blank token = no token).
  - Keyset cursor progression across pages.
  - The snapshot round-trips back through `data:pull`'s snapshot reader into identical files.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `Add data:pull and snapshot publishing`

---

### Task 5: Import (repo → D1 + R2), frozen and fully verified

**Files:** Create `scripts/import-challenges.ts`; Modify `package.json` (`data:import`), `.gitignore` (`import-report*.json`).

**Behavior.** It's idempotent; `--dry-run` writes nothing.
1. **Source.** Record `git rev-parse HEAD` and refuse to run if the working tree under `src/data/` or `public/targets/` has uncommitted changes. The report always names exactly which tree was imported.
2. **Images.** For every challenge JSON in both modes, `putIfAbsent('targets/<mode>/<targetImage>', bytes, { image/webp, public, max-age=31536000, immutable })`.
   - Legacy and existing names are kept as they are.
   - Up to 8 at a time.
   - Any "refusing to overwrite" aborts the import.
3. **Rows.** Multi-row `INSERT ... ON CONFLICT DO NOTHING`, at most 10 rows per statement (10 columns × 10 rows = the 100-parameter limit). `legacy` comes from the file name, `created_at` is the import time, and `generation` is `NULL`.
4. **Exhaustive verification**, not a sample:
   - Pull **every** row (keyset).
   - For **every** source file: the row exists; `fromRow(row)` deep-equals the file; `legacy` matches the file name; `target_image` equals the file's `targetImage`.
   - **No extra rows** exist that lack a source file.
   - For **every** image: `head` size equals the local size, and the ETag equals the local MD5.
5. **Report.** Write `import-report-<sha7>.json` with the source SHA, counts per mode, and every failure. Exit 1 if there's any failure.
6. The first public snapshot is published by the first Deploy run after PR D. Until then `data:pull` without a token has nothing to read, which matters only to contributors and only for that window.

- [ ] **Step 1: Implement**, then run `--dry-run` locally.
- [ ] **Step 2: Commit** — `Add verified challenge import`

**→ PR C** = Tasks 1–5. No change to the site, the generator, or the workflows.

- [ ] **Step 3 (owner, after PR C merges): First import.**
  - From a fresh checkout of `origin/main`: `npm run data:import`. The report must show zero failures.
  - Spot-check that `https://assets.cssdaily.dev/targets/css/<latest>.webp` loads.
  - The generator keeps committing to the repo until PR D. Task 8 Step 6 re-imports from a frozen tree right before the switch.

---

### Task 6: Site reads `.data/` + assets domain

**Files:**
- Modify: `src/utils/challenges.ts`, `ChallengePlayer.tsx:192`, `TailwindPlayer.tsx:193`, `Layout.astro`, `scripts/smoke-hosting.ts`
- Create: `src/utils/assets.ts` + test

- [ ] **Step 1: `challenges.ts`.** Glob `'../../.data/challenges/css/*.json'` and `'../../.data/challenges/tailwind/*.json'`. If either mode ends up empty, throw: `No challenge data in .data/ — run "npm run data:pull" first`.
- [ ] **Step 2: `assets.ts`.**
  - `ASSET_BASE`: `import.meta.env.PUBLIC_ASSET_BASE`, trimmed. If it's blank, use `'https://assets.cssdaily.dev'`; a blank value must never produce relative image URLs.
  - `targetImageUrl(mode, challenge)`.
  - Tests: both modes, a legacy name, a hashed name, and a blank or whitespace env value.
- [ ] **Step 3:** The players use `targetImageUrl`. `Layout.astro` gets `<link rel="preconnect" href={ASSET_BASE} crossorigin>`. The redirect stubs stay bare.
- [ ] **Step 4: Smoke check.**
  - `pickSmokeTargets` reads `.data/challenges/css/`, so it needs `npm run data:pull` first.
  - The asset origin comes from the same `PUBLIC_ASSET_BASE` rule.
  - Check 8: `GET <asset>/targets/css/<image>` → 200, `image/webp`, and `cache-control` containing `immutable`. Add the same check for a **Tailwind** image and for a **legacy** image name. Hashed names get covered after the first post-switch generation (Task 8 Step 7).
  - Browser checks:
    - Listen for `requestfailed`, which catches DNS, TLS and connection failures, on both the site origin and the asset origin, as well as status ≥ 400.
    - On B1, B2 and B6, assert that the visible target image **decoded**: `img.complete && img.naturalWidth > 0` on the visible `img[src^="<asset>/targets/"]`.
- [ ] **Step 5: Build comparison.**
  - Build `main` → `dist-before/`, then build this branch from a `data:pull` of the same data.
  - Compare **only the HTML files** after normalizing:
    - strip hashes from `/_astro/<name>.<hash>.<ext>`;
    - rewrite `https://assets.cssdaily.dev/targets/css/` to `/targets/`, and `…/tailwind/` to `/targets/tailwind/`;
    - drop the preconnect line.
  - Expect **zero** differences. Bundled JS changes are expected and aren't compared.
  - Delete `dist-before/` afterwards.
- [ ] **Step 6:** `npm run worker:dev`, then `npm run smoke -- http://localhost:8787 --expect-origin=worker`.
- [ ] **Step 7: Commit** — `Build from D1 snapshot; serve targets from assets.cssdaily.dev`

---

### Task 7: Generator publishes to R2 + D1

**Files:**
- Modify: `scripts/generate-common.ts` (+ test), `scripts/generate-challenge.ts`, `scripts/generate-tailwind-challenge.ts`
- Create: `scripts/publish-challenge.ts` + test

**Interfaces:**
- `isComplete(rowsForDate, difficulty)` (pure): true if a row exists for that difficulty, **or** if any row for the date has `legacy = 1`.
- `runDifficulties({ existing, … })`: the caller does one D1 query per date and mode. The behavior and failure rules don't change.
- `publishChallenge(mode, json, webp, generation, deps = { r2, d1 })`:
  1. `name = hashedImageName(...)`.
  2. `await r2.putIfAbsent('targets/<mode>/' + name, webp, immutable)`. `'identical'` is fine: a rerun after a failed insert.
  3. Insert the row (`ON CONFLICT DO NOTHING`).
  4. Return `{ inserted }`; `false` → `::warning::`.
- `collectRecentTitles` becomes a D1 query (latest 90 for the mode).
- The generator **doesn't** publish the snapshot; Deploy does.
- [ ] **Step 1: Tests.**
  - Port `generate-common.test.ts` from temp directories to row fixtures, keeping every existing case.
  - `publishChallenge`, with stubbed clients: the upload happens before the insert. For upload **403**, **exhausted 5xx**, **network rejection** and **refusing to overwrite**, D1 is **never called**. An `'identical'` result still inserts.
- [ ] **Step 2: Implement.**
  - Replace the two scripts' WebP and JSON writes with `publishChallenge`.
  - Record `generation = { provider, model }`.
  - The Playwright and retry code doesn't change.
- [ ] **Step 3: Verify without spending.** Run the CSS and Tailwind generators for a date that's fully present. Each must skip all three difficulties and make **no** model call.
- [ ] **Step 4: Commit** — `Generator publishes to R2 and D1 instead of the repo`

---

### Task 8: Workflows

**Files:** Modify `.github/workflows/deploy.yml`, `deploy-cloudflare.yml`, `generate-challenge.yml`.

- [ ] **Step 1: `deploy.yml`.**

```yaml
concurrency:
  # One production pipeline at a time; non-main runs never share (or
  # replace) the production queue entry.
  group: ${{ github.ref == 'refs/heads/main' && 'deploy-production' || format('deploy-{0}', github.run_id) }}
  cancel-in-progress: false
```

  - `build` job:
    - checkout with `ref: ${{ github.ref == 'refs/heads/main' && 'main' || github.sha }}`. This runs inside the lock, so production builds `main`'s **current** tip;
    - record the SHA;
    - pull with `npm run data:pull -- --require-d1`, env `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (from `vars`), `D1_READ_TOKEN`;
    - `npm test`, then build;
    - upload `dist` **and** `.data` as artifacts.
- [ ] **Step 2: `deploy-cloudflare.yml`.**
  - Remove its job-level concurrency; the workflow-level lock replaces it.
  - Keep the checkout of the built SHA and the tip check.
  - After `wrangler deploy`, download `.data` and run `npx tsx scripts/publish-snapshot.ts --source-sha <sha>`, with the `R2_ASSETS_*` secrets passed explicitly. A failure is a `::warning::`, not a failed deploy.
  - Add those two secrets to the `workflow_call` declaration.
- [ ] **Step 3: `generate-challenge.yml`.**
  - Remove *Commit and push*, *Build Astro site*, *Upload dist*, the job's `outputs`, and the `deploy` job.
  - Permissions: `contents: read`, `actions: write`.
  - Generation steps' env: `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_WRITE_TOKEN`, `R2_ASSETS_ACCESS_KEY_ID`, `R2_ASSETS_SECRET_ACCESS_KEY`.
  - Final step: if either mode succeeded, run `gh workflow run deploy.yml --ref main` with `GH_TOKEN: ${{ github.token }}`.
- [ ] **Step 4:** Parse all three files with `yaml` and review the diff by eye.
- [ ] **Step 5: Commit** — `Generator triggers Deploy; builds pull from D1`

**→ PR D** = Tasks 6–8. This is the switch.

- [ ] **Step 6 (owner): Frozen switch.** Do these in order:
  1. `gh workflow disable generate-challenge.yml`. Cancel or wait out any generate or Deploy run that's queued or running, until the Actions tab is idle.
  2. `git fetch origin` and note the SHA of `origin/main`. In a **fresh worktree at that SHA**, run `npm ci && npm run data:import`. The report must show **zero failures**, and its source SHA must equal the one you noted.
  3. Merge PR D and wait for its Deploy run.
  4. `npm run data:pull && npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www`. Also confirm that `https://assets.cssdaily.dev/data/challenges.json` now exists.
  5. `gh workflow enable generate-challenge.yml`.
- [ ] **Step 7 (owner): First generator run.** Let the scheduled run happen, or dispatch it by hand. Then confirm all of these:
  - no new commit;
  - a new D1 row whose `target_image` is a hashed name, and that image loads;
  - a Deploy run with event `workflow_dispatch`;
  - the new day is live on `cssdaily.dev`;
  - the smoke check passes.

---

### Task 9: Rollback (written before it's needed)

If PR D misbehaves before PR E:
1. `gh workflow disable generate-challenge.yml`, then drain or cancel every queued and running generate or Deploy run.
2. On a branch from current `main`, **in one commit**:
   - `git revert --no-commit <PR D merge>`;
   - `npm run data:pull -- --require-d1 --layout repo --with-images`, which restores all rows, including post-switch days, plus their images with checksums verified;
   - `npm test && npm run build`;
   - commit.
   Doing it as one commit means no deploy ever runs with the code reverted but the data missing.
3. Merge it, check that Deploy succeeds, run the smoke check, then re-enable the workflow.

- [ ] **Step 1:** `--layout repo` and `--with-images` are implemented and tested in Task 4.
- [ ] **Step 2: Rehearse after Task 8 Step 7**, so a hashed image and a post-switch day exist:
  - In a scratch worktree, run the restore into its `src/data/` and `public/targets/`.
  - Check that every file except the new day's matches the frozen import SHA's tree (`git diff --stat`), and that the new day has a JSON file and its image.
  - Discard the scratch worktree.

---

### Task 10: Cleanup + backups (PR E, about a week after PR D)

- [ ] **Step 1: Delete** `src/data/challenges/`, `src/data/tailwind-challenges/`, `public/targets/`, `scripts/generate-targets.ts`, `scripts/migrate-targets-to-webp.ts`, and the `migrate-targets` npm script.
  - Keep `src/data/tailwind-classes.json`.
  - Unit tests use only `scripts/__fixtures__/`, so `npm test` is unaffected. Confirm by running it after the deletion.
- [ ] **Step 2: Backups.** Add `scripts/backup.ts` and `.github/workflows/backup.yml` (weekly + `workflow_dispatch`). The job has only `D1_WRITE_TOKEN` (export needs D1 write, confirmed in review), the `R2_BACKUP_*` secrets, and the account and database IDs.
  - `npx wrangler d1 export cssdaily --remote --output d1.sql` with `CLOUDFLARE_API_TOKEN` set from `D1_WRITE_TOKEN`. Note that the export briefly locks the database. Schedule it for 03:00 UTC Sunday, well away from generation.
  - Upload to the **backup bucket** as `d1/<YYYY-MM-DD>.sql`.
  - **Images:** for every `target_image` in D1 that isn't yet in the backup bucket under `targets/<mode>/<name>`:
    - download it from the public asset URL;
    - verify the MD5 against the assets bucket's ETag;
    - copy it with `putIfAbsent`.
  - Write `manifests/<YYYY-MM-DD>.json`, listing every row key, image name and MD5.
  - Retention: keep the last 12 weekly SQL exports and delete older ones. Images are never deleted from the backup bucket.
  - Point-in-time restore depends on the plan (Task 0 Step 8): Time Travel covers 7 days on Free and 30 on Paid. Weekly exports cover anything older.
- [ ] **Step 3: Restore rehearsal.**
  - `npx wrangler d1 execute cssdaily-restore-test --local --file d1.sql`, using a local-only database.
  - Check the row counts against the manifest, and spot-check three images' MD5s from the backup bucket.
  - Write down the procedure in `docs/operations/restore.md`.
- [ ] **Step 4: Docs.**
  - README: the pipeline steps (WebP, not PNG; R2 + D1; the generator triggers Deploy).
  - Local dev: `npm install && npm run data:pull && npm run dev`, with no credentials needed.
  - Update CONTRIBUTING if it references the data directories.
- [ ] **Step 5: Commit** — `Remove repo challenge data; add private D1 + image backups`

## Done when

- The repo contains no challenge JSON or target images.
- The import report for the frozen SHA shows zero failures.
- A scheduled generator run has made no commit, and its day (hashed image) is live.
- `npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www` passes, with the target images decoded from `assets.cssdaily.dev`.
- A fresh clone with no `.env` (or a copied `.env.example`) runs `npm install && npm run data:pull && npm run dev`.
- A weekly backup (SQL + images + manifest) has landed in the **private** bucket, and a restore has been rehearsed.
