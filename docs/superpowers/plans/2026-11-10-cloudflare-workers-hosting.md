# Cloudflare Workers Hosting (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Steps marked **(owner)** are dashboard or GitHub-settings actions that only Ryan can perform. Stop at each one and hand off.

**Goal:** Serve `https://cssdaily.dev` from a Cloudflare Worker (static assets only, no script) instead of GitHub Pages, with **no visible change** and **no downtime**, and deploy it from GitHub Actions.

**Architecture:** `npm run build` still produces the same static `dist/`. A Worker with no script serves `dist/` through Workers Static Assets. `not_found_handling: "404-page"` keeps the existing contract: `404.html` is served at the requested URL, which `ChallengeRedirect.astro` relies on. The cutover deliberately uses a **Worker route** on a proxied zone instead of a Worker custom domain. The design spec said custom domain; this plan supersedes that. Here's why:
- **GitHub stays the origin underneath.** While GitHub Pages is still published, deleting the route sends traffic straight back to it with no DNS change. A custom domain would take over the hostname's DNS, and getting back to GitHub would mean editing DNS again.
- **There's nothing new to provision at cutover.** A route on already-proxied records switches traffic as soon as it's created, using the zone's Universal SSL certificate that is already active. A custom domain provisions its own certificate when it's attached. That's probably quick, but on an HSTS-preloaded `.dev` domain any gap is a hard outage, so this plan doesn't take the chance.

**The route stays permanent.** It's a supported setup for a Worker that serves the whole hostname, with proxied `100::` placeholder records once GitHub is retired (Task 6). Cloudflare recommends custom domains when the Worker is the origin, so moving to one later is possible. That would be its own small, separately verified change and isn't needed for any later phase.

The work ships as **two PRs** with owner steps between them:
- **PR A:** dual-deploy. GitHub Pages keeps serving production, and every build *also* deploys to the Worker on `*.workers.dev` for verification.
- **PR B:** cutover. Adds the route, removes the GitHub Pages deploy, and disables `workers.dev`.

**Tech Stack:** Astro 5 (static, `directory` build format), Wrangler 4 (lockfile-pinned devDependency, run directly with `npx wrangler deploy`), GitHub Actions, tsx, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-cloudflare-accounts-and-feedback-design.md`, Phase 1b.

## Prerequisites (already done)

- Phase 1a: `cssdaily.dev` uses Cloudflare nameservers (`brian`/`coraline.ns.cloudflare.com`). This was verified on 2026-11-10:
  - The registry delegation is correct.
  - The records match DigitalOcean's: four GitHub Pages A records, plus `www` CNAME → `tekgadgt.github.io`. All are currently **DNS only**.
  - There's no DS record and no MX.
  - GitHub's Let's Encrypt certificate is serving.
- The DigitalOcean zone can be deleted any time after 2026-11-11, independently of this plan.

## Global Constraints

- **No `src/` changes.** This plan doesn't change site behavior. In particular, the redirect stubs (`index.astro`, `tailwind/index.astro`, `404.astro`) stay bare, and `astro.config.mjs` stays untouched.
- **The origin is exactly `https://cssdaily.dev`.** `localStorage` is scoped per origin, so serving the site on `www` or any other host would split player history. `www` must 301 to the apex and never serve content.
- **Never interpolate `${{ ... }}` into a `run:` line.** Pass values through `env:`. Same rule as the existing workflows.
- **The Cloudflare API token is scoped:** account = Ryan's account, zone = `cssdaily.dev` only. Even scoped like this, the *Edit Cloudflare Workers* template can write **any** Worker script in the account. Zone scoping only limits routes. That's acceptable while `cssdaily` is the only Worker; revisit if the account gains others. Secrets are only referenced in `with:`/`env:`, never echoed.
- **Wrangler is lockfile-pinned:** `wrangler@^4.160.0` (the latest on 2026-11-10) in `devDependencies`, with `package-lock.json` committed and `npm ci` everywhere. CI runs that installed Wrangler directly (`npx wrangler deploy`), so CI and local use the same version, and no third-party action ever handles the API token. This replaced `cloudflare/wrangler-action@v3` after a security review flagged it as an unpinned third-party action receiving the token.
- **Every deploy ships the commit it built, with that commit's own config.** The deploy job checks out the exact SHA the artifact was built from. It deploys only if that SHA is still the tip of `main`; otherwise a newer run owns the deploy (Task 3).
- **Absolute machine paths never appear** in committed files (see the repo memory on relative paths). Use `grep -rn "/Users/"` before every commit.

---

### Task 1: Wrangler config + local Worker preview

**Files:**
- Modify: `package.json` (add the `wrangler` devDependency; add `worker:dev` and `smoke` scripts)
- Modify: `package-lock.json` (regenerated by `npm install`)
- Create: `wrangler.jsonc`
- Create: `public/_headers` (deployment marker, Step 4b)
- Modify: `.gitignore` (add `.wrangler/`)

- [ ] **Step 1: Install wrangler**

```bash
npm install --save-dev wrangler@^4.160.0
```

- [ ] **Step 2: Create `wrangler.jsonc`** (stage A: `workers.dev` only, no routes)

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "cssdaily",
  "compatibility_date": "2026-11-10",
  // Assets-only Worker: no "main" script. Requests are served straight
  // from dist/ and never invoke Worker code (static requests are free).
  "assets": {
    "directory": "./dist",
    // Serves the nearest 404.html AT THE REQUESTED URL with status 404,
    // the same contract GitHub Pages had. ChallengeRedirect.astro reads
    // location.pathname on the 404 page to clamp and redirect dates.
    "not_found_handling": "404-page",
    // /challenge/<date> → /challenge/<date>/ (the build emits
    // <route>/index.html)
    "html_handling": "auto-trailing-slash"
  },
  // Stage A: reachable only at cssdaily.<subdomain>.workers.dev for
  // verification. PR B adds the production route and turns this off.
  "workers_dev": true,
  "preview_urls": false
}
```

- [ ] **Step 3: Add scripts to `package.json`**

```json
"worker:dev": "wrangler dev --port 8787",
"smoke": "tsx scripts/smoke-hosting.ts"
```

(`smoke` is implemented in Task 2.)

- [ ] **Step 4: Ignore Wrangler's local state.** Append `.wrangler/` to `.gitignore`.

- [ ] **Step 4b: Deployment marker.** Create `public/_headers`:

```
/*
  X-Hosted-By: cssdaily-worker
```

Workers Static Assets applies `_headers` rules and doesn't serve the file itself. This gives the smoke check a *positive* signal that the Worker answered, rather than just inferring it from a missing GitHub header. The header isn't visible to players. During dual deploy, GitHub Pages will serve `/_headers` as a plain static file, which is harmless.

- [ ] **Step 5: Verify locally**

```bash
npm run build && npm run worker:dev
```

In another shell:
- `curl -sI http://localhost:8787/` should return 200 with `x-hosted-by: cssdaily-worker`.
- `curl -sI http://localhost:8787/challenge/2099-01-01/` should return **404**.

The full check runs in Task 2.

- [ ] **Step 6: Commit** — `Add Wrangler config for Workers static-assets hosting`

---

### Task 2: Hosting smoke check (`scripts/smoke-hosting.ts`)

A checked-in script, so the same assertions run against local `wrangler dev`, `workers.dev`, today's GitHub Pages production (baseline), and production after cutover.

**Files:**
- Create: `scripts/smoke-hosting.ts`
- Create: `scripts/smoke-hosting.test.ts` (pure helper only)

**Interfaces:**
- `pickSmokeTargets(cssFiles: string[], targetFiles: string[], today: string): { date: string; image: string }`, pure and exported. It picks the latest CSS challenge date ≤ `today` (UTC `YYYY-MM-DD`, compared as strings) that has a matching target WebP. Both `<date>-<difficulty>.json/.webp` and legacy `<date>.json/.webp` names count. It throws if nothing qualifies.
- CLI: `npm run smoke -- <baseUrl> [--expect-origin=github|worker] [--check-www] [--no-browser]`

**HTTP checks.** These use `fetch`.

**Checks.** All requests use `redirect: 'manual'`. A failing check prints `FAIL <name>: <detail>`, and any failure makes the script exit 1.

| # | Request | Expect |
|---|---------|--------|
| 1 | `GET /` | 200, body contains `id="redirect-data"` |
| 2 | `GET /tailwind/` | 200, body contains `id="redirect-data"` |
| 3 | `GET /about/` | 200 |
| 4 | `GET /challenge/<date>/` | 200, body contains the date string |
| 5 | `GET /challenge/<date>` (no slash) | 3xx; `new URL(Location, requestUrl).href` **equals** `<baseUrl>/challenge/<date>/` exactly, so a cross-origin redirect fails. (GitHub sends 301, Workers 307; any 3xx passes.) |
| 6 | `GET /challenge/2099-01-01/` | **404**, body contains `id="redirect-data"` (proves the 404 page is served at the requested URL) |
| 7 | `GET /definitely-not-a-page` | 404, body contains `id="redirect-data"` |
| 8 | `GET /targets/<image>` | 200, `content-type` starts with `image/webp` |
| 9 | `--expect-origin=github` | the check-1 response **has** `x-github-request-id` and **lacks** `x-hosted-by` |
| 9′ | `--expect-origin=worker` | the check-1 response **has** `x-hosted-by: cssdaily-worker` (positive marker from Task 1 Step 4b) and lacks `x-github-request-id` |
| 10 | `--check-www` | `GET https://www.cssdaily.dev/challenge/<date>/?s=1` → 301, `Location` = `https://cssdaily.dev/challenge/<date>/?s=1` |
| 11 | `GET /about/`, parse HTML | exactly **one** `static.cloudflareinsights.com/beacon.min.js` script. Redirect stubs and `404.html` deliberately have **zero** (they don't use `Layout`), so check the bare `/` for zero too. This catches double-injection if Web Analytics auto-setup ever gets turned on. |

**Browser checks.** HTTP checks only prove the redirect *payload* is served; the redirect itself runs in JavaScript (`ChallengeRedirect.astro`). So these use Playwright Chromium, which is already a devDependency and installed for the generator. They're on by default; `--no-browser` skips them. For each start URL, wait for navigation to settle, then assert:
- The final URL is **same-origin** as `baseUrl` and matches `/(challenge|tailwind)/YYYY-MM-DD/`, with a date ≤ tomorrow (UTC). Tomorrow is allowed because the redirect uses the *browser's* local date.
- The challenge player rendered: a `.cm-editor` element is visible.
- No request to `baseUrl`'s origin failed (status ≥ 400) apart from the expected first 404 document, and there was no `pageerror`.

| # | Start URL | Final URL mode |
|---|-----------|----------------|
| B1 | `/` | `challenge` |
| B2 | `/tailwind/` | `tailwind` |
| B3 | `/challenge/2099-01-01/` | `challenge` (future date clamped) |
| B4 | `/tailwind/2099-01-01/` | `tailwind` |
| B5 | `/definitely-not-a-page` | `challenge` (via `/`) |
| B6 | `/challenge/<date>/` | stays on `/challenge/<date>/` (direct load renders) |

`<date>` and `<image>` come from `pickSmokeTargets` over `src/data/challenges/` and `public/targets/` (both are still in the repo during Phase 1). `today` is the UTC date, `new Date().toISOString().slice(0, 10)`, so the result doesn't depend on the runner's time zone.

- [ ] **Step 1: Write failing tests for `pickSmokeTargets`.** Cases:
  - Picks the latest date ≤ today.
  - Ignores a future-dated file (tomorrow's pre-generated challenge).
  - Accepts a legacy unsuffixed pair.
  - Skips a date whose WebP is missing.
  - Throws when there are no candidates.
- [ ] **Step 2: Implement `pickSmokeTargets` until the tests pass** (`npm test`).
- [ ] **Step 3: Implement the CLI checks:** the HTTP table with global `fetch` (Node 22), and the browser table with `playwright`'s `chromium`. The browser launch honors `CHROMIUM_PATH` the same way `scripts/generate-challenge.ts` does.
- [ ] **Step 4: Baseline against current production.**

```bash
npm run smoke -- https://cssdaily.dev --expect-origin=github
```

Also run it with `--check-www`. Every check must pass **today**, on GitHub Pages. GitHub's www redirect keeps the path and query, as checked on 2026-11-10: `www…/challenge/2026-11-10/?s=1` → 301 `https://cssdaily.dev/challenge/2026-11-10/?s=1`. If any check fails, **stop and investigate** before going further. Either the check has a bug, or production already has a problem that has to be understood before migrating. Write down the explanation in the PR description either way.

- [ ] **Step 5: Against local Worker.** `npm run build && npm run worker:dev`, then `npm run smoke -- http://localhost:8787`. Checks 1–8, 9′, 11 and B1–B6 must pass.
- [ ] **Step 6: Commit** — `Add hosting smoke check`

---

### Task 3: PR A — dual deploy (GitHub Pages + Worker on workers.dev)

GitHub Pages stays the production host. Every build also deploys the same `dist/` to the Worker.

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/generate-challenge.yml`

- [ ] **Step 1 (owner): Create the API token and secrets.**
  - Cloudflare dashboard → My Profile → API Tokens → *Create Token* → template **Edit Cloudflare Workers**.
  - Account Resources: *Include → your account*. Zone Resources: *Include → Specific zone → cssdaily.dev*.
  - GitHub repo → Settings → Secrets and variables → Actions: add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The account ID is in the dashboard sidebar.

- [ ] **Step 2: `deploy.yml`.** In the `build` job:
  - Record the SHA it built.
  - Expose that SHA as a job output.
  - Upload `dist`.

```yaml
  build:
    runs-on: ubuntu-latest
    outputs:
      sha: ${{ steps.sha.outputs.value }}
    steps:
      - uses: actions/checkout@v4
      - id: sha
        run: echo "value=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
      # ... existing setup-node / npm ci / npm test / build / Pages upload ...
      - name: Upload dist for Cloudflare
        uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist
          retention-days: 1
```

Then add a job alongside the existing Pages `deploy` job:

```yaml
  deploy-cloudflare:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
    concurrency:
      group: cloudflare-deploy
      cancel-in-progress: false
    steps:
      # Exactly the commit dist/ was built from, so wrangler.jsonc and the
      # lockfile-pinned wrangler always match the artifact.
      - uses: actions/checkout@v4
        with:
          ref: ${{ needs.build.outputs.sha }}
      - name: Skip if main has moved on
        id: tip
        env:
          BUILT_SHA: ${{ needs.build.outputs.sha }}
        run: |
          TIP="$(git ls-remote origin refs/heads/main | cut -f1)"
          if [ "$TIP" = "$BUILT_SHA" ]; then
            echo "deploy=true" >> "$GITHUB_OUTPUT"
          else
            echo "::notice::Skipping deploy of $BUILT_SHA: main is now $TIP, and that commit's run owns the deploy"
            echo "deploy=false" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.tip.outputs.deploy == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - if: steps.tip.outputs.deploy == 'true'
        run: npm ci
      - if: steps.tip.outputs.deploy == 'true'
        uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      - name: Deploy to Cloudflare Workers
        if: steps.tip.outputs.deploy == 'true'
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: npx wrangler deploy
```

**Why both the job-level lock and the tip check:**
- **The lock is per job, not per workflow.** A workflow-level group shared with `generate-challenge.yml` would let a queued push run *cancel a pending generate run*, because GitHub cancels the older pending entry in a group. A job-level group only ever cancels a queued *deploy job*.
- **The lock alone doesn't prevent stale deploys.** Jobs are ordered by when they queue, not by commit order, and `deploy.yml` builds the commit that triggered it. A slow push build of an older commit could finish after the generator's newer deploy and overwrite it, dropping tomorrow's challenge until the next deploy.
- **The tip check closes that gap.** Running inside the lock, it deploys only the commit that is currently `main`'s tip. Every tip has a run that will deploy it:
  - pushes to `main` trigger `deploy.yml`;
  - the generator's own push is deployed by its own workflow, because pushes made with `GITHUB_TOKEN` don't trigger other workflows.
- **A skipped build is always superseded.** If the tip's run fails its tests, nothing deploys. That's the right outcome for a broken `main`.

- [ ] **Step 3: `generate-challenge.yml`.** Same pattern:
  - Give the existing *Build Astro site* step an `id: build`. Record the SHA **after** `git pull`, inside that step, because that is the commit `dist` is built from: `echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"`.
  - Expose it as job output `sha: ${{ steps.build.outputs.sha }}` on `generate`.
  - After the existing *Upload artifact* step, add the `dist` `upload-artifact` step.
  - Add a `deploy-cloudflare` job with `needs: generate`, identical to Step 2's except that it reads `needs.generate.outputs.sha`.
  - Leave the Pages `deploy` job as it is.

> **As implemented:** the deploy job lives in one reusable workflow, `.github/workflows/deploy-cloudflare.yml` (`on: workflow_call`, input `sha`). It doesn't change how the deploy behaves; it just stops the identical job from drifting between the two workflows. Each caller adds a `deploy-cloudflare` job that `uses:` it with `permissions: contents: read` and passes **only** `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`, rather than `secrets: inherit`, so the deploy never receives the model API keys.

- [ ] **Step 4: Lint workflows.** If `actionlint` is available, run it. Either way, review the YAML diff by eye for indentation and `needs` names.
- [ ] **Step 5: Commit** — `Deploy to Cloudflare Workers alongside GitHub Pages`, then hand the PR to Ryan (he pushes and merges, per the PR workflow).

- [ ] **Step 6 (owner, after merge): verify `workers.dev`.**
  - **No dashboard setup is needed.** The first `wrangler deploy` creates the `cssdaily` Worker. It only requires the account's `workers.dev` subdomain to exist (Workers & Pages → set it once) and the token's Workers Scripts: Edit permission. Don't create the Worker through the dashboard's *Import a repository*: that turns on Workers Builds, and every push would deploy twice.
  - A brand-new `workers.dev` hostname can take a minute or two to resolve. If the first smoke run fails on DNS or TLS, wait and rerun before investigating.
  - *Optional, before merging:* `npx wrangler login`, then `npm run build && npx wrangler deploy` creates the Worker from your machine (it only touches `workers.dev`), so the smoke check can run first. This uses your own login, not the API token, so the first CI deploy still proves the token works.
  - Get the URL from the deploy log or dashboard: `https://cssdaily.<subdomain>.workers.dev`.
  - Run `npm run smoke -- https://cssdaily.<subdomain>.workers.dev --expect-origin=worker`. Checks 1–8, 9′, 11 and B1–B6 must pass.
  - Open a challenge in a browser: play a few edits, confirm the score updates, then submit and confirm the results modal shows. `localStorage` is per origin, so `workers.dev` starts with empty history; that's expected.
- [ ] **Step 7 (owner): Let one scheduled generate run complete** (06:00 UTC) and confirm its `deploy-cloudflare` job succeeded, with tomorrow's challenge present in the `workers.dev` build.

---

### Task 4 (owner): Pre-cutover zone settings — still served by GitHub, now through Cloudflare

Every step here is reversible on its own, and production is still GitHub Pages throughout.

- [ ] **Step 1: TLS.**
  - SSL/TLS → Overview → set the encryption mode to **Full (strict)** *before* proxying anything. *Flexible* + GitHub's "Enforce HTTPS" = an infinite redirect loop.
  - SSL/TLS → Edge Certificates: the Universal certificate shows **Active**, covering `cssdaily.dev` and `*.cssdaily.dev`. **Always Use HTTPS** is On.
- [ ] **Step 2: www → apex redirect.** Rules → Redirect Rules → *Create* (single redirect):
  - When: `http.host eq "www.cssdaily.dev"`
  - Then: dynamic, `concat("https://cssdaily.dev", http.request.uri.path)`, **preserve query string**, status **301**.
- [ ] **Step 3: Proxy the records.** DNS → set the four apex A records and the `www` CNAME to **Proxied** (orange).
- [ ] **Step 4: Verify.**

```bash
npm run smoke -- https://cssdaily.dev --expect-origin=github --check-www
```

All checks pass. The site is now served *through* Cloudflare from GitHub, and `www` redirects at the edge.

- **Analytics:** Web Analytics may offer *automatic setup* now that the zone is proxied. **Don't enable it.** The manual beacon in `Layout.astro` stays, and auto-injection would double-count. Smoke check 11 verifies it: one beacon on `/about/`, and zero on the bare redirect stub.
- **Rollback:** set the records back to DNS only. This isn't instant: resolvers keep the Cloudflare edge IPs until the proxied records' TTL (300 s) expires, and Cloudflare forwards traffic to GitHub in the meantime anyway, so the site stays up.

---

### Task 5: PR B — cutover to the Worker route

**Files:**
- Modify: `wrangler.jsonc`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/generate-challenge.yml`
- Delete: `public/CNAME`
- Modify: `README.md` (lines 39 and 59)

- [ ] **Step 1: `wrangler.jsonc`.** Add the production route and turn off the verification hosts:

```jsonc
  "routes": [
    { "pattern": "cssdaily.dev/*", "zone_name": "cssdaily.dev" }
  ],
  "workers_dev": false,
  "preview_urls": false
```

`www` gets no route because the Task 4 Redirect Rule answers it at the edge before any route.

- [ ] **Step 2: `deploy.yml`.**
  - Delete the Pages `deploy` job and the *Upload artifact* (`upload-pages-artifact`) step.
  - Drop the workflow-level `pages: write` / `id-token: write` permissions and the `concurrency: group: pages` block.
  - Rename the workflow to `Deploy`.
  - Rename the `deploy-cloudflare` caller job → `deploy`. `deploy-cloudflare.yml` itself stays.
- [ ] **Step 3: `generate-challenge.yml`.**
  - Delete the Pages `deploy` job and the `upload-pages-artifact` step.
  - Drop `pages: write` / `id-token: write` from the `generate` job; it keeps `contents: write` for the commit.
  - Rename the `deploy-cloudflare` caller job → `deploy`.
- [ ] **Step 4: Delete `public/CNAME`.** It only mattered to GitHub Pages; Workers ignores it, and with it gone a stale custom-domain claim can't be re-published.
- [ ] **Step 5: README.**
  - Line 39 `**GitHub Pages** — Hosting` → `**Cloudflare Workers** — Hosting (static assets)`.
  - Line 59 → `The site automatically rebuilds and deploys to Cloudflare Workers`.
- [ ] **Step 6: Verify locally.** Run `npm test && npm run build && npm run worker:dev`, then `npm run smoke -- http://localhost:8787`. Also `grep -rn "pages" .github/workflows/`: nothing Pages-specific should remain.
- [ ] **Step 7: Commit** — `Cut production over to Cloudflare Workers`, then hand to Ryan.

- [ ] **Step 8 (owner): Merge PR B.** Merge it **outside 05:30–07:00 UTC** (the generator's window), and only once the Actions tab shows no generate or deploy run in progress, so no PR-A-era deploy can land after the cutover. The `deploy` job's `wrangler deploy` creates the route, and traffic switches over as soon as it exists. Then run:

```bash
npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www
```

All checks must pass. Then open the site in a browser **where you have existing history**: streak and history must still be there. This proves the origin didn't change.

- **Rollback (available until Task 6 Step 2).** The route is declared in `wrangler.jsonc`, so any deploy still running from PR B would recreate a route that was deleted in the dashboard. Stop deploys first:
  1. `gh workflow disable generate-challenge.yml`, and don't push to `main`. Cancel or wait out any run in progress (Actions tab).
  2. Dashboard → Workers & Pages → `cssdaily` → Settings → Domains & Routes → delete the `cssdaily.dev/*` route. Traffic falls through right away to the still-published GitHub Pages site, which is stale only by deploys made after the merge. Verify with `npm run smoke -- https://cssdaily.dev --expect-origin=github --check-www`.
  3. Revert PR B on `main`. The revert push runs `deploy.yml` with PR A's config (no route) and also republishes GitHub Pages with current content.
  4. `gh workflow enable generate-challenge.yml`.

---

### Task 6 (owner): Retire GitHub Pages — after 48 hours of clean production

- [ ] **Step 1: Watch for 48 hours.** Two scheduled generate runs must have deployed successfully, and Web Analytics traffic should look normal.
- [ ] **Step 2: Point DNS away from GitHub, never leaving a gap.** The route and the Redirect Rule only apply while each hostname **has a proxied record**, so never delete a record before its replacement exists:
  1. **Apex:** *add* a proxied `AAAA @ 100::` record first (it can coexist with the A records). *Then* delete the four GitHub A records.
  2. **www:** *edit* the existing CNAME in place, changing the target from `tekgadgt.github.io` to `cssdaily.dev` (still proxied). A CNAME can't coexist with other record types at the same name, so an in-place edit is the gap-free option. The Redirect Rule answers `www` at the edge whatever the record's target is.
  3. Re-run `npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www`.

  **This ends the GitHub rollback window.** From here on, deleting the route sends the apex to `100::`, which is an error, not GitHub.
- [ ] **Step 3: Unpublish Pages.** GitHub → Settings → Pages → unpublish / set Source to *None*. Then delete the `github-pages` environment under Settings → Environments. DNS doesn't point at GitHub any more (Step 2), so there's never a window where the domain points at GitHub with no claim on it, which is the subdomain-takeover risk.
- [ ] **Step 3b: Know the post-retirement recovery path.** A bad deploy is now fixed with Worker versions, not DNS. `npx wrangler deployments list` shows recent versions, and `npx wrangler rollback <version-id>` makes an earlier one live immediately. Then fix forward on `main`, because the next scheduled deploy would otherwise ship `main` again.
- [ ] **Step 4 (optional): Re-enable DNSSEC.** DNS → Settings → *Enable DNSSEC*, then paste the DS record into Porkbun.

---

## Done when

- `npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www` passes.
- Existing browser history survived.
- A scheduled generate run deployed a new challenge via `wrangler deploy`.
- No DNS record points at GitHub, and GitHub Pages is unpublished, in that order.
- Neither workflow references Pages.
