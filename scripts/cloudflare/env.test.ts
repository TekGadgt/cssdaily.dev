import { describe, expect, it } from 'vitest';
import { readEnv, requireEnv } from './env';

describe('readEnv', () => {
  it('returns trimmed values', () => {
    expect(readEnv('X', { X: '  abc \n' })).toBe('abc');
  });

  it('treats blank and whitespace-only values as unset', () => {
    expect(readEnv('X', { X: '' })).toBeUndefined();
    expect(readEnv('X', { X: '   ' })).toBeUndefined();
    expect(readEnv('X', {})).toBeUndefined();
  });

  it('requireEnv names the missing variable', () => {
    expect(() => requireEnv('D1_DATABASE_ID', { D1_DATABASE_ID: ' ' })).toThrow(/D1_DATABASE_ID/);
  });
});
