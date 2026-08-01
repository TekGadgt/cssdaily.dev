import { describe, expect, it, vi } from 'vitest';
import { localToday, navigableDates, resolveAvailableDate } from './date';

describe('resolveAvailableDate', () => {
  const dates = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-08-02'];

  it('returns the ceiling itself when it is available', () => {
    expect(resolveAvailableDate(dates, '2026-07-29')).toBe('2026-07-29');
  });

  it('returns the latest date before the ceiling when the ceiling is missing', () => {
    expect(resolveAvailableDate(dates, '2026-08-01')).toBe('2026-07-30');
  });

  it('never returns a date after the ceiling', () => {
    // 2026-08-02 is present but must not leak for an earlier ceiling
    expect(resolveAvailableDate(dates, '2026-07-31')).toBe('2026-07-30');
  });

  it('returns the earliest available date when the ceiling precedes all of them', () => {
    expect(resolveAvailableDate(dates, '2020-01-01')).toBe('2026-07-28');
  });

  it('returns null for an empty list', () => {
    expect(resolveAvailableDate([], '2026-08-01')).toBeNull();
  });

  it('sorts unsorted input defensively', () => {
    const shuffled = ['2026-08-02', '2026-07-29', '2026-07-28', '2026-07-30'];
    expect(resolveAvailableDate(shuffled, '2026-08-01')).toBe('2026-07-30');
  });

  it('does not mutate the caller array', () => {
    const shuffled = ['2026-08-02', '2026-07-28'];
    resolveAvailableDate(shuffled, '2026-08-01');
    expect(shuffled).toEqual(['2026-08-02', '2026-07-28']);
  });

  it('handles a single date at or before the ceiling', () => {
    expect(resolveAvailableDate(['2026-07-30'], '2026-08-01')).toBe('2026-07-30');
  });

  it('handles a single date after the ceiling', () => {
    expect(resolveAvailableDate(['2026-09-01'], '2026-08-01')).toBe('2026-09-01');
  });
});

describe('navigableDates', () => {
  const dates = ['2026-07-28', '2026-07-29', '2026-07-30', '2026-08-02'];

  it('drops dates after the ceiling, so the "next" arrow cannot reach them', () => {
    expect(navigableDates(dates, '2026-07-30', '2026-08-01')).toEqual([
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
    ]);
  });

  it('keeps the current date even when it is past the ceiling', () => {
    // Direct access to a future page must still find its own index.
    const result = navigableDates(dates, '2026-08-02', '2026-08-01');
    expect(result).toEqual(['2026-07-28', '2026-07-29', '2026-07-30', '2026-08-02']);
    expect(result.indexOf('2026-08-02')).toBe(result.length - 1);
  });

  it('keeps a current date that is absent from the list entirely', () => {
    expect(navigableDates(dates, '2026-12-25', '2026-08-01')).toContain('2026-12-25');
  });

  it('does not duplicate the current date when it is already included', () => {
    expect(navigableDates(dates, '2026-07-29', '2026-08-01')).toEqual([
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
    ]);
  });

  it('sorts unsorted input and does not mutate the caller array', () => {
    const shuffled = ['2026-07-30', '2026-07-28', '2026-08-02'];
    expect(navigableDates(shuffled, '2026-07-28', '2026-08-01')).toEqual([
      '2026-07-28',
      '2026-07-30',
    ]);
    expect(shuffled).toEqual(['2026-07-30', '2026-07-28', '2026-08-02']);
  });
});

describe('localToday', () => {
  it('formats the local calendar date as zero-padded YYYY-MM-DD', () => {
    // Constructed from local components, so this is Feb 3 local wherever the
    // suite runs — and the single-digit month and day must come back padded.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 3, 23, 30, 0));
    try {
      expect(localToday()).toBe('2026-02-03');
    } finally {
      vi.useRealTimers();
    }
  });
});
