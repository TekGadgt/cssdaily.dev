import { useEffect, useState } from 'react';
import type { Difficulty } from '../utils/types';
import { DIFFICULTY_ORDER, saveDifficultyPreference } from '../utils/difficulty';

interface DifficultySwitcherProps {
  available: Difficulty[];
}

// Visual active state is CSS-only (driven by <html data-difficulty>, stamped
// pre-paint) so it never flashes. The hover literals lock the active color
// and background at higher specificity than the base hover utilities,
// independent of stylesheet order.
const ACTIVE_CLASSES: Record<Difficulty, string> = {
  easy: '[[data-difficulty=easy]_&]:bg-green-900 [[data-difficulty=easy]_&]:text-green-300 [[data-difficulty=easy]_&]:hover:bg-green-900 [[data-difficulty=easy]_&]:hover:text-green-300',
  medium: '[[data-difficulty=medium]_&]:bg-yellow-900 [[data-difficulty=medium]_&]:text-yellow-300 [[data-difficulty=medium]_&]:hover:bg-yellow-900 [[data-difficulty=medium]_&]:hover:text-yellow-300',
  hard: '[[data-difficulty=hard]_&]:bg-red-900 [[data-difficulty=hard]_&]:text-red-300 [[data-difficulty=hard]_&]:hover:bg-red-900 [[data-difficulty=hard]_&]:hover:text-red-300',
};

const LABELS: Record<Difficulty, string> = { easy: 'E', medium: 'M', hard: 'H' };

export default function DifficultySwitcher({ available }: DifficultySwitcherProps) {
  // aria-pressed needs real state for screen readers; hydrated post-mount so
  // the build-time render (no document) never mismatches. Observed from the
  // html attribute (not set locally on click) because each player in a
  // multi-difficulty set mounts its own switcher instance — they must all
  // stay in sync no matter which one was clicked, including the players'
  // fallback effect rewriting the attribute.
  const [selected, setSelected] = useState<Difficulty | null>(null);

  useEffect(() => {
    const read = () => setSelected((document.documentElement.dataset.difficulty as Difficulty) ?? null);
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-difficulty'] });
    return () => observer.disconnect();
  }, []);

  const select = (d: Difficulty) => {
    document.documentElement.dataset.difficulty = d;
    saveDifficultyPreference(d);
  };

  return (
    // Themed like the neighboring control buttons (h-8, gray-700 base);
    // single letters keep the cluster compact — full names go to aria/title
    <div className="flex h-8 rounded-lg overflow-hidden divide-x divide-gray-800" role="group" aria-label="Difficulty">
      {DIFFICULTY_ORDER.filter((d) => available.includes(d)).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => select(d)}
          aria-pressed={selected === d}
          aria-label={d}
          title={d.charAt(0).toUpperCase() + d.slice(1)}
          className={`px-2.5 text-sm font-medium inline-flex items-center bg-gray-700 hover:bg-gray-600 text-gray-400 hover:text-white ${ACTIVE_CLASSES[d]}`}
        >
          {LABELS[d]}
        </button>
      ))}
    </div>
  );
}
