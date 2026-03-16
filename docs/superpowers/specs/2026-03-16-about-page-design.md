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

### Update `src/pages/challenge/[date].astro`

Add the shared `Header.astro` above `ChallengePlayer`.

### Update `src/components/ChallengePlayer.tsx`

Remove from the existing header:
- The "CSS Daily" logo link
- The GitHub and TekGadgt icon links

Keep challenge-specific elements:
- Date navigation (prev/next arrows, date display)
- Challenge title and difficulty badge
- Timer, score, submit/results buttons, stats button

The ChallengePlayer header becomes a secondary toolbar below the shared site header.

## About Page: `src/pages/about.astro`

Static Astro page using `Layout.astro`, styled with Tailwind to match the dark theme (bg-gray-900, text-white).

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
- Embedded YouTube video (Cassidy Williams' video via iframe, `https://www.youtube.com/embed/3Uct3cQ77Xo`)
- Text links to Bluesky post and LinkedIn post
- No third-party embed scripts for social posts (keeps page fast)

#### 7. Footer
- Social/profile links: GitHub, LinkedIn, Bluesky
- Soft CTA line: "I'm currently open to new opportunities" (or similar natural phrasing)
- Link to tekgadgt.com

### Styling

- Dark theme consistent with rest of site (bg-gray-900, text-white/gray-300)
- Max-width container (max-w-3xl or similar) for readable content width
- Sections separated with spacing, not heavy dividers
- Concise: each section 2-4 sentences, AI section up to 5
- YouTube embed responsive (16:9 aspect ratio)

## Files to Create

1. `src/components/Header.astro` — shared site header
2. `src/pages/about.astro` — the about page

## Files to Modify

1. `src/pages/challenge/[date].astro` — add shared Header above ChallengePlayer
2. `src/components/ChallengePlayer.tsx` — remove site-level nav from its header, keep challenge-specific toolbar

## Out of Scope

- Content copywriting (user will refine with Claude web after page is built)
- Analytics/tracking for the about page (already covered by Cloudflare snippet in Layout)
- Mobile-specific design (Tailwind responsive utilities will handle basics)
