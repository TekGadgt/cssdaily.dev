import { describe, expect, it } from 'vitest';
import { imageKey, keysToPrune } from './backup';

describe('backup retention', () => {
  it('prunes all but the newest exports', () => {
    const keys = ['d1/2026-11-22.sql', 'd1/2026-11-08.sql', 'd1/2026-11-15.sql', 'd1/2026-11-01.sql'];
    expect(keysToPrune(keys, 2)).toEqual(['d1/2026-11-01.sql', 'd1/2026-11-08.sql']);
    expect(keysToPrune(keys, 12)).toEqual([]);
  });

  it('mirrors the assets bucket layout for images', () => {
    expect(imageKey({ mode: 'tailwind', target_image: '2026-11-14-easy-0123456789ab.webp' })).toBe('targets/tailwind/2026-11-14-easy-0123456789ab.webp');
  });
});
