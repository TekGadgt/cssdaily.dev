import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { normalizeStarterCss, normalizeStarterCssDetailed, sameIgnoringWhitespace } from './starter-css';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'challenges', 'css');

describe('normalizeStarterCss', () => {
  it('formats inline and multiline empty rules identically', () => {
    const want = ':root {\n  --ink: #111;\n}\n\n.card {\n\n}\n\n.card h1 {\n\n}\n';
    expect(normalizeStarterCss(':root {\n  --ink: #111;\n}\n.card {}\n.card h1 {}')).toBe(want);
    expect(normalizeStarterCss(':root {\n  --ink: #111;\n}\n\n.card {\n}\n\n.card h1 {\n}\n')).toBe(want);
    expect(normalizeStarterCss(':root {\n  --ink: #111;\n}\n.card { }\n\n\n.card h1 {\n\n\n}')).toBe(want);
  });

  it('keeps non-empty rules and quoted strings exactly', () => {
    const css = ':root {\n  --a: "}{";\n}\nbody {\n  display: flex;\n}\n.x::before {}';
    expect(normalizeStarterCss(css)).toBe(':root {\n  --a: "}{";\n}\n\nbody {\n  display: flex;\n}\n\n.x::before {\n\n}\n');
  });

  it('is idempotent', () => {
    const once = normalizeStarterCss('.a {}\n.b {\n}');
    expect(normalizeStarterCss(once)).toBe(once);
  });

  it('only ever changes whitespace, on every committed fixture', () => {
    for (const file of fs.readdirSync(FIXTURES)) {
      const css = JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')).starter.css as string;
      const out = normalizeStarterCss(css);
      expect(sameIgnoringWhitespace(out, css)).toBe(true);
      expect(out).not.toMatch(/\{\}|\{\n\}/);
    }
  });

  it('drops a stray closing brace only when asked, and reports it', () => {
    const css = ':root {\n  --a: 1;\n}\n\n.card {\n}\n}';
    expect(() => normalizeStarterCss(css)).toThrow(/Unbalanced "}"/);
    const result = normalizeStarterCssDetailed(css, { dropStrayBraces: true });
    expect(result).toEqual({ css: ':root {\n  --a: 1;\n}\n\n.card {\n\n}\n', strayBraces: 1 });
    expect(sameIgnoringWhitespace(result.css, css, result.strayBraces)).toBe(true);
    expect(sameIgnoringWhitespace(result.css, css)).toBe(false);
    // A "}" with content before it isn't a lone stray brace: never dropped
    expect(() => normalizeStarterCssDetailed('.a {}\ncolor: red; }', { dropStrayBraces: true })).toThrow(/Unbalanced/);
  });

  it('rejects unbalanced CSS instead of guessing', () => {
    expect(() => normalizeStarterCss('.a {')).toThrow(/Unbalanced/);
    expect(() => normalizeStarterCss('.a {}}')).toThrow(/Unbalanced/);
  });
});
