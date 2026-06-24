# Image optimization + redirect tightening + a11y/SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut target-image weight ~40% via lossless WebP, collapse the first-load redirect chain to a single hop, and close three a11y/SEO gaps (editor labels, iframe titles, `main` landmark).

**Architecture:** Target images move from PNG to lossless WebP (byte-identical decode, so scoring — which re-renders `target.css` live and never reads the file — is unaffected). A shared `scripts/webp.ts` helper encodes once; a one-time migration converts existing files + rewrites `targetImage` in challenge JSON; the daily generators emit WebP going forward. Redirects are tightened by making the root/404 pages bare no-Layout stubs that jump straight to the trailing-slash URL, plus adding trailing slashes to every internal link and `trailingSlash: 'always'` in config. a11y fixes are localized markup/extension additions.

**Tech Stack:** Astro 5 (static, GitHub Pages), React 19 islands, CodeMirror 6, `sharp` 0.34.5 (already resolvable transitively), `tsx` for scripts, Playwright for generation.

**No unit-test runner exists in this repo** (only Playwright for generation). Verification therefore uses `npm run build`, `grep`, and scripted `node`/`tsx` assertions rather than a new test framework — consistent with the codebase.

---

### Task 1: Add `sharp` dependency, `trailingSlash` config, and shared WebP helper

**Files:**
- Modify: `package.json` (dependencies + scripts)
- Modify: `astro.config.mjs`
- Create: `scripts/webp.ts`

- [ ] **Step 1: Record `sharp` as an explicit dependency**

Run: `npm install --save-exact sharp@0.34.5`
Expected: `package.json` `dependencies` gains `"sharp": "0.34.5"`; install succeeds (it is already in the tree, so this is fast).

- [ ] **Step 2: Add a `migrate-targets` script entry to `package.json`**

In the `"scripts"` block of `package.json`, add the line after `"generate": "tsx scripts/generate-challenge.ts",`:

```json
    "migrate-targets": "tsx scripts/migrate-targets-to-webp.ts",
```

- [ ] **Step 3: Set `trailingSlash: 'always'` in `astro.config.mjs`**

Change the `defineConfig` call so it reads:

```js
export default defineConfig({
  site: 'https://cssdaily.dev',
  trailingSlash: 'always',
  integrations: [react(), tailwind()],
});
```

- [ ] **Step 4: Create the shared WebP helper**

Create `scripts/webp.ts`:

```ts
import sharp from 'sharp';

/**
 * Encode a PNG buffer to lossless WebP. Lossless decodes byte-identically to
 * the source PNG (verified: 0 channel diff across the corpus) while running
 * ~40% smaller, so target-image fidelity is unchanged. effort:6 is the
 * highest-ratio setting that still encodes quickly enough for the daily run.
 */
export function encodeWebpLossless(png: Buffer): Promise<Buffer> {
  return sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
}
```

- [ ] **Step 5: Verify config + helper compile**

Run: `npx astro check 2>&1 | tail -20`
Expected: no new errors referencing `astro.config.mjs` or `scripts/webp.ts`. (Pre-existing warnings elsewhere are fine.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json astro.config.mjs scripts/webp.ts
git commit -m "Add sharp dep, trailingSlash config, and lossless WebP helper"
```

---

### Task 2: One-time migration — convert existing PNGs to WebP and rewrite challenge JSON

**Files:**
- Create: `scripts/migrate-targets-to-webp.ts`
- Modify (by running the script): `public/targets/**/*.png` → `.webp`, `src/data/challenges/*.json`, `src/data/tailwind-challenges/*.json`

- [ ] **Step 1: Write the migration script**

Create `scripts/migrate-targets-to-webp.ts`:

```ts
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { encodeWebpLossless } from './webp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const TARGET_DIRS = [
  path.join(root, 'public', 'targets'),
  path.join(root, 'public', 'targets', 'tailwind'),
];
const CHALLENGE_DIRS = [
  path.join(root, 'src', 'data', 'challenges'),
  path.join(root, 'src', 'data', 'tailwind-challenges'),
];

async function convertImages() {
  let converted = 0;
  let skipped = 0;
  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) continue;
    // Non-recursive: each dir listed explicitly so we never recurse into
    // tailwind/ twice or pick up unrelated nested files.
    const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png'));
    for (const f of pngs) {
      const pngPath = path.join(dir, f);
      const webpPath = pngPath.replace(/\.png$/, '.webp');
      if (fs.existsSync(webpPath)) {
        skipped++;
        continue;
      }
      const webp = await encodeWebpLossless(fs.readFileSync(pngPath));
      fs.writeFileSync(webpPath, webp);
      fs.unlinkSync(pngPath);
      converted++;
    }
  }
  console.log(`Images: converted ${converted}, skipped ${skipped} (already webp)`);
}

function updateChallengeJson() {
  let updated = 0;
  for (const dir of CHALLENGE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
      const p = path.join(dir, f);
      const raw = fs.readFileSync(p, 'utf-8');
      const hadTrailingNewline = raw.endsWith('\n');
      const c = JSON.parse(raw);
      const current: string = c.targetImage ?? `${c.date}.png`;
      const next = current.replace(/\.png$/, '.webp');
      if (c.targetImage !== next) {
        c.targetImage = next;
        fs.writeFileSync(
          p,
          JSON.stringify(c, null, 2) + (hadTrailingNewline ? '\n' : '')
        );
        updated++;
      }
    }
  }
  console.log(`JSON: updated targetImage on ${updated} challenges`);
}

await convertImages();
updateChallengeJson();
console.log('Migration complete.');
```

- [ ] **Step 2: Record the pre-migration counts**

Run: `echo "png=$(find public/targets -name '*.png' | wc -l) webp=$(find public/targets -name '*.webp' | wc -l)"`
Expected: `png=256 webp=0` (count may differ if challenges were added; note whatever the PNG count is).

- [ ] **Step 3: Run the migration**

Run: `npm run migrate-targets`
Expected output ends with `Migration complete.`, with `Images: converted 256, skipped 0` and `JSON: updated targetImage on <N>` (N = number of challenge JSON files).

- [ ] **Step 4: Verify all PNGs are gone and replaced 1:1 by WebP**

Run: `echo "png=$(find public/targets -name '*.png' | wc -l) webp=$(find public/targets -name '*.webp' | wc -l)"`
Expected: `png=0 webp=256` (webp count equals the original png count from Step 2).

- [ ] **Step 5: Verify no challenge JSON still references a `.png`**

Run: `grep -rl '"targetImage": *"[^"]*\.png"' src/data || echo "NONE"`
Expected: `NONE`.

- [ ] **Step 6: Verify the build resolves every target image (no 404s baked in)**

Run: `npm run build && echo "BUILD OK"`
Expected: `BUILD OK`. Then confirm the dist carries WebP and no stray target PNGs:
Run: `echo "dist png=$(find dist/targets -name '*.png' | wc -l) webp=$(find dist/targets -name '*.webp' | wc -l)"`
Expected: `dist png=0 webp=256`.

- [ ] **Step 7: Re-run the migration to confirm idempotency**

Run: `npm run migrate-targets`
Expected: `Images: converted 0, skipped 256` and `JSON: updated targetImage on 0`.

- [ ] **Step 8: Commit**

```bash
git add scripts/migrate-targets-to-webp.ts public/targets src/data/challenges src/data/tailwind-challenges
git commit -m "Migrate target images to lossless WebP; rewrite targetImage refs"
```

---

### Task 3: Emit WebP from the generation pipeline

**Files:**
- Modify: `scripts/generate-challenge.ts:6-7`, `:187`, `:194-197`
- Modify: `scripts/generate-tailwind-challenge.ts:6`, `:189`, `:196-199`
- Modify: `scripts/generate-targets.ts:5`, `:33-35`

- [ ] **Step 1: Update `generate-challenge.ts` import**

After the existing import on line 6 (`import { buildScreenshotHtml } from '../src/utils/code';`), add:

```ts
import { encodeWebpLossless } from './webp';
```

- [ ] **Step 2: Update `generate-challenge.ts` `targetImage` field**

Change the `targetImage` line in the `challenge` object (currently `targetImage: \`${date}-${difficulty}.png\`,`) to:

```ts
    targetImage: `${date}-${difficulty}.webp`,
```

- [ ] **Step 3: Update `generate-challenge.ts` screenshot → WebP write**

Replace these three lines:

```ts
  const pngPath = path.join(TARGETS_DIR, `${date}-${difficulty}.png`);
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`Saved target PNG: ${pngPath}`);
```

with:

```ts
  const png = await page.screenshot({ type: 'png' });
  const webpPath = path.join(TARGETS_DIR, `${date}-${difficulty}.webp`);
  fs.writeFileSync(webpPath, await encodeWebpLossless(png));
  console.log(`Saved target WebP: ${webpPath}`);
```

- [ ] **Step 4: Apply the same three changes to `generate-tailwind-challenge.ts`**

After line 6 (`import { buildTailwindScreenshotHtml } from '../src/utils/code';`), add:

```ts
import { encodeWebpLossless } from './webp';
```

Change the `targetImage` field to:

```ts
    targetImage: `${date}-${difficulty}.webp`,
```

Replace:

```ts
  const pngPath = path.join(TARGETS_DIR, `${date}-${difficulty}.png`);
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`Saved Tailwind target PNG: ${pngPath}`);
```

with:

```ts
  const png = await page.screenshot({ type: 'png' });
  const webpPath = path.join(TARGETS_DIR, `${date}-${difficulty}.webp`);
  fs.writeFileSync(webpPath, await encodeWebpLossless(png));
  console.log(`Saved Tailwind target WebP: ${webpPath}`);
```

- [ ] **Step 5: Update `generate-targets.ts` to honor `targetImage` and emit WebP**

After line 5 (`import { buildScreenshotHtml } from '../src/utils/code';`), add:

```ts
import { encodeWebpLossless } from './webp';
```

Replace these three lines (around `:33`):

```ts
    const pngPath = path.join(TARGETS_DIR, `${challenge.date}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    console.log(`Generated: ${pngPath}`);
```

with (this also fixes a latent bug — it previously hardcoded `${date}.png`, ignoring multi-difficulty `targetImage`):

```ts
    const outName = (challenge.targetImage ?? `${challenge.date}.png`).replace(/\.png$/, '.webp');
    const png = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(TARGETS_DIR, outName), await encodeWebpLossless(png));
    console.log(`Generated: ${path.join(TARGETS_DIR, outName)}`);
```

- [ ] **Step 6: Type-check the scripts**

Run: `npx astro check 2>&1 | grep -E "generate-(challenge|tailwind-challenge|targets)\.ts" || echo "NO SCRIPT ERRORS"`
Expected: `NO SCRIPT ERRORS`.

- [ ] **Step 7: Commit**

```bash
git add scripts/generate-challenge.ts scripts/generate-tailwind-challenge.ts scripts/generate-targets.ts
git commit -m "Emit lossless WebP target images from generation scripts"
```

---

### Task 4: Update frontend image fallback to `.webp`

**Files:**
- Modify: `src/components/ChallengePlayer.tsx:182`
- Modify: `src/components/TailwindPlayer.tsx:183`

- [ ] **Step 1: Update `ChallengePlayer.tsx` fallback**

Change line 182 from:

```tsx
  const targetSrc = `/targets/${challenge.targetImage ?? `${challenge.date}.png`}`;
```

to:

```tsx
  const targetSrc = `/targets/${challenge.targetImage ?? `${challenge.date}.webp`}`;
```

- [ ] **Step 2: Update `TailwindPlayer.tsx` fallback**

Change line 183 from:

```tsx
  const targetSrc = `/targets/tailwind/${challenge.targetImage ?? `${challenge.date}.png`}`;
```

to:

```tsx
  const targetSrc = `/targets/tailwind/${challenge.targetImage ?? `${challenge.date}.webp`}`;
```

- [ ] **Step 3: Verify no `.png` fallback remains in components**

Run: `grep -rn "\.png" src/components || echo "NO PNG REFS"`
Expected: `NO PNG REFS`.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChallengePlayer.tsx src/components/TailwindPlayer.tsx
git commit -m "Default target image fallback to .webp"
```

---

### Task 5: Slim redirect stubs and collapse the first-load hop

**Files:**
- Modify: `src/pages/index.astro` (full rewrite)
- Modify: `src/pages/tailwind/index.astro` (full rewrite)
- Modify: `src/pages/404.astro` (full rewrite)

- [ ] **Step 1: Rewrite `src/pages/index.astro` as a bare stub redirecting to the trailing-slash URL**

Replace the entire file with:

```astro
---
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <title>CSS Daily</title>
    <script>
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      window.location.replace(`/challenge/${date}/`);
    </script>
  </head>
  <body>
    <noscript><a href="/about/">CSS Daily</a></noscript>
  </body>
</html>
```

- [ ] **Step 2: Rewrite `src/pages/tailwind/index.astro` the same way**

Replace the entire file with:

```astro
---
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <title>Tailwind Daily - CSS Daily</title>
    <script>
      const d = new Date();
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      window.location.replace(`/tailwind/${date}/`);
    </script>
  </head>
  <body>
    <noscript><a href="/about/">CSS Daily</a></noscript>
  </body>
</html>
```

- [ ] **Step 3: Rewrite `src/pages/404.astro` as a bare stub**

The 404 target is the static path `/`, so it can use a meta-refresh in addition to the script. Replace the entire file with:

```astro
---
---
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="robots" content="noindex" />
    <title>Not Found - CSS Daily</title>
    <meta http-equiv="refresh" content="0; url=/" />
    <script>window.location.replace('/');</script>
  </head>
  <body>
    <noscript><a href="/">CSS Daily</a></noscript>
  </body>
</html>
```

- [ ] **Step 4: Verify the stubs no longer import `Layout` and target trailing-slash URLs**

Run: `grep -L "Layout" src/pages/index.astro src/pages/tailwind/index.astro src/pages/404.astro` then `grep -n "replace(\`/challenge/\${date}/\`)\|replace(\`/tailwind/\${date}/\`)" src/pages/index.astro src/pages/tailwind/index.astro`
Expected: all three files listed by the first command (none import Layout); both redirect lines found with trailing slashes.

- [ ] **Step 5: Build and confirm the stubs are tiny (no Layout/analytics bundle)**

Run: `npm run build && grep -c "cloudflareinsights" dist/index.html dist/404.html dist/tailwind/index.html`
Expected: `0` for each file (the analytics beacon, which lives in `Layout`, is absent from the redirect stubs).

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro src/pages/tailwind/index.astro src/pages/404.astro
git commit -m "Make redirect stubs Layout-free and jump straight to trailing-slash URLs"
```

---

### Task 6: Add trailing slashes to all internal route links

**Files:**
- Modify: `src/components/Header.astro:15`, `:25`
- Modify: `src/components/ChallengePlayer.tsx:194`, `:200`
- Modify: `src/components/TailwindPlayer.tsx:195`, `:201`
- Modify: `src/components/HistoryView.tsx:65`
- Modify: `src/components/ResultsModal.tsx:94`, `:97`

- [ ] **Step 1: Header links**

In `src/components/Header.astro`, change `href="/tailwind"` to `href="/tailwind/"` and `href="/about"` to `href="/about/"`. Leave the `currentPath === '/tailwind'` / `'/about'` comparisons unchanged — those are internal identifiers passed by the pages, not URLs.

- [ ] **Step 2: ChallengePlayer date arrows**

In `src/components/ChallengePlayer.tsx`, change:
- line 194: `href={\`/challenge/${prevDate}\`}` → `href={\`/challenge/${prevDate}/\`}`
- line 200: `href={\`/challenge/${nextDate}\`}` → `href={\`/challenge/${nextDate}/\`}`

- [ ] **Step 3: TailwindPlayer date arrows**

In `src/components/TailwindPlayer.tsx`, change:
- line 195: `href={\`/tailwind/${prevDate}\`}` → `href={\`/tailwind/${prevDate}/\`}`
- line 201: `href={\`/tailwind/${nextDate}\`}` → `href={\`/tailwind/${nextDate}/\`}`

- [ ] **Step 4: HistoryView link**

In `src/components/HistoryView.tsx` line 65, change `href={\`${basePath}/${date}\`}` → `href={\`${basePath}/${date}/\`}`.

- [ ] **Step 5: ResultsModal prev/next links**

In `src/components/ResultsModal.tsx`, change:
- line 94: `href={\`${basePath}/${prevDate}\`}` → `href={\`${basePath}/${prevDate}/\`}`
- line 97: `href={\`${basePath}/${nextDate}\`}` → `href={\`${basePath}/${nextDate}/\`}`

- [ ] **Step 6: Verify no internal route link is missing its trailing slash**

Run: `grep -rn "challenge/\${\|tailwind/\${\|basePath}/\${" src/components`
Expected: every match ends with `/}` before the closing backtick (e.g. `` `/challenge/${prevDate}/` ``, `` `${basePath}/${date}/` ``) — none end in `}` directly.
Run: `grep -rn 'href="/tailwind"\|href="/about"' src/components`
Expected: no matches (both Header links now carry the trailing slash).

- [ ] **Step 7: Build to confirm nothing broke**

Run: `npm run build && echo "BUILD OK"`
Expected: `BUILD OK`.

- [ ] **Step 8: Commit**

```bash
git add src/components/Header.astro src/components/ChallengePlayer.tsx src/components/TailwindPlayer.tsx src/components/HistoryView.tsx src/components/ResultsModal.tsx
git commit -m "Add trailing slashes to internal route links to avoid GH Pages 301s"
```

---

### Task 7: Accessible names on the CodeMirror editors

**Files:**
- Modify: `src/components/CodeEditor.tsx:35-49`, `:63-69`
- Modify: `src/components/TailwindEditor.tsx:141-162`

- [ ] **Step 1: Label the CSS editor**

In `src/components/CodeEditor.tsx`, inside the CSS view's `extensions` array (the one containing `css(),`), add this line immediately after `oneDark,` (line 38):

```ts
        EditorView.contentAttributes.of({ 'aria-label': 'CSS editor' }),
```

- [ ] **Step 2: Label the read-only HTML editor**

In the same file, inside the HTML view's `extensions` array (the one containing `html(),` and `EditorState.readOnly.of(true)`), add this line immediately after `oneDark,` (line 66):

```ts
        EditorView.contentAttributes.of({ 'aria-label': 'HTML editor (read-only)' }),
```

- [ ] **Step 3: Label the Tailwind editor**

In `src/components/TailwindEditor.tsx`, inside the `extensions` array, add this line immediately after the `EditorView.theme({ ... }),` block (after line 150):

```ts
        EditorView.contentAttributes.of({ 'aria-label': 'Tailwind HTML editor' }),
```

`EditorView` is already imported in both files, so no import change is needed.

- [ ] **Step 4: Build and confirm the labels reach the rendered DOM**

Run: `npm run build && grep -rho 'aria-label="[^"]*editor[^"]*"' dist/challenge/*/index.html | sort -u`
Expected output includes `aria-label="CSS editor"` and `aria-label="HTML editor (read-only)"`. (CodeMirror applies `contentAttributes` to its `.cm-content` `role="textbox"` element; these appear in the server-rendered island markup.)

Run: `grep -rho 'aria-label="Tailwind HTML editor"' dist/tailwind/*/index.html | sort -u`
Expected: `aria-label="Tailwind HTML editor"`.

> Note: if the React islands are not server-rendered into the static HTML (client-only), the grep may return nothing even though the labels are correct at runtime. In that case verify at runtime instead: `npm run preview`, open a challenge, and inspect the `.cm-content` element in DevTools for the `aria-label` attribute.

- [ ] **Step 5: Commit**

```bash
git add src/components/CodeEditor.tsx src/components/TailwindEditor.tsx
git commit -m "Add aria-labels to CodeMirror editor textboxes"
```

---

### Task 8: Titles on all iframes

**Files:**
- Modify: `src/components/Preview.tsx:21-27`
- Modify: `src/components/TailwindPreview.tsx:21-27`
- Modify: `src/utils/diff.ts:34-41`, `:271-278`

- [ ] **Step 1: Title the CSS preview iframe**

In `src/components/Preview.tsx`, add a `title` attribute to the `<iframe>` (after the `ref={ref}` line):

```tsx
    <iframe
      ref={ref}
      title="Live preview of your code"
      srcDoc={buildSrcdoc(html, css)}
      sandbox="allow-same-origin"
      style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, border: 'none', background: '#f5f5f5' }}
      onLoad={handleLoad}
    />
```

- [ ] **Step 2: Title the Tailwind preview iframe**

In `src/components/TailwindPreview.tsx`, add the same `title` line after `ref={ref}`:

```tsx
    <iframe
      ref={ref}
      title="Live preview of your code"
      srcDoc={buildTailwindSrcdoc(html)}
      sandbox="allow-scripts allow-same-origin"
      style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, border: 'none', background: '#f5f5f5' }}
      onLoad={handleLoad}
    />
```

- [ ] **Step 3: Title the offscreen capture iframes in `diff.ts`**

In `src/utils/diff.ts`, in `renderAndCapture`, immediately after `const iframe = document.createElement('iframe');` (line 34), add:

```ts
  iframe.title = 'Offscreen render for scoring';
```

In `renderAndCaptureTailwind`, immediately after `const iframe = document.createElement('iframe');` (line 271), add the same line:

```ts
  iframe.title = 'Offscreen render for scoring';
```

- [ ] **Step 4: Verify every iframe has a title**

Run: `grep -rn "iframe" src/components/Preview.tsx src/components/TailwindPreview.tsx | grep -i title; grep -n "iframe.title" src/utils/diff.ts`
Expected: a `title=` on both preview iframes and two `iframe.title =` lines in `diff.ts`.

- [ ] **Step 5: Build**

Run: `npm run build && echo "BUILD OK"`
Expected: `BUILD OK`.

- [ ] **Step 6: Commit**

```bash
git add src/components/Preview.tsx src/components/TailwindPreview.tsx src/utils/diff.ts
git commit -m "Add title to all iframes for accessibility"
```

---

### Task 9: Add a `main` landmark to the challenge pages

**Files:**
- Modify: `src/pages/challenge/[date].astro:31-41`
- Modify: `src/pages/tailwind/[date].astro:31-41`

- [ ] **Step 1: Wrap the challenge players in `<main>`**

In `src/pages/challenge/[date].astro`, change the body block from:

```astro
  <div class="flex flex-col h-screen">
    <Header currentPath="/challenge" />
    {challenges.map((challenge: any) => (
      <ChallengePlayer
        client:load
        challenge={challenge}
        allDates={allDates}
        availableDifficulties={availableDifficulties}
      />
    ))}
  </div>
```

to:

```astro
  <div class="flex flex-col h-screen">
    <Header currentPath="/challenge" />
    <main class="flex-1 flex flex-col min-h-0">
      {challenges.map((challenge: any) => (
        <ChallengePlayer
          client:load
          challenge={challenge}
          allDates={allDates}
          availableDifficulties={availableDifficulties}
        />
      ))}
    </main>
  </div>
```

- [ ] **Step 2: Wrap the Tailwind players in `<main>`**

In `src/pages/tailwind/[date].astro`, apply the identical change, wrapping the `{challenges.map(... <TailwindPlayer ... /> ...)}` block in `<main class="flex-1 flex flex-col min-h-0"> ... </main>` (Header stays outside).

- [ ] **Step 3: Build and confirm exactly one `<main>` per challenge page**

Run: `npm run build && for f in dist/challenge/2026-06-13/index.html dist/tailwind/2026-06-13/index.html; do echo "$f: $(grep -o '<main' "$f" | wc -l) main tags"; done`
Expected: each file reports `1 main tags`.

- [ ] **Step 4: Visually confirm layout is intact**

Run: `npm run preview` and open a challenge page; confirm the editor/preview fill the viewport exactly as before (the `<main>` inherits the `flex-1 min-h-0` role the players rely on). Stop preview when done.

- [ ] **Step 5: Commit**

```bash
git add src/pages/challenge/[date].astro src/pages/tailwind/[date].astro
git commit -m "Add main landmark to challenge pages"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build && echo "BUILD OK"`
Expected: `BUILD OK`, no errors.

- [ ] **Step 2: Confirm the asset/redirect/a11y end-state in one sweep**

Run:
```bash
echo "targets png=$(find dist/targets -name '*.png' | wc -l) webp=$(find dist/targets -name '*.webp' | wc -l)"
echo "index imports Layout? $(grep -c Layout dist/index.html)"
echo "sample main count: $(grep -o '<main' dist/challenge/*/index.html | wc -l)"
```
Expected: `targets png=0 webp=<all>`; `index imports Layout? 0` (stub has no Layout markup — the analytics beacon is absent); main count equals the number of challenge pages.

- [ ] **Step 3: Manual smoke test in preview**

Run: `npm run preview`, then check:
- `http://localhost:4321/` redirects straight to `/challenge/<today>/` (one navigation, trailing slash present) — watch the Network panel for no intermediate `/challenge/<today>` 301.
- A challenge loads; the target tab/overlay shows the reference image (now WebP) correctly.
- Editing CSS updates the score/heatmap exactly as before (scoring is unaffected — it re-renders `target.css`, never the image).
- Date arrows, header links (`Tailwind`, `About`), and history links navigate with no redirect.
Stop preview when done.

- [ ] **Step 4: Final status check**

Run: `git status -s && git log --oneline main..HEAD`
Expected: clean working tree; the commit list shows Tasks 1–9.
