export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Final score = PIXEL_WEIGHT * pixelScore + STRUCTURAL_WEIGHT * structural*100.
// Tunable. The structural component is linear for now; if unstyled-starter
// inflation shows up in practice (default block layout already overlaps
// targets), a power curve like the pixel score's SCORE_EXPONENT is the knob.
export const PIXEL_WEIGHT = 0.6;
export const STRUCTURAL_WEIGHT = 0.4;

/**
 * Intersection-over-union of two viewport-relative rects. 0 when disjoint;
 * two zero-area rects (e.g. both hidden) count as a match.
 */
export function rectIoU(a: ElementRect, b: ElementRect): number {
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  if (areaA === 0 && areaB === 0) return 1;

  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Mean IoU across 1:1 element pairs (matched by document order), 0..1.
 * Returns null when the lists can't be paired (length mismatch — corrupted
 * markup) or there is nothing to measure; callers fall back to pixel-only.
 */
export function computeStructuralScore(
  userRects: ElementRect[],
  targetRects: ElementRect[]
): number | null {
  if (userRects.length !== targetRects.length || targetRects.length === 0) return null;
  const total = targetRects.reduce((sum, t, i) => sum + rectIoU(userRects[i], t), 0);
  return total / targetRects.length;
}

/**
 * Blend the power-curved pixel score (0-100 int) with the structural score
 * (0..1 or null). Null structural -> pixel-only.
 */
export function blendScores(pixelScore: number, structural: number | null): number {
  if (structural === null) return pixelScore;
  return Math.round(PIXEL_WEIGHT * pixelScore + STRUCTURAL_WEIGHT * structural * 100);
}
