import Anthropic from '@anthropic-ai/sdk';
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildTailwindScreenshotHtml } from '../src/utils/code';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'tailwind-challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets', 'tailwind');

const SYSTEM_PROMPT = `You are a Tailwind CSS challenge generator for a "Wordle for CSS" game. Generate a self-contained Tailwind challenge where users add utility classes to HTML elements to match a target design.

STRICT CONSTRAINTS:
- ONLY Tailwind utility classes, NO custom CSS
- Every HTML element MUST have a class attribute
- Component must not exceed 520x320px (hard max within 600x400 viewport)
- Body background is always #f5f5f5 (set by environment)
- Use Tailwind's built-in color palette (no custom colors)
- Focus on: flexbox, grid, spacing, borders, border-radius, typography, colors
- NO box-shadow, text-shadow, or background-image utilities
- NO font-family declarations (Inter font is loaded by the environment)
- The starter HTML and target HTML must have the SAME structure — only class values differ
- Starter HTML has class="" (empty) on every element
- Target HTML has the correct Tailwind utility classes

OUTPUT FORMAT — use these exact XML tags (no JSON, no code fences):

<title>Challenge Name</title>
<difficulty>easy|medium|hard</difficulty>
<targethtml>The target HTML with correct Tailwind classes on every element</targethtml>
<starterhtml>The starter HTML with class="" (empty) on every element</starterhtml>

Generate creative, visually interesting components like cards, badges, buttons, navbars, pricing tables, profile cards, etc.`;

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

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: userPrompt,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  const text = (message.content[0] as { type: 'text'; text: string }).text;

  const extract = (tag: string): string => {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
    if (!match) throw new Error(`Missing <${tag}> in response:\n${text.substring(0, 500)}`);
    return match[1].trim();
  };

  const title = extract('title');
  const difficulty = extract('difficulty') as 'easy' | 'medium' | 'hard';
  const targetHtml = extract('targethtml');
  const starterHtml = extract('starterhtml');

  const challenge = {
    title,
    difficulty,
    date,
    timeLimit: difficulty === 'easy' ? 300 : difficulty === 'hard' ? 900 : 600,
    starter: { html: starterHtml },
    target: { html: targetHtml },
  };

  fs.mkdirSync(CHALLENGES_DIR, { recursive: true });
  const jsonPath = path.join(CHALLENGES_DIR, `${date}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2));
  console.log(`Saved Tailwind challenge JSON: ${jsonPath}`);

  await generateTargetPng(challenge);
}

async function generateTargetPng(challenge: any) {
  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  const page = await browser.newPage();
  await page.setViewportSize({ width: 600, height: 400 });

  const html = buildTailwindScreenshotHtml(challenge.target.html);
  await page.setContent(html, { waitUntil: 'networkidle' });

  fs.mkdirSync(TARGETS_DIR, { recursive: true });
  const pngPath = path.join(TARGETS_DIR, `${challenge.date}.png`);
  await page.screenshot({ path: pngPath, type: 'png' });
  console.log(`Saved Tailwind target PNG: ${pngPath}`);

  await browser.close();
}

const date = process.argv[2] || (() => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

generateChallenge(date).then(() => {
  console.log(`CHALLENGE_DATE=${date}`);
}).catch(console.error);
