# About Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an About page with shared site header, project story, AI highlight, social proof, and soft job-search CTA.

**Architecture:** Extract site-level nav from ChallengePlayer into a shared Astro header component. Add a static About page using the existing Layout. Fix ChallengePlayer's layout to use flex instead of hardcoded calc.

**Tech Stack:** Astro, React, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-16-about-page-design.md`

---

## Chunk 1: Shared Header and Layout Changes

### Task 1: Add description prop to Layout.astro

**Files:**
- Modify: `src/layouts/Layout.astro`

- [ ] **Step 1: Add optional description prop with OG tags**

Update the Props interface and meta tags:

```astro
---
interface Props {
  title?: string;
  description?: string;
}
const { title = 'CSS Daily - A Daily CSS Challenge', description = 'A daily CSS challenge - like Wordle, but for CSS!' } = Astro.props;
---
```

Replace the hardcoded `<meta name="description">` and add OG tags in `<head>`:

```html
<meta name="description" content={description} />
<meta property="og:title" content={title} />
<meta property="og:description" content={description} />
```

- [ ] **Step 2: Verify the site builds**

Run: `npm run build`
Expected: Build succeeds with no errors. Existing pages still work since defaults match current hardcoded values.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Layout.astro
git commit -m "feat: add description prop and OG tags to Layout"
```

---

### Task 2: Create shared Header.astro component

**Files:**
- Create: `src/components/Header.astro`

- [ ] **Step 1: Create Header.astro**

The component accepts a `currentPath` prop to highlight the active nav link. It contains the logo, About link, GitHub icon, and TekGadgt icon — all extracted from ChallengePlayer.tsx lines 144-206.

```astro
---
interface Props {
  currentPath?: string;
}
const { currentPath = '' } = Astro.props;
---
<header class="border-b border-gray-700 px-4 py-3 bg-gray-900">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div class="flex items-center gap-6">
      <a href="/" class="text-xl font-bold text-blue-400">CSS Daily</a>
      <nav class="flex items-center gap-4 text-sm">
        <a
          href="/about"
          class:list={[
            'transition hover:text-white',
            currentPath === '/about' ? 'text-white' : 'text-gray-400'
          ]}
        >
          About
        </a>
      </nav>
    </div>
    <div class="flex items-center gap-4">
      <a href="https://github.com/TekGadgt/cssdaily.dev" target="_blank" rel="noopener noreferrer" class="text-gray-500 hover:text-white transition" title="GitHub">
        <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
      </a>
      <a href="https://tekgadgt.com" target="_blank" rel="noopener noreferrer" class="text-gray-500 hover:text-white transition" title="TekGadgt">
        <img src="/prami-mono.svg" alt="TekGadgt" class="w-5 h-5 opacity-50 hover:opacity-100 transition" style="filter: invert(1)" />
      </a>
    </div>
  </div>
</header>
```

- [ ] **Step 2: Verify the site builds**

Run: `npm run build`
Expected: Build succeeds. Header.astro is created but not yet used.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.astro
git commit -m "feat: create shared Header.astro component"
```

---

### Task 3: Integrate Header into challenge page and refactor ChallengePlayer

**Files:**
- Modify: `src/pages/challenge/[date].astro`
- Modify: `src/components/ChallengePlayer.tsx`

- [ ] **Step 1: Update [date].astro to include Header and flex wrapper**

```astro
---
import Layout from '../../layouts/Layout.astro';
import Header from '../../components/Header.astro';
import ChallengePlayer from '../../components/ChallengePlayer.tsx';

export async function getStaticPaths() {
  const challengeFiles = import.meta.glob('../../data/challenges/*.json', { eager: true });
  const challenges = Object.values(challengeFiles).map((mod: any) => mod.default || mod);
  const allDates = challenges.map((c: any) => c.date).sort();

  return challenges.map((challenge: any) => ({
    params: { date: challenge.date },
    props: { challenge, allDates },
  }));
}

const { challenge, allDates } = Astro.props;
---
<Layout title={`${challenge.title} - CSS Daily`}>
  <div class="flex flex-col h-screen">
    <Header currentPath="/challenge" />
    <ChallengePlayer client:load challenge={challenge} allDates={allDates} />
  </div>
</Layout>
```

- [ ] **Step 2: Remove site-level nav from ChallengePlayer and fix layout**

In `src/components/ChallengePlayer.tsx`, make these changes:

**a)** Change the root div (line 140) from:
```tsx
<div className="min-h-screen bg-gray-900 text-white">
```
to:
```tsx
<div className="flex-1 flex flex-col bg-gray-900 text-white">
```

**b)** In the header section: remove only the logo `<a>` tag (line 145) from inside the first `<div>` (line 144) — keep the date nav `<div>` (lines 146-158) that's a sibling inside that same parent. The parent div at line 144 becomes the date nav wrapper. Also remove lines 201-206: the GitHub and TekGadgt icon links. The header keeps only the date nav, challenge info, timer, score, and action buttons.

The header (line 142) becomes:
```tsx
<header className="border-b border-gray-700 px-4 py-3">
  <div className="max-w-7xl mx-auto flex items-center justify-between">
    <div className="flex items-center gap-2 text-sm text-gray-400">
      {prevDate ? (
        <a href={`/challenge/${prevDate}`} className="hover:text-white">&larr;</a>
      ) : (
        <span className="text-gray-600">&larr;</span>
      )}
      <span>{formatDate(challenge.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      {nextDate ? (
        <a href={`/challenge/${nextDate}`} className="hover:text-white">&rarr;</a>
      ) : (
        <span className="text-gray-600">&rarr;</span>
      )}
    </div>

    <div className="flex items-center gap-4">
      <span className="text-sm text-gray-400">{challenge.title}</span>
      <span className={`text-xs px-2 py-0.5 rounded ${challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
        challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
          'bg-red-900 text-red-300'
        }`}>
        {challenge.difficulty}
      </span>
    </div>

    <div className="flex items-center gap-4">
      <Timer
        timeLimit={challenge.timeLimit || 600}
        isRunning={phase === 'playing'}
        onTimeUp={handleTimeUp}
        onTick={handleTick}
      />
      <ScoreDisplay score={displayScore} />
      {phase === 'playing' && (
        <button
          onClick={doSubmit}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition"
        >
          Submit
        </button>
      )}
      {phase === 'finished' && (
        <button
          onClick={() => setShowResults(true)}
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition"
        >
          Results
        </button>
      )}
      <button
        onClick={() => setShowHistory(true)}
        className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition"
      >
        Stats
      </button>
    </div>
  </div>
</header>
```

**c)** Change the main content div (line 212) from:
```tsx
<div className="max-w-7xl mx-auto p-4 flex flex-col" style={{ height: 'calc(100vh - 57px)' }}>
```
to:
```tsx
<div className="max-w-7xl mx-auto p-4 flex flex-col flex-1 min-h-0">
```

- [ ] **Step 3: Verify the site builds and challenge page renders correctly**

Run: `npm run build`
Expected: Build succeeds. The challenge page now has two bars — the site header (logo, About, icons) and the challenge toolbar (date nav, title, timer, etc.) — with the editor filling remaining space.

- [ ] **Step 4: Commit**

```bash
git add src/pages/challenge/\[date\].astro src/components/ChallengePlayer.tsx
git commit -m "feat: integrate shared Header into challenge page, refactor ChallengePlayer layout"
```

---

## Chunk 2: About Page

### Task 4: Create the About page

**Files:**
- Create: `src/pages/about.astro`

- [ ] **Step 1: Create about.astro with all sections**

```astro
---
import Layout from '../layouts/Layout.astro';
import Header from '../components/Header.astro';
---
<Layout title="About - CSS Daily" description="The story behind CSS Daily — a daily CSS challenge built with AI, inspired by March MadCSS and SynHax.">
  <Header currentPath="/about" />
  <main class="max-w-3xl mx-auto px-4 py-12 text-gray-300">

    <!-- Hero -->
    <section class="mb-12">
      <h1 class="text-4xl font-bold text-white mb-4">CSS Daily</h1>
      <p class="text-xl text-gray-400">A daily CSS challenge — like Wordle, but for CSS.</p>
      <p class="mt-4">
        Each morning a new challenge appears. You get an HTML structure and a target screenshot,
        then write CSS to match it as closely as possible before time runs out. Your score is
        calculated by pixel-level comparison in real time as you type.
      </p>
    </section>

    <!-- The Story -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold text-white mb-4">The Story</h2>
      <p>
        CSS Daily was inspired by the
        <a href="https://www.marchmadcss.com/" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">March MadCSS</a>
        tournament and built in a single day. A new challenge generates automatically every morning,
        so there's always something fresh to try. The visual diff scoring engine is adapted from
        <a href="https://github.com/syntaxfm/synhax" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">SynHax</a>,
        the open-source project by Wes Bos and Scott Tolinski.
      </p>
    </section>

    <!-- Built With AI -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold text-white mb-4">Built With AI</h2>
      <p>
        The entire site was built using
        <a href="https://claude.ai/code" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">Claude Code</a>.
        Each morning, the
        <a href="https://docs.anthropic.com/en/api" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">Claude API</a>
        generates a new challenge — the HTML structure, target CSS, and starter CSS stubs.
        Playwright automatically renders the target to a screenshot, and GitHub Actions handles
        the full pipeline: generate, screenshot, commit, and deploy. No manual intervention needed.
      </p>
      <p class="mt-3">
        This project demonstrates what's possible when you combine AI-augmented development with
        good architecture. The result is a fully automated platform that ships a new challenge
        every day with zero maintenance.
      </p>
    </section>

    <!-- How It Works -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold text-white mb-4">How It Works</h2>
      <p>
        CSS Daily is built with Astro, React, CodeMirror 6, and Tailwind CSS. The scoring engine
        uses real-time pixel-level visual diffing with Euclidean RGB distance scoring, adapted from
        SynHax with modifications. No backend, no database — just a static site, a cron job, an AI,
        and a dream.
      </p>
    </section>

    <!-- Featured -->
    <section class="mb-12">
      <h2 class="text-2xl font-bold text-white mb-4">Featured</h2>
      <div class="aspect-video w-full rounded-lg overflow-hidden mb-4">
        <iframe
          src="https://www.youtube-nocookie.com/embed/3Uct3cQ77Xo"
          title="Cassidy Williams plays CSS Daily"
          frameborder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
          loading="lazy"
          class="w-full h-full"
        ></iframe>
      </div>
      <ul class="flex flex-col gap-2 text-sm">
        <li>
          <a href="https://bsky.app/profile/tekgadgt.dev/post/3mggtrzfpec23" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">
            Original announcement on Bluesky
          </a>
        </li>
        <li>
          <a href="https://www.linkedin.com/posts/ryan-mcgovern-tekgadgt_css-daily-a-daily-css-challenge-activity-7435883007632359424-7_ga" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">
            Project writeup on LinkedIn
          </a>
        </li>
      </ul>
    </section>

    <!-- Footer -->
    <footer class="border-t border-gray-700 pt-8 mt-12">
      <p class="text-white mb-4">I'm currently open to new opportunities.</p>
      <div class="flex items-center gap-4 text-sm">
        <a href="https://github.com/TekGadgt" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">GitHub</a>
        <a href="https://www.linkedin.com/in/ryan-mcgovern-tekgadgt" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">LinkedIn</a>
        <a href="https://bsky.app/profile/tekgadgt.dev" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">Bluesky</a>
        <a href="https://tekgadgt.com" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:text-blue-300">tekgadgt.com</a>
      </div>
    </footer>

  </main>
</Layout>
```

- [ ] **Step 2: Verify the site builds and the about page renders**

Run: `npm run build`
Expected: Build succeeds. `/about` page is generated in the output.

- [ ] **Step 3: Run dev server and visually verify**

Run: `npm run dev`
Verify:
- Navigate to `/about` — page renders with all sections, dark theme, readable on desktop
- YouTube embed loads and is responsive
- All links work (GitHub, LinkedIn, Bluesky, SynHax, March MadCSS)
- Header shows "About" link as active (text-white)
- Navigate to a challenge page — Header shows "About" as inactive (text-gray-400)
- Challenge page layout is not broken (editor fills remaining space, no overflow)

- [ ] **Step 4: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat: add About page with project story, AI highlight, and social proof"
```
