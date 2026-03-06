import type { DiffResult } from './types';
import { buildSrcdoc } from './code';

// Matches Synhax defaults
const COLOR_TOLERANCE = 30;
const BG_TOLERANCE = 10;
const MAX_RGB_DISTANCE = 441.67; // sqrt(255^2 + 255^2 + 255^2)

function rgbDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}

/**
 * Render HTML+CSS in a hidden iframe and capture using snapdom.
 * Uses snapdom() -> toSvg() -> canvas, matching Synhax's capture pipeline.
 */
export async function renderAndCapture(
  html: string,
  css: string,
  width: number,
  height: number
): Promise<HTMLCanvasElement> {
  const { snapdom } = await import('@zumer/snapdom');

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  iframe.style.top = '0';
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.border = 'none';
  iframe.setAttribute('sandbox', 'allow-same-origin');
  document.body.appendChild(iframe);

  try {
    const srcdoc = buildSrcdoc(html, css);
    const doc = iframe.contentDocument!;
    doc.open();
    doc.write(srcdoc);
    doc.close();

    // Wait for fonts and rendering
    await new Promise<void>((resolve) => {
      const check = () => {
        if (doc.fonts && doc.fonts.ready) {
          doc.fonts.ready.then(() => setTimeout(resolve, 100));
        } else {
          setTimeout(resolve, 200);
        }
      };
      if (doc.readyState === 'complete') check();
      else iframe.onload = () => check();
    });

    // Capture using snapdom -> toSvg -> canvas (matching Synhax pipeline)
    const body = doc.body;
    body.getBoundingClientRect(); // Force layout
    const snap = await snapdom(body);
    const svgImg = await snap.toSvg();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(svgImg, 0, 0, width, height);

    return canvas;
  } finally {
    document.body.removeChild(iframe);
  }
}

/**
 * Compare user CSS against target CSS using Synhax's algorithm:
 * - Euclidean RGB distance
 * - Background color detection from target top-left pixel (tight tolerance=10)
 * - Skip pixels where both are background
 * - Max mismatch (1.0) when one is background and other has content
 * - Gradient scoring: within tolerance=full match, beyond=scaled penalty
 */
export async function compareToTarget(
  html: string,
  userCss: string,
  targetCss: string,
  options: { compareWidth: number; compareHeight: number }
): Promise<DiffResult> {
  const { compareWidth: width, compareHeight: height } = options;

  const [userCanvas, targetCanvas] = await Promise.all([
    renderAndCapture(html, userCss, width, height),
    renderAndCapture(html, targetCss, width, height),
  ]);

  const userCtx = userCanvas.getContext('2d')!;
  const targetCtx = targetCanvas.getContext('2d')!;

  const userData = userCtx.getImageData(0, 0, width, height);
  const targetData = targetCtx.getImageData(0, 0, width, height);

  const userPixels = userData.data;
  const targetPixels = targetData.data;

  const totalPixels = width * height;

  // Detect background color from target's top-left pixel
  const bgR = targetPixels[0];
  const bgG = targetPixels[1];
  const bgB = targetPixels[2];

  const isBackgroundColor = (r: number, g: number, b: number): boolean => {
    return rgbDistance(r, g, b, bgR, bgG, bgB) <= BG_TOLERANCE;
  };

  // Per-pixel diff values: -1 = skipped, 0-1 = diff amount
  const SKIPPED = -1;
  const pixelDiffs = new Float32Array(totalPixels);
  let skippedCount = 0;

  for (let px = 0; px < totalPixels; px++) {
    const i = px * 4;

    const ur = userPixels[i], ug = userPixels[i + 1], ub = userPixels[i + 2], ua = userPixels[i + 3];
    const tr = targetPixels[i], tg = targetPixels[i + 1], tb = targetPixels[i + 2], ta = targetPixels[i + 3];

    // Determine effective alpha (background-colored pixels treated as transparent)
    const userIsBg = isBackgroundColor(ur, ug, ub);
    const targetIsBg = isBackgroundColor(tr, tg, tb);
    const effectiveUserA = userIsBg ? 0 : ua;
    const effectiveTargetA = targetIsBg ? 0 : ta;

    // Both background/transparent -> skip entirely
    if (effectiveUserA === 0 && effectiveTargetA === 0) {
      pixelDiffs[px] = SKIPPED;
      skippedCount++;
      continue;
    }

    // One has content, other is background -> maximum mismatch
    if ((effectiveUserA === 0 && effectiveTargetA > 0) ||
        (effectiveUserA > 0 && effectiveTargetA === 0)) {
      pixelDiffs[px] = 1;
      continue;
    }

    // Both have content -> euclidean distance scoring
    const dist = rgbDistance(ur, ug, ub, tr, tg, tb);
    pixelDiffs[px] = dist / MAX_RGB_DISTANCE;
  }

  // Score using Synhax's gradient euclidean approach
  const effectivePixels = totalPixels - skippedCount;
  const normalizedTolerance = COLOR_TOLERANCE / MAX_RGB_DISTANCE;

  let totalDiff = 0;
  for (let px = 0; px < totalPixels; px++) {
    const diff = pixelDiffs[px];
    if (diff === SKIPPED) continue;

    if (diff <= normalizedTolerance) {
      // Within tolerance = full match (0 penalty)
    } else {
      // Beyond tolerance = scaled penalty
      const excess = diff - normalizedTolerance;
      const maxExcess = 1 - normalizedTolerance;
      totalDiff += excess / maxExcess;
    }
  }

  const score = effectivePixels > 0
    ? Math.max(0, Math.min(100, Math.round((1 - totalDiff / effectivePixels) * 100)))
    : 0;

  // Generate heatmap canvas for visualization
  const heatmapCanvas = document.createElement('canvas');
  heatmapCanvas.width = width;
  heatmapCanvas.height = height;
  const heatmapCtx = heatmapCanvas.getContext('2d')!;
  const heatmapData = heatmapCtx.createImageData(width, height);

  for (let px = 0; px < totalPixels; px++) {
    const diff = pixelDiffs[px];
    const i = px * 4;

    if (diff === SKIPPED || diff <= normalizedTolerance) {
      // Transparent for skipped/matching pixels
      heatmapData.data[i] = 0;
      heatmapData.data[i + 1] = 0;
      heatmapData.data[i + 2] = 0;
      heatmapData.data[i + 3] = 0;
      continue;
    }

    // Heatmap: blue (small diff) to red (big diff)
    // Hue: 0.67 (blue, 240deg) down to 0 (red) based on diff
    const hue = (1 - diff) * 0.67;
    const [r, g, b] = hslToRgb(hue, 1, 0.5);
    heatmapData.data[i] = r;
    heatmapData.data[i + 1] = g;
    heatmapData.data[i + 2] = b;
    heatmapData.data[i + 3] = 255;
  }

  heatmapCtx.putImageData(heatmapData, 0, 0);

  // Diff canvas = user's render (for visual reference)
  const diffCanvas = document.createElement('canvas');
  diffCanvas.width = width;
  diffCanvas.height = height;
  const diffCtx = diffCanvas.getContext('2d')!;
  diffCtx.drawImage(userCanvas, 0, 0);

  return { score, diffCanvas, heatmapCanvas };
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}
