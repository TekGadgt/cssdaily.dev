import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildScreenshotHtml } from '../src/utils/code';
import { measureComponent, isOversize, MAX_COMPONENT_WIDTH, MAX_COMPONENT_HEIGHT } from './measure';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets');

const SYSTEM_PROMPT = `You are a CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained CSS challenge that users will try to replicate.

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
- Available canvas: 560x360px. Component must fit comfortably within this.
- Height is the tight dimension — keep components SHORT. Max ~6-8 visible elements stacked vertically.
- Width is generous — use it. Prefer side-by-side layouts (flexbox row, grid columns) over tall single-column stacks.
- Use compact spacing: small/medium padding (8-16px), tight margins/gaps (4-12px). Avoid large spacing values.
- Keep text sizes modest: body text 14px, headings 18-24px max. No hero-sized text.

OUTPUT FORMAT — use these exact XML tags (no JSON, no code fences):

<title>Challenge Name</title>
<difficulty>easy|medium|hard</difficulty>
<html>The HTML markup (shared by target and starter)</html>
<targetcss>The complete target CSS with all properties</targetcss>
<startercss>The starter CSS: same :root block with all variables, plus empty selector stubs</startercss>

The starter CSS must include the same :root block with ALL variables, plus empty selector stubs for each class/element used in the target CSS.
Generate creative, visually interesting components like cards, badges, buttons, navbars, pricing tables, etc.`;

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

      const block = message.content[0];
      if (!block || block.type !== 'text') {
        throw new Error(`Unexpected response content on attempt ${attempt}: ${JSON.stringify(message.content).substring(0, 200)}`);
      }
      const text = block.text;

      let parsed: ChallengeFields;
      try {
        parsed = extractChallenge(text);
      } catch (err) {
        console.warn(`Attempt ${attempt}: failed to parse response — ${(err as Error).message}`);
        if (attempt === MAX_ATTEMPTS) throw err;
        messages.push({ role: 'assistant', content: text });
        messages.push({
          role: 'user',
          content: 'Your previous response was missing required XML tags. Output the complete challenge again with ALL of these tags: <title>, <difficulty>, <html>, <targetcss>, <startercss>.',
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

    // Screenshot the last rendered attempt (accepted, or shipped-anyway oversize)
    fs.mkdirSync(TARGETS_DIR, { recursive: true });
    const pngPath = path.join(TARGETS_DIR, `${date}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    console.log(`Saved target PNG: ${pngPath}`);
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
