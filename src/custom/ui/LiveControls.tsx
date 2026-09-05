import React from 'react';
import {
  Play,
  Pause,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  RotateCcw,
  Zap,
  Swords,
  Trophy,
} from 'lucide-react';

export interface LiveControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onReset: () => void;
  canStepBack: boolean;
  canStepForward: boolean;
  delayMs: number;
  onChangeDelay: (ms: number) => void;
  // Enhanced exhibition match metadata
  fighterAName?: string;
  fighterBName?: string;
  fighterADepth?: number;
  fighterBDepth?: number;
  fighterAMode?: 'depth' | 'time';
  fighterBMode?: 'depth' | 'time';
  fighterATimeSec?: number;
  fighterBTimeSec?: number;
  currentPly?: number;
  totalPlies?: number;
  isGameOver?: boolean;
  winner?: 0 | 1 | 'draw' | null;
  reason?: string | null;
  onJumpToStart?: () => void;
  onJumpToEnd?: () => void;
}

export const LiveControls: React.FC<LiveControlsProps> = ({
  isPlaying,
  onTogglePlay,
  onStepForward,
  onStepBackward,
  onReset,
  canStepBack,
  canStepForward,
  delayMs,
  onChangeDelay,
  fighterAName = 'Fighter A',
  fighterBName = 'Fighter B',
  fighterADepth = 3,
  fighterBDepth = 3,
  fighterAMode = 'depth',
  fighterBMode = 'depth',
  fighterATimeSec = 1.0,
  fighterBTimeSec = 1.0,
  currentPly = 0,
  totalPlies = 0,
  isGameOver = false,
  winner = null,
  reason = '',
  onJumpToStart,
  onJumpToEnd,
}) => {
  const labelA = fighterAMode === 'time' ? `${fighterATimeSec}s` : `D${fighterADepth}`;
  const labelB = fighterBMode === 'time' ? `${fighterBTimeSec}s` : `D${fighterBDepth}`;

  return (
    <div className="intransitive-toolbar-card intransitive-exhibition-card compact">
      {/* Header: Title + Dynamic Match Status */}
      <div className="intransitive-exhibition-header">
        <div className="intransitive-exhibition-title-group">
          <div className="intransitive-exhibition-icon">
            <Swords size={14} color="#ea580c" />
          </div>
          <div>
            <h4 className="intransitive-exhibition-title">Single Game Exhibition</h4>
            <span className="intransitive-exhibition-subtitle">Live duel observation & replay</span>
          </div>
        </div>

        {/* Dynamic Status Pill */}
        <div className={`intransitive-exhibition-status-pill ${isPlaying ? 'live' : isGameOver ? 'ended' : 'idle'}`}>
          {isPlaying ? (
            <>
              <span className="intransitive-pulse-dot red" />
              <span>Live • Ply {currentPly}</span>
            </>
          ) : isGameOver ? (
            <>
              <Trophy size={11} color="#ea580c" />
              <span>
                {winner === 'draw'
                  ? 'Drawn Game'
                  : `${winner === 0 ? 'Blue' : 'Red'} Won (${reason || 'goal'})`}
              </span>
            </>
          ) : currentPly > 0 ? (
            <span>Ply {currentPly} of {totalPlies}</span>
          ) : (
            <span>Ready</span>
          )}
        </div>
      </div>

      {/* Matchup Duel Strip */}
      <div className="intransitive-exhibition-duel-bar">
        <div className="fighter-duel-badge blue" title={`Blue: ${fighterAName} (${labelA})`}>
          <span className="duel-dot blue" />
          <span className="duel-name">{fighterAName}</span>
          <span className="duel-spec">{labelA}</span>
        </div>

        <span className="duel-vs">vs</span>

        <div className="fighter-duel-badge red" title={`Red: ${fighterBName} (${labelB})`}>
          <span className="duel-dot red" />
          <span className="duel-name">{fighterBName}</span>
          <span className="duel-spec">{labelB}</span>
        </div>
      </div>

      {/* Primary Action + Navigation Controls Row */}
      <div className="intransitive-exhibition-actions-row">
        {/* Main CTA */}
        <button
          type="button"
          onClick={onTogglePlay}
          className={`intransitive-btn-watch-main ${isPlaying ? 'playing' : isGameOver ? 'rematch' : ''}`}
          title={isPlaying ? 'Pause Match' : isGameOver ? 'Restart Match' : 'Start Live Match'}
        >
          {isPlaying ? (
            <>
              <Pause size={14} /> Pause
            </>
          ) : isGameOver ? (
            <>
              <RotateCcw size={14} /> Play Again
            </>
          ) : (
            <>
              <Play size={14} fill="currentColor" /> Watch Live
            </>
          )}
        </button>

        {/* Navigation Button Cluster */}
        <div className="intransitive-nav-cluster">
          {onJumpToStart && (
            <button
              type="button"
              onClick={onJumpToStart}
              disabled={!canStepBack || isPlaying}
              title="Jump to Start (Ply 0)"
              className="intransitive-btn-round"
            >
              <ChevronsLeft size={15} />
            </button>
          )}

          <button
            type="button"
            onClick={onStepBackward}
            disabled={!canStepBack || isPlaying}
            title="Step Backward"
            className="intransitive-btn-round"
          >
            <ChevronLeft size={15} />
          </button>

          <button
            type="button"
            onClick={onStepForward}
            disabled={!canStepForward || isPlaying}
            title="Step Forward"
            className="intransitive-btn-round"
          >
            <ChevronRight size={15} />
          </button>

          {onJumpToEnd && (
            <button
              type="button"
              onClick={onJumpToEnd}
              disabled={currentPly >= totalPlies || isPlaying}
              title="Jump to Latest Ply"
              className="intransitive-btn-round"
            >
              <ChevronsRight size={15} />
            </button>
          )}

          <button
            type="button"
            onClick={onReset}
            disabled={isPlaying}
            title="Reset Game"
            className="intransitive-btn-round"
          >
            <RotateCcw size={15} />
          </button>
        </div>
      </div>

      {/* Speed Presets & Slider Row */}
      <div className="intransitive-exhibition-speed-row">
        <div className="intransitive-speed-presets">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', fontWeight: 600, color: '#786f66', marginRight: '3px' }}>
            <Zap size={12} color="#d97706" /> Pace:
          </span>
          <button
            type="button"
            onClick={() => onChangeDelay(50)}
            className={`intransitive-speed-pill ${delayMs <= 80 ? 'active' : ''}`}
          >
            50ms
          </button>
          <button
            type="button"
            onClick={() => onChangeDelay(300)}
            className={`intransitive-speed-pill ${delayMs > 80 && delayMs <= 500 ? 'active' : ''}`}
          >
            300ms
          </button>
          <button
            type="button"
            onClick={() => onChangeDelay(1000)}
            className={`intransitive-speed-pill ${delayMs > 500 ? 'active' : ''}`}
          >
            1.0s
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1, maxWidth: '125px' }}>
          <input
            type="range"
            min="50"
            max="2000"
            step="50"
            value={delayMs}
            onChange={(e) => onChangeDelay(Number(e.target.value))}
            className="intransitive-range-slider"
          />
          <span style={{ fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700, minWidth: '35px', textAlign: 'right', color: '#c2410c' }}>
            {delayMs >= 1000 ? `${(delayMs / 1000).toFixed(1)}s` : `${delayMs}ms`}
          </span>
        </div>
      </div>
    </div>
  );
};
