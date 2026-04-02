import { useRef, useEffect, useState } from 'react';
import { generateShareText, copyToClipboard } from '../utils/share';
import { adjacentDate } from '../utils/date';

interface ResultsModalProps {
  isOpen: boolean;
  date: string;
  score: number;
  timeSpent: number;
  timeLimit: number;
  heatmapCanvas: HTMLCanvasElement | null;
  onClose: () => void;
  basePath?: string;
}

export default function ResultsModal({ isOpen, date, score, timeSpent, timeLimit, heatmapCanvas, onClose, basePath = '/challenge' }: ResultsModalProps) {
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

  let scoreColor = 'text-error';
  if (score >= 80) scoreColor = 'text-success';
  else if (score >= 50) scoreColor = 'text-warning';

  const handleShare = async () => {
    const text = generateShareText(date, score, timeSpent, timeLimit);
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
      <div className="bg-elevated rounded-md p-6 max-w-md w-full mx-4 shadow-brutal-md border-3 border-border-strong" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-xl font-bold text-text-primary text-center mb-4">Challenge Complete!</h2>

        <div className="text-center mb-4">
          <div className={`text-5xl font-bold ${scoreColor} mb-1`}>{score}%</div>
          <div className="text-text-muted">Time: {timeStr}</div>
        </div>

        <div ref={canvasContainerRef} className="flex justify-center mb-4" />

        <div className="flex flex-col gap-2">
          <button
            onClick={handleShare}
            className="w-full py-2 px-4 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
          >
            {copied ? 'Copied!' : 'Share Result'}
          </button>
          <button
            onClick={onClose}
            className="w-full py-2 px-4 bg-surface hover:bg-base text-text-primary rounded-md font-medium transition border-2 border-border-strong shadow-brutal-sm"
          >
            Keep Tweaking
          </button>
        </div>

        <div className="flex justify-between mt-4 text-sm">
          <a href={`${basePath}/${prevDate}`} className="text-accent-primary hover:text-accent-primary/80">
            &larr; Previous
          </a>
          <a href={`${basePath}/${nextDate}`} className="text-accent-primary hover:text-accent-primary/80">
            Next &rarr;
          </a>
        </div>
      </div>
    </div>
  );
}
