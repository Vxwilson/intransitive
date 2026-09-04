/**
 * EngineStatsPanel - Telemetry & Analysis Control Dashboard
 * Displays real-time search statistics (Depth, NPS, Nodes, Time, Multi-PV lines)
 * and controls for Live Analysis, Infinite Thinking, Lines (1-5), RAM/Hash, and CPU threads.
 */

import React, { useState } from 'react';
import type { SearchUpdate } from '../engine/search';
import type { Color, Move } from '../core/types';
import { WHITE } from '../core/types';
import {
  Activity,
  Bot,
  Zap,
  Gauge,
  Clock,
  Compass,
  CheckCircle2,
  BrainCircuit,
  Sliders,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import type { GameMode, DifficultyLevel, SearchLine } from '../engine/engineTypes';
import { DIFFICULTY_PRESETS, HASH_PRESETS } from '../engine/engineTypes';

interface EngineStatsPanelProps {
  stats: SearchUpdate | null;
  isSearching: boolean;
  isAnalysisEnabled: boolean;
  onToggleAnalysis: (enabled: boolean) => void;
  gameMode: GameMode;
  onChangeGameMode: (mode: GameMode) => void;
  playerColor: Color;
  onChangePlayerColor: (color: Color) => void;
  difficulty: DifficultyLevel;
  onChangeDifficulty: (diff: DifficultyLevel) => void;
  multiPv: number;
  onChangeMultiPv: (lines: number) => void;
  isInfinite: boolean;
  onToggleInfinite: (infinite: boolean) => void;
  searchTimeSec: number;
  onChangeSearchTimeSec: (sec: number) => void;
  hashMb: number;
  onChangeHashMb: (mb: number) => void;
  threads: number;
  onChangeThreads: (t: number) => void;
  isHardwareExpanded?: boolean;
  onToggleHardwareExpanded?: (expanded: boolean) => void;
  onApplyMove?: (move: Move) => void;
}

export const EngineStatsPanel: React.FC<EngineStatsPanelProps> = ({
  stats,
  isSearching,
  isAnalysisEnabled,
  onToggleAnalysis,
  gameMode,
  onChangeGameMode,
  playerColor,
  onChangePlayerColor,
  difficulty,
  onChangeDifficulty,
  multiPv,
  onChangeMultiPv,
  isInfinite,
  onToggleInfinite,
  searchTimeSec,
  onChangeSearchTimeSec,
  hashMb,
  onChangeHashMb,
  threads,
  onChangeThreads,
  isHardwareExpanded: controlledHardwareExpanded,
  onToggleHardwareExpanded,
  onApplyMove,
}) => {
  const [internalHardwareExpanded, setInternalHardwareExpanded] = useState<boolean>(false);
  const isSettingsOpen = controlledHardwareExpanded !== undefined ? controlledHardwareExpanded : internalHardwareExpanded;
  const toggleSettings = () => {
    if (onToggleHardwareExpanded) {
      onToggleHardwareExpanded(!isSettingsOpen);
    } else {
      setInternalHardwareExpanded((prev) => !prev);
    }
  };
  const maxThreads = 16;

  // Format score helper
  const formatScore = (
    scoreWhite: number,
    isMate: boolean,
    mateInPlies: number | null
  ): { label: string; className: string } => {
    if (isMate) {
      const plies = mateInPlies ?? 0;
      const moves = Math.ceil(plies / 2);
      const sign = scoreWhite >= 0 ? '+' : '-';
      return {
        label: `${sign}M${moves}`,
        className: scoreWhite >= 0 ? 'score-white-win' : 'score-black-win',
      };
    }
    const pawns = (scoreWhite / 100).toFixed(2);
    const label = scoreWhite > 0 ? `+${pawns}` : `${pawns}`;
    let className = 'score-neutral';
    if (scoreWhite > 50) className = 'score-white-win';
    else if (scoreWhite < -50) className = 'score-black-win';
    return { label, className };
  };

  const primaryScore = stats
    ? formatScore(stats.scoreWhite, stats.isMate, stats.mateInPlies)
    : { label: '0.00', className: 'score-neutral' };

  // Format NPS (e.g. 850k or 1.2M)
  const formatNPS = (nps: number): string => {
    if (nps >= 1000000) return `${(nps / 1000000).toFixed(1)}M/s`;
    if (nps >= 1000) return `${Math.round(nps / 1000)}k/s`;
    return `${nps}/s`;
  };

  const linesToDisplay: SearchLine[] =
    stats?.lines && stats.lines.length > 0
      ? stats.lines
      : stats?.bestMoveSAN
      ? [
          {
            rank: 1,
            move: stats.bestMove!,
            san: stats.bestMoveSAN,
            score: stats.score,
            scoreWhite: stats.scoreWhite,
            pv: stats.pv,
            pvSAN: stats.pvSAN,
            isMate: stats.isMate,
            mateInPlies: stats.mateInPlies,
          },
        ]
      : [];

  return (
    <div className="engine-stats-panel">
      {/* Clean Master Header: Title, Settings Toggle, Analysis Switch */}
      <div className="panel-header">
        <div className="panel-title-group">
          <BrainCircuit size={18} className="panel-icon-accent" />
          <span className="panel-title">Engine Analysis & AI</span>
        </div>

        <div className="header-actions">
          {/* Settings & Sliders Toggle */}
          <button
            type="button"
            className={`hw-toggle-btn ${isSettingsOpen ? 'active' : ''}`}
            onClick={toggleSettings}
            title="Configure search time, lines, CPU threads, and memory"
          >
            <Sliders size={13} />
            <span>Settings</span>
            {isSettingsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {/* Live Analysis Toggle */}
          <label className="toggle-switch-label" title="Toggle Live Background Analysis">
            <span className="toggle-text">Analysis</span>
            <input
              type="checkbox"
              checked={isAnalysisEnabled}
              onChange={(e) => onToggleAnalysis(e.target.checked)}
              className="toggle-checkbox"
            />
            <span className="toggle-slider" />
          </label>
        </div>
      </div>

      {/* Expandable Settings & Range Sliders Drawer */}
      {isSettingsOpen && (
        <div className="hardware-config-drawer">
          {/* Engine Selector (Guaranteed within bounds) */}
          <div className="hw-slider-row">
            <span className="hw-slider-label">Engine:</span>
            <div className="hw-select-container">
              <select className="hw-compact-select" defaultValue="classical">
                <option value="classical">Chessesque 2.0 (PeSTO HCE)</option>
                <option value="nnue" disabled>NNUE 85MB (Phase 3)</option>
              </select>
              <span className="hw-info-icon" title="Phase 2 Classical PeSTO evaluation with dynamic phase tapering. Phase 3 NNUE upcoming.">
                <Info size={13} />
              </span>
            </div>
          </div>

          {/* Search Time Slider */}
          <div className="hw-slider-row">
            <span className="hw-slider-label">Search time</span>
            <div className="hw-slider-wrap">
              <input
                type="range"
                min={1}
                max={31}
                value={isInfinite ? 31 : searchTimeSec}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (val === 31) {
                    onToggleInfinite(true);
                  } else {
                    onToggleInfinite(false);
                    onChangeSearchTimeSec(val);
                  }
                }}
                className="hw-range-slider"
                style={{
                  background: `linear-gradient(to right, #60a5fa 0%, #60a5fa ${
                    ((isInfinite ? 31 : searchTimeSec) - 1) / 30 * 100
                  }%, rgba(255, 255, 255, 0.15) ${
                    ((isInfinite ? 31 : searchTimeSec) - 1) / 30 * 100
                  }%, rgba(255, 255, 255, 0.15) 100%)`,
                }}
              />
              <span className="hw-slider-val">
                {isInfinite ? '∞' : `${searchTimeSec}s`}
              </span>
            </div>
          </div>

          {/* Multiple Lines Slider */}
          <div className="hw-slider-row">
            <span className="hw-slider-label">Multiple lines</span>
            <div className="hw-slider-wrap">
              <input
                type="range"
                min={1}
                max={5}
                value={multiPv}
                onChange={(e) => onChangeMultiPv(Number(e.target.value))}
                className="hw-range-slider"
                style={{
                  background: `linear-gradient(to right, #60a5fa 0%, #60a5fa ${
                    (multiPv - 1) / 4 * 100
                  }%, rgba(255, 255, 255, 0.15) ${
                    (multiPv - 1) / 4 * 100
                  }%, rgba(255, 255, 255, 0.15) 100%)`,
                }}
              />
              <span className="hw-slider-val">{multiPv} / 5</span>
            </div>
          </div>

          {/* Threads Slider (Max 16) */}
          <div className="hw-slider-row">
            <span className="hw-slider-label">Threads</span>
            <div className="hw-slider-wrap">
              <input
                type="range"
                min={1}
                max={maxThreads}
                value={threads}
                onChange={(e) => onChangeThreads(Number(e.target.value))}
                className="hw-range-slider"
                style={{
                  background: `linear-gradient(to right, #60a5fa 0%, #60a5fa ${
                    ((threads - 1) / (maxThreads - 1)) * 100
                  }%, rgba(255, 255, 255, 0.15) ${
                    ((threads - 1) / (maxThreads - 1)) * 100
                  }%, rgba(255, 255, 255, 0.15) 100%)`,
                }}
              />
              <span className="hw-slider-val">{threads} / {maxThreads}</span>
            </div>
          </div>

          {/* Memory Slider */}
          <div className="hw-slider-row">
            <span className="hw-slider-label">Memory</span>
            <div className="hw-slider-wrap">
              <input
                type="range"
                min={0}
                max={HASH_PRESETS.length - 1}
                value={Math.max(0, HASH_PRESETS.indexOf(hashMb))}
                onChange={(e) => {
                  const idx = Number(e.target.value);
                  onChangeHashMb(HASH_PRESETS[idx]);
                }}
                className="hw-range-slider"
                style={{
                  background: `linear-gradient(to right, #60a5fa 0%, #60a5fa ${
                    (Math.max(0, HASH_PRESETS.indexOf(hashMb)) / (HASH_PRESETS.length - 1)) * 100
                  }%, rgba(255, 255, 255, 0.15) ${
                    (Math.max(0, HASH_PRESETS.indexOf(hashMb)) / (HASH_PRESETS.length - 1)) * 100
                  }%, rgba(255, 255, 255, 0.15) 100%)`,
                }}
              />
              <span className="hw-slider-val">{hashMb}MB</span>
            </div>
          </div>
        </div>
      )}

      {/* Opponent Mode Selection */}
      <div className="engine-mode-bar">
        <div className="mode-segmented-control">
          <button
            type="button"
            className={`segmented-btn ${gameMode === 'human_vs_human' ? 'active' : ''}`}
            onClick={() => onChangeGameMode('human_vs_human')}
          >
            Human vs Human
          </button>
          <button
            type="button"
            className={`segmented-btn ${gameMode === 'play_vs_computer' ? 'active' : ''}`}
            onClick={() => onChangeGameMode('play_vs_computer')}
          >
            <Bot size={14} style={{ display: 'inline', marginRight: 4 }} />
            Play vs Computer
          </button>
        </div>

        {/* Play vs Computer Options */}
        {gameMode === 'play_vs_computer' && (
          <div className="ai-options-row">
            <div className="ai-option-group">
              <span className="option-label">Side:</span>
              <div className="mini-pill-selector">
                <button
                  type="button"
                  className={`mini-pill ${playerColor === WHITE ? 'active' : ''}`}
                  onClick={() => onChangePlayerColor(WHITE)}
                >
                  White
                </button>
                <button
                  type="button"
                  className={`mini-pill ${playerColor !== WHITE ? 'active' : ''}`}
                  onClick={() => onChangePlayerColor(1 as Color)}
                >
                  Black
                </button>
              </div>
            </div>

            <div className="ai-option-group">
              <span className="option-label">Skill:</span>
              <div className="mini-pill-selector">
                {(['casual', 'intermediate', 'strong'] as DifficultyLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`mini-pill ${difficulty === level ? 'active' : ''}`}
                    onClick={() => onChangeDifficulty(level)}
                  >
                    {DIFFICULTY_PRESETS[level].label.split(' ')[0]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Realtime Telemetry Display */}
      <div className="telemetry-box">
        {/* Status bar */}
        <div className="telemetry-status-row">
          <div className="status-indicator-group">
            <span
              className={`status-pulse-dot ${
                isSearching ? 'status-active-pulse' : 'status-idle'
              }`}
            />
            <span className="status-label">
              {isSearching
                ? isInfinite
                  ? `Infinite Depth ${stats?.depth ?? 1}...`
                  : `Searching Depth ${stats?.depth ?? 1}...`
                : stats
                ? 'Evaluation Ready'
                : 'Engine Idle'}
            </span>
          </div>

          <div className={`score-badge ${primaryScore.className}`}>
            <Activity size={12} />
            <span>{primaryScore.label}</span>
          </div>
        </div>

        {/* Telemetry Metrics Grid */}
        <div className="metrics-grid">
          <div className="metric-cell">
            <div className="metric-header">
              <Gauge size={12} />
              <span>Depth</span>
            </div>
            <div className="metric-value">{stats ? `${stats.depth}` : '—'}</div>
          </div>

          <div className="metric-cell">
            <div className="metric-header">
              <Zap size={12} />
              <span>Speed</span>
            </div>
            <div className="metric-value">
              {stats ? formatNPS(stats.nps) : '—'}
            </div>
          </div>

          <div className="metric-cell">
            <div className="metric-header">
              <Clock size={12} />
              <span>Time</span>
            </div>
            <div className="metric-value">
              {stats ? `${stats.timeMs}ms` : '—'}
            </div>
          </div>

          <div className="metric-cell">
            <div className="metric-header">
              <Compass size={12} />
              <span>Nodes</span>
            </div>
            <div className="metric-value">
              {stats ? stats.nodes.toLocaleString() : '—'}
            </div>
          </div>
        </div>

        {/* Best Move & Principal Variations (Multi-PV Lines) */}
        <div className="pv-container">
          <div className="pv-header">
            <span className="pv-title">
              {multiPv > 1 ? `Top ${multiPv} Engine Lines` : 'Best Move & Line'}
            </span>
            {stats?.bestMoveSAN && (
              <span
                className="best-move-chip"
                onClick={() => stats.bestMove && onApplyMove?.(stats.bestMove)}
                title={`Click to play best move (${stats.bestMoveSAN})`}
              >
                <CheckCircle2 size={12} />
                <span>{stats.bestMoveSAN}</span>
              </span>
            )}
          </div>

          {linesToDisplay.length > 0 ? (
            <div className="multi-pv-list">
              {linesToDisplay.map((line) => {
                const lineScore = formatScore(line.scoreWhite, line.isMate, line.mateInPlies);
                return (
                  <div
                    key={line.rank}
                    className="pv-line-row"
                    onClick={() => onApplyMove?.(line.move)}
                    title={`Click to play ${line.san} on the board`}
                  >
                    <span className="pv-rank-chip">#{line.rank}</span>
                    <span className={`pv-row-score ${lineScore.className}`}>
                      {lineScore.label}
                    </span>
                    <div className="pv-row-moves">
                      {line.pvSAN.map((san, idx) => (
                        <span key={`${san}-${idx}`} className="pv-token">
                          {idx === 0 ? <strong>{san}</strong> : san}{' '}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="pv-empty">Enable live analysis to evaluate position</div>
          )}
        </div>
      </div>
    </div>
  );
};
