# Generator Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin emoji rendering to Noto Color Emoji everywhere challenges render, validate generated component size with a retry feedback loop, and nudge generations toward semantic HTML.

**Architecture:** All challenge HTML is built through helpers in `src/utils/code.ts`, used by the player preview iframes, the snapdom diff captures, and the Playwright screenshot pipeline — so the font change happens once and applies everywhere. The two generator scripts (`scripts/generate-challenge.ts`, `scripts/generate-tailwind-challenge.ts`) are restructured from one-shot API calls into a measure-and-retry conversation loop using a shared Playwright measurement helper. Spec: `docs/superpowers/specs/2026-06-10-quality-improvements-design.md` (Package 1).

**Tech Stack:** TypeScript, Anthropic SDK (multi-turn messages), Playwright, tsx. No test framework exists in this repo — verification is via targeted smoke scripts and `npm run build`.

**Important context for the implementing engineer:**
- The repo has zero automated tests and no test runner. Do not add one for this package. Each task includes explicit verification commands instead.
- `scripts/generate-challenge.ts` and `scripts/generate-tailwind-challenge.ts` run daily in GitHub Actions with `ANTHROPIC_API_KEY`. Lines printed as `::warning::...` become GitHub Actions warning annotations.
- Past challenges/targets are archival — do NOT regenerate any existing JSON or PNG (spec explicitly excludes backfill).
- The viewport for all rendering is 600×400 with 20px body padding; the component size limit is 520×320.

---

### Task 1: Pin Noto Color Emoji in all rendering paths

**Files:**
- Modify: `src/utils/code.ts`

- [ ] **Step 1: Update `FONT_LINK` and `BASE_STYLES`**

In `src/utils/code.ts`, replace line 1:

```ts
export const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Color+Emoji&display=swap';
```

And in `BASE_STYLES`, change the body `font-family` line from:

```css
  font-family: 'Inter', sans-serif;
```

to:

```css
  font-family: 'Inter', 'Noto Color Emoji', sans-serif;
```

- [ ] **Step 2: Update the Tailwind body font class**

In `buildTailwindSrcdoc` in the same file, change the body tag from:

```html
<body class="bg-[#f5f5f5] min-h-screen flex items-center justify-center p-5 font-['Inter']">
```

to:

```html
<body class="bg-[#f5f5f5] min-h-screen flex items-center justify-center p-5 font-['Inter','Noto_Color_Emoji']">
```

(Tailwind arbitrary values use underscores for spaces; commas separate font-stack entries.)

- [ ] **Step 3: Verify the font URL resolves and the site builds**

Run:

```bash
curl -s -o /dev/null -w "%{http_code}\n" "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Color+Emoji&display=swap"
npm run build
```

Expected: `200`, then a successful Astro build with no errors.

- [ ] **Step 4: Visually verify emoji rendering (spot check)**

Run `npm run dev`, open a past challenge that contains emoji (e.g. search with `grep -lE '[\x{1F300}-\x{1FAFF}]' src/data/challenges/*.json | head -3` to find one), and confirm the **Your Preview** panel renders emoji in Noto Color Emoji style (flat Google-style glyphs, not Apple's). The target PNG will still show old glyphs — that is expected (archival).

- [ ] **Step 5: Commit**

```bash
git add src/utils/code.ts
git commit -m "Pin Noto Color Emoji font in all challenge rendering paths"
```

---

### Task 2: Shared Playwright measurement helper

**Files:**
- Create: `scripts/measure.ts`

- [ ] **Step 1: Create `scripts/measure.ts`**

```ts
import type { Page } from 'playwright';

export const MAX_COMPONENT_WIDTH = 520;
export const MAX_COMPONENT_HEIGHT = 320;

/**
 * Measure the bounding box of the rendered component: the union of
 * document.body's direct children rects (the body is a flex container
 * that centers the component; padding/background are environment chrome).
 */
export async function measureComponent(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of Array.from(document.body.children)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    }
    if (minX === Infinity) return { width: 0, height: 0 };
    return { width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
  });
}

export function isOversize(size: { width: number; height: number }): boolean {
  return size.width > MAX_COMPONENT_WIDTH || size.height > MAX_COMPONENT_HEIGHT;
}
```

- [ ] **Step 2: Smoke-test the helper against known-size fixtures**

Write `/tmp/measure-smoke.ts`:

```ts
import { chromium } from 'playwright';
import { measureComponent, isOversize } from '/Users/tekgadgt/projects/cssdaily.dev/scripts/measure';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 600, height: 400 });

// Fixture 1: oversize width
await page.setContent('<body style="margin:0;padding:20px"><div style="width:550px;height:100px"></div></body>');
const a = await measureComponent(page);
console.log('fixture 1:', a, 'oversize:', isOversize(a));
if (a.width !== 550 || a.height !== 100 || !isOversize(a)) { console.error('FAIL fixture 1'); process.exit(1); }

// Fixture 2: fits, two siblings (union box)
await page.setContent('<body style="margin:0;padding:20px"><div style="width:200px;height:80px"></div><div style="width:300px;height:50px"></div></body>');
const b = await measureComponent(page);
console.log('fixture 2:', b, 'oversize:', isOversize(b));
if (b.width !== 300 || b.height !== 130 || isOversize(b)) { console.error('FAIL fixture 2'); process.exit(1); }

console.log('PASS');
await browser.close();
```

Run:

```bash
npx tsx /tmp/measure-smoke.ts
```

Expected output ends with `PASS`. (Fixture 2: default block layout stacks the divs, so the union is 300 wide × 130 tall.)

- [ ] **Step 3: Commit**

```bash
git add scripts/measure.ts
git commit -m "Add shared Playwright component-size measurement helper"
```

---

### Task 3: Oversize retry loop + semantic HTML in CSS generator

**Files:**
- Modify: `scripts/generate-challenge.ts`

- [ ] **Step 1: Add the semantic HTML line to the system prompt**

In the `STRICT CONSTRAINTS` block of `SYSTEM_PROMPT`, after the line `- Focus on: flexbox, grid, spacing, borders, border-radius, typography (font-size, font-weight, line-height)`, add:

```
- Prefer semantic HTML elements (nav, article, section, header, footer, button, figure, ul/li) over generic divs where they fit naturally
```

- [ ] **Step 2: Restructure generation into a measure-and-retry loop**

Replace the entire contents of `scripts/generate-challenge.ts` body below the `SYSTEM_PROMPT` declaration (the `generateChallenge` and `generateTargetPng` functions) with:

```ts
const MAX_ATTEMPTS = 4; // 1 initial generation + 3 size-fix retries

interface ChallengeFields {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  html: string;
  targetCss: string;
  starterCss: string;
}

function extractChallenge(text: string): ChallengeFields {
  const extract = (tag: string): string => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) throw new Error(`Missing <${tag}> in response:\n${text.substring(0, 500)}`);
    return match[1].trim();
  };

  return {
    title: extract('title'),
    difficulty: extract('difficulty') as 'easy' | 'medium' | 'hard',
    html: extract('html'),
    targetCss: extract('targetcss'),
    starterCss: extract('startercss'),
  };
}

async function generateChallenge(date: string) {
  // Collect recent challenge titles to avoid repeats
  const recentTitles: string[] = [];
  if (fs.existsSync(CHALLENGES_DIR)) {
    const files = fs.readdirSync(CHALLENGES_DIR).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 30);
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, file), 'utf-8'));
        if (data.title) recentTitles.push(data.title);
      } catch {}
    }
  }

  let userPrompt = `Generate a CSS challenge for date ${date}.`;
  if (recentTitles.length > 0) {
    userPrompt += `\n\nRecent challenges (do NOT repeat these themes or similar variations):\n${recentTitles.map((t) => `- ${t}`).join('\n')}`;
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    let fields: ChallengeFields | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages,
        system: SYSTEM_PROMPT,
      });

      const text = (message.content[0] as { type: 'text'; text: string }).text;
      fields = extractChallenge(text);

      // Render the target and measure the component (this render is also
      // reused for the screenshot once the size is accepted)
      await page.setContent(buildScreenshotHtml(fields.html, fields.targetCss), { waitUntil: 'networkidle' });
      const size = await measureComponent(page);

      if (!isOversize(size)) {
        console.log(`Attempt ${attempt}: component is ${size.width}x${size.height}px — OK`);
        break;
      }

      console.warn(`Attempt ${attempt}: component is ${size.width}x${size.height}px (max ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT})`);

      if (attempt === MAX_ATTEMPTS) {
        // Ship it anyway — a slightly clipped challenge beats a missing day
        console.log(`::warning::CSS challenge for ${date} shipped oversize at ${size.width}x${size.height}px after ${MAX_ATTEMPTS} attempts`);
        break;
      }

      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `Your component rendered at ${size.width}x${size.height}px, which exceeds the ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px maximum. Regenerate the challenge with a more compact layout that fits within ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px — reduce padding, font sizes, or element count as needed. Output all the XML tags again in full.`,
      });
    }

    if (!fields) throw new Error('Generation produced no challenge');

    const challenge = {
      title: fields.title,
      difficulty: fields.difficulty,
      target: { html: fields.html, css: fields.targetCss },
      starter: { html: fields.html, css: fields.starterCss },
      date,
      timeLimit: fields.difficulty === 'easy' ? 300 : fields.difficulty === 'hard' ? 900 : 600,
    };

    // Save JSON
    fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
    const jsonPath = path.join(CHALLENGES_DIR, `${date}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
    console.log(`Saved challenge JSON: ${jsonPath}`);

    // Screenshot the already-rendered accepted attempt
    fs.mkdirSync(TARGETS_DIR, { recursive: true });
    const pngPath = path.join(TARGETS_DIR, `${date}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    console.log(`Saved target PNG: ${pngPath}`);
  } finally {
    await browser.close();
  }
}
```

Update the imports at the top of the file:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildScreenshotHtml } from '../src/utils/code';
import { measureComponent, isOversize, MAX_COMPONENT_WIDTH, MAX_COMPONENT_HEIGHT } from './measure';
```

Keep the existing CLI block at the bottom of the file (the `const date = process.argv[2] || ...` and `generateChallenge(date).then(...)` lines) unchanged.

- [ ] **Step 3: Type-check**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no errors. (If the project tsconfig doesn't cover `scripts/`, run `npx tsc --noEmit scripts/generate-challenge.ts --module esnext --moduleResolution bundler --target es2022 --skipLibCheck` instead and expect no errors.)

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-challenge.ts
git commit -m "Add oversize measure-and-retry loop and semantic HTML guidance to CSS generator"
```

---

### Task 4: Oversize retry loop + semantic HTML in Tailwind generator

**Files:**
- Modify: `scripts/generate-tailwind-challenge.ts`

- [ ] **Step 1: Add the semantic HTML line to the system prompt**

In the `STRICT CONSTRAINTS` block of `SYSTEM_PROMPT`, after the line `- Focus on: flexbox, grid, spacing, borders, border-radius, typography, colors`, add:

```
- Prefer semantic HTML elements (nav, article, section, header, footer, button, figure, ul/li) over generic divs where they fit naturally
```

- [ ] **Step 2: Restructure generation into a measure-and-retry loop**

Replace the `generateChallenge` and `generateTargetPng` functions in `scripts/generate-tailwind-challenge.ts` with:

```ts
const MAX_ATTEMPTS = 4; // 1 initial generation + 3 size-fix retries

interface TailwindChallengeFields {
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  targetHtml: string;
  starterHtml: string;
}

function extractChallenge(text: string): TailwindChallengeFields {
  const extract = (tag: string): string => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) throw new Error(`Missing <${tag}> in response:\n${text.substring(0, 500)}`);
    return match[1].trim();
  };

  return {
    title: extract('title'),
    difficulty: extract('difficulty') as 'easy' | 'medium' | 'hard',
    targetHtml: extract('targethtml'),
    starterHtml: extract('starterhtml'),
  };
}

async function generateChallenge(date: string) {
  const recentTitles: string[] = [];
  if (fs.existsSync(CHALLENGES_DIR)) {
    const files = fs.readdirSync(CHALLENGES_DIR).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 30);
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, file), 'utf-8'));
        if (data.title) recentTitles.push(data.title);
      } catch {}
    }
  }

  let userPrompt = `Generate a Tailwind CSS challenge for date ${date}.`;
  if (recentTitles.length > 0) {
    userPrompt += `\n\nRecent challenges (do NOT repeat these themes or similar variations):\n${recentTitles.map((t) => `- ${t}`).join('\n')}`;
  }

  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];

  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    let fields: TailwindChallengeFields | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages,
        system: SYSTEM_PROMPT,
      });

      const text = (message.content[0] as { type: 'text'; text: string }).text;
      fields = extractChallenge(text);

      await page.setContent(buildTailwindScreenshotHtml(fields.targetHtml), { waitUntil: 'networkidle' });
      const size = await measureComponent(page);

      if (!isOversize(size)) {
        console.log(`Attempt ${attempt}: component is ${size.width}x${size.height}px — OK`);
        break;
      }

      console.warn(`Attempt ${attempt}: component is ${size.width}x${size.height}px (max ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT})`);

      if (attempt === MAX_ATTEMPTS) {
        console.log(`::warning::Tailwind challenge for ${date} shipped oversize at ${size.width}x${size.height}px after ${MAX_ATTEMPTS} attempts`);
        break;
      }

      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: `Your component rendered at ${size.width}x${size.height}px, which exceeds the ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px maximum. Regenerate the challenge with a more compact layout that fits within ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT}px — reduce padding, text sizes, or element count as needed. Output all the XML tags again in full.`,
      });
    }

    if (!fields) throw new Error('Generation produced no challenge');

    const challenge = {
      title: fields.title,
      difficulty: fields.difficulty,
      date,
      timeLimit: fields.difficulty === 'easy' ? 300 : fields.difficulty === 'hard' ? 900 : 600,
      starter: { html: fields.starterHtml },
      target: { html: fields.targetHtml },
    };

    fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
    const jsonPath = path.join(CHALLENGES_DIR, `${date}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
    console.log(`Saved Tailwind challenge JSON: ${jsonPath}`);

    fs.mkdirSync(TARGETS_DIR, { recursive: true });
    const pngPath = path.join(TARGETS_DIR, `${date}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    console.log(`Saved Tailwind target PNG: ${pngPath}`);
  } finally {
    await browser.close();
  }
}
```

Update the imports at the top of the file:

```ts
import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildTailwindScreenshotHtml } from '../src/utils/code';
import { measureComponent, isOversize, MAX_COMPONENT_WIDTH, MAX_COMPONENT_HEIGHT } from './measure';
```

Keep the existing CLI block at the bottom unchanged.

Note: the Tailwind screenshot HTML loads the Tailwind CDN, so `waitUntil: 'networkidle'` matters here — it already matches the existing behavior.

- [ ] **Step 3: Type-check**

Run:

```bash
npx tsc --noEmit -p tsconfig.json
```

Expected: no errors (same fallback as Task 3 Step 3 if `scripts/` isn't covered).

- [ ] **Step 4: Commit**

```bash
git add scripts/generate-tailwind-challenge.ts
git commit -m "Add oversize measure-and-retry loop and semantic HTML guidance to Tailwind generator"
```

---

### Task 5: End-to-end verification with a throwaway date

Requires `ANTHROPIC_API_KEY` in the environment (a few Sonnet calls, ~$0.05). If no key is available locally, skip and verify via a `workflow_dispatch` run of the Generate Daily Challenge action instead — but do not merge unverified.

- [ ] **Step 1: Run both generators for a sentinel date**

```bash
npx tsx scripts/generate-challenge.ts 2099-01-01
npx tsx scripts/generate-tailwind-challenge.ts 2099-01-01
```

Expected: each prints `Attempt N: component is WxHpx — OK` (almost always attempt 1), then `Saved challenge JSON` / `Saved ... target PNG`, then `CHALLENGE_DATE=2099-01-01`. The logged W×H must be ≤ 520×320 unless an `::warning::` line says it shipped oversize.

- [ ] **Step 2: Inspect the artifacts**

```bash
cat src/data/challenges/2099-01-01.json | head -20
open public/targets/2099-01-01.png
open public/targets/tailwind/2099-01-01.png
```

Expected: valid JSON with title/difficulty/starter/target; PNGs show the full component unclipped, with any emoji rendered in Noto Color Emoji (flat Google) style.

- [ ] **Step 3: Delete the sentinel artifacts**

```bash
rm src/data/challenges/2099-01-01.json src/data/tailwind-challenges/2099-01-01.json
rm public/targets/2099-01-01.png public/targets/tailwind/2099-01-01.png
git status
```

Expected: `git status` shows a clean tree (nothing staged or untracked from the sentinel run).

- [ ] **Step 4: Final build check and verify clean state**

```bash
npm run build
git log --oneline -5
```

Expected: build succeeds; the log shows the three commits from Tasks 1–4 on top.
