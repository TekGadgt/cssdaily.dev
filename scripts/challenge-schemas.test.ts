import { describe, expect, it } from 'vitest';
import {
  cssChallengeFieldsSchema,
  normalizeTailwindFields,
  parseCssChallengeXml,
  parseTailwindChallengeXml,
  tailwindChallengeFieldsSchema,
} from './challenge-schemas';

describe('challenge schemas', () => {
  it('accepts the CSS structured-output shape', () => {
    expect(cssChallengeFieldsSchema.parse({
      title: 'Card',
      html: '<article></article>',
      targetCss: 'article { display: flex; }',
      starterCss: 'article {}',
    })).toEqual({
      title: 'Card',
      html: '<article></article>',
      targetCss: 'article { display: flex; }',
      starterCss: 'article {}',
    });
  });

  it('accepts the Tailwind structured-output shape', () => {
    expect(tailwindChallengeFieldsSchema.parse({
      title: 'Badge',
      targetHtml: '<span class="px-2"></span>',
      starterHtml: '<span class=""></span>',
    }).title).toBe('Badge');
  });

  it('parses the legacy Anthropic CSS XML format', () => {
    expect(parseCssChallengeXml('<title>Card</title><html><article></article></html><targetcss>a{}</targetcss><startercss>b{}</startercss>'))
      .toEqual({ title: 'Card', html: '<article></article>', targetCss: 'a{}', starterCss: 'b{}' });
  });

  it('parses Anthropic Tailwind XML and normalizes empty classes', () => {
    expect(parseTailwindChallengeXml('<title>Badge</title><targethtml><span class="p-2"></span></targethtml><starterhtml><span class=""></span></starterhtml>').starterHtml)
      .toBe('<span class="  "></span>');
  });

  it('normalizes all whitespace-only starter classes from structured output', () => {
    expect(normalizeTailwindFields({
      title: 'Badge',
      targetHtml: '<span class="p-2"></span>',
      starterHtml: '<span class="   "></span>',
    }).starterHtml).toBe('<span class="  "></span>');
  });

  it('rejects missing structured-output fields', () => {
    expect(() => cssChallengeFieldsSchema.parse({ title: 'Incomplete' })).toThrow();
  });
});
