# About Page Design Spec

## Overview

Add a static About page to cssdaily.dev that serves as both a project showcase and a subtle job-search signal. The page tells the origin story, highlights AI-powered development, shows social proof, and ends with a soft "open to opportunities" CTA.

## Goals

- **Portfolio piece**: Showcase technical skills and decision-making to potential employers
- **Project story**: Tell the origin (March MadCSS inspiration, built in a day) and credit SynHax
- **Job search signal**: Soft CTA without being pushy
- **Social proof**: Feature Cassidy Williams' video and social media engagement

## Navigation Changes

### New shared header component: `src/components/Header.astro`

Extract the top-level navigation from `ChallengePlayer.tsx` into a reusable Astro component containing:
- "CSS Daily" logo link (to `/`)
- "About" nav link (to `/about`)
- GitHub icon link (to repo)
- TekGadgt icon link (to tekgadgt.com)

Active page indication: the current page's nav link uses `text-white` while inactive links use `text-gray-400`.

### Header integration strategy

`Header.astro` is included per-page, NOT added to `Layout.astro`. Reason: `index.astro` and `404.astro` are redirect/utility pages that should not render a header. Each content page (`about.astro`, `[date].astro`) includes `Header.astro` explicitly.

### Update `src/pages/challenge/[date].astro`

Add the shared `Header.astro` above `ChallengePlayer`. The page structure becomes a flex column filling the viewport:

```html
<Layout>
  <div class="flex flex-col h-screen">
    <Header />
    <ChallengePlayer client:load ... />
  </div>
</Layout>
```

### Update `src/components/ChallengePlayer.tsx`

Remove from the existing header:
- The "CSS Daily" logo link
- The GitHub and TekGadgt icon links

Keep challenge-specific elements:
- Date navigation (prev/next arrows, date display)
- Challenge title and difficulty badge
- Timer, score, submit/results buttons, stats button

The ChallengePlayer header becomes a secondary toolbar below the shared site header.

**Layout fix**: Replace the hardcoded `min-h-screen` on the root div and `calc(100vh - 57px)` on the main content area with flex-based layout. The root div becomes `flex-1 flex flex-col` (filling remaining space below the site header), and the main content area uses `flex-1` instead of the calc. This avoids fragile pixel math when two header bars are present.

### Pages requiring no changes

- `src/pages/index.astro` — redirect-only page, no header needed
- `src/pages/404.astro` — utility page, no header needed

## About Page: `src/pages/about.astro`

Static Astro page using `Layout.astro`, styled with Tailwind to match the dark theme (bg-gray-900, text-white).

### SEO

Extend `Layout.astro` to accept an optional `description` prop (alongside the existing `title` prop) for the meta description tag. The existing hardcoded description ("A daily CSS challenge - like Wordle, but for CSS!") becomes the default when no prop is passed. The About page sets its own description and title. Add `og:title`, `og:description` meta tags for social sharing (important since this page will be linked from LinkedIn/Bluesky). These OG tags apply to all pages via Layout, which is fine.

### Page Sections

#### 1. Header
Shared `Header.astro` component.

#### 2. Hero/Intro
One-liner: "A daily CSS challenge — like Wordle, but for CSS." Brief expansion: each morning a new challenge appears, you write CSS to match a target, and get scored via pixel-level comparison.

#### 3. The Story
Origin story in 2-4 sentences: Inspired by the March MadCSS tournament. Built the entire platform in a single day. New challenges generate automatically every morning. Scoring adapted from Wes Bos and Scott Tolinski's open-source SynHax project.

#### 4. Built With AI
Dedicated section (slightly longer, 3-5 sentences):
- Claude API generates each challenge (HTML structure, target CSS, starter CSS stubs)
- Playwright renders the target CSS to a screenshot automatically
- GitHub Actions orchestrates the daily pipeline: generate, screenshot, commit, deploy
- The site itself was built using Claude Code
- Position: demonstrates shipping real products with AI-augmented development

#### 5. How It Works
Brief technical overview (2-4 sentences):
- Stack: Astro, React, CodeMirror 6, Tailwind CSS
- Real-time pixel-level visual diffing using snapdom for DOM-to-canvas capture
- Euclidean RGB distance scoring with background detection (adapted from SynHax)
- No backend, no database — static site with a cron job

#### 6. Featured
- Embedded YouTube video (Cassidy Williams' video via iframe, using `youtube-nocookie.com` domain for privacy, with `loading="lazy"`)
- Text links to Bluesky post (`https://bsky.app/profile/tekgadgt.dev/post/3mggtrzfpec23`) and LinkedIn post (`https://www.linkedin.com/posts/ryan-mcgovern-tekgadgt_css-daily-a-daily-css-challenge-activity-7435883007632359424-7_ga`)
- No third-party embed scripts for social posts (keeps page fast)

#### 7. Footer
This footer is specific to the About page, not a shared site component.
- Social/profile links: GitHub, LinkedIn, Bluesky
- Soft CTA line: "I'm currently open to new opportunities" (or similar natural phrasing)
- Link to tekgadgt.com

### Styling

- Dark theme consistent with rest of site (bg-gray-900, text-white/gray-300)
- Max-width container (max-w-3xl or similar) for readable content width
- Sections separated with spacing, not heavy dividers
- Concise: each section 2-4 sentences, AI section up to 5
- YouTube embed responsive (`aspect-video` Tailwind utility for 16:9 container)
- Mobile-responsive: content sections use standard Tailwind responsive utilities, readable on narrow viewports. The YouTube embed must use a responsive wrapper to prevent overflow.

## Files to Create

1. `src/components/Header.astro` — shared site header
2. `src/pages/about.astro` — the about page

## Files to Modify

1. `src/layouts/Layout.astro` — add optional `description` prop for meta description and OG tags
2. `src/pages/challenge/[date].astro` — add shared Header, wrap in flex column layout
3. `src/components/ChallengePlayer.tsx` — remove site-level nav from its header, replace hardcoded height calc with flex layout

## Out of Scope

- Content copywriting (user will refine with Claude web after page is built)
- Analytics/tracking for the about page (already covered by Cloudflare snippet in Layout)
