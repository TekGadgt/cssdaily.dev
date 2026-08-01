import { describe, expect, it } from 'vitest';
import { resolveAvailableDate } from './date';

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
