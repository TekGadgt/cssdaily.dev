interface ScoreDisplayProps {
  score: number;
  /** Component scores for the hover tooltip; absent until the first diff */
  breakdown?: {
    pixelScore: number;
    structuralScore: number | null;
  };
}

export default function ScoreDisplay({ score, breakdown }: ScoreDisplayProps) {
  let color = 'text-red-400';
  if (score >= 80) color = 'text-green-400';
  else if (score >= 50) color = 'text-yellow-400';

  const title = breakdown
    ? breakdown.structuralScore === null
      ? `Pixel match ${breakdown.pixelScore}%`
      : `Pixel match ${breakdown.pixelScore}% · Structure ${breakdown.structuralScore}%`
    : undefined;

  return (
    <span
      className={`font-mono text-lg font-bold ${color}`}
      title={title}
      // title is hover-only; mirror the breakdown (with the score, since
      // aria-label replaces the text content) for assistive tech
      aria-label={title ? `Score ${score}%. ${title}` : undefined}
    >
      {score}%
    </span>
  );
}
