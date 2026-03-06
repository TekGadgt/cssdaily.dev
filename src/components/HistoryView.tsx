import { useState, useEffect } from 'react';
import { getHistory, getStats } from '../utils/storage';
import { formatDate } from '../utils/date';
import type { ChallengeHistory, UserStats } from '../utils/types';

interface HistoryViewProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HistoryView({ isOpen, onClose }: HistoryViewProps) {
  const [history, setHistory] = useState<ChallengeHistory>({});
  const [stats, setStats] = useState<UserStats>({ gamesPlayed: 0, currentStreak: 0, maxStreak: 0, averageScore: 0 });

  useEffect(() => {
    if (isOpen) {
      setHistory(getHistory());
      setStats(getStats());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sortedDates = Object.keys(history).sort().reverse();

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white text-center mb-4">Your Stats</h2>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: 'Played', value: stats.gamesPlayed },
            { label: 'Avg Score', value: `${stats.averageScore}%` },
            { label: 'Streak', value: stats.currentStreak },
            { label: 'Best', value: stats.maxStreak },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold text-white">{value}</div>
              <div className="text-xs text-gray-400">{label}</div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-medium text-gray-400 mb-2">Past Challenges</h3>
        {sortedDates.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-4">No challenges completed yet.</p>
        ) : (
          <div className="space-y-1">
            {sortedDates.map((date) => {
              const result = history[date];
              let scoreColor = 'text-red-400';
              if (result.score >= 80) scoreColor = 'text-green-400';
              else if (result.score >= 50) scoreColor = 'text-yellow-400';

              return (
                <a
                  key={date}
                  href={`/challenge/${date}`}
                  className="flex justify-between items-center py-2 px-3 rounded hover:bg-gray-700 transition"
                >
                  <span className="text-sm text-gray-300">
                    {formatDate(date, { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <span className={`font-mono font-bold ${scoreColor}`}>{result.score}%</span>
                </a>
              );
            })}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
        >
          Close
        </button>
      </div>
    </div>
  );
}
