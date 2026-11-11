import { describe, expect, it } from 'vitest';
import { pickSmokeTargets } from './smoke-hosting';

describe('pickSmokeTargets', () => {
  it('picks the latest date on or before today', () => {
    expect(pickSmokeTargets(
      ['2026-11-08-easy.json', '2026-11-09-easy.json', '2026-11-10-hard.json'],
      ['2026-11-08-easy.webp', '2026-11-09-easy.webp', '2026-11-10-hard.webp'],
      '2026-11-10',
    )).toEqual({ date: '2026-11-10', image: '2026-11-10-hard.webp' });
  });

  it("ignores tomorrow's pre-generated challenge", () => {
    expect(pickSmokeTargets(
      ['2026-11-10-easy.json', '2026-11-11-easy.json'],
      ['2026-11-10-easy.webp', '2026-11-11-easy.webp'],
      '2026-11-10',
    )).toEqual({ date: '2026-11-10', image: '2026-11-10-easy.webp' });
  });

  it('accepts a legacy unsuffixed pair', () => {
    expect(pickSmokeTargets(['2026-03-05.json'], ['2026-03-05.webp'], '2026-11-10'))
      .toEqual({ date: '2026-03-05', image: '2026-03-05.webp' });
  });

  it('skips a date whose target image is missing', () => {
    expect(pickSmokeTargets(
      ['2026-11-09-medium.json', '2026-11-10-medium.json'],
      ['2026-11-09-medium.webp'],
      '2026-11-10',
    )).toEqual({ date: '2026-11-09', image: '2026-11-09-medium.webp' });
  });

  it('ignores files that are not challenge JSON', () => {
    expect(pickSmokeTargets(
      ['.gitkeep', 'notes.json', '2026-11-09-easy.json'],
      ['2026-11-09-easy.webp'],
      '2026-11-10',
    )).toEqual({ date: '2026-11-09', image: '2026-11-09-easy.webp' });
  });

  it('throws when nothing qualifies', () => {
    expect(() => pickSmokeTargets(['2026-11-11-easy.json'], ['2026-11-11-easy.webp'], '2026-11-10'))
      .toThrow(/no challenge/i);
    expect(() => pickSmokeTargets([], [], '2026-11-10')).toThrow(/no challenge/i);
  });
});
