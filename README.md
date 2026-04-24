# CSS Daily

**A daily CSS challenge game — like Wordle, but for CSS.**

Each day, new challenges are generated across two modes:

- **CSS Mode** — Write CSS to match a target screenshot. You're given the HTML structure and starter stubs.
- **Tailwind Mode** — Add Tailwind utility classes to HTML elements to match the target. Editing is restricted to `class` attribute values only.

Live at **[cssdaily.dev](https://cssdaily.dev)**

## How It Works

1. A new challenge is generated daily for each mode via Claude (Anthropic API)
2. You see a target component and an editor — CSS editor with stubs, or HTML with empty class attributes
3. Your score updates in real-time as you type, powered by pixel-level visual diffing
4. Submit before the timer runs out to lock in your score
5. Share your results with friends

## Game Modes

### CSS Challenge (`/challenge/[date]`)

Write CSS from scratch to match the target. Includes a split view toggle to see CSS and HTML side-by-side or in tabs.

### Tailwind Challenge (`/tailwind/[date]`)

Add Tailwind utility classes to pre-structured HTML. The editor locks everything except `class=""` values — non-editable regions are dimmed, editable regions are highlighted. Includes Tailwind utility autocomplete with Tab-to-accept.

## Tech Stack

- **[Astro](https://astro.build/)** — Static site generation
- **[React](https://react.dev/)** — Interactive challenge player
- **[CodeMirror 6](https://codemirror.net/)** — CSS/HTML editor with transaction filters, decorations, and custom autocomplete
- **[Tailwind CSS](https://tailwindcss.com/)** — UI styling + Tailwind CDN for challenge rendering
- **[@zumer/snapdom](https://github.com/nicecoder02/snapdom)** — DOM-to-image capture for visual diffing
- **[Playwright](https://playwright.dev/)** — Target screenshot generation
- **[Claude API](https://docs.anthropic.com/)** — Daily challenge generation
- **GitHub Pages** — Hosting
- **GitHub Actions** — CI/CD and daily challenge cron

## Visual Diff Engine

The scoring system compares your rendered output against the target using pixel-level analysis:

- Both your output and the target are rendered in hidden iframes and captured with snapdom
- Pixel comparison uses Euclidean RGB distance with configurable tolerance
- Background pixels are auto-detected and excluded from scoring
- A power curve is applied to the raw score to reward precision over broad-stroke matches

For Tailwind challenges, the diff engine uses iframes with `allow-scripts` sandbox to load the Tailwind CDN, with class value sanitization for XSS defense-in-depth.

## Daily Generation Pipeline

1. A GitHub Actions cron job runs daily at 6am UTC
2. Claude generates a new CSS challenge and a new Tailwind challenge (independently, with `continue-on-error`)
3. Playwright renders the target to a screenshot PNG for each challenge
4. The challenge JSONs and target images are committed to the repo
5. The site automatically rebuilds and deploys to GitHub Pages

## Local Development

```bash
npm install
npm run dev
```

To generate challenges locally (requires `ANTHROPIC_API_KEY` env var):

```bash
# CSS challenges
npx tsx scripts/generate-challenge.ts           # generates for tomorrow
npx tsx scripts/generate-challenge.ts 2026-03-15 # generates for a specific date

# Tailwind challenges
npx tsx scripts/generate-tailwind-challenge.ts           # generates for tomorrow
npx tsx scripts/generate-tailwind-challenge.ts 2026-03-15 # generates for a specific date
```

To regenerate target PNGs from existing challenge JSONs:

```bash
npx tsx scripts/generate-targets.ts
```

## Acknowledgments

The visual diff engine in this project is adapted from [Synhax](https://github.com/syntaxfm/synhax) by the [Syntax](https://syntax.fm/) team. Huge thanks to [Wes Bos](https://github.com/wesbos), [Scott Tolinski](https://github.com/stolinski), and all contributors to Synhax for building and open-sourcing the pixel comparison approach that powers the scoring system here. Their work on Euclidean color distance, background detection, and gradient scoring was invaluable.

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="14.28%"><a href="https://runonce.dev"><img src="https://avatars.githubusercontent.com/u/1458916?v=4?s=100" width="100px;" alt="Camilo"/><br /><sub><b>Camilo</b></sub></a><br /><a href="#code-runoncedev" title="Code">💻</a> <a href="#maintenance-runoncedev" title="Maintenance">🚧</a></td>
    </tr>
  </tbody>
</table>

<!-- markdownlint-restore -->
<!-- prettier-ignore-end -->

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT

## Author

Built by [TekGadgt](https://tekgadgt.com) — [GitHub](https://github.com/TekGadgt/cssdaily.dev)
