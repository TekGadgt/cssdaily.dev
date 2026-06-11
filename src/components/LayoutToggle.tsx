import type { LayoutMode } from '../utils/types';

interface LayoutToggleProps {
  layout: LayoutMode;
  onChange: (layout: LayoutMode) => void;
}

export default function LayoutToggle({ layout, onChange }: LayoutToggleProps) {
  const next: LayoutMode = layout === 'rows' ? 'columns' : 'rows';
  return (
    <button
      onClick={() => onChange(next)}
      title={`Switch to ${next} layout`}
      aria-label={`Switch to ${next} layout`}
      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm inline-flex items-center rounded-lg transition"
    >
      {next === 'columns' ? (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6" height="6.5" rx="1" />
          <rect x="1" y="8.5" width="6" height="6.5" rx="1" />
          <rect x="8.5" y="1" width="6.5" height="14" rx="1" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <rect x="1" y="1" width="6.5" height="6" rx="1" />
          <rect x="8.5" y="1" width="6.5" height="6" rx="1" />
          <rect x="1" y="8.5" width="14" height="6.5" rx="1" />
        </svg>
      )}
    </button>
  );
}
