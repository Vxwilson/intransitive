import React from 'react';
import { Play, Pause, ChevronLeft, ChevronRight, RotateCcw, Zap } from 'lucide-react';

interface LiveControlsProps {
  isPlaying: boolean;
  onTogglePlay: () => void;
  onStepForward: () => void;
  onStepBackward: () => void;
  onReset: () => void;
  canStepBack: boolean;
  canStepForward: boolean;
  delayMs: number;
  onChangeDelay: (ms: number) => void;
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
}) => {
  return (
    <div className="intransitive-toolbar-card">
      {/* Primary Action Buttons Row */}
      <div className="intransitive-toolbar-row">
        <div className="intransitive-button-group">
          <button
            type="button"
            onClick={onReset}
            title="Reset Game"
            className="intransitive-btn-round"
          >
            <RotateCcw size={16} />
          </button>

          <button
            type="button"
            onClick={onStepBackward}
            disabled={!canStepBack || isPlaying}
            title="Step Backward"
            className="intransitive-btn-round"
          >
            <ChevronLeft size={16} />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Pause Observation' : 'Start Live Self-Play'}
            className={`intransitive-btn-watch ${isPlaying ? 'playing' : ''}`}
          >
            {isPlaying ? (
              <>
                <Pause size={15} /> Pause
              </>
            ) : (
              <>
                <Play size={15} fill="currentColor" /> Watch Live
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onStepForward}
            disabled={!canStepForward || isPlaying}
            title="Step Forward"
            className="intransitive-btn-round"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Speed Presets */}
        <div className="intransitive-speed-presets">
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
            className={`intransitive-speed-pill ${delayMs > 80 && delayMs <= 400 ? 'active' : ''}`}
          >
            300ms
          </button>
          <button
            type="button"
            onClick={() => onChangeDelay(1000)}
            className={`intransitive-speed-pill ${delayMs > 400 ? 'active' : ''}`}
          >
            1.0s
          </button>
        </div>
      </div>

      {/* Speed Slider Row */}
      <div className="intransitive-slider-row">
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
          <Zap size={14} color="#d97706" /> Speed:
        </span>
        <input
          type="range"
          min="50"
          max="2000"
          step="50"
          value={delayMs}
          onChange={(e) => onChangeDelay(Number(e.target.value))}
          className="intransitive-range-slider"
        />
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, minWidth: '45px', textAlign: 'right', color: '#c2410c' }}>
          {delayMs >= 1000 ? `${(delayMs / 1000).toFixed(1)}s` : `${delayMs}ms`}
        </span>
      </div>
    </div>
  );
};
