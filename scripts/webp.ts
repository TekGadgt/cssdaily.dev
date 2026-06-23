import sharp from 'sharp';

/**
 * Encode a PNG buffer to lossless WebP. The target screenshots are flat UI
 * renders, so lossless WebP cuts file size without changing decoded pixels.
 */
export function encodeWebpLossless(png: Buffer): Promise<Buffer> {
  return sharp(png).webp({ lossless: true, effort: 6 }).toBuffer();
}
