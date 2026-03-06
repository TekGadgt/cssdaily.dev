import { useState, useEffect, useRef } from 'react';

interface TimerProps {
  timeLimit: number;
  isRunning: boolean;
  onTimeUp: () => void;
  onTick?: (elapsed: number) => void;
}

export default function Timer({ timeLimit, isRunning, onTimeUp, onTick }: TimerProps) {
  const [remaining, setRemaining] = useState(timeLimit);
  const elapsedRef = useRef(0);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      elapsedRef.current += 1;
      onTick?.(elapsedRef.current);

      setRemaining((prev) => {
        const next = prev - 1;
        if (next <= 0) {
          clearInterval(interval);
          onTimeUpRef.current();
          return 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, onTick]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const display = `${minutes}:${String(seconds).padStart(2, '0')}`;

  let color = 'text-white';
  if (remaining <= 10) color = 'text-red-400';
  else if (remaining <= 60) color = 'text-yellow-400';

  return (
    <span className={`font-mono text-lg font-bold ${color}`}>
      {display}
    </span>
  );
}
