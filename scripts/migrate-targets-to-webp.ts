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
  let removedPng = 0;
  let alreadyWebp = 0;

  for (const dir of TARGET_DIRS) {
    if (!fs.existsSync(dir)) continue;

    const pngs = fs.readdirSync(dir).filter((file) => file.endsWith('.png'));
    for (const file of pngs) {
      const pngPath = path.join(dir, file);
      const webpPath = pngPath.replace(/\.png$/, '.webp');

      if (fs.existsSync(webpPath)) {
        alreadyWebp++;
      } else {
        const webp = await encodeWebpLossless(fs.readFileSync(pngPath));
        fs.writeFileSync(webpPath, webp);
        converted++;
      }

      fs.unlinkSync(pngPath);
      removedPng++;
    }
  }

  console.log(`Images: converted ${converted}, removed ${removedPng} PNGs, found ${alreadyWebp} existing WebPs`);
}

function updateChallengeJson() {
  let updated = 0;

  for (const dir of CHALLENGE_DIRS) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.json'));
    for (const file of files) {
      const jsonPath = path.join(dir, file);
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const hadTrailingNewline = raw.endsWith('\n');
      const challenge = JSON.parse(raw);
      const current = challenge.targetImage ?? `${challenge.date}.png`;
      const next = current.replace(/\.png$/, '.webp');

      if (challenge.targetImage !== next) {
        challenge.targetImage = next;
        fs.writeFileSync(jsonPath, JSON.stringify(challenge, null, 2) + (hadTrailingNewline ? '\n' : ''));
        updated++;
      }
    }
  }

  console.log(`JSON: updated targetImage on ${updated} challenges`);
}

await convertImages();
updateChallengeJson();
console.log('Migration complete.');
