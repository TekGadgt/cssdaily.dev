import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { buildScreenshotHtml } from '../src/utils/code';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets');

async function generateTargets() {
  const files = fs.readdirSync(CHALLENGES_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('No challenge JSON files found.');
    return;
  }

  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch({
    ...(chromiumPath ? { executablePath: chromiumPath } : {}),
  });

  fs.mkdirSync(TARGETS_DIR, { recursive: true });

  for (const file of files) {
    const challenge = JSON.parse(fs.readFileSync(path.join(CHALLENGES_DIR, file), 'utf-8'));
    const page = await browser.newPage();
    await page.setViewportSize({ width: 600, height: 400 });

    const html = buildScreenshotHtml(challenge.target.html, challenge.target.css);
    await page.setContent(html, { waitUntil: 'networkidle' });

    const pngPath = path.join(TARGETS_DIR, `${challenge.date}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    console.log(`Generated: ${pngPath}`);

    await page.close();
  }

  await browser.close();
  console.log('Done!');
}

generateTargets().catch(console.error);
