import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildScreenshotHtml } from '../src/utils/code';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets');

const SYSTEM_PROMPT = `You are a CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained CSS challenge that users will try to replicate.

STRICT CONSTRAINTS:
- NO font-family declarations (Inter font is loaded by the environment)
- NO box-shadow or text-shadow (inconsistent rendering)
- NO background-image, url(), or external assets
- ALL colors must be defined as :root CSS custom properties with var() references
- Component must fit within 560x360px (20px margin from 600x400 viewport)
- Max width ~320px, max height ~340px
- Body background is always #f5f5f5 (set by environment)
- Focus on: flexbox, grid, spacing, borders, border-radius, typography (font-size, font-weight, line-height)

OUTPUT FORMAT (JSON):
{
  "title": "Challenge Name",
  "difficulty": "easy|medium|hard",
  "target": {
    "html": "<div>...</div>",
    "css": ":root { --primary: #xxx; } .class { ... }"
  },
  "starter": {
    "html": "<div>...</div>",
    "css": ":root { --primary: #xxx; }\\n.class { }\\n..."
  }
}

The starter HTML must be IDENTICAL to target HTML.
The starter CSS must include the same :root block with ALL variables, plus empty selector stubs for each class used.
Generate creative, visually interesting components like cards, badges, buttons, navbars, pricing tables, etc.`;

async function generateChallenge(date: string) {
  const client = new Anthropic();

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Generate a CSS challenge for date ${date}. Return ONLY valid JSON, no markdown.`,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const text = (message.content[0] as { type: 'text'; text: string }).text;
  const challenge = JSON.parse(text);
  challenge.date = date;
  challenge.timeLimit = challenge.difficulty === 'easy' ? 300 : challenge.difficulty === 'hard' ? 900 : 600;

  // Save JSON
  fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
  const jsonPath = path.join(CHALLENGES_DIR, `${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
  console.log(`Saved challenge JSON: ${jsonPath}`);

  // Generate target screenshot
  await generateTargetPng(challenge);
}

async function generateTargetPng(challenge: any) {
  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 600, height: 400 });

  const html = buildScreenshotHtml(challenge.target.html, challenge.target.css);
  await page.setContent(html, { waitUntil: 'networkidle' });

  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  const pngPath = path.join(TARGETS_DIR, `${challenge.date}.png`);
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`Saved target PNG: ${pngPath}`);

  await browser.close();
}

// CLI
const date = process.argv[2] || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

generateChallenge(date).catch(console.error);
