import { useEffect, useState } from 'react';
import type { Difficulty } from '../utils/types';
import { DIFFICULTY_ORDER, saveDifficultyPreference } from '../utils/difficulty';

interface DifficultySwitcherProps {
  available: Difficulty[];
}

// Visual active state is CSS-only (driven by <html data-difficulty>, stamped
// pre-paint) so it never flashes. The hover literals lock the active color at
// higher specificity than `hover:text-white`, independent of stylesheet order.
const ACTIVE_CLASSES: Record<Difficulty, string> = {
  easy: '[[data-difficulty=easy]_&]:bg-green-900 [[data-difficulty=easy]_&]:text-green-300 [[data-difficulty=easy]_&]:hover:text-green-300',
  medium: '[[data-difficulty=medium]_&]:bg-yellow-900 [[data-difficulty=medium]_&]:text-yellow-300 [[data-difficulty=medium]_&]:hover:text-yellow-300',
  hard: '[[data-difficulty=hard]_&]:bg-red-900 [[data-difficulty=hard]_&]:text-red-300 [[data-difficulty=hard]_&]:hover:text-red-300',
};

export default function DifficultySwitcher({ available }: DifficultySwitcherProps) {
  // aria-pressed needs real state for screen readers; hydrated post-mount so
  // the build-time render (no document) never mismatches
  const [selected, setSelected] = useState<Difficulty | null>(null);

  useEffect(() => {
    setSelected((document.documentElement.dataset.difficulty as Difficulty) ?? null);
  }, []);

  const select = (d: Difficulty) => {
    document.documentElement.dataset.difficulty = d;
    saveDifficultyPreference(d);
    setSelected(d);
  };

  return (
    <div className="flex text-xs rounded overflow-hidden border border-gray-700" role="group" aria-label="Difficulty">
      {DIFFICULTY_ORDER.filter((d) => available.includes(d)).map((d) => (
        <button
          key={d}
          onClick={() => select(d)}
          aria-pressed={selected === d}
          className={`px-2 py-0.5 capitalize text-gray-500 hover:text-white ${ACTIVE_CLASSES[d]}`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
