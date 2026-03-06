interface ScoreDisplayProps {
  score: number;
}

export default function ScoreDisplay({ score }: ScoreDisplayProps) {
  let color = 'text-red-400';
  if (score >= 80) color = 'text-green-400';
  else if (score >= 50) color = 'text-yellow-400';

  return (
    <span className={`font-mono text-lg font-bold ${color}`}>
      {score}%
    </span>
  );
}
