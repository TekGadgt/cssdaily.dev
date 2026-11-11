# Challenge Data to D1, Target Images to R2 (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Steps marked **(owner)** are Cloudflare-dashboard, Wrangler-login, or GitHub-settings actions that only Ryan can perform. Stop at each one and hand off.

**Goal:** After this phase the repo holds code only. Each challenge is a row in D1 (its text) plus an object in R2 (its Playwright screenshot), and target images are served from `https://assets.cssdaily.dev`. The daily generator stops committing to git. Players see **no change**.

**Architecture:**
- **Site (pages stay prerendered).** CI runs `npm run data:pull` before `astro build`. It writes a snapshot of the D1 `challenges` table to the gitignored `.data/` directory, in **exactly today's per-challenge JSON shape**. `src/utils/challenges.ts` globs `.data/` instead of `src/data/`, and its exports don't change, so no page changes. Target `<img>` URLs move to `https://assets.cssdaily.dev/targets/{css|tailwind}/<file>`.
- **Generator.** Text generation, Playwright render and measure, and the screenshot pipeline are unchanged. Only the *save* step changes:
  1. upload the WebP to R2 under a content-hashed name;
  2. insert the challenge row into D1. This is the publish step, so a row never references an image that wasn't uploaded.
  3. refresh the public data snapshot (best-effort);
  4. **trigger the normal Deploy workflow** instead of committing and building.
- **Local development without credentials.** `data:pull` reads D1 when a D1 token is present. Otherwise it downloads the **public snapshot** at `https://assets.cssdaily.dev/data/challenges.json`. Contributors cloning the repo still get a working `npm run dev` with no Cloudflare access. Nothing in the snapshot is new exposure: every challenge's target code is already embedded in its prerendered page.

**Tech Stack:** Astro 5 (static), Wrangler 4, Cloudflare D1 (REST API from Node scripts; `wrangler d1` for migrations and the bulk import), Cloudflare R2 (S3-compatible API via `aws4fetch`), GitHub Actions, tsx, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-cloudflare-accounts-and-feedback-design.md`, Phase 2.

## Deviations from the spec (decided while planning, 2026-11-11)

1. **Build reads a pulled snapshot, not an Astro content-layer loader.** `data:pull` writes the same JSON files the site globs today, so `challenges.ts`'s exports and every page stay untouched. It also avoids the content layer's persistent data store (`.astro/data-store.json`), which can serve stale entries between builds. The spec already proposed the `.data/` snapshot for local dev; this plan makes it the only path.
2. **The generator triggers Deploy instead of building and deploying itself.** Once data lives in D1, the Phase 1 rule "deploy only the commit at `main`'s tip" no longer guarantees the newest *data* ships:
   - A push run that pulled D1 *before* the generator inserted a new day could deploy *after* the generator's run and silently drop that day.
   - The fix is to make Deploy the only workflow that builds, with **workflow-level** concurrency. Runs are then serialized end to end (pull → build → deploy), so a later run always pulls fresher data than an earlier one.
   - The generator calls `gh workflow run deploy.yml --ref main`. A `workflow_dispatch` is allowed to trigger from `GITHUB_TOKEN`, unlike a push.
   - Phase 1 put the concurrency at job level only to avoid cancelling a pending *generate* run. The generator now sits outside the group, so that reason is gone.
3. **New `legacy` column.** It preserves `alreadyGenerated`'s rule that an unsuffixed pre-rollout day (100 CSS, 84 Tailwind) counts as complete for every difficulty. The filename was the only thing marking a day as legacy, and the filename disappears in D1.
4. **A public data snapshot** in R2, so contributors without credentials can still develop locally (see Architecture).

## Global Constraints

- **No player-visible change.** Same pages, same URLs, same challenge content; only the image host changes. The smoke check (`npm run smoke`) must pass before and after each PR.
- **Targets are always Playwright screenshots** of the model's text output. Nothing in this plan generates images any other way.
- **Never publish a row without its image.** The order is: upload to R2, then insert into D1. A failed upload throws before the insert. An orphan object in R2 is harmless.
- **D1 writes never overwrite.** Every insert is `INSERT ... ON CONFLICT DO NOTHING`, so reruns, the catch-up import and backfills can't clobber a published challenge.
- **Least-privilege credentials, each only in the jobs that need it:**

  | Secret / variable | Grants | Used by |
  |---|---|---|
  | `CLOUDFLARE_API_TOKEN` (existing) | Workers deploy | Deploy job |
  | `D1_READ_TOKEN` (new secret) | Account → D1: Read | Deploy's build job (`data:pull`) |
  | `D1_WRITE_TOKEN` (new secret) | Account → D1: Edit | Generator job |
  | `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` (new secrets) | R2 Object Read & Write, **this bucket only** | Generator job |
  | `D1_DATABASE_ID` (new **variable**, not a secret) | — | All of the above |

  Model API keys stay in the generator job only.
- **Never interpolate `${{ ... }}` into a `run:` line.** Use `env:`.
- **Scripts that hit paid APIs are never imported by tests.** Same rule as `generate-common.test.ts`: D1 and R2 clients are tested with a stubbed `fetch`.
- **No absolute machine paths** in committed files; run `grep -rn "/Users/"` before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `migrations/0001_challenges.sql` | `challenges` table |
| `scripts/cloudflare/d1.ts` | `d1Query(sql, params)` over the D1 REST API |
| `scripts/cloudflare/r2.ts` | `r2Put`, `r2Head` over the R2 S3 API (`aws4fetch`) |
| `scripts/challenge-rows.ts` | Pure mapping between challenge JSON and D1 row; hashed image key |
| `scripts/import-challenges.ts` | One-time, idempotent import of the repo data into D1 and R2, plus the first snapshot |
| `scripts/data-pull.ts` | D1 or public snapshot → `.data/challenges/{css,tailwind}/*.json` |
| `scripts/publish-snapshot.ts` | Writes `data/challenges.json` to R2 (shared by the import and the generator) |
| `src/utils/assets.ts` | `targetImageUrl(mode, challenge)` |
| `src/utils/challenges.ts` | Glob `.data/` instead of `src/data/` |

---

### Task 0 (owner): Create Cloudflare resources and credentials

- [ ] **Step 1: D1 database.** `npx wrangler d1 create cssdaily` (Wrangler login on your machine). Choose location hint **ENAM** (eastern North America) if asked. Copy the printed `database_id`.
- [ ] **Step 2: R2 bucket.** Dashboard → R2 → *Create bucket* `cssdaily-assets` (location: automatic, Standard storage).
  - Settings → **Custom Domains → Connect `assets.cssdaily.dev`**. The zone is already on Cloudflare, so the DNS record and certificate are created for you.
  - Leave the **r2.dev public URL disabled**, so the custom domain is the only public way in.
- [ ] **Step 3: R2 API token.** R2 → *Manage API tokens* → *Create API token*:
  - Permission: **Object Read & Write**.
  - Bucket: **Apply to specific buckets only → `cssdaily-assets`**.
  - Copy the **Access Key ID** and **Secret Access Key**. They're shown once.
- [ ] **Step 4: D1 tokens.** My Profile → API Tokens → *Create Custom Token*, twice:
  - `cssdaily D1 read`: Account → **D1 → Read**, your account only.
  - `cssdaily D1 write`: Account → **D1 → Edit**, your account only.

  D1 permissions are account-wide; the account holds only this database.
- [ ] **Step 5: GitHub.**
  - Secrets: `gh secret set D1_READ_TOKEN`, `gh secret set D1_WRITE_TOKEN`, `gh secret set R2_ACCESS_KEY_ID`, `gh secret set R2_SECRET_ACCESS_KEY`.
  - Variable: `gh variable set D1_DATABASE_ID --body <id>`.
- [ ] **Step 6: Local `.env`** (gitignored; Task 2 adds the names to `.env.example`). Add `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_WRITE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. The import (Task 5) runs from your machine.

---

### Task 1: D1 schema + binding

**Files:** Create `migrations/0001_challenges.sql`; Modify `wrangler.jsonc`.

- [ ] **Step 1: Migration**

```sql
-- One row per published challenge. The challenge text lives here; its
-- target screenshot lives in R2 under target_image.
CREATE TABLE challenges (
  mode         TEXT    NOT NULL CHECK (mode IN ('css', 'tailwind')),
  date         TEXT    NOT NULL CHECK (date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  difficulty   TEXT    NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  title        TEXT    NOT NULL,
  time_limit   INTEGER NOT NULL,
  target_image TEXT    NOT NULL,            -- file name under targets/<mode>/ in R2
  body         TEXT    NOT NULL,            -- JSON {"starter":…,"target":…}, as in the original files
  legacy       INTEGER NOT NULL DEFAULT 0,  -- 1 = pre-multi-difficulty day (unsuffixed file)
  generation   TEXT,                        -- JSON metadata (provider/model; exemplars in Phase 6)
  created_at   INTEGER NOT NULL,            -- ms since epoch, server clock at insert
  PRIMARY KEY (mode, date, difficulty)
);
CREATE INDEX challenges_by_mode_date ON challenges (mode, date);
```

- [ ] **Step 2: `wrangler.jsonc`.** Add the binding (verified 2026-11-11: a Worker with no script accepts it, and `--dry-run` lists `env.DB`):

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "cssdaily",
      "database_id": "<from Task 0>",
      "migrations_dir": "migrations"
    }
  ],
```

- [ ] **Step 3 (owner): Apply.**
  - `npx wrangler d1 migrations apply cssdaily --remote`
  - Then `npx wrangler d1 execute cssdaily --remote --command "SELECT name FROM sqlite_master WHERE type='table'"` should list `challenges` and `d1_migrations`.
- [ ] **Step 4: Commit** — `Add D1 challenges schema`

---

### Task 2: Cloudflare clients (D1 REST, R2 S3)

**Files:**
- Create: `scripts/cloudflare/d1.ts`, `scripts/cloudflare/r2.ts`, and a test for each
- Modify: `package.json` (`aws4fetch`)
- Modify: `.env.example` (names only)

**Interfaces:**
- `d1Query<T>(sql: string, params?: unknown[], opts?: { token?: string; fetch?: typeof fetch }): Promise<T[]>`
  - It sends `POST https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query` with body `{ sql, params }` and returns `result[0].results`.
  - On `success: false` it throws with the API's `errors` messages.
  - It reads `D1_WRITE_TOKEN ?? D1_READ_TOKEN` unless `opts.token` is given.
  - *Verify while implementing:* the response shape and the **100-bound-parameter limit per statement**. That limit sets how many rows fit in one multi-row INSERT: 10 columns → at most 10 rows per statement.
- `r2Put(key: string, body: Uint8Array | string, opts: { contentType: string; cacheControl: string }): Promise<void>`
- `r2Head(key: string): Promise<{ size: number } | null>`
  - Both use `aws4fetch`'s `AwsClient` against `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/cssdaily-assets/${key}`, with region `auto`.

- [ ] **Step 1:** `npm install aws4fetch` (a small, dependency-free SigV4 signer; Cloudflare's R2 docs use it).
- [ ] **Step 2: Tests first** (stubbed fetch):
  - `d1Query` sends the right URL, auth header and body, and returns the rows.
  - It throws on `success: false`, with the error text.
  - It throws a clear message when the account ID, database ID or token env var is missing.
  - `r2Put` sends the content-type and cache-control headers.
  - `r2Head` returns `null` on 404 and the size from `content-length` on 200.
- [ ] **Step 3: Implement** until the tests pass.
- [ ] **Step 4:** Add `.env.example` entries, names only with blank values and one comment each: `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `D1_READ_TOKEN`, `D1_WRITE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `PUBLIC_ASSET_BASE`.
- [ ] **Step 5: Commit** — `Add D1 and R2 clients for scripts`

---

### Task 3: Row mapping + hashed image names (pure)

**Files:** Create `scripts/challenge-rows.ts` + test.

**Interfaces:**
- `type Mode = 'css' | 'tailwind'`
- `toRow(mode, json, { legacy, createdAt, generation? }): ChallengeRow`. `body = JSON.stringify({ starter: json.starter, target: json.target })`.
- `fromRow(row): ChallengeJson`. Returns **exactly** the original file's shape: `{ title, difficulty, target, starter, date, timeLimit, targetImage }`. Key order doesn't matter to consumers; the round-trip test compares with `toEqual`.
- `hashedImageName(date, difficulty, webp: Uint8Array): string` → `${date}-${difficulty}-${sha256hex.slice(0, 12)}.webp`.
- `isLegacyFileName(file)`: true for `YYYY-MM-DD.json`.

- [ ] **Step 1: Tests:**
  - **Round-trip every real file in the repo:** for each JSON in `src/data/challenges` and `src/data/tailwind-challenges`, `fromRow(toRow(mode, json, …))` deep-equals the original. That's 1,102 files today; this is the main guarantee that the migration is lossless.
  - `hashedImageName` is deterministic and has the right format.
  - `isLegacyFileName` handles both forms.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `Add challenge row mapping`

---

### Task 4: Snapshot publish + `data:pull`

**Files:**
- Create: `scripts/publish-snapshot.ts`, `scripts/data-pull.ts` + test
- Modify: `package.json` (`"data:pull": "tsx scripts/data-pull.ts"`), `.gitignore` (`.data/`)

**Behavior:**
- `publishSnapshot()`:
  - `SELECT * FROM challenges ORDER BY mode, date, difficulty`, paged (`LIMIT 200 OFFSET n`) to stay well under response limits.
  - Builds `{ generatedAt, css: ChallengeJson[], tailwind: ChallengeJson[] }` via `fromRow`.
  - Uploads it to R2 `data/challenges.json` with `Cache-Control: public, max-age=300`.
- `data:pull [--out <dir>]` (default `.data/challenges`):
  - If `D1_READ_TOKEN` or `D1_WRITE_TOKEN` is set, read D1 the same paged way.
  - Otherwise `GET ${PUBLIC_ASSET_BASE ?? 'https://assets.cssdaily.dev'}/data/challenges.json`.
  - Write each challenge to `<out>/<mode>/<date>-<difficulty>.json` (pretty-printed, 2-space indent, the generator's format). Clear `<out>/<mode>/` first so removed rows don't linger.
  - Log the source and the counts.
  - `--layout repo` (for rollback, Task 9) writes `src/data/challenges/` and `src/data/tailwind-challenges/` under their original file names instead: `<date>.json` for `legacy` rows, `<date>-<difficulty>.json` otherwise.
  - `--require-d1` fails instead of falling back to the public snapshot. CI uses it (Task 8).
- [ ] **Step 1: Tests:**
  - The writer produces the expected paths and contents from a fixed set of rows.
  - `--layout repo` reproduces original legacy names.
  - Source selection: token present → D1, no token → snapshot URL.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Commit** — `Add data:pull and public snapshot`

---

### Task 5: One-time import (repo → D1 + R2)

**Files:** Create `scripts/import-challenges.ts`; Modify `package.json` (`"data:import": "tsx scripts/import-challenges.ts"`).

**Behavior.** It's idempotent and safe to rerun; `--dry-run` reports the plan without writing anything.
1. For both modes, read every JSON in the repo directory and its `targetImage` WebP.
2. **Images.** Legacy images keep their names (`targets/<mode>/<targetImage>`); the repo copies never change.
   - Upload with `Content-Type: image/webp` and `Cache-Control: public, max-age=31536000, immutable`.
   - Skip any object whose `r2Head` size already matches.
   - Run with concurrency 8.
3. **Rows.** Insert with `INSERT ... ON CONFLICT DO NOTHING` as multi-row statements within the parameter limit (Task 2).
   - `legacy` comes from `isLegacyFileName`.
   - `created_at` = the file's first-commit time if cheaply available, otherwise import time. Nothing reads it yet.
   - `generation` = `NULL`.
4. **Verify.** Per mode, the D1 row count equals the file count. A sample of 20 random rows round-trips with `fromRow` to deep-equal their files. Every `target_image` returns `r2Head` ≠ null. Any mismatch exits 1.
5. `publishSnapshot()`.

- [ ] **Step 1: Implement**, then run with `--dry-run` locally (owner `.env`).
- [ ] **Step 2: Commit** — `Add one-time challenge import`

**→ PR C** = Tasks 1–5. It doesn't change the site, the generator, or the workflows.

- [ ] **Step 3 (owner, after PR C merges): Run the import.** `npm run data:import`, then check:
  - The script's verification passes.
  - `npx wrangler d1 execute cssdaily --remote --command "SELECT mode, COUNT(*) FROM challenges GROUP BY mode"` shows the repo counts (CSS 559+, Tailwind 543+ as of 2026-11-11).
  - `https://assets.cssdaily.dev/targets/css/2026-11-11-easy.webp` loads.
  - `https://assets.cssdaily.dev/data/challenges.json` downloads.

---

### Task 6: Site reads the snapshot + assets domain

**Files:**
- Modify: `src/utils/challenges.ts`, `src/components/ChallengePlayer.tsx:192`, `src/components/TailwindPlayer.tsx:193`, `src/layouts/Layout.astro`
- Create: `src/utils/assets.ts` + test
- Modify: `scripts/smoke-hosting.ts` (+ test)

- [ ] **Step 1: `challenges.ts`.** The globs become `'../../.data/challenges/css/*.json'` and `'../../.data/challenges/tailwind/*.json'`. Everything else (grouping, sorting, exports) stays.
  - After grouping, if either map is empty, **throw**: `No challenge data in .data/ — run "npm run data:pull" first`. A silent empty build would deploy a site that redirects everything to `/about/`.
- [ ] **Step 2: `src/utils/assets.ts`.**
  - `ASSET_BASE = import.meta.env.PUBLIC_ASSET_BASE ?? 'https://assets.cssdaily.dev'`.
  - `targetImageUrl(mode, challenge) = ${ASSET_BASE}/targets/${mode}/${challenge.targetImage ?? `${challenge.date}.webp`}`. The fallback is kept for safety, since every current row has `targetImage`.
  - Test: both modes, a legacy name, and a hashed name.
- [ ] **Step 3: Players.** Replace the two inline `targetSrc` builders with `targetImageUrl('css', challenge)` and `targetImageUrl('tailwind', challenge)`.
- [ ] **Step 4: `Layout.astro`.** Add `<link rel="preconnect" href="https://assets.cssdaily.dev" crossorigin>` in `<head>`. Leave the redirect stubs bare (they don't use `Layout`).
- [ ] **Step 5: Smoke check.**
  - `pickSmokeTargets` reads `.data/challenges/css/` instead of the repo directories, with the same date rule. The image is the row's `targetImage`, so the "has a matching WebP file" filter goes.
  - Check 8 fetches `https://assets.cssdaily.dev/targets/css/<image>` and asserts 200, `image/webp`, and a `cache-control` header containing `immutable`.
  - B6's "no failed same-origin requests" stays. Add: no failed requests to the asset origin either.
- [ ] **Step 6: Verify.**
  - `npm run data:pull` (D1, with your `.env`).
  - Diff the old build against the new one: `npm run build` on `main` → copy `dist/` to `dist-before/`; build this branch; then `diff -r dist-before dist`. Expect **only** the image URL and preconnect differences in the HTML. Delete `dist-before/` afterwards.
  - Run `npm run data:pull` again with the D1 variables unset, to exercise the public-snapshot path, and confirm the snapshot gives the same file count.
  - `npm run worker:dev`, then `npm run smoke -- http://localhost:8787 --expect-origin=worker`.
- [ ] **Step 7: Commit** — `Build from D1 snapshot; serve targets from assets.cssdaily.dev`

---

### Task 7: Generator publishes to R2 + D1

**Files:**
- Modify: `scripts/generate-common.ts` (+ its test), `scripts/generate-challenge.ts`, `scripts/generate-tailwind-challenge.ts`
- Create: `scripts/publish-challenge.ts` + test

**Interfaces:**
- `isComplete(rows: { difficulty: Difficulty; legacy: number }[], difficulty): boolean` (pure). It's true if a row exists for this difficulty, **or** if any row for the date has `legacy = 1`. This replaces the file-existence logic in `alreadyGenerated`.
- `runDifficulties` takes `existing: { difficulty; legacy }[]` (one D1 query per date and mode, done by the caller) instead of the two directory paths. Its behavior and failure rules don't change.
- `publishChallenge(mode, challengeJson, webp: Uint8Array, generation)`:
  1. `name = hashedImageName(...)`.
  2. `r2Put('targets/<mode>/' + name, webp, immutable)`. If this throws, nothing has been inserted.
  3. Insert the row with `targetImage: name`, `ON CONFLICT DO NOTHING`.
  4. Return `{ inserted: boolean }`. `false` means another run already published this challenge; log a `::warning::`.
- `collectRecentTitles` → `SELECT title FROM challenges WHERE mode = ? ORDER BY date DESC, difficulty LIMIT 90`.
- After `runDifficulties`, call `publishSnapshot()`. It's **best-effort**: on failure, log a `::warning::` and don't fail the run, because the snapshot only serves local development.

- [ ] **Step 1: Tests.**
  - Port `generate-common.test.ts` from temp directories to row fixtures, keeping every existing case: skips present, repairs missing, legacy day complete for all difficulties, and the throw-only-when-all-attempted-failed rule.
  - Add `publishChallenge` tests with stubbed clients: the upload happens before the insert; a failed upload means no insert; the return value on conflict.
- [ ] **Step 2: Implement.**
  - In both generator scripts, replace the WebP and JSON `writeFileSync` blocks with `publishChallenge`.
  - Record `generation = { provider, model }` (`createGenerationProvider()` already exposes both).
  - The Playwright and retry code doesn't change.
- [ ] **Step 3: Verify locally without spending.**
  - Run `npx tsx scripts/generate-challenge.ts 2026-11-11` with `.env` loaded. All three difficulties exist in D1, so it must log "already present — skipping" three times and make **no** model call. That's the same no-spend guarantee as today. Run the Tailwind script the same way.
  - There's no scratch D1 or R2, so the live write path isn't exercised locally. It's covered by the `publishChallenge` tests, then by the first real run (Task 8 Step 7), with Task 9's rollback ready if that run misbehaves.
- [ ] **Step 4: Commit** — `Generator publishes to R2 and D1 instead of the repo`

---

### Task 8: Workflows

**Files:**
- Modify: `.github/workflows/deploy.yml`, `.github/workflows/generate-challenge.yml`, `.github/workflows/deploy-cloudflare.yml`

- [ ] **Step 1: `deploy.yml`.**
  - Add **workflow-level** `concurrency: { group: deploy, cancel-in-progress: false }`. A queued run replaces an older queued one, which is fine: the newer run pulls fresher data. See Deviation 2.
  - In `build`, before *Build Astro site*, add:

```yaml
      - name: Pull challenge data from D1
        env:
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          D1_DATABASE_ID: ${{ vars.D1_DATABASE_ID }}
          D1_READ_TOKEN: ${{ secrets.D1_READ_TOKEN }}
        run: npm run data:pull -- --require-d1
```

  - Use `npm run data:pull -- --require-d1` in that step. CI builds come from D1 only and must never fall back to the public snapshot.
- [ ] **Step 2: `deploy-cloudflare.yml`.**
  - Keep the reusable workflow and its tip check (still useful: a dispatch on a non-`main` ref skips).
  - The job-level concurrency group becomes redundant under Step 1's lock but is harmless. Remove it, so the lock lives in one place.
- [ ] **Step 3: `generate-challenge.yml`.**
  - Remove *Commit and push*, *Build Astro site*, *Upload dist for Cloudflare*, the `outputs`, and the `deploy` job.
  - Permissions become `contents: read` + `actions: write`. The `actions: write` is needed for `gh workflow run`.
  - Add the Cloudflare env to the generation steps: `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID` (variable), `D1_WRITE_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
  - Final step:

```yaml
      - name: Deploy the new challenges
        if: steps.css.outcome == 'success' || steps.tailwind.outcome == 'success'
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh workflow run deploy.yml --ref main
```

  - The report step's both-failed rule doesn't change.
  - Nothing is committed any more, so `contents: write` goes.
- [ ] **Step 4:** Parse all three files with the `yaml` package. Review the diff by eye; actionlint can't run in this environment.
- [ ] **Step 5: Commit** — `Generator triggers Deploy; builds pull from D1`

**→ PR D** = Tasks 6–8. This is the switch.

- [ ] **Step 6 (owner): Merge PR D.**
  1. **Right before merging,** rerun `npm run data:import`. It's idempotent, and it catches any day the old generator committed since the first import.
  2. Merge while nothing is running in the Actions tab.
  3. After the Deploy run finishes: `npm run data:pull && npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www`.
- [ ] **Step 7 (owner): First generator run.**
  - Either let the scheduled run happen, or dispatch it by hand.
  - Confirm that the run made no commit; that a new D1 row and a new hashed R2 object exist; that a Deploy run was triggered by `workflow_dispatch`; and that the new day loads on `cssdaily.dev`.

---

### Task 9: Rollback path (written before it's needed)

If PR D misbehaves before Task 10:
1. `gh workflow disable generate-challenge.yml`.
2. Run `npm run data:pull -- --layout repo`. This writes D1's contents back into `src/data/` under the original file names, including any days generated after PR D.
3. Copy any new hashed images back into `public/targets/` from R2. Add a `--with-images` flag to `data:pull --layout repo` that downloads them.
4. Commit that. Revert PR D. Re-enable the workflow.

- [ ] **Step 1:** Implement `--layout repo` and `--with-images`, with tests for the file naming (part of Task 4's tests).
- [ ] **Step 2:** Rehearse it locally once, after the Task 5 import: run `--layout repo` into a scratch output directory inside the repo. `diff -r` it against `src/data/` and expect no differences. Then delete the scratch directory.

---

### Task 10: Cleanup + backups (PR E, about a week after PR D)

- [ ] **Step 1:** Delete `src/data/challenges/`, `src/data/tailwind-challenges/`, and `public/targets/`.
  - Also delete the one-off scripts that only work against those directories: `scripts/generate-targets.ts` and `scripts/migrate-targets-to-webp.ts` (and the `migrate-targets` npm script).
  - Keep `src/data/tailwind-classes.json`: it's editor configuration, not challenge data.
  - Git history keeps the old files, and rewriting it isn't worth it.
- [ ] **Step 2: Backups.** Add `.github/workflows/backup-d1.yml` (weekly cron plus `workflow_dispatch`).
  - It runs `npx wrangler d1 export cssdaily --remote --output backup.sql` with `CLOUDFLARE_API_TOKEN: ${{ secrets.D1_WRITE_TOKEN }}`, then uploads the file to R2 at `backups/d1/<YYYY-MM-DD>.sql` with `r2Put`.
  - Together with D1 Time Travel (30-day point-in-time restore), that's the backup story now that git no longer holds the data.
  - *Verify while implementing:* whether `d1 export` needs D1 Edit or works with Read. Use the narrowest token that works.
- [ ] **Step 3: Docs.**
  - README "Daily Generation Pipeline": steps 3–5 become render → R2 + D1 → Deploy workflow. It still says "screenshot PNG"; it's a lossless WebP, so fix that while you're there.
  - Local dev: `npm install && npm run data:pull && npm run dev`, with a note that no credentials are needed.
  - Update CONTRIBUTING if it references the data directories.
- [ ] **Step 4: Commit** — `Remove repo challenge data; add weekly D1 backup`

## Done when

- The repo contains no challenge JSON or target images.
- The generator has made a successful scheduled run with no git commit, and its day is live on `cssdaily.dev`.
- `npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www` passes, with images served from `assets.cssdaily.dev`.
- A fresh clone with no `.env` can run `npm install && npm run data:pull && npm run dev`.
- A weekly D1 backup has landed in R2.
