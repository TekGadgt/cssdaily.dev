import type { Page } from 'playwright';

export const MAX_COMPONENT_WIDTH = 520;
export const MAX_COMPONENT_HEIGHT = 320;

/**
 * Measure the bounding box of the rendered component: the union of
 * document.body's direct children rects (the body is a flex container
 * that centers the component; padding/background are environment chrome).
 * Absolutely-positioned or transformed descendants that extend beyond a
 * direct child's layout rect are not captured.
 */
export async function measureComponent(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of Array.from(document.body.children)) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.right);
      maxY = Math.max(maxY, r.bottom);
    }
    if (minX === Infinity) return { width: 0, height: 0 };
    return { width: Math.round(maxX - minX), height: Math.round(maxY - minY) };
  });
}

export function isOversize(size: { width: number; height: number }): boolean {
  return size.width > MAX_COMPONENT_WIDTH || size.height > MAX_COMPONENT_HEIGHT;
}
