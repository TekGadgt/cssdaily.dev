import { useState, useRef, useCallback, useEffect } from 'react';
import type { Challenge, DiffResult } from '../utils/types';
import { compareToTarget } from '../utils/diff';
import { saveResult, getResult } from '../utils/storage';
import { formatDate, adjacentDate } from '../utils/date';
import Preview, { PREVIEW_WIDTH, PREVIEW_HEIGHT } from './Preview';
import CodeEditor from './CodeEditor';
import Timer from './Timer';
import ScoreDisplay from './ScoreDisplay';
import ResultsModal from './ResultsModal';
import HistoryView from './HistoryView';

type Phase = 'idle' | 'playing' | 'finished';
type TargetTab = 'target' | 'overlay' | 'diff';

interface ChallengePlayerProps {
  challenge: Challenge;
  allDates: string[];
}

export default function ChallengePlayer({ challenge, allDates }: ChallengePlayerProps) {
  const [userCss, setUserCss] = useState(challenge.starter.css);
  const userCssRef = useRef(challenge.starter.css);
  const [phase, setPhase] = useState<Phase>('idle');
  const phaseRef = useRef<Phase>('idle');
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [targetTab, setTargetTab] = useState<TargetTab>('target');
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);
  const [showResults, setShowResults] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [submittedScore, setSubmittedScore] = useState(0);
  const [submittedTime, setSubmittedTime] = useState(0);
  const timeSpentRef = useRef(0);
  const diffPendingRef = useRef(false);
  const diffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heatmapRef = useRef<HTMLDivElement>(null);

  // Check for existing result
  useEffect(() => {
    const existing = getResult(challenge.date);
    if (existing) {
      setSubmittedScore(existing.score);
      setSubmittedTime(existing.timeSpent);
      setPhase('finished');
      phaseRef.current = 'finished';
      setScore(existing.score);
      scoreRef.current = existing.score;
    }
  }, [challenge.date]);

  const runDiff = useCallback(async () => {
    if (diffPendingRef.current) return;
    diffPendingRef.current = true;

    try {
      const result = await compareToTarget(
        challenge.starter.html,
        userCssRef.current,
        challenge.target.css,
        { compareWidth: PREVIEW_WIDTH, compareHeight: PREVIEW_HEIGHT }
      );
      setDiffResult(result);
      if (phaseRef.current !== 'finished') {
        setScore(result.score);
        scoreRef.current = result.score;
      }
    } catch (err) {
      console.error('Diff failed:', err);
    } finally {
      diffPendingRef.current = false;
    }
  }, [challenge]);

  const scheduleDiff = useCallback(() => {
    if (diffTimeoutRef.current) clearTimeout(diffTimeoutRef.current);
    diffTimeoutRef.current = setTimeout(runDiff, 1500);
  }, [runDiff]);

  const handleCssChange = useCallback((css: string) => {
    setUserCss(css);
    userCssRef.current = css;
    if (phaseRef.current !== 'playing') {
      setPhase('playing');
      phaseRef.current = 'playing';
    }
    scheduleDiff();
  }, [scheduleDiff]);

  const handlePreviewLoad = useCallback(() => {
    setTimeout(runDiff, 100);
  }, [runDiff]);

  const doSubmit = useCallback(() => {
    const finalScore = scoreRef.current;
    setPhase('finished');
    phaseRef.current = 'finished';
    setSubmittedScore(finalScore);
    setSubmittedTime(timeSpentRef.current);
    saveResult(challenge.date, {
      date: challenge.date,
      score: finalScore,
      timeSpent: timeSpentRef.current,
      submittedCss: userCssRef.current,
    });
    setShowResults(true);
  }, [challenge.date]);

  const handleTimeUp = useCallback(() => {
    doSubmit();
  }, [doSubmit]);

  const handleTick = useCallback((elapsed: number) => {
    timeSpentRef.current = elapsed;
  }, []);

  // Display heatmap in diff tab
  useEffect(() => {
    if (targetTab === 'diff' && diffResult?.heatmapCanvas && heatmapRef.current) {
      heatmapRef.current.innerHTML = '';
      const canvas = diffResult.heatmapCanvas.cloneNode(true) as HTMLCanvasElement;
      canvas.style.width = `${PREVIEW_WIDTH}px`;
      canvas.style.height = `${PREVIEW_HEIGHT}px`;
      canvas.style.background = '#f5f5f5';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(diffResult.heatmapCanvas, 0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
      heatmapRef.current.appendChild(canvas);
    }
  }, [targetTab, diffResult]);

  const sortedDates = [...allDates].sort();
  const currentIdx = sortedDates.indexOf(challenge.date);
  const prevDate = currentIdx > 0 ? sortedDates[currentIdx - 1] : null;
  const nextDate = currentIdx < sortedDates.length - 1 ? sortedDates[currentIdx + 1] : null;
  const displayScore = phase === 'finished' ? submittedScore : score;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-base text-text-primary">
      {/* Header */}
      <header className="border-b-2 border-border-default px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-text-muted">
            {prevDate ? (
              <a href={`/challenge/${prevDate}`} className="hover:text-text-primary">&larr;</a>
            ) : (
              <span className="text-text-muted/40">&larr;</span>
            )}
            <span>{formatDate(challenge.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            {nextDate ? (
              <a href={`/challenge/${nextDate}`} className="hover:text-text-primary">&rarr;</a>
            ) : (
              <span className="text-text-muted/40">&rarr;</span>
            )}
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-text-muted">{challenge.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded-md border ${challenge.difficulty === 'easy' ? 'border-success/30 text-success' :
              challenge.difficulty === 'medium' ? 'border-warning/30 text-warning' :
                'border-error/30 text-error'
              }`}>
              {challenge.difficulty}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <Timer
              timeLimit={challenge.timeLimit || 600}
              isRunning={phase === 'playing'}
              onTimeUp={handleTimeUp}
              onTick={handleTick}
            />
            <ScoreDisplay score={displayScore} />
            {phase === 'playing' && (
              <button
                onClick={doSubmit}
                className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
              >
                Submit
              </button>
            )}
            {phase === 'finished' && (
              <button
                onClick={() => setShowResults(true)}
                className="px-4 py-1.5 bg-accent-secondary hover:bg-accent-secondary/80 text-text-primary text-sm rounded-md font-medium transition border-2 border-accent-secondary shadow-brutal-sm"
              >
                Results
              </button>
            )}
            <button
              onClick={() => setShowHistory(true)}
              className="px-3 py-1.5 bg-elevated hover:bg-elevated/80 text-text-primary text-sm rounded-md transition border border-border-default"
            >
              Stats
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-4 flex flex-col flex-1 min-h-0">
        {/* Preview panels */}
        <div className="flex justify-between mb-4 flex-shrink-0">
          {/* User Preview */}
          <div>
            <div className="flex items-center h-8 mb-2">
              <h3 className="text-sm font-medium text-text-muted">Your Preview</h3>
            </div>
            <div className="rounded-md overflow-hidden border-2 border-border-default" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
              <Preview
                html={challenge.starter.html}
                css={userCss}
                onLoad={handlePreviewLoad}
              />
            </div>
          </div>

          {/* Target Panel */}
          <div>
            <div className="flex items-center gap-2 h-8 mb-2">
              <h3 className="text-sm font-medium text-text-muted">Target</h3>
              <div className="flex text-xs">
                {(['target', 'overlay', 'diff'] as TargetTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTargetTab(tab)}
                    className={`px-2 py-1 capitalize ${targetTab === tab
                      ? 'bg-elevated text-text-primary rounded-md'
                      : 'text-text-muted hover:text-text-primary'
                      }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md overflow-hidden border-2 border-border-default relative" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, background: '#f5f5f5' }}>
              {targetTab === 'target' && (
                <img
                  src={`/targets/${challenge.date}.png`}
                  alt="Target"
                  style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, objectFit: 'contain' }}
                />
              )}
              {targetTab === 'overlay' && (
                <>
                  <img
                    src={`/targets/${challenge.date}.png`}
                    alt="Target"
                    style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, objectFit: 'contain', position: 'absolute', top: 0, left: 0 }}
                  />
                  <div style={{ position: 'absolute', top: 0, left: 0, opacity: overlayOpacity }}>
                    <Preview html={challenge.starter.html} css={userCss} />
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={overlayOpacity}
                    onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
                    className="absolute bottom-2 left-1/2 -translate-x-1/2 w-48 z-10"
                  />
                </>
              )}
              {targetTab === 'diff' && (
                <div ref={heatmapRef} className="w-full h-full flex items-center justify-center">
                  {!diffResult && <span className="text-text-muted text-sm">Start editing to see diff</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Code Editor */}
        <div className="rounded-md overflow-hidden border-2 border-border-default flex-1 min-h-0">
          <CodeEditor
            initialCss={challenge.starter.css}
            htmlContent={challenge.starter.html}
            onChange={handleCssChange}
          />
        </div>
      </div>

      {/* Modals */}
      <ResultsModal
        isOpen={showResults}
        date={challenge.date}
        score={submittedScore}
        timeSpent={submittedTime}
        timeLimit={challenge.timeLimit || 600}
        heatmapCanvas={diffResult?.heatmapCanvas || null}
        onClose={() => setShowResults(false)}
      />
      <HistoryView
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
      />
    </div>
  );
}
