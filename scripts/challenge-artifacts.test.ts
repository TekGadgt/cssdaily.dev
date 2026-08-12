import { describe, expect, it } from 'vitest';
import { buildCssChallenge, buildTailwindChallenge } from './challenge-artifacts';

describe('generated challenge artifacts', () => {
  it('preserves the existing CSS JSON shape', () => {
    expect(buildCssChallenge({
      title: 'Card',
      html: '<article></article>',
      targetCss: 'article { display: flex; }',
      starterCss: 'article {}',
    }, '2026-08-20', 'medium')).toEqual({
      title: 'Card',
      difficulty: 'medium',
      target: { html: '<article></article>', css: 'article { display: flex; }' },
      starter: { html: '<article></article>', css: 'article {}' },
      date: '2026-08-20',
      timeLimit: 600,
      targetImage: '2026-08-20-medium.webp',
    });
  });

  it('preserves the existing Tailwind JSON shape', () => {
    expect(buildTailwindChallenge({
      title: 'Badge',
      targetHtml: '<span class="p-2"></span>',
      starterHtml: '<span class="  "></span>',
    }, '2026-08-20', 'easy')).toEqual({
      title: 'Badge',
      difficulty: 'easy',
      date: '2026-08-20',
      timeLimit: 300,
      starter: { html: '<span class="  "></span>' },
      target: { html: '<span class="p-2"></span>' },
      targetImage: '2026-08-20-easy.webp',
    });
  });
});
