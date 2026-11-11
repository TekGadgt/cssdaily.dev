/**
 * Hosting smoke check: asserts the deployed site behaves the same on every
 * host it has lived on (GitHub Pages, local `wrangler dev`, workers.dev,
 * production behind the Worker route).
 *
 *   npm run smoke -- <baseUrl> [--expect-origin=github|worker] [--check-www] [--no-browser]
 *
 * HTTP checks prove the right documents and status codes are served; browser
 * checks prove the JavaScript redirects in ChallengeRedirect.astro actually
 * land on a rendered challenge (the HTTP layer only sees their payload).
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHALLENGES_DIR = path.join(__dirname, '..', 'src', 'data', 'challenges');
const TARGETS_DIR = path.join(__dirname, '..', 'public', 'targets');

const CHALLENGE_FILE_RE = /^(\d{4}-\d{2}-\d{2})(?:-(?:easy|medium|hard))?\.json$/;
const REDIRECT_MARKER = 'id="redirect-data"';
const BEACON_SRC = 'static.cloudflareinsights.com/beacon.min.js';
const WORKER_MARKER = 'cssdaily-worker';
const PRODUCTION_WWW = 'https://www.cssdaily.dev';
const PRODUCTION_APEX = 'https://cssdaily.dev';

/**
 * Latest CSS challenge dated on or before `today` that has a matching target
 * image. Dates are YYYY-MM-DD and compared as strings. Pure, for testing.
 */
export function pickSmokeTargets(
  cssFiles: string[],
  targetFiles: string[],
  today: string
): { date: string; image: string } {
  const images = new Set(targetFiles);
  const candidates: { date: string; image: string }[] = [];
  for (const file of cssFiles) {
    const match = CHALLENGE_FILE_RE.exec(file);
    if (!match || match[1] > today) continue;
    const image = file.replace(/\.json$/, '.webp');
    if (images.has(image)) candidates.push({ date: match[1], image });
  }
  if (candidates.length === 0) {
    throw new Error(`No challenge with a target image on or before ${today}`);
  }
  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.image.localeCompare(b.image));
  return candidates[0];
}

interface Options {
  baseUrl: string;
  expectOrigin: 'github' | 'worker' | null;
  checkWww: boolean;
  browser: boolean;
}

function parseArgs(argv: string[]): Options {
  const positional = argv.filter((a) => !a.startsWith('--'));
  if (positional.length !== 1) {
    throw new Error('Usage: npm run smoke -- <baseUrl> [--expect-origin=github|worker] [--check-www] [--no-browser]');
  }
  const base = new URL(positional[0]);
  let expectOrigin: Options['expectOrigin'] = null;
  for (const arg of argv.filter((a) => a.startsWith('--'))) {
    if (arg === '--check-www' || arg === '--no-browser') continue;
    const m = /^--expect-origin=(github|worker)$/.exec(arg);
    if (!m) throw new Error(`Unknown option ${arg}`);
    expectOrigin = m[1] as 'github' | 'worker';
  }
  return {
    baseUrl: base.origin,
    expectOrigin,
    checkWww: argv.includes('--check-www'),
    browser: !argv.includes('--no-browser'),
  };
}

const utcDate = (offsetDays = 0) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const countOccurrences = (text: string, needle: string) => text.split(needle).length - 1;

type Check = { name: string; run: () => Promise<void> };

function assert(condition: unknown, detail: string): asserts condition {
  if (!condition) throw new Error(detail);
}

function httpChecks(opts: Options, date: string, image: string): Check[] {
  const { baseUrl } = opts;
  const get = (p: string) => fetch(new URL(p, baseUrl), { redirect: 'manual' });
  const expectBody = async (p: string, status: number, needle?: string) => {
    const res = await get(p);
    assert(res.status === status, `${p}: expected ${status}, got ${res.status}`);
    const body = await res.text();
    if (needle) assert(body.includes(needle), `${p}: body lacks ${needle}`);
    return { res, body };
  };

  const checks: Check[] = [
    { name: '1 / serves redirect stub', run: async () => { await expectBody('/', 200, REDIRECT_MARKER); } },
    { name: '2 /tailwind/ serves redirect stub', run: async () => { await expectBody('/tailwind/', 200, REDIRECT_MARKER); } },
    { name: '3 /about/ serves', run: async () => { await expectBody('/about/', 200); } },
    { name: `4 /challenge/${date}/ serves`, run: async () => { await expectBody(`/challenge/${date}/`, 200, date); } },
    {
      name: '5 missing trailing slash redirects same-origin',
      run: async () => {
        const reqUrl = new URL(`/challenge/${date}`, baseUrl);
        const res = await fetch(reqUrl, { redirect: 'manual' });
        assert(res.status >= 300 && res.status < 400, `expected 3xx, got ${res.status}`);
        const location = res.headers.get('location');
        assert(location, 'no Location header');
        const resolved = new URL(location, reqUrl).href;
        const expected = new URL(`/challenge/${date}/`, baseUrl).href;
        assert(resolved === expected, `Location ${resolved} !== ${expected}`);
      },
    },
    { name: '6 future date serves 404 page in place', run: async () => { await expectBody('/challenge/2099-01-01/', 404, REDIRECT_MARKER); } },
    { name: '7 unknown path serves 404 page in place', run: async () => { await expectBody('/definitely-not-a-page', 404, REDIRECT_MARKER); } },
    {
      name: `8 target image ${image}`,
      run: async () => {
        const res = await get(`/targets/${image}`);
        assert(res.status === 200, `expected 200, got ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        assert(type.startsWith('image/webp'), `content-type ${type}`);
      },
    },
    {
      name: '11 analytics beacon: one on /about/, none on the bare stub',
      run: async () => {
        const about = await (await get('/about/')).text();
        const stub = await (await get('/')).text();
        assert(countOccurrences(about, BEACON_SRC) === 1, `/about/ has ${countOccurrences(about, BEACON_SRC)} beacons`);
        assert(countOccurrences(stub, BEACON_SRC) === 0, `/ has ${countOccurrences(stub, BEACON_SRC)} beacons`);
      },
    },
  ];

  if (opts.expectOrigin) {
    const origin = opts.expectOrigin;
    checks.push({
      name: `9 served by ${origin}`,
      run: async () => {
        const res = await get('/');
        const github = res.headers.has('x-github-request-id');
        const worker = res.headers.get('x-hosted-by') === WORKER_MARKER;
        if (origin === 'github') assert(github && !worker, `x-github-request-id=${github}, x-hosted-by=${worker}`);
        else assert(worker && !github, `x-hosted-by=${worker}, x-github-request-id=${github}`);
      },
    });
  }

  if (opts.checkWww) {
    checks.push({
      name: '10 www redirects to apex with path and query',
      run: async () => {
        const res = await fetch(`${PRODUCTION_WWW}/challenge/${date}/?s=1`, { redirect: 'manual' });
        assert(res.status === 301, `expected 301, got ${res.status}`);
        const expected = `${PRODUCTION_APEX}/challenge/${date}/?s=1`;
        assert(res.headers.get('location') === expected, `Location ${res.headers.get('location')} !== ${expected}`);
      },
    });
  }

  return checks;
}

async function browserChecks(opts: Options, date: string): Promise<{ checks: Check[]; close: () => Promise<void> }> {
  const { chromium } = await import('playwright');
  const chromiumPath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(chromiumPath ? { executablePath: chromiumPath } : {});
  const origin = new URL(opts.baseUrl).origin;
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const finalUrlRe = new RegExp(`^${escaped}/(challenge|tailwind)/(\\d{4}-\\d{2}-\\d{2})/$`);
  const latestAllowed = utcDate(1); // the redirect uses the browser's local date

  const visit = (start: string, mode: 'challenge' | 'tailwind', exactDate?: string): Check => ({
    name: `B ${start} → rendered ${mode}`,
    run: async () => {
      // Fresh context per visit: stored results would change what renders
      const context = await browser.newContext();
      const page = await context.newPage();
      const failures: string[] = [];
      page.on('pageerror', (err) => failures.push(`pageerror: ${err.message}`));
      page.on('response', (res) => {
        // The first document of a 404-start visit is expected to be a 404
        if (res.request().resourceType() === 'document') return;
        if (new URL(res.url()).origin === origin && res.status() >= 400) {
          failures.push(`${res.status()} ${res.url()}`);
        }
      });
      try {
        await page.goto(new URL(start, opts.baseUrl).href);
        await page.waitForURL(finalUrlRe, { timeout: 15_000 });
        const [, finalMode, finalDate] = finalUrlRe.exec(page.url())!;
        assert(finalMode === mode, `landed on ${page.url()}, expected mode ${mode}`);
        assert(finalDate <= latestAllowed, `landed on future date ${finalDate}`);
        if (exactDate) assert(finalDate === exactDate, `landed on ${finalDate}, expected ${exactDate}`);
        // Day pages render every difficulty's player and hide all but one
        await page.locator('.cm-editor').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
        // Let late subresources (target image) settle before judging failures
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        assert(failures.length === 0, failures.join('; '));
      } finally {
        await context.close();
      }
    },
  });

  return {
    checks: [
      visit('/', 'challenge'),
      visit('/tailwind/', 'tailwind'),
      visit('/challenge/2099-01-01/', 'challenge'),
      visit('/tailwind/2099-01-01/', 'tailwind'),
      visit('/definitely-not-a-page', 'challenge'),
      visit(`/challenge/${date}/`, 'challenge', date),
    ],
    close: () => browser.close(),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { date, image } = pickSmokeTargets(
    fs.readdirSync(CHALLENGES_DIR),
    fs.readdirSync(TARGETS_DIR),
    utcDate()
  );
  console.log(`Smoke-checking ${opts.baseUrl} (challenge ${date}, image ${image})`);

  const checks = httpChecks(opts, date, image);
  const browser = opts.browser ? await browserChecks(opts, date) : null;
  if (browser) checks.push(...browser.checks);

  let failed = 0;
  try {
    for (const check of checks) {
      try {
        await check.run();
        console.log(`PASS ${check.name}`);
      } catch (err) {
        failed++;
        console.log(`FAIL ${check.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    await browser?.close();
  }

  console.log(failed === 0 ? `All ${checks.length} checks passed` : `${failed} of ${checks.length} checks failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
