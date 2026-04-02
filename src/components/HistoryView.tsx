import { useState, useEffect } from 'react';
import { getHistory as getDefaultHistory, getStats as getDefaultStats } from '../utils/storage';
import { formatDate } from '../utils/date';
import type { GenericHistory, UserStats } from '../utils/types';

interface HistoryViewProps {
  isOpen: boolean;
  onClose: () => void;
  basePath?: string;
  getHistoryFn?: () => GenericHistory;
  getStatsFn?: () => UserStats;
}

export default function HistoryView({
  isOpen,
  onClose,
  basePath = '/challenge',
  getHistoryFn = getDefaultHistory,
  getStatsFn = getDefaultStats,
}: HistoryViewProps) {
  const [history, setHistory] = useState<GenericHistory>({});
  const [stats, setStats] = useState<UserStats>({ gamesPlayed: 0, currentStreak: 0, maxStreak: 0, averageScore: 0 });

  useEffect(() => {
    if (isOpen) {
      setHistory(getHistoryFn());
      setStats(getStatsFn());
    }
  }, [isOpen, getHistoryFn, getStatsFn]);

  if (!isOpen) return null;

  const sortedDates = Object.keys(history).sort().reverse();

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-elevated rounded-md p-6 max-w-md w-full mx-4 shadow-brutal-md border-3 border-border-strong max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-text-primary text-center mb-4">Your Stats</h2>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: 'Played', value: stats.gamesPlayed },
            { label: 'Avg Score', value: `${stats.averageScore}%` },
            { label: 'Streak', value: stats.currentStreak },
            { label: 'Best', value: stats.maxStreak },
          ].map(({ label, value }) => (
            <div key={label} className="text-center">
              <div className="text-2xl font-bold text-text-primary">{value}</div>
              <div className="text-xs text-text-muted">{label}</div>
            </div>
          ))}
        </div>

        <h3 className="text-sm font-medium text-text-muted mb-2">Past Challenges</h3>
        {sortedDates.length === 0 ? (
          <p className="text-text-muted text-sm text-center py-4">No challenges completed yet.</p>
        ) : (
          <div className="space-y-1">
            {sortedDates.map((date) => {
              const result = history[date];
              let scoreColor = 'text-error';
              if (result.score >= 80) scoreColor = 'text-success';
              else if (result.score >= 50) scoreColor = 'text-warning';

              return (
                <a
                  key={date}
                  href={`${basePath}/${date}`}
                  className="flex justify-between items-center py-2 px-3 rounded-md hover:bg-elevated transition"
                >
                  <span className="text-sm text-text-secondary">
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
          className="w-full mt-4 py-2 px-4 bg-surface hover:bg-base text-text-primary rounded-md font-medium transition border-2 border-border-strong shadow-brutal-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
