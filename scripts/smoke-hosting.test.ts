import { describe, expect, it } from 'vitest';
import { pickSmokeTargets } from './smoke-hosting';

const c = (date: string, targetImage: string) => ({ date, targetImage });

describe('pickSmokeTargets', () => {
  const css = [
    c('2026-03-05', '2026-03-05.webp'),
    c('2026-03-06', '2026-03-06.webp'),
    c('2026-11-10', '2026-11-10-easy.webp'),
    c('2026-11-11', '2026-11-11-hard.webp'),
    c('2026-11-11', '2026-11-11-easy.webp'),
    c('2026-11-12', '2026-11-12-easy-0123456789ab.webp'),
  ];
  const tailwind = [c('2026-11-11', '2026-11-11-medium.webp'), c('2026-11-12', '2026-11-12-easy.webp')];

  it("picks the latest CSS day on or before today, never tomorrow's pre-generated one", () => {
    const { date, images } = pickSmokeTargets(css, tailwind, '2026-11-11');
    expect(date).toBe('2026-11-11');
    expect(images[0]).toEqual({ mode: 'css', image: '2026-11-11-easy.webp' });
  });

  it('includes the latest Tailwind image and the oldest legacy-named CSS image', () => {
    const { images } = pickSmokeTargets(css, tailwind, '2026-11-11');
    expect(images).toEqual([
      { mode: 'css', image: '2026-11-11-easy.webp' },
      { mode: 'tailwind', image: '2026-11-11-medium.webp' },
      { mode: 'css', image: '2026-03-05.webp' },
    ]);
  });

  it('handles hashed image names', () => {
    expect(pickSmokeTargets(css, tailwind, '2026-11-12').images[0]).toEqual({ mode: 'css', image: '2026-11-12-easy-0123456789ab.webp' });
  });

  it('omits the legacy check when there are no legacy names', () => {
    expect(pickSmokeTargets([c('2026-11-11', '2026-11-11-easy.webp')], tailwind, '2026-11-11').images).toHaveLength(2);
  });

  it('throws when either mode has nothing on or before today', () => {
    expect(() => pickSmokeTargets(css, [c('2026-11-12', 'x.webp')], '2026-11-11')).toThrow(/No CSS and Tailwind/);
    expect(() => pickSmokeTargets([], tailwind, '2026-11-11')).toThrow(/No CSS and Tailwind/);
  });
});
