import type { Difficulty } from '../utils/types';
import { DIFFICULTY_ORDER, saveDifficultyPreference } from '../utils/difficulty';

interface DifficultySwitcherProps {
  available: Difficulty[];
}

const ACTIVE_CLASSES: Record<Difficulty, string> = {
  easy: '[[data-difficulty=easy]_&]:bg-green-900 [[data-difficulty=easy]_&]:text-green-300',
  medium: '[[data-difficulty=medium]_&]:bg-yellow-900 [[data-difficulty=medium]_&]:text-yellow-300',
  hard: '[[data-difficulty=hard]_&]:bg-red-900 [[data-difficulty=hard]_&]:text-red-300',
};

export default function DifficultySwitcher({ available }: DifficultySwitcherProps) {
  const select = (d: Difficulty) => {
    document.documentElement.dataset.difficulty = d;
    saveDifficultyPreference(d);
  };

  return (
    <div className="flex text-xs rounded overflow-hidden border border-gray-700">
      {DIFFICULTY_ORDER.filter((d) => available.includes(d)).map((d) => (
        <button
          key={d}
          onClick={() => select(d)}
          className={`px-2 py-0.5 capitalize text-gray-500 hover:text-white ${ACTIVE_CLASSES[d]}`}
        >
          {d}
        </button>
      ))}
    </div>
  );
}
