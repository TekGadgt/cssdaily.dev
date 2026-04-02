interface ScoreDisplayProps {
  score: number;
}

export default function ScoreDisplay({ score }: ScoreDisplayProps) {
  let color = 'text-error';
  if (score >= 80) color = 'text-success';
  else if (score >= 50) color = 'text-warning';

  return (
    <span className={`font-mono text-lg font-bold ${color}`}>
      {score}%
    </span>
  );
}
