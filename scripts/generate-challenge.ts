import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import 'dotenv/config'
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildScreenshotHtml } from '../src/utils/code';
import { encodeWebpLossless } from './webp';
import { measureComponent, isOversize, MAX_COMPONENT_WIDTH, MAX_COMPONENT_HEIGHT } from './measure';
import type { Difficulty } from '../src/utils/types';
import { TIME_LIMITS } from '../src/utils/difficulty';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets');

const SYSTEM_PROMPT = `You are a CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained CSS challenge that users will try to replicate. The user prompt names the target difficulty — calibrate the challenge to it.

STRICT CONSTRAINTS:
- NO font-family declarations (Inter and Noto Color Emoji fonts are loaded and set by the environment)
- NO box-shadow or text-shadow (inconsistent rendering)
- NO background-image, url(), or external assets
- ALL colors must be defined as :root CSS custom properties with var() references
- Component must not exceed 520x320px (hard max within 600x400 viewport)
- Body background is always #f5f5f5 (set by environment)
- Focus on: flexbox, grid, spacing, borders, border-radius, typography (font-size, font-weight, line-height)
- Prefer semantic HTML elements (nav, article, section, header, footer, button, figure, ul/li) over generic divs where they fit naturally

SIZING STRATEGY (viewport is 600x400, body has 20px padding on all sides):
- Your size budget is 520x320px — the same hard max as above. Design toward ~480x280 so you never brush the limit.
- Height is the tight dimension — keep components SHORT. Max ~6-8 visible elements stacked vertically.
- Width is generous — use it. Prefer side-by-side layouts (flexbox row, grid columns) over tall single-column stacks.
- Use compact spacing: small/medium padding (8-16px), tight margins/gaps (4-12px). Avoid large spacing values.
- Keep text sizes modest: body text 14px, headings 18-24px max. No hero-sized text.

DIFFICULTY CRITERIA (the size budget always applies — hard means denser, not bigger):
- easy: 3-5 elements, one flex container, ~8-15 CSS properties in the target, 2-3 colors. A single small card, badge, button group, or alert.
- medium: 6-9 elements, nested flexbox or a simple grid, ~16-30 properties, 3-5 colors. Cards with header/body/footer, profile rows, pricing blocks.
- hard: 10-14 elements, grid AND nested flex, ~30-50 properties, 5+ colors, varied border-radius and typography. Dashboard widgets, media players, stat panels.

OUTPUT FORMAT — use these exact XML tags (no JSON, no code fences):

<title>Challenge Name</title>
<html>The HTML markup (shared by target and starter)</html>
<targetcss>The complete target CSS with all properties</targetcss>
<startercss>The starter CSS: same :root block with all variables, plus empty selector stubs</startercss>

The starter CSS must include the same :root block with ALL variables, plus empty selector stubs for each class/element used in the target CSS.
Generate creative, visually interesting components like cards, badges, buttons, navbars, pricing tables, etc.`;

const MAX_ATTEMPTS = 4; // 1 initial generation + 3 size-fix retries

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

interface ChallengeFields {
  title: string;
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
    html: extract('html'),
    targetCss: extract('targetcss'),
    starterCss: extract('startercss'),
  };
}

function collectRecentTitles(): string[] {
  const titles: string[] = [];
  if (fs.existsSync(CHALLENGES_DIR)) {
    // 90 files ≈ 30 days now that each day produces three challenges
    const files = fs.readdirSync(CHALLENGES_DIR).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 90);
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, file), 'utf-8'));
        if (data.title) titles.push(data.title);
      } catch {}
    }
  }
  return titles;
}

/** Generate one challenge at the given difficulty. Returns its title (fed into later calls' avoid-list). */
async function generateOne(
  client: Anthropic,
  page: import('playwright').Page,
  date: string,
  difficulty: Difficulty,
  avoidTitles: string[]
): Promise<string> {
  let userPrompt = `Generate a ${difficulty} CSS challenge for date ${date}.`;
  if (avoidTitles.length > 0) {
    userPrompt += `\n\nRecent challenges (do NOT repeat these themes or similar variations):\n${avoidTitles.map((t) => `- ${t}`).join('\n')}`;
  }

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userPrompt }];
  let fields: ChallengeFields | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // Hard challenges (full target CSS + starter CSS + HTML) brushed the
      // old 4000 cap in production (2026-06-13: two truncated responses)
      max_tokens: 8000,
      messages,
      system: SYSTEM_PROMPT,
    });

    const block = message.content[0];
    if (!block || block.type !== 'text') {
      throw new Error(`Unexpected response content on attempt ${attempt}: ${JSON.stringify(message.content).substring(0, 200)}`);
    }
    const text = block.text;

    // A truncated response would fail extraction anyway, but with a
    // misleading missing-tags retry message — the model would regenerate at
    // the same length and truncate again. Tell it the real problem.
    if (message.stop_reason === 'max_tokens') {
      console.warn(`[${difficulty}] Attempt ${attempt}: response truncated at the token limit`);
      if (attempt === MAX_ATTEMPTS) throw new Error(`Response truncated at the token limit on final attempt`);
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: 'Your previous response was cut off before completing. Regenerate the challenge more compactly — fewer elements and terser CSS — and output ALL the XML tags in full.',
      });
      continue;
    }

    let parsed: ChallengeFields;
    try {
      parsed = extractChallenge(text);
    } catch (err) {
      console.warn(`[${difficulty}] Attempt ${attempt}: failed to parse response — ${(err as Error).message}`);
      if (attempt === MAX_ATTEMPTS) throw err;
      messages.push({ role: 'assistant', content: text });
      messages.push({
        role: 'user',
        content: 'Your previous response was missing required XML tags. Output the complete challenge again with ALL of these tags: <title>, <html>, <targetcss>, <startercss>.',
      });
      continue;
    }

    // Render the target and measure the component (this render is also
    // reused for the screenshot once the size is accepted)
    await page.setContent(buildScreenshotHtml(parsed.html, parsed.targetCss), { waitUntil: 'networkidle' });
    // Only assign fields after a successful render so fields, the rendered
    // page, and the eventual screenshot always correspond to the same attempt.
    fields = parsed;
    const size = await measureComponent(page);

    if (!isOversize(size)) {
      console.log(`[${difficulty}] Attempt ${attempt}: component is ${size.width}x${size.height}px — OK`);
      break;
    }

    console.warn(`[${difficulty}] Attempt ${attempt}: component is ${size.width}x${size.height}px (max ${MAX_COMPONENT_WIDTH}x${MAX_COMPONENT_HEIGHT})`);

    if (attempt === MAX_ATTEMPTS) {
      // Ship it anyway — a slightly clipped challenge beats a missing day
      console.log(`::warning::CSS ${difficulty} challenge for ${date} shipped oversize at ${size.width}x${size.height}px after ${MAX_ATTEMPTS} attempts`);
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
    difficulty,
    target: { html: fields.html, css: fields.targetCss },
    starter: { html: fields.html, css: fields.starterCss },
    date,
    timeLimit: TIME_LIMITS[difficulty],
    targetImage: `${date}-${difficulty}.webp`,
  };

  // Screenshot the last rendered attempt (accepted, or shipped-anyway
  // oversize) BEFORE writing the JSON: a screenshot failure must not leave
  // an orphan JSON whose target image 404s on the site. An orphan WebP is
  // harmless (nothing references it).
  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  const png = await page.screenshot({ type: 'png' });
  const webpPath = path.join(TARGETS_DIR, `${date}-${difficulty}.webp`);
  fs.writeFileSync(webpPath, await encodeWebpLossless(png));
  console.log(`Saved target WebP: ${webpPath}`);

  fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
  const jsonPath = path.join(CHALLENGES_DIR, `${date}-${difficulty}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
  console.log(`Saved challenge JSON: ${jsonPath}`);

  return fields.title;
}

async function generateChallenge(date: string) {
  const client = new Anthropic();

  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    const recentTitles = collectRecentTitles();
    const todaysTitles: string[] = [];
    const failures: Difficulty[] = [];

    for (const difficulty of DIFFICULTIES) {
      try {
        const title = await generateOne(client, page, date, difficulty, [...todaysTitles, ...recentTitles]);
        todaysTitles.push(title);
      } catch (err) {
        console.error(`[${difficulty}] generation failed:`, err);
        console.log(`::warning::CSS ${difficulty} challenge generation failed for ${date}`);
        failures.push(difficulty);
      }
    }

    if (failures.length === DIFFICULTIES.length) {
      throw new Error(`All ${DIFFICULTIES.length} difficulty generations failed for ${date}`);
    }
    if (failures.length > 0) {
      console.warn(`Completed with failures: ${failures.join(', ')}`);
    }
  } finally {
    await browser.close();
  }
}

// CLI — defaults to tomorrow's date so the cron generates ahead of time
const date = process.argv[2] || (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

generateChallenge(date).then(() => {
  // Write date to stdout for CI to capture
  console.log(`CHALLENGE_DATE=${date}`);
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
