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
import { assetBase } from './data-pull';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Written by `npm run data:pull`; the challenge data no longer lives in the repo
const DATA_DIR = path.join(__dirname, '..', '.data', 'challenges');

const LEGACY_IMAGE_RE = /^\d{4}-\d{2}-\d{2}\.webp$/;
const REDIRECT_MARKER = 'id="redirect-data"';
const BEACON_SRC = 'static.cloudflareinsights.com/beacon.min.js';
const WORKER_MARKER = 'cssdaily-worker';
const PRODUCTION_WWW = 'https://www.cssdaily.dev';
const PRODUCTION_APEX = 'https://cssdaily.dev';

export interface SmokeChallenge {
  date: string;
  targetImage: string;
}

export interface SmokeImage {
  mode: 'css' | 'tailwind';
  image: string;
}

const latestOnOrBefore = (list: SmokeChallenge[], today: string) =>
  list
    .filter((c) => c.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || a.targetImage.localeCompare(b.targetImage))[0];

/**
 * The CSS challenge date to load (latest on or before `today`, so not a
 * pre-generated future day) plus target images to fetch: that day's CSS
 * image, the latest Tailwind image, and the oldest legacy-named CSS image.
 * Dates are YYYY-MM-DD, compared as strings. Pure, for testing.
 */
export function pickSmokeTargets(
  css: SmokeChallenge[],
  tailwind: SmokeChallenge[],
  today: string
): { date: string; images: SmokeImage[] } {
  const cssPick = latestOnOrBefore(css, today);
  const twPick = latestOnOrBefore(tailwind, today);
  if (!cssPick || !twPick) throw new Error(`No CSS and Tailwind challenges on or before ${today}`);
  const images: SmokeImage[] = [
    { mode: 'css', image: cssPick.targetImage },
    { mode: 'tailwind', image: twPick.targetImage },
  ];
  const legacy = css.filter((c) => LEGACY_IMAGE_RE.test(c.targetImage)).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (legacy) images.push({ mode: 'css', image: legacy.targetImage });
  return { date: cssPick.date, images };
}

function readPulled(mode: 'css' | 'tailwind'): SmokeChallenge[] {
  const dir = path.join(DATA_DIR, mode);
  if (!fs.existsSync(dir)) throw new Error('No challenge data in .data/ — run "npm run data:pull" first');
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as SmokeChallenge);
}

interface Options {
  baseUrl: string;
  /** Origin target images are served from (PUBLIC_ASSET_BASE rule, as the site uses) */
  assetBase: string;
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
    assetBase: assetBase(),
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

function httpChecks(opts: Options, date: string, images: SmokeImage[]): Check[] {
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
    ...images.map(({ mode, image }): Check => ({
      name: `8 target image ${mode}/${image}`,
      run: async () => {
        const url = `${opts.assetBase}/targets/${mode}/${image}`;
        const res = await fetch(url, { redirect: 'manual' });
        assert(res.status === 200, `${url}: expected 200, got ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        assert(type.startsWith('image/webp'), `content-type ${type}`);
        // Targets are content-addressed or never change: cached forever
        const cache = res.headers.get('cache-control') ?? '';
        assert(cache.includes('immutable'), `cache-control "${cache}" lacks immutable`);
      },
    })),
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

  const assetOrigin = new URL(opts.assetBase).origin;
  const watched = new Set([origin, assetOrigin]);

  const visit = (start: string, mode: 'challenge' | 'tailwind', opts2: { exactDate?: string; image?: boolean } = {}): Check => ({
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
        if (watched.has(new URL(res.url()).origin) && res.status() >= 400) {
          failures.push(`${res.status()} ${res.url()}`);
        }
      });
      // DNS, TLS, and connection failures produce no response at all
      page.on('requestfailed', (req) => {
        if (watched.has(new URL(req.url()).origin)) {
          failures.push(`request failed (${req.failure()?.errorText ?? 'unknown'}) ${req.url()}`);
        }
      });
      try {
        await page.goto(new URL(start, opts.baseUrl).href);
        await page.waitForURL(finalUrlRe, { timeout: 15_000 });
        const [, finalMode, finalDate] = finalUrlRe.exec(page.url())!;
        assert(finalMode === mode, `landed on ${page.url()}, expected mode ${mode}`);
        assert(finalDate <= latestAllowed, `landed on future date ${finalDate}`);
        if (opts2.exactDate) assert(finalDate === opts2.exactDate, `landed on ${finalDate}, expected ${opts2.exactDate}`);
        // Day pages render every difficulty's player and hide all but one
        await page.locator('.cm-editor').filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 });
        if (opts2.image) {
          // The visible target screenshot actually loaded and decoded
          const prefix = `${opts.assetBase}/targets/`;
          await page.waitForFunction(
            (p) => [...document.querySelectorAll('img')].some(
              (img) => img.src.startsWith(p) && img.offsetParent !== null && img.complete && img.naturalWidth > 0
            ),
            prefix,
            { timeout: 15_000 }
          ).catch(() => { failures.push(`no visible decoded target image from ${prefix}`); });
        }
        // Let late subresources settle before judging failures
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        assert(failures.length === 0, failures.join('; '));
      } finally {
        await context.close();
      }
    },
  });

  return {
    checks: [
      visit('/', 'challenge', { image: true }),
      visit('/tailwind/', 'tailwind', { image: true }),
      visit('/challenge/2099-01-01/', 'challenge'),
      visit('/tailwind/2099-01-01/', 'tailwind'),
      visit('/definitely-not-a-page', 'challenge'),
      visit(`/challenge/${date}/`, 'challenge', { exactDate: date, image: true }),
    ],
    close: () => browser.close(),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { date, images } = pickSmokeTargets(readPulled('css'), readPulled('tailwind'), utcDate());
  console.log(`Smoke-checking ${opts.baseUrl} (challenge ${date}; images from ${opts.assetBase})`);

  const checks = httpChecks(opts, date, images);
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
