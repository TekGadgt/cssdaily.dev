# CSS Daily

**A daily CSS challenge game — like Wordle, but for CSS.**

Each day, a new CSS component challenge is generated. You're given the HTML structure and a target screenshot — your job is to write the CSS to match it as closely as possible before time runs out.

Live at **[cssdaily.dev](https://cssdaily.dev)**

## How It Works

1. A new challenge is generated daily via Claude (Anthropic API)
2. You see a target component and an empty CSS editor with starter stubs
3. Write CSS to match the target — your score updates in real-time as you type
4. Submit before the timer runs out to lock in your score
5. Share your results with friends

## Tech Stack

- **[Astro](https://astro.build/)** — Static site generation
- **[React](https://react.dev/)** — Interactive challenge player
- **[CodeMirror 6](https://codemirror.net/)** — CSS/HTML editor
- **[Tailwind CSS](https://tailwindcss.com/)** — UI styling
- **[@zumer/snapdom](https://github.com/nicecoder02/snapdom)** — DOM-to-image capture for visual diffing
- **[Playwright](https://playwright.dev/)** — Target screenshot generation
- **[Claude API](https://docs.anthropic.com/)** — Daily challenge generation
- **GitHub Pages** — Hosting
- **GitHub Actions** — CI/CD and daily challenge cron

## Visual Diff Engine

The scoring system compares your rendered CSS output against the target using pixel-level analysis:

- Both your CSS and the target CSS are rendered in hidden iframes and captured with snapdom
- Pixel comparison uses Euclidean RGB distance with configurable tolerance
- Background pixels are auto-detected and excluded from scoring
- A power curve is applied to the raw score to reward precision over broad-stroke matches

## Daily Generation Pipeline

1. A GitHub Actions cron job runs daily at 6am UTC
2. Claude generates a new challenge with HTML, target CSS, and starter CSS stubs
3. Playwright renders the target CSS to a screenshot PNG
4. The challenge JSON and target image are committed to the repo
5. The site automatically rebuilds and deploys to GitHub Pages

## Local Development

```bash
npm install
npm run dev
```

To generate a challenge locally (requires `ANTHROPIC_API_KEY` env var):

```bash
npx tsx scripts/generate-challenge.ts           # generates for tomorrow
npx tsx scripts/generate-challenge.ts 2026-03-15 # generates for a specific date
```

To regenerate target PNGs from existing challenge JSONs:

```bash
npx tsx scripts/generate-targets.ts
```

## Acknowledgments

The visual diff engine in this project is adapted from [Synhax](https://github.com/syntaxfm/synhax) by the [Syntax](https://syntax.fm/) team. Huge thanks to [Wes Bos](https://github.com/wesbos), [Scott Tolinski](https://github.com/stolinski), and all contributors to Synhax for building and open-sourcing the pixel comparison approach that powers the scoring system here. Their work on Euclidean color distance, background detection, and gradient scoring was invaluable.

## License

MIT

## Author

Built by [TekGadgt](https://tekgadgt.com) — [GitHub](https://github.com/TekGadgt/cssdaily.dev)
