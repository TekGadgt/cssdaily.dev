import { describe, expect, it, vi } from 'vitest';
import { describeError, isNetworkError, withNetworkRetry } from './errors';

describe('describeError', () => {
  it('surfaces the nested cause Node hides behind "fetch failed"', () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    expect(describeError(new TypeError('fetch failed', { cause: socket }))).toBe('fetch failed ← other side closed (UND_ERR_SOCKET)');
  });

  it('handles non-errors', () => {
    expect(describeError('plain')).toBe('plain');
  });
});

describe('withNetworkRetry', () => {
  it('retries network errors only', async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce('ok');
    await expect(withNetworkRetry(flaky, 3, 0)).resolves.toBe('ok');

    const broken = vi.fn(async () => { throw new Error('Refusing to overwrite x'); });
    await expect(withNetworkRetry(broken, 3, 0)).rejects.toThrow(/Refusing/);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry budget', async () => {
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(withNetworkRetry(down, 2, 0)).rejects.toThrow(/fetch failed/);
    expect(down).toHaveBeenCalledTimes(3);
    expect(isNetworkError(new Error('fetch failed'))).toBe(false); // only TypeErrors from fetch
  });
});
