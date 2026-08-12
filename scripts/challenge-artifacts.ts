import { TIME_LIMITS } from '../src/utils/difficulty';
import type { Difficulty } from '../src/utils/types';
import type { ChallengeFields, TailwindChallengeFields } from './challenge-schemas';

export function buildCssChallenge(fields: ChallengeFields, date: string, difficulty: Difficulty) {
  return {
    title: fields.title,
    difficulty,
    target: { html: fields.html, css: fields.targetCss },
    starter: { html: fields.html, css: fields.starterCss },
    date,
    timeLimit: TIME_LIMITS[difficulty],
    targetImage: `${date}-${difficulty}.webp`,
  };
}

export function buildTailwindChallenge(fields: TailwindChallengeFields, date: string, difficulty: Difficulty) {
  return {
    title: fields.title,
    difficulty,
    date,
    timeLimit: TIME_LIMITS[difficulty],
    starter: { html: fields.starterHtml },
    target: { html: fields.targetHtml },
    targetImage: `${date}-${difficulty}.webp`,
  };
}
