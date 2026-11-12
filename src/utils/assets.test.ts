import { describe, expect, it } from 'vitest';
import { resolveAssetBase, targetImageUrl } from './assets';

describe('asset URLs', () => {
  it('defaults blank or missing bases to the assets domain', () => {
    expect(resolveAssetBase(undefined)).toBe('https://assets.cssdaily.dev');
    expect(resolveAssetBase('')).toBe('https://assets.cssdaily.dev');
    expect(resolveAssetBase('   ')).toBe('https://assets.cssdaily.dev');
    expect(resolveAssetBase('http://localhost:9000/')).toBe('http://localhost:9000');
  });

  it('builds per-mode target URLs for legacy, suffixed, and hashed names', () => {
    const base = 'https://assets.cssdaily.dev';
    expect(targetImageUrl('css', { date: '2026-03-05', targetImage: '2026-03-05.webp' }, base))
      .toBe('https://assets.cssdaily.dev/targets/css/2026-03-05.webp');
    expect(targetImageUrl('tailwind', { date: '2026-11-11', targetImage: '2026-11-11-hard.webp' }, base))
      .toBe('https://assets.cssdaily.dev/targets/tailwind/2026-11-11-hard.webp');
    expect(targetImageUrl('css', { date: '2026-11-14', targetImage: '2026-11-14-easy-0123456789ab.webp' }, base))
      .toBe('https://assets.cssdaily.dev/targets/css/2026-11-14-easy-0123456789ab.webp');
    expect(targetImageUrl('css', { date: '2026-03-06' }, base)).toBe('https://assets.cssdaily.dev/targets/css/2026-03-06.webp');
  });
});
