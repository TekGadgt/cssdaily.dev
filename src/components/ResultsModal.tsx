import { useRef, useEffect, useState } from 'react';
import { generateShareText, copyToClipboard } from '../utils/share';
import { adjacentDate } from '../utils/date';

interface ResultsModalProps {
  isOpen: boolean;
  date: string;
  score: number;
  timeSpent: number;
  heatmapCanvas: HTMLCanvasElement | null;
  onClose: () => void;
}

export default function ResultsModal({ isOpen, date, score, timeSpent, heatmapCanvas, onClose }: ResultsModalProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && heatmapCanvas && canvasContainerRef.current) {
      canvasContainerRef.current.innerHTML = '';

      // Create a properly sized canvas and draw the heatmap into it
      const display = document.createElement('canvas');
      display.width = 300;
      display.height = 200;
      display.style.width = '300px';
      display.style.height = '200px';
      display.style.borderRadius = '8px';
      display.style.background = '#f5f5f5';

      const ctx = display.getContext('2d');
      if (ctx) {
        ctx.drawImage(heatmapCanvas, 0, 0, 300, 200);
      }

      canvasContainerRef.current.appendChild(display);
    }
  }, [isOpen, heatmapCanvas]);

  if (!isOpen) return null;

  const minutes = Math.floor(timeSpent / 60);
  const seconds = timeSpent % 60;
  const timeStr = `${minutes}:${String(seconds).padStart(2, '0')}`;

  let scoreColor = 'text-red-400';
  if (score >= 80) scoreColor = 'text-green-400';
  else if (score >= 50) scoreColor = 'text-yellow-400';

  const handleShare = async () => {
    const text = generateShareText(date, score, timeSpent);
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const prevDate = adjacentDate(date, -1);
  const nextDate = adjacentDate(date, 1);

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-800 rounded-xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-white text-center mb-4">Challenge Complete!</h2>

        <div className="text-center mb-4">
          <div className={`text-5xl font-bold ${scoreColor} mb-1`}>{score}%</div>
          <div className="text-gray-400">Time: {timeStr}</div>
        </div>

        <div ref={canvasContainerRef} className="flex justify-center mb-4" />

        <div className="flex flex-col gap-2">
          <button
            onClick={handleShare}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition"
          >
            {copied ? 'Copied!' : 'Share Result'}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition"
          >
            Keep Tweaking
          </button>
        </div>

        <div className="flex justify-between mt-4 text-sm">
          <a href={`/challenge/${prevDate}`} className="text-blue-400 hover:text-blue-300">
            &larr; Previous
          </a>
          <a href={`/challenge/${nextDate}`} className="text-blue-400 hover:text-blue-300">
            Next &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
