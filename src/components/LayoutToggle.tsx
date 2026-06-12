import { saveLayoutPreference } from '../utils/storage';
import type { LayoutMode } from '../utils/types';

/**
 * Toggles between rows and columns layout. The current mode lives on
 * <html data-layout> — set before first paint by an inline script in
 * Layout.astro — and all layout-dependent classes react to it via CSS
 * data-attribute variants, so navigation never flashes the wrong layout.
 */
export default function LayoutToggle() {
  const toggle = () => {
    const next: LayoutMode = document.documentElement.dataset.layout === 'columns' ? 'rows' : 'columns';
    document.documentElement.dataset.layout = next;
    saveLayoutPreference(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title="Toggle layout"
      aria-label="Toggle layout"
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm inline-flex items-center rounded-lg transition"
    >
      {/* Each icon previews the layout clicking switches to; CSS swaps them */}
      <svg className="[[data-layout=columns]_&]:hidden" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6.5" rx="1" />
        <rect x="1" y="8.5" width="6" height="6.5" rx="1" />
        <rect x="8.5" y="1" width="6.5" height="14" rx="1" />
      </svg>
      <svg className="hidden [[data-layout=columns]_&]:block" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <rect x="1" y="1" width="6.5" height="6" rx="1" />
        <rect x="8.5" y="1" width="6.5" height="6" rx="1" />
        <rect x="1" y="8.5" width="14" height="6.5" rx="1" />
      </svg>
    </button>
  );
}
