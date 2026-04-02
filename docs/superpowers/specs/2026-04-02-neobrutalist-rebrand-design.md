# CSS Daily — Neobrutalist-Lite Visual Rebrand

**Date:** 2026-04-02
**Branch:** `themes`
**Scope:** Pure aesthetic reskin — same layout, structure, and logic

## Overview

Rebrand CSS Daily with a "neobrutalist-lite" aesthetic: dark-first, sharp borders, bold cool/techy accent colors, and a developer-tool-with-personality feel. Restrained — the brutalist touches are accents, not the whole identity.

## Approach: Hybrid Theme System (Approach C)

- **Colors** defined as CSS custom properties on `:root`, mapped into Tailwind via `var()` references
- **Fonts, shadows, borders, spacing** defined directly in `tailwind.config.mjs`
- Challenge generation and rendering are fully isolated (inline CSS / Tailwind CDN) and unaffected by config changes

## Color System

CSS custom properties on `:root` in `Layout.astro`, mapped into `tailwind.config.mjs`.

### Backgrounds

| Token              | Hex       | Usage                                    |
|--------------------|-----------|------------------------------------------|
| `--bg-base`        | `#0B0F14` | Page background                          |
| `--bg-surface`     | `#111827` | Cards, panels, editor areas              |
| `--bg-elevated`    | `#182235` | Hover states, active tabs, dropdowns     |

### Text

| Token              | Hex       | Usage                                    |
|--------------------|-----------|------------------------------------------|
| `--text-primary`   | `#E6F0FF` | Headings, primary content                |
| `--text-secondary` | `#A9BCD6` | Body text, descriptions                  |
| `--text-muted`     | `#6F819A` | Timestamps, hints, placeholders          |

### Accents

| Token                | Hex       | Usage                                  |
|----------------------|-----------|----------------------------------------|
| `--accent-primary`   | `#00D4FF` | Primary buttons, links, active states  |
| `--accent-secondary` | `#2F7BFF` | Secondary actions, selected tabs       |
| `--accent-tertiary`  | `#39F58F` | Success states, score highlights       |

### Borders

| Token              | Hex       | Usage                                    |
|--------------------|-----------|------------------------------------------|
| `--border-default` | `#2A3447` | Subtle dividers, card edges              |
| `--border-strong`  | `#3A4A63` | Emphasized borders, focused inputs       |

### Status

| Token       | Hex       | Usage                                         |
|-------------|-----------|-----------------------------------------------|
| `--success` | `#2EEA8A` | Pass/high score                               |
| `--error`   | `#FF5C7A` | Fail/low score                                |
| `--warning` | `#FFC857` | Timer warnings                                |

## Neobrutalist Design Tokens

Defined directly in `tailwind.config.mjs`.

### Borders

- `1px` — Default UI chrome (cards, dividers)
- `2px` — Interactive elements (buttons, tabs, selected cards, inputs)
- `3px` — High-emphasis only (primary CTA, active challenge card)

### Border Radius

- `6px` (`rounded-md`) for most UI elements
- `4px` for smaller/dense controls
- No pills or fully-rounded — keep edges sharp

### Shadows (Hard Offset, No Blur)

- `shadow-brutal-sm`: `2px 2px 0 0 rgba(0,0,0,0.45)` — Buttons, small interactive elements
- `shadow-brutal-md`: `4px 4px 0 0 rgba(0,0,0,0.5)` — Cards, modals, prominent containers
- Used sparingly on actionable elements only; containers stay mostly flat

### Focus Ring

- `2px` solid `--accent-primary` (`#00D4FF`) with `2px` offset

### General Principles

- Flat surfaces with visible borders rather than gradients or soft shadows
- High contrast between layers (base -> surface -> elevated)
- Brutalist touches are accents, not the whole personality

## Typography

### Font Pairing

- **UI text:** Space Grotesk — geometric, slightly quirky, fits the brutalist aesthetic
- **Code/editor:** JetBrains Mono — excellent readability, ligatures, developer standard

### Tailwind Font Stacks

- `font-sans`: `"Space Grotesk", "Inter", "Segoe UI", sans-serif`
- `font-mono`: `"JetBrains Mono", "IBM Plex Mono", "SFMono-Regular", monospace`

### Loading Strategy

- Google Fonts with `display=swap`
- Weights: Space Grotesk 400/500/600/700, JetBrains Mono 400/500

### Sizing

- Keep existing Tailwind scale (`text-sm`, `text-base`, `text-lg`, etc.)
- Headings: `font-sans` with `font-bold` or `font-semibold`
- Body/UI: `font-sans` at normal weight
- Code areas: `font-mono`
- No type mixing beyond sans + mono

## Implementation Scope

### Files That Change

| File                                | What Changes                                              |
|-------------------------------------|-----------------------------------------------------------|
| `tailwind.config.mjs`              | Custom colors (mapped to CSS vars), fonts, shadows, borders |
| `src/layouts/Layout.astro`         | CSS custom properties on `:root`, Google Fonts links, base classes |
| `src/components/Header.astro`      | Color/border/font classes                                 |
| `src/components/ChallengePlayer.tsx`| Color/border/font classes                                |
| `src/components/TailwindPlayer.tsx` | Color/border/font classes                                |
| `src/components/CodeEditor.tsx`    | Surrounding chrome classes                                |
| `src/components/TailwindEditor.tsx`| Surrounding chrome classes                                |
| `src/components/Timer.tsx`         | Colors (warning state uses `--warning`)                   |
| `src/components/ScoreDisplay.tsx`  | Score colors to use accent/success palette                |
| `src/components/ResultsModal.tsx`  | Modal chrome classes                                      |
| `src/components/HistoryView.tsx`   | Card/text classes                                         |
| `src/pages/*.astro`               | Inline color classes on page-level elements               |

### Files That Don't Change

- `scripts/*` — Challenge generation untouched
- `src/utils/*` — Logic unchanged
- `src/data/*` — Challenge data unchanged
- `public/targets/*` — Target PNGs unchanged

### What Stays the Same

- Layout, spacing, component hierarchy
- All game logic (scoring, timer, diffing)
- Editor functionality
- Routing
