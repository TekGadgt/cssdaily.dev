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
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="border-b border-gray-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <a href="/" className="text-xl font-bold text-blue-400">CSS Daily</a>
            <div className="flex items-center gap-2 text-sm text-gray-400">
              {prevDate ? (
                <a href={`/challenge/${prevDate}`} className="hover:text-white">&larr;</a>
              ) : (
                <span className="text-gray-600">&larr;</span>
              )}
              <span>{formatDate(challenge.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              {nextDate ? (
                <a href={`/challenge/${nextDate}`} className="hover:text-white">&rarr;</a>
              ) : (
                <span className="text-gray-600">&rarr;</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-400">{challenge.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              challenge.difficulty === 'easy' ? 'bg-green-900 text-green-300' :
              challenge.difficulty === 'medium' ? 'bg-yellow-900 text-yellow-300' :
              'bg-red-900 text-red-300'
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
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition"
              >
                Submit
              </button>
            )}
            {phase === 'finished' && (
              <button
                onClick={() => setShowResults(true)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm rounded-lg font-medium transition"
              >
                Results
              </button>
            )}
            <button
              onClick={() => setShowHistory(true)}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition"
            >
              Stats
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-4 flex flex-col" style={{ height: 'calc(100vh - 57px)' }}>
        {/* Preview panels */}
        <div className="flex justify-between mb-4 flex-shrink-0">
          {/* User Preview */}
          <div>
            <div className="flex items-center h-8 mb-2">
              <h3 className="text-sm font-medium text-gray-400">Your Preview</h3>
            </div>
            <div className="rounded-lg overflow-hidden border border-gray-700" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
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
              <h3 className="text-sm font-medium text-gray-400">Target</h3>
              <div className="flex text-xs">
                {(['target', 'overlay', 'diff'] as TargetTab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setTargetTab(tab)}
                    className={`px-2 py-1 capitalize ${
                      targetTab === tab
                        ? 'bg-gray-700 text-white rounded'
                        : 'text-gray-500 hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-lg overflow-hidden border border-gray-700 relative" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, background: '#f5f5f5' }}>
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
                  {!diffResult && <span className="text-gray-500 text-sm">Start editing to see diff</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Code Editor */}
        <div className="rounded-lg overflow-hidden border border-gray-700 flex-1 min-h-0">
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
