export interface Challenge {
  date: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number;
  starter: {
    html: string;
    css: string;
  };
  target: {
    html: string;
    css: string;
  };
}

export interface ChallengeResult {
  date: string;
  score: number;
  timeSpent: number;
  submittedCss: string;
}

export interface ChallengeHistory {
  [date: string]: ChallengeResult;
}

export interface UserStats {
  gamesPlayed: number;
  currentStreak: number;
  maxStreak: number;
  averageScore: number;
}

export interface StorageData {
  history: ChallengeHistory;
}

export interface DiffResult {
  score: number;
  diffCanvas: HTMLCanvasElement;
  heatmapCanvas: HTMLCanvasElement;
}
