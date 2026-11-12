const DEFAULT_ASSET_BASE = 'https://assets.cssdaily.dev';

/**
 * Where target images (and the public data snapshot) are served from: the
 * R2 bucket behind assets.cssdaily.dev. A blank PUBLIC_ASSET_BASE counts as
 * unset — it must never produce relative image URLs.
 */
export function resolveAssetBase(value: string | undefined): string {
  const trimmed = value?.trim();
  return (trimmed || DEFAULT_ASSET_BASE).replace(/\/+$/, '');
}

export const ASSET_BASE = resolveAssetBase(import.meta.env.PUBLIC_ASSET_BASE);

/** Target screenshot URL; legacy challenges without targetImage use `<date>.webp`. */
export function targetImageUrl(
  mode: 'css' | 'tailwind',
  challenge: { date: string; targetImage?: string },
  base: string = ASSET_BASE
): string {
  return `${base}/targets/${mode}/${challenge.targetImage ?? `${challenge.date}.webp`}`;
}
