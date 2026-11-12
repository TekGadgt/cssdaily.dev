/**
 * Canonical starter-CSS layout: every empty rule is
 *
 *   selector {
 *
 *   }
 *
 * with one blank line between top-level rules and a trailing newline.
 * Non-empty rules (the :root variables, preset rules like `body { … }`)
 * keep their content exactly. Only whitespace ever changes —
 * `sameIgnoringWhitespace` is the invariant callers can assert.
 */

interface Block {
  prelude: string;
  body: string;
}

/**
 * Splits top-level `prelude { body }` blocks, respecting strings, comments
 * and nesting. With `dropStray`, an unmatched top-level `}` (a generator
 * slip that browsers ignore) is removed and counted instead of throwing.
 */
function splitBlocks(css: string, dropStray: boolean): { blocks: Block[]; rest: string; strays: number } {
  const blocks: Block[] = [];
  let strays = 0;
  let depth = 0;
  let start = 0;
  let open = -1;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      for (i++; i < css.length && css[i] !== ch; i++) if (css[i] === '\\') i++;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) open = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth < 0) {
        if (!dropStray || css.slice(start, i).trim()) throw new Error('Unbalanced "}" in starter CSS');
        strays++;
        depth = 0;
        start = i + 1;
        continue;
      }
      if (depth === 0) {
        blocks.push({ prelude: css.slice(start, open), body: css.slice(open + 1, i) });
        start = i + 1;
      }
    }
  }
  if (depth !== 0) throw new Error('Unbalanced "{" in starter CSS');
  return { blocks, rest: css.slice(start), strays };
}

export interface NormalizeResult {
  css: string;
  /** Unmatched top-level `}` removed (only with dropStrayBraces) */
  strayBraces: number;
}

export function normalizeStarterCssDetailed(css: string, opts: { dropStrayBraces?: boolean } = {}): NormalizeResult {
  const { blocks, rest, strays } = splitBlocks(css, opts.dropStrayBraces ?? false);
  if (rest.trim()) throw new Error(`Unexpected trailing starter CSS: ${rest.trim().slice(0, 40)}`);
  const out = blocks.map(({ prelude, body }) => {
    const selector = prelude.trim();
    return body.trim() === '' ? `${selector} {\n\n}` : `${selector} {${body}}`;
  });
  return { css: out.length ? `${out.join('\n\n')}\n` : '', strayBraces: strays };
}

export function normalizeStarterCss(css: string): string {
  return normalizeStarterCssDetailed(css).css;
}

/** True when two CSS strings differ only in whitespace (and, optionally, `strayBraces` removed `}`s). */
export function sameIgnoringWhitespace(normalized: string, original: string, strayBraces = 0): boolean {
  const squash = (s: string) => s.replace(/\s+/g, '');
  const a = squash(normalized);
  const b = squash(original);
  if (strayBraces === 0) return a === b;
  // Every removed brace must be a lone top-level "}" — compare with them
  // stripped from wherever "}}" (end of block + stray) occurs in the original.
  let stripped = b;
  for (let n = 0; n < strayBraces; n++) stripped = stripped.replace(/\}\}/, '}');
  return a === stripped;
}
