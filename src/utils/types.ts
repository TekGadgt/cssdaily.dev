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

export interface TailwindChallenge {
  date: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  timeLimit: number;
  starter: {
    html: string;
  };
  target: {
    html: string;
  };
}

export interface TailwindChallengeResult {
  date: string;
  score: number;
  timeSpent: number;
  submittedHtml: string;
}

export interface TailwindChallengeHistory {
  [date: string]: TailwindChallengeResult;
}

export interface TailwindStorageData {
  history: TailwindChallengeHistory;
}

/** Minimal history entry — used by HistoryView which only needs the score */
export interface HistoryEntry {
  score: number;
}

export interface GenericHistory {
  [date: string]: HistoryEntry;
}
