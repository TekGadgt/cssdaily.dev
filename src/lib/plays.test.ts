import { describe, expect, it } from 'vitest';
import { MAX_PLAY_BYTES, UPSERT_PLAY_SQL, isSameOrigin, parsePlay, readLimited } from './plays';

const stream = (text: string) => new Response(text).body;

describe('parsePlay', () => {
  it('accepts a well-formed play', () => {
    expect(parsePlay({ mode: 'css', date: '2026-11-14', difficulty: 'hard' })).toEqual({ mode: 'css', date: '2026-11-14', difficulty: 'hard' });
  });

  it.each([
    ['bad mode', { mode: 'scss', date: '2026-11-14', difficulty: 'easy' }],
    ['bad date', { mode: 'css', date: '2026-1-14', difficulty: 'easy' }],
    ['bad difficulty', { mode: 'css', date: '2026-11-14', difficulty: 'expert' }],
    ['extra field', { mode: 'css', date: '2026-11-14', difficulty: 'easy', userId: 'x' }],
    ['missing field', { mode: 'css', date: '2026-11-14' }],
    ['array', ['css']],
    ['null', null],
  ])('rejects %s', (_label, body) => {
    expect(parsePlay(body)).toBeNull();
  });
});

describe('isSameOrigin', () => {
  it('accepts only the site origin', () => {
    const url = 'https://cssdaily.dev/api/plays';
    expect(isSameOrigin('https://cssdaily.dev', url)).toBe(true);
    expect(isSameOrigin('https://evil.example', url)).toBe(false);
    expect(isSameOrigin('https://www.cssdaily.dev', url)).toBe(false);
    expect(isSameOrigin('http://cssdaily.dev', url)).toBe(false);
    expect(isSameOrigin(null, url)).toBe(false);
    expect(isSameOrigin('null', url)).toBe(false);
  });
});

describe('readLimited', () => {
  it('returns small bodies and refuses oversize ones', async () => {
    await expect(readLimited(stream('{"a":1}'), MAX_PLAY_BYTES)).resolves.toBe('{"a":1}');
    await expect(readLimited(stream('x'.repeat(MAX_PLAY_BYTES + 1)), MAX_PLAY_BYTES)).resolves.toBeNull();
  });
});

describe('upsert', () => {
  it('increments per challenge per day and never stores anything else', () => {
    expect(UPSERT_PLAY_SQL).toMatch(/^INSERT INTO plays \(mode, date, difficulty, day, count\) VALUES \(\?, \?, \?, \?, 1\) ON CONFLICT \(mode, date, difficulty, day\) DO UPDATE SET count = count \+ 1$/);
  });
});
