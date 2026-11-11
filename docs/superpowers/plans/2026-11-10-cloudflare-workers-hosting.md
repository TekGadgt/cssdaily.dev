# Cloudflare Workers Hosting (Phase 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Steps marked **(owner)** are dashboard or GitHub-settings actions that only Ryan can perform. Stop at each one and hand off.

**Goal:** Serve `https://cssdaily.dev` from a Cloudflare Worker (static assets only, no script) instead of GitHub Pages, with **no visible change** and **no downtime**, and deploy it from GitHub Actions.

**Architecture:** `npm run build` still produces the same static `dist/`. A Worker with no script serves `dist/` through Workers Static Assets. `not_found_handling: "404-page"` keeps the existing contract: `404.html` is served at the requested URL, which `ChallengeRedirect.astro` relies on. The cutover uses a **Worker route** on a proxied zone, not a Worker custom domain. Here's why:
- A custom domain needs the hostname's existing DNS records deleted first, and it issues a new certificate at attach time. On an HSTS-preloaded `.dev` domain, any certificate gap is a hard outage.
- A route on already-proxied records switches traffic atomically, using the zone's Universal SSL certificate that is already active.
- Deleting the route is an instant rollback to GitHub Pages.

The work ships as **two PRs** with owner steps between them:
- **PR A:** dual-deploy. GitHub Pages keeps serving production, and every build *also* deploys to the Worker on `*.workers.dev` for verification.
- **PR B:** cutover. Adds the route, removes the GitHub Pages deploy, and disables `workers.dev`.

**Tech Stack:** Astro 5 (static, `directory` build format), Wrangler 4 (pinned devDependency), `cloudflare/wrangler-action@v3`, GitHub Actions, tsx, vitest.

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
- **The Cloudflare API token is scoped:** account = Ryan's account, zone = `cssdaily.dev` only. Secrets are only referenced in `with:`/`env:`, never echoed.
- **Wrangler is pinned** in `devDependencies` (`wrangler@^4.160.0`, the latest on 2026-11-10). CI and local use the same version.
- **Absolute machine paths never appear** in committed files (see the repo memory on relative paths). Use `grep -rn "/Users/"` before every commit.

---

### Task 1: Wrangler config + local Worker preview

**Files:**
- Modify: `package.json` (add the `wrangler` devDependency; add `worker:dev` and `smoke` scripts)
- Create: `wrangler.jsonc`
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

- [ ] **Step 5: Verify locally**

```bash
npm run build && npm run worker:dev
```

In another shell, `curl -sI http://localhost:8787/` should return 200, and `curl -sI http://localhost:8787/challenge/2099-01-01/` should return **404**. The full check runs in Task 2.

- [ ] **Step 6: Commit** — `Add Wrangler config for Workers static-assets hosting`

---

### Task 2: Hosting smoke check (`scripts/smoke-hosting.ts`)

A checked-in script, so the same assertions run against local `wrangler dev`, `workers.dev`, today's GitHub Pages production (baseline), and production after cutover.

**Files:**
- Create: `scripts/smoke-hosting.ts`
- Create: `scripts/smoke-hosting.test.ts` (pure helper only)

**Interfaces:**
- `pickSmokeTargets(cssFiles: string[], targetFiles: string[], today: string): { date: string; image: string }`, pure and exported. It picks the latest CSS challenge date ≤ `today` (UTC `YYYY-MM-DD`, compared as strings) that has a matching target WebP. Both `<date>-<difficulty>.json/.webp` and legacy `<date>.json/.webp` names count. It throws if nothing qualifies.
- CLI: `npm run smoke -- <baseUrl> [--expect-origin=github|worker] [--check-www]`

**Checks.** All requests use `redirect: 'manual'`. A failing check prints `FAIL <name>: <detail>`, and any failure makes the script exit 1.

| # | Request | Expect |
|---|---------|--------|
| 1 | `GET /` | 200, body contains `id="redirect-data"` |
| 2 | `GET /tailwind/` | 200, body contains `id="redirect-data"` |
| 3 | `GET /about/` | 200 |
| 4 | `GET /challenge/<date>/` | 200, body contains the date string |
| 5 | `GET /challenge/<date>` (no slash) | 3xx, `Location` ends with `/challenge/<date>/` (GitHub sends 301, Workers 307; any 3xx passes) |
| 6 | `GET /challenge/2099-01-01/` | **404**, body contains `id="redirect-data"` (proves the 404 page is served at the requested URL) |
| 7 | `GET /definitely-not-a-page` | 404, body contains `id="redirect-data"` |
| 8 | `GET /targets/<image>` | 200, `content-type` starts with `image/webp` |
| 9 | `--expect-origin=github` | the check-1 response **has** an `x-github-request-id` header |
| 9′ | `--expect-origin=worker` | the check-1 response **lacks** `x-github-request-id` |
| 10 | `--check-www` | `GET https://www.cssdaily.dev/challenge/<date>/?s=1` → 301, `Location` = `https://cssdaily.dev/challenge/<date>/?s=1` |

`<date>` and `<image>` come from `pickSmokeTargets` over `src/data/challenges/` and `public/targets/` (both are still in the repo during Phase 1). `today` is the UTC date, `new Date().toISOString().slice(0, 10)`, so the result doesn't depend on the runner's time zone.

- [ ] **Step 1: Write failing tests for `pickSmokeTargets`.** Cases:
  - Picks the latest date ≤ today.
  - Ignores a future-dated file (tomorrow's pre-generated challenge).
  - Accepts a legacy unsuffixed pair.
  - Skips a date whose WebP is missing.
  - Throws when there are no candidates.
- [ ] **Step 2: Implement `pickSmokeTargets` until the tests pass** (`npm test`).
- [ ] **Step 3: Implement the CLI checks** (table above) using global `fetch` (Node 22).
- [ ] **Step 4: Baseline against current production.**

```bash
npm run smoke -- https://cssdaily.dev --expect-origin=github
```

Also run it with `--check-www`. Every check must pass **today**, on GitHub Pages. GitHub's www redirect keeps the path and query, as checked on 2026-11-10: `www…/challenge/2026-11-10/?s=1` → 301 `https://cssdaily.dev/challenge/2026-11-10/?s=1`. If any check fails, the check is wrong, not the host. Fix it before going further.

- [ ] **Step 5: Against local Worker.** `npm run build && npm run worker:dev`, then `npm run smoke -- http://localhost:8787`. Checks 1–8 must pass.
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

- [ ] **Step 2: `deploy.yml`.** In the `build` job, after *Upload artifact*, add:

```yaml
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
      - uses: actions/checkout@v4   # for wrangler.jsonc + the pinned wrangler
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist
      - name: Deploy to Cloudflare Workers
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

The concurrency is set **per job, not per workflow**. A workflow-level group shared with `generate-challenge.yml` would let a queued push deploy *cancel a pending generate run*: GitHub cancels the older pending entry in a group. Cancelling a queued deploy job is harmless, because every deploy ships a build of `main` taken after the generator's push.

- [ ] **Step 3: `generate-challenge.yml`.** Same pattern:
  - After the existing *Upload artifact* step in `generate`, add the `dist` `upload-artifact` step.
  - Add a `deploy-cloudflare` job with `needs: generate`, identical to Step 2's.
  - Leave the Pages `deploy` job as it is.

  Note: this workflow's `build` runs after `git pull`, so `dist` includes the newly committed challenge. The artifact carries that exact build, and nothing is rebuilt.

- [ ] **Step 4: Lint workflows.** If `actionlint` is available, run it. Either way, review the YAML diff by eye for indentation and `needs` names.
- [ ] **Step 5: Commit** — `Deploy to Cloudflare Workers alongside GitHub Pages`, then hand the PR to Ryan (he pushes and merges, per the PR workflow).

- [ ] **Step 6 (owner, after merge): verify `workers.dev`.**
  - Get the URL from the deploy log or dashboard: `https://cssdaily.<subdomain>.workers.dev`.
  - Run `npm run smoke -- https://cssdaily.<subdomain>.workers.dev --expect-origin=worker`. Checks 1–8 and 9′ must pass.
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

- **Analytics:** Web Analytics may offer *automatic setup* now that the zone is proxied. **Don't enable it.** The manual beacon in `Layout.astro` stays, and auto-injection would double-count. Check that the page HTML has exactly one `cloudflareinsights` script.
- **Rollback:** set the records back to DNS only.

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
  - Rename `deploy-cloudflare` → `deploy`.
- [ ] **Step 3: `generate-challenge.yml`.**
  - Delete the Pages `deploy` job and the `upload-pages-artifact` step.
  - Drop `pages: write` / `id-token: write` from the `generate` job; it keeps `contents: write` for the commit.
  - Rename `deploy-cloudflare` → `deploy`.
- [ ] **Step 4: Delete `public/CNAME`.** It only mattered to GitHub Pages; Workers ignores it, and with it gone a stale custom-domain claim can't be re-published.
- [ ] **Step 5: README.**
  - Line 39 `**GitHub Pages** — Hosting` → `**Cloudflare Workers** — Hosting (static assets)`.
  - Line 59 → `The site automatically rebuilds and deploys to Cloudflare Workers`.
- [ ] **Step 6: Verify locally.** Run `npm test && npm run build && npm run worker:dev`, then `npm run smoke -- http://localhost:8787`. Also `grep -rn "pages" .github/workflows/`: nothing Pages-specific should remain.
- [ ] **Step 7: Commit** — `Cut production over to Cloudflare Workers`, then hand to Ryan.

- [ ] **Step 8 (owner): Merge PR B.** The `deploy` job's `wrangler deploy` attaches the route, and traffic switches atomically. Then run:

```bash
npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www
```

All checks must pass. Then open the site in a browser **where you have existing history**: streak and history must still be there. This proves the origin didn't change.

- **Rollback (instant):** dashboard → Workers & Pages → `cssdaily` → Settings → Domains & Routes → delete the route. Requests fall through to the still-published GitHub Pages site, which is stale only by whatever deployed after the merge. Then revert PR B.

---

### Task 6 (owner): Retire GitHub Pages — after 48 hours of clean production

- [ ] **Step 1: Watch for 48 hours.** Two scheduled generate runs must have deployed successfully, and Web Analytics traffic should look normal.
- [ ] **Step 2: Unpublish Pages.** GitHub → Settings → Pages → unpublish / set Source to *None*. Then delete the `github-pages` environment under Settings → Environments.
- [ ] **Step 3: Replace the GitHub IPs straight away.** Once Pages is unpublished, DNS records that still point at GitHub's Pages IPs are a **subdomain-takeover risk**: another GitHub user could claim `cssdaily.dev` for their own Pages site. The Worker route would mask it, but don't rely on that.
  - Delete the four A records and the `www` CNAME.
  - Add **proxied** `AAAA @ 100::` and `AAAA www 100::`. These are Cloudflare's documented "originless" placeholders for hosts served entirely by Workers or rules.
  - Re-run the smoke command from Task 5 Step 8.
- [ ] **Step 4 (optional): Re-enable DNSSEC.** DNS → Settings → *Enable DNSSEC*, then paste the DS record into Porkbun.

---

## Done when

- `npm run smoke -- https://cssdaily.dev --expect-origin=worker --check-www` passes.
- Existing browser history survived.
- A scheduled generate run deployed a new challenge via `wrangler deploy`.
- GitHub Pages is unpublished, and no DNS record points at GitHub.
- Neither workflow references Pages.
