import { useEffect } from 'react';
import type { TailwindChallenge } from '../utils/types';
import { formatDate } from '../utils/date';
import { TAILWIND_PREVIEW_WIDTH, TAILWIND_PREVIEW_HEIGHT } from './TailwindPreview';
import TailwindEditor from './TailwindEditor';

interface TailwindPlayerProps {
  challenge: TailwindChallenge;
  allDates: string[];
}

export default function TailwindSolution({ challenge, allDates }: TailwindPlayerProps) {
  const sortedDates = [...allDates].sort();
  const currentIdx = sortedDates.indexOf(challenge.date);
  const prevDate = currentIdx > 0 ? sortedDates[currentIdx - 1] : null;
  const nextDate = currentIdx < sortedDates.length - 1 ? sortedDates[currentIdx + 1] : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            {prevDate ? (
              <a href={`/tailwind/${prevDate}`} className="hover:text-white">&larr;</a>
            ) : (
              <span className="text-gray-600">&larr;</span>
            )}
            <span>{formatDate(challenge.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {nextDate ? (
              <a href={`/tailwind/${nextDate}`} className="hover:text-white">&rarr;</a>
            ) : (
              <span className="text-gray-600">&rarr;</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{challenge.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
              challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
                'bg-red-900 text-red-300'
              }`}>
              {challenge.difficulty}
            </span>
          </div>
          <div className="w-5"></div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-4 flex flex-col flex-1 min-h-0">
        {/* Preview panels */}
        <div className="flex justify-between mb-4 flex-shrink-0">
          {/* User Preview */}
          <div>
            <div className="flex items-center h-8 mb-2">
              <h3 className="text-sm font-medium text-gray-400">Solution</h3>
            </div>
            <div className="rounded-lg overflow-auto overflow-y-auto border border-gray-700" style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT }}>
              {/* Tailwind Editor */}
        <div className="rounded-lg overflow-scroll border border-gray-700 flex-1 min-h-0">
          <TailwindEditor
            initialHtml={challenge.target.html}
            onChange={() => {}}
          />
        </div>
            </div>
          </div>

          {/* Target Panel */}
          <div>
            <div className="flex items-center gap-2 h-8 mb-2">
              <h3 className="text-sm font-medium text-gray-400">Target</h3>
            </div>
            <div className="rounded-lg overflow-hidden border border-gray-700 relative" style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, background: '#f5f5f5' }}>
              
                <img
                  src={`/targets/tailwind/${challenge.date}.png`}
                  alt="Target"
                  style={{ width: TAILWIND_PREVIEW_WIDTH, height: TAILWIND_PREVIEW_HEIGHT, objectFit: 'contain' }}
                />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
