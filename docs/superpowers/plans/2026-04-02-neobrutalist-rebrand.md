# Neobrutalist-Lite Visual Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin CSS Daily with a neobrutalist-lite aesthetic — new colors, typography, borders, and shadows — without changing layout or logic.

**Architecture:** CSS custom properties for colors on `:root`, mapped into Tailwind config. Fonts, shadows, and border tokens defined directly in `tailwind.config.mjs`. All changes are class-level swaps in ~12 files.

**Tech Stack:** Tailwind CSS 3.4, Astro 5, React 19, Google Fonts (Space Grotesk, JetBrains Mono)

---

## File Structure

No new files created (except the config/layout changes). All work is modifying existing files:

| File | Responsibility |
|------|---------------|
| `tailwind.config.mjs` | Theme extension: colors (mapped to CSS vars), fonts, shadows, border-width |
| `src/layouts/Layout.astro` | CSS custom properties on `:root`, Google Fonts links, base body classes |
| `src/components/Header.astro` | Site navigation chrome |
| `src/components/ChallengePlayer.tsx` | CSS challenge player UI chrome |
| `src/components/TailwindPlayer.tsx` | Tailwind challenge player UI chrome |
| `src/components/CodeEditor.tsx` | Editor tab bar and container chrome |
| `src/components/TailwindEditor.tsx` | Editor tab bar and container chrome |
| `src/components/Timer.tsx` | Timer display colors |
| `src/components/ScoreDisplay.tsx` | Score display colors |
| `src/components/ResultsModal.tsx` | Results modal chrome |
| `src/components/HistoryView.tsx` | History/stats modal chrome |
| `src/pages/about.astro` | About page text and link colors |

---

### Task 1: Theme Foundation — Tailwind Config + Layout

**Files:**
- Modify: `tailwind.config.mjs`
- Modify: `src/layouts/Layout.astro`

- [ ] **Step 1: Update `tailwind.config.mjs` with theme tokens**

Replace the entire file with:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        base: 'var(--bg-base)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-muted': 'var(--text-muted)',
        accent: {
          primary: 'var(--accent-primary)',
          secondary: 'var(--accent-secondary)',
          tertiary: 'var(--accent-tertiary)',
        },
        border: {
          default: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
        success: 'var(--success)',
        error: 'var(--error)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        sans: ['"Space Grotesk"', '"Inter"', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"IBM Plex Mono"', '"SFMono-Regular"', 'monospace'],
      },
      boxShadow: {
        'brutal-sm': '2px 2px 0 0 rgba(0,0,0,0.45)',
        'brutal-md': '4px 4px 0 0 rgba(0,0,0,0.5)',
      },
      borderWidth: {
        '3': '3px',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: Update `src/layouts/Layout.astro` with CSS variables and Google Fonts**

Replace the full file content with:

```astro
---
interface Props {
  title?: string;
  description?: string;
}
const { title = 'CSS Daily - A Daily CSS Challenge', description = 'A daily CSS challenge - like Wordle, but for CSS!' } = Astro.props;
---
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content={description} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
    <link rel="manifest" href="/site.webmanifest">
    <title>{title}</title>
    <style>
      :root {
        --bg-base: #0B0F14;
        --bg-surface: #111827;
        --bg-elevated: #182235;
        --text-primary: #E6F0FF;
        --text-secondary: #A9BCD6;
        --text-muted: #6F819A;
        --accent-primary: #00D4FF;
        --accent-secondary: #2F7BFF;
        --accent-tertiary: #39F58F;
        --border-default: #2A3447;
        --border-strong: #3A4A63;
        --success: #2EEA8A;
        --error: #FF5C7A;
        --warning: #FFC857;
      }
    </style>
  </head>
  <body class="min-h-screen bg-base font-sans text-text-secondary">
    <slot />
    <!-- Cloudflare Web Analytics -->
    <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "44069e8e1cd1479c85c3a876abab3d38"}'></script>
    <!-- End Cloudflare Web Analytics -->
  </body>
</html>
```

- [ ] **Step 3: Build to verify no errors**

Run: `npm run build`
Expected: Clean build with no errors. The site will look partially broken (old classes referencing gray-900 etc. still in components) — that's expected until the remaining tasks are done.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.mjs src/layouts/Layout.astro
git commit -m "feat: add neobrutalist theme foundation — config + CSS variables"
```

---

### Task 2: Header

**Files:**
- Modify: `src/components/Header.astro`

- [ ] **Step 1: Update Header.astro classes**

Replace the full file content with:

```astro
---
interface Props {
  currentPath?: string;
}
const { currentPath = '' } = Astro.props;
---
<header class="border-b-2 border-border-default px-4 py-3 bg-base">
  <div class="max-w-7xl mx-auto flex items-center justify-between">
    <div class="flex items-center gap-6">
      <a href="/" class="text-xl font-bold text-accent-primary">CSS Daily</a>
      <nav class="flex items-center gap-4 text-sm">
        <a
          href="/tailwind"
          aria-current={currentPath === '/tailwind' ? 'page' : undefined}
          class:list={[
            'transition hover:text-text-primary',
            currentPath === '/tailwind' ? 'text-text-primary' : 'text-text-muted'
          ]}
        >
          Tailwind
        </a>
        <a
          href="/about"
          aria-current={currentPath === '/about' ? 'page' : undefined}
          class:list={[
            'transition hover:text-text-primary',
            currentPath === '/about' ? 'text-text-primary' : 'text-text-muted'
          ]}
        >
          About
        </a>
      </nav>
    </div>
    <div class="flex items-center gap-4">
      <a href="https://github.com/TekGadgt/cssdaily.dev" target="_blank" rel="noopener noreferrer" class="text-text-muted hover:text-text-primary transition" title="GitHub">
        <svg aria-hidden="true" focusable="false" class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" /></svg>
      </a>
      <a href="https://tekgadgt.com" target="_blank" rel="noopener noreferrer" class="text-text-muted hover:text-text-primary transition" title="TekGadgt">
        <img src="/prami-mono.svg" alt="TekGadgt" class="w-5 h-5 opacity-50 hover:opacity-100 transition" style="filter: invert(1)" />
      </a>
    </div>
  </div>
</header>
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.astro
git commit -m "feat: retheme Header with neobrutalist tokens"
```

---

### Task 3: ChallengePlayer

**Files:**
- Modify: `src/components/ChallengePlayer.tsx`

- [ ] **Step 1: Update ChallengePlayer.tsx classes**

Apply these specific class replacements throughout the file:

| Old Class | New Class |
|-----------|-----------|
| `bg-gray-900` | `bg-base` |
| `text-white` (on root div) | `text-text-primary` |
| `border-gray-700` | `border-border-default` |
| `text-gray-400` | `text-text-muted` |
| `text-gray-600` | `text-text-muted` |
| `text-gray-500` | `text-text-muted` |
| `hover:text-white` | `hover:text-text-primary` |
| `bg-green-900 text-green-300` | `bg-green-900/30 text-success` |
| `bg-yellow-900 text-yellow-300` | `bg-yellow-900/30 text-warning` |
| `bg-red-900 text-red-300` | `bg-red-900/30 text-error` |
| `bg-blue-600` | `bg-accent-secondary` |
| `hover:bg-blue-700` | `hover:bg-accent-secondary/80` |
| `rounded-lg` (on buttons) | `rounded-md` |
| `bg-gray-700` (on buttons/tabs) | `bg-elevated` |
| `hover:bg-gray-600` | `hover:bg-elevated/80` |
| `bg-gray-700 text-white rounded` (active tab) | `bg-elevated text-text-primary rounded-md` |

Specifically, the root div (line 139):
```tsx
<div className="flex-1 flex flex-col min-h-0 bg-base text-text-primary">
```

The challenge header (line 141):
```tsx
<header className="border-b-2 border-border-default px-4 py-3">
```

The date nav (line 143):
```tsx
<div className="flex items-center gap-2 text-sm text-text-muted">
```

Arrow links:
```tsx
<a href={`/challenge/${prevDate}`} className="hover:text-text-primary">&larr;</a>
```

Disabled arrows:
```tsx
<span className="text-text-muted/40">&larr;</span>
```

Challenge title (line 158):
```tsx
<span className="text-sm text-text-muted">{challenge.title}</span>
```

Difficulty badge (lines 159-163):
```tsx
<span className={`text-xs px-2 py-0.5 rounded-md border ${challenge.difficulty === 'easy' ? 'border-success/30 text-success' :
  challenge.difficulty === 'medium' ? 'border-warning/30 text-warning' :
    'border-error/30 text-error'
  }`}>
  {challenge.difficulty}
</span>
```

Submit/Results buttons (lines 176-189):
```tsx
<button
  onClick={doSubmit}
  className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
>
  Submit
</button>
```

```tsx
<button
  onClick={() => setShowResults(true)}
  className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
>
  Results
</button>
```

Stats button (lines 191-195):
```tsx
<button
  onClick={() => setShowHistory(true)}
  className="px-3 py-1.5 bg-elevated hover:bg-elevated/80 text-text-primary text-sm rounded-md transition border border-border-default"
>
  Stats
</button>
```

Preview labels (lines 208, 222):
```tsx
<h3 className="text-sm font-medium text-text-muted">Your Preview</h3>
```
```tsx
<h3 className="text-sm font-medium text-text-muted">Target</h3>
```

Preview containers (lines 210, 238):
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
```
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default relative" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, background: '#f5f5f5' }}>
```

Target tabs (lines 226-233):
```tsx
<button
  key={tab}
  onClick={() => setTargetTab(tab)}
  className={`px-2 py-1 capitalize ${targetTab === tab
    ? 'bg-elevated text-text-primary rounded-md'
    : 'text-text-muted hover:text-text-primary'
    }`}
>
  {tab}
</button>
```

Diff placeholder (line 269):
```tsx
{!diffResult && <span className="text-text-muted text-sm">Start editing to see diff</span>}
```

Code editor container (line 277):
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default flex-1 min-h-0">
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/ChallengePlayer.tsx
git commit -m "feat: retheme ChallengePlayer with neobrutalist tokens"
```

---

### Task 4: TailwindPlayer

**Files:**
- Modify: `src/components/TailwindPlayer.tsx`

- [ ] **Step 1: Update TailwindPlayer.tsx classes**

Apply the exact same class replacements as Task 3. The two files are nearly identical in their UI markup. The specific changes:

Root div (line 139):
```tsx
<div className="flex-1 flex flex-col min-h-0 bg-base text-text-primary">
```

Header (line 141):
```tsx
<header className="border-b-2 border-border-default px-4 py-3">
```

Date nav (line 143):
```tsx
<div className="flex items-center gap-2 text-sm text-text-muted">
```

Arrow links — use `/tailwind/` path:
```tsx
<a href={`/tailwind/${prevDate}`} className="hover:text-text-primary">&larr;</a>
```

Disabled arrows:
```tsx
<span className="text-text-muted/40">&larr;</span>
```

Challenge title (line 158):
```tsx
<span className="text-sm text-text-muted">{challenge.title}</span>
```

Difficulty badge (lines 159-163):
```tsx
<span className={`text-xs px-2 py-0.5 rounded-md border ${challenge.difficulty === 'easy' ? 'border-success/30 text-success' :
  challenge.difficulty === 'medium' ? 'border-warning/30 text-warning' :
    'border-error/30 text-error'
  }`}>
  {challenge.difficulty}
</span>
```

Submit button (lines 176-180):
```tsx
<button
  onClick={doSubmit}
  className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
>
  Submit
</button>
```

Results button (lines 183-188):
```tsx
<button
  onClick={() => setShowResults(true)}
  className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
>
  Results
</button>
```

Stats button (lines 191-195):
```tsx
<button
  onClick={() => setShowHistory(true)}
  className="px-3 py-1.5 bg-elevated hover:bg-elevated/80 text-text-primary text-sm rounded-md transition border border-border-default"
>
  Stats
</button>
```

Preview labels (lines 208, 222):
```tsx
<h3 className="text-sm font-medium text-text-muted">Your Preview</h3>
```
```tsx
<h3 className="text-sm font-medium text-text-muted">Target</h3>
```

Preview containers (lines 210, 237):
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default" style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT }}>
```
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default relative" style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, background: '#f5f5f5' }}>
```

Target tabs (lines 224-232):
```tsx
<button
  key={tab}
  onClick={() => setTargetTab(tab)}
  className={`px-2 py-1 capitalize ${targetTab === tab
    ? 'bg-elevated text-text-primary rounded-md'
    : 'text-text-muted hover:text-text-primary'
    }`}
>
  {tab}
</button>
```

Diff placeholder (line 268):
```tsx
{!diffResult && <span className="text-text-muted text-sm">Start editing to see diff</span>}
```

Editor container (line 276):
```tsx
<div className="rounded-md overflow-hidden border-2 border-border-default flex-1 min-h-0">
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/TailwindPlayer.tsx
git commit -m "feat: retheme TailwindPlayer with neobrutalist tokens"
```

---

### Task 5: CodeEditor + TailwindEditor

**Files:**
- Modify: `src/components/CodeEditor.tsx`
- Modify: `src/components/TailwindEditor.tsx`

- [ ] **Step 1: Update CodeEditor.tsx classes**

The tab bar border (line 88):
```tsx
<div className="flex items-center border-b-2 border-border-default">
```

Active CSS tab (line 92):
```tsx
className={`px-4 py-2 text-sm font-medium ${activeTab === 'css' ? 'bg-surface text-text-primary border-b-2 border-accent-primary' : 'text-text-muted hover:text-text-primary'}`}
```

Active HTML tab (line 98):
```tsx
className={`px-4 py-2 text-sm font-medium ${activeTab === 'html' ? 'bg-surface text-text-primary border-b-2 border-accent-primary' : 'text-text-muted hover:text-text-primary'}`}
```

Split view labels (lines 107-108):
```tsx
<span className="px-4 py-2 text-sm font-medium bg-surface text-text-primary border-b-2 border-accent-primary">CSS</span>
<span className="px-4 py-2 text-sm font-medium text-text-muted">HTML (read-only)</span>
```

Layout toggle button (line 113):
```tsx
className="p-1.5 text-text-muted hover:text-text-primary transition rounded-md hover:bg-elevated"
```

Split divider (line 135):
```tsx
className={`h-full ${isSplit ? 'w-1/2 border-r border-border-default' : (activeTab === 'css' ? '' : 'hidden')}`}
```

- [ ] **Step 2: Update TailwindEditor.tsx classes**

The tab bar border (line 173):
```tsx
<div className="flex border-b-2 border-border-default">
```

The tab label (line 174):
```tsx
<div className="px-4 py-2 text-sm font-medium bg-surface text-text-primary border-b-2 border-accent-primary">
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/CodeEditor.tsx src/components/TailwindEditor.tsx
git commit -m "feat: retheme code editors with neobrutalist tokens"
```

---

### Task 6: Timer + ScoreDisplay

**Files:**
- Modify: `src/components/Timer.tsx`
- Modify: `src/components/ScoreDisplay.tsx`

- [ ] **Step 1: Update Timer.tsx colors**

Replace the color logic (lines 41-43):
```tsx
let color = 'text-text-primary';
if (remaining <= 10) color = 'text-error';
else if (remaining <= 60) color = 'text-warning';
```

- [ ] **Step 2: Update ScoreDisplay.tsx colors**

Replace the color logic (lines 6-8):
```tsx
let color = 'text-error';
if (score >= 80) color = 'text-success';
else if (score >= 50) color = 'text-warning';
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 4: Commit**

```bash
git add src/components/Timer.tsx src/components/ScoreDisplay.tsx
git commit -m "feat: retheme Timer and ScoreDisplay with semantic colors"
```

---

### Task 7: ResultsModal

**Files:**
- Modify: `src/components/ResultsModal.tsx`

- [ ] **Step 1: Update ResultsModal.tsx classes**

Score color logic (lines 48-50):
```tsx
let scoreColor = 'text-error';
if (score >= 80) scoreColor = 'text-success';
else if (score >= 50) scoreColor = 'text-warning';
```

Modal backdrop (line 65):
```tsx
<div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
```
(backdrop stays the same)

Modal container (line 66):
```tsx
<div className="bg-surface rounded-md p-6 max-w-md w-full mx-4 shadow-brutal-md border-2 border-border-default" onClick={(e) => e.stopPropagation()}>
```

Heading (line 67):
```tsx
<h2 className="text-xl font-bold text-text-primary text-center mb-4">Challenge Complete!</h2>
```

Score display (line 70):
```tsx
<div className={`text-5xl font-bold ${scoreColor} mb-1`}>{score}%</div>
```
(stays the same, uses updated scoreColor)

Time display (line 71):
```tsx
<div className="text-text-muted">Time: {timeStr}</div>
```

Share button (lines 77-80):
```tsx
<button
  onClick={handleShare}
  className="w-full py-2 px-4 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
>
  {copied ? 'Copied!' : 'Share Result'}
</button>
```

Keep Tweaking button (lines 83-86):
```tsx
<button
  onClick={onClose}
  className="w-full py-2 px-4 bg-elevated hover:bg-elevated/80 text-text-primary rounded-md font-medium transition border border-border-default"
>
  Keep Tweaking
</button>
```

Nav links (lines 92-97):
```tsx
<a href={`${basePath}/${prevDate}`} className="text-accent-primary hover:text-accent-primary/80">
  &larr; Previous
</a>
<a href={`${basePath}/${nextDate}`} className="text-accent-primary hover:text-accent-primary/80">
  Next &rarr;
</a>
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/ResultsModal.tsx
git commit -m "feat: retheme ResultsModal with neobrutalist tokens"
```

---

### Task 8: HistoryView

**Files:**
- Modify: `src/components/HistoryView.tsx`

- [ ] **Step 1: Update HistoryView.tsx classes**

Modal container (line 37):
```tsx
<div className="bg-surface rounded-md p-6 max-w-md w-full mx-4 shadow-brutal-md border-2 border-border-default max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
```

Heading (line 38):
```tsx
<h2 className="text-xl font-bold text-text-primary text-center mb-4">Your Stats</h2>
```

Stat values (line 48):
```tsx
<div className="text-2xl font-bold text-text-primary">{value}</div>
```

Stat labels (line 49):
```tsx
<div className="text-xs text-text-muted">{label}</div>
```

Section heading (line 54):
```tsx
<h3 className="text-sm font-medium text-text-muted mb-2">Past Challenges</h3>
```

Empty state (line 56):
```tsx
<p className="text-text-muted text-sm text-center py-4">No challenges completed yet.</p>
```

Score color logic (lines 61-63):
```tsx
let scoreColor = 'text-error';
if (result.score >= 80) scoreColor = 'text-success';
else if (result.score >= 50) scoreColor = 'text-warning';
```

History row (lines 66-72):
```tsx
<a
  key={date}
  href={`${basePath}/${date}`}
  className="flex justify-between items-center py-2 px-3 rounded-md hover:bg-elevated transition"
>
  <span className="text-sm text-text-secondary">
    {formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' })}
  </span>
  <span className={`font-mono font-bold ${scoreColor}`}>{result.score}%</span>
</a>
```

Close button (lines 81-84):
```tsx
<button
  onClick={onClose}
  className="w-full mt-4 py-2 px-4 bg-elevated hover:bg-elevated/80 text-text-primary rounded-md font-medium transition border border-border-default"
>
  Close
</button>
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/components/HistoryView.tsx
git commit -m "feat: retheme HistoryView with neobrutalist tokens"
```

---

### Task 9: About Page

**Files:**
- Modify: `src/pages/about.astro`

- [ ] **Step 1: Update about.astro classes**

Main content area (line 11):
```html
<main class="max-w-3xl mx-auto px-4 py-12 text-text-secondary">
```

All headings (`text-white` → `text-text-primary`):
```html
<h1 class="text-4xl font-bold text-text-primary mb-4">CSS Daily</h1>
```
```html
<h2 class="text-2xl font-bold text-text-primary mb-4">The Story</h2>
```
```html
<h2 class="text-2xl font-bold text-text-primary mb-4">Built With AI</h2>
```
```html
<h2 class="text-2xl font-bold text-text-primary mb-4">How It Works</h2>
```
```html
<h2 class="text-2xl font-bold text-text-primary mb-4">Featured</h2>
```

Subtitle (line 16):
```html
<p class="text-xl text-text-muted">
```

All links (`text-blue-400 hover:text-blue-300` → `text-accent-primary hover:text-accent-primary/80`):
Apply to every `<a>` tag in the file (about 8 links in the body + 4 in the footer).

Footer (lines 127-129):
```html
<footer class="max-w-3xl mx-auto px-4 border-t-2 border-border-default pt-8 mt-12 mb-12 text-text-secondary">
```

Footer heading (line 130):
```html
<p class="text-text-primary mb-4">I'm currently open to new opportunities.</p>
```

- [ ] **Step 2: Build to verify**

Run: `npm run build`
Expected: Clean build.

- [ ] **Step 3: Commit**

```bash
git add src/pages/about.astro
git commit -m "feat: retheme about page with neobrutalist tokens"
```

---

### Task 10: Visual Verification

**Files:** None (verification only)

- [ ] **Step 1: Start dev server and verify all pages**

Run: `npm run dev`

Check each page visually:
1. `/` → Redirects to today's challenge
2. `/challenge/2026-04-02` → CSS challenge player: dark base background, cyan logo, blue buttons with brutal shadows, proper text hierarchy, bordered previews
3. `/tailwind/2026-04-02` → Tailwind player: same theme as CSS player
4. `/about` → About page: cyan links, proper text colors, bordered footer
5. Verify the code editors still render (CodeMirror oneDark theme should complement the new palette)
6. Verify modals open and display correctly (Results, Stats)

- [ ] **Step 2: Check for any remaining old gray classes**

Run: `grep -rn "bg-gray-\|text-gray-\|border-gray-" src/components/ src/pages/ src/layouts/`

Expected: No matches (all old classes should be replaced). If any remain, fix them.

- [ ] **Step 3: Final build check**

Run: `npm run build`
Expected: Clean build with zero errors and zero warnings.

- [ ] **Step 4: Commit any fixups**

If Step 2 found remaining old classes:
```bash
git add -A
git commit -m "fix: replace remaining old gray classes with theme tokens"
```
