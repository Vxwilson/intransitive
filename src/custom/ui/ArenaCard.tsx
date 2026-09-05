/**
 * ArenaCard - Visual Arena Tournament Simulation & Benchmarking Card
 * Provides multi-game simulations with win rates, average plies, and tactical move accuracy.
 */

import React, { useState } from 'react';
import {
  Trophy,
  Download,
  Upload,
  Dices,
  Target,
  Activity,
  Zap,
  Sparkles,
  Pause,
  Play,
  Square,
  Clock,
  ChevronDown,
  Sliders,
  FileText,
} from 'lucide-react';
import type { Checkpoint } from '../engine/types';

const DEPTH_LABELS: Record<number, string> = {
  1: 'D1 Fast (1 ply)',
  2: 'D2 Tactical (2 plies)',
  3: 'D3 Deep (3 plies)',
  4: 'D4 Master (4 plies)',
  5: 'D5 Grandmaster (5 plies)',
  6: 'D6 Ultra (6 plies)',
};

interface ArenaCardProps {
  checkpoints: Checkpoint[];
  currentGeneration: number;
  fighterAId: string;
  fighterBId: string;
  onChangeFighterA?: (id: string) => void;
  onChangeFighterB?: (id: string) => void;
  onRunTournament: (
    cpA: Checkpoint,
    cpB: Checkpoint,
    games: number,
    depthA: number,
    depthB: number,
    thinkTimeSecA?: number,
    thinkTimeSecB?: number
  ) => void;
  fighterADepth?: number;
  fighterBDepth?: number;
  onChangeFighterADepth?: (depth: number) => void;
  onChangeFighterBDepth?: (depth: number) => void;
  fighterAMode?: 'depth' | 'time';
  fighterBMode?: 'depth' | 'time';
  onChangeFighterAMode?: (mode: 'depth' | 'time') => void;
  onChangeFighterBMode?: (mode: 'depth' | 'time') => void;
  fighterATimeSec?: number;
  fighterBTimeSec?: number;
  onChangeFighterATimeSec?: (sec: number) => void;
  onChangeFighterBTimeSec?: (sec: number) => void;
  isPaused?: boolean;
  onPauseTournament?: () => void;
  onResumeTournament?: () => void;
  onStopTournament?: () => void;
  onExportJSON: () => void;
  onImportJSON: (json: string) => void;
  tournamentResult: {
    winsA: number;
    winsB: number;
    draws: number;
    winRateA: number;
    winRateB: number;
    drawRate: number;
    gamesPlayed: number;
    avgGameLength?: number;
    accuracyA?: number;
    accuracyB?: number;
    depthA?: number;
    depthB?: number;
    thinkTimeSecA?: number;
    thinkTimeSecB?: number;
    isCancelled?: boolean;
  } | null;
  isSimulating?: boolean;
  isZoomEnabled?: boolean;
  onToggleZoom?: () => void;
  arenaLiveResults?: {
    gameIndex: number;
    totalGames: number;
    winsA: number;
    winsB: number;
    draws: number;
    isSimulating: boolean;
    fighterAIsBlue?: boolean;
  } | null;
  onExportTournamentPGN?: () => void;
}

export const ArenaCard: React.FC<ArenaCardProps> = ({
  checkpoints,
  fighterAId,
  fighterBId,
  onRunTournament,
  fighterADepth = 2,
  fighterBDepth = 2,
  onChangeFighterADepth,
  onChangeFighterBDepth,
  fighterAMode = 'depth',
  fighterBMode = 'depth',
  onChangeFighterAMode,
  onChangeFighterBMode,
  fighterATimeSec = 1.0,
  fighterBTimeSec = 1.0,
  onChangeFighterATimeSec,
  onChangeFighterBTimeSec,
  isPaused = false,
  onPauseTournament,
  onResumeTournament,
  onStopTournament,
  onExportJSON,
  onImportJSON,
  tournamentResult,
  isSimulating = false,
  isZoomEnabled = true,
  onToggleZoom,
  arenaLiveResults,
  onExportTournamentPGN,
}) => {
  const [customGames, setCustomGames] = useState<number>(20);
  const [showAdvancedOptions, setShowAdvancedOptions] = useState<boolean>(false);

  const checkpointA = checkpoints.find((c) => c.id === fighterAId) || checkpoints[0];
  const checkpointB = checkpoints.find((c) => c.id === fighterBId) || checkpoints[1] || checkpoints[0];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) onImportJSON(content);
    };
    reader.readAsText(file);
  };

  const handleSimulate = () => {
    const games = Math.max(1, Math.min(2000, Number(customGames) || 20));
    onRunTournament(
      checkpointA,
      checkpointB,
      games,
      fighterADepth,
      fighterBDepth,
      fighterAMode === 'time' ? fighterATimeSec : undefined,
      fighterBMode === 'time' ? fighterBTimeSec : undefined
    );
  };

  return (
    <div className="intransitive-editorial-card compact-arena">
      {/* Header */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-card-heading">
          <div className="intransitive-card-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed', borderColor: '#ddd6fe' }}>
            <Trophy size={18} />
          </div>
          <div className="intransitive-card-text">
            <h3>Tournament Simulation Arena</h3>
            <p>Head-to-head benchmarking & tactical accuracy scoring</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {onExportTournamentPGN && (
            <button
              type="button"
              onClick={onExportTournamentPGN}
              title="Export All Games (PGN)"
              className="intransitive-icon-btn"
            >
              <FileText size={14} color="#ea580c" />
            </button>
          )}
          <button
            type="button"
            onClick={onExportJSON}
            title="Export Checkpoints JSON"
            className="intransitive-icon-btn"
          >
            <Download size={14} />
          </button>
          <label
            title="Import Checkpoints JSON"
            className="intransitive-icon-btn"
          >
            <Upload size={14} />
            <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* Simulation Controls Section */}
      <div className="intransitive-simulate-section">
        {/* Matchup Duel Strip */}
        <div className="intransitive-exhibition-duel-bar" style={{ margin: '0' }}>
          <div className="fighter-duel-badge blue" title={`Blue: ${checkpointA?.name}`}>
            <span className="duel-dot blue" />
            <span className="duel-name">{checkpointA?.name?.split(' ')[0] || 'Fighter A'}</span>
            <span className="duel-spec">{fighterAMode === 'time' ? `${fighterATimeSec}s` : `D${fighterADepth}`}</span>
          </div>

          <span className="duel-vs">vs</span>

          <div className="fighter-duel-badge red" title={`Red: ${checkpointB?.name}`}>
            <span className="duel-dot red" />
            <span className="duel-name">{checkpointB?.name?.split(' ')[0] || 'Fighter B'}</span>
            <span className="duel-spec">{fighterBMode === 'time' ? `${fighterBTimeSec}s` : `D${fighterBDepth}`}</span>
          </div>
        </div>

        {/* Tournament Execution Controls & Simulation Status */}
        <div className="intransitive-simulate-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4a4239' }}>Simulate:</span>
            <input
              type="number"
              min="1"
              max="2000"
              value={customGames}
              onChange={(e) => setCustomGames(Math.max(1, parseInt(e.target.value, 10) || 1))}
              disabled={isSimulating}
              className="intransitive-input-number warm"
              style={{ width: '64px', padding: '0.25rem 0.4rem', fontSize: '0.75rem' }}
            />
            <span style={{ fontSize: '0.74rem', color: '#6b635b' }}>games</span>
          </div>

          {/* Quick preset chips */}
          <div className="intransitive-mini-btn-group">
            {[10, 20, 50, 100].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCustomGames(preset)}
                disabled={isSimulating}
                className={`intransitive-mini-btn ${customGames === preset ? 'active' : ''}`}
                style={{ padding: '0.2rem 0.45rem', fontSize: '0.7rem' }}
              >
                {preset}
              </button>
            ))}
          </div>

          {/* Action Buttons: Run Tournament, or Pause/Resume and Stop */}
          {isSimulating ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              {isPaused ? (
                <button
                  type="button"
                  onClick={onResumeTournament}
                  className="intransitive-btn-primary success"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.76rem' }}
                  title="Resume tournament simulation"
                >
                  <Play size={14} /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPauseTournament}
                  className="intransitive-btn-secondary warn"
                  style={{ padding: '0.45rem 0.85rem', fontSize: '0.76rem' }}
                  title="Pause tournament simulation"
                >
                  <Pause size={14} /> Pause
                </button>
              )}

              <button
                type="button"
                onClick={onStopTournament}
                className="intransitive-btn-secondary danger"
                style={{ padding: '0.45rem 0.75rem', fontSize: '0.76rem' }}
                title="Stop tournament early and finalize results"
              >
                <Square size={13} fill="currentColor" /> Stop
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleSimulate}
              className="intransitive-btn-primary"
              style={{ padding: '0.45rem 0.95rem', fontSize: '0.76rem' }}
            >
              <Dices size={14} /> Run Tournament
            </button>
          )}
        </div>

        {/* Collapsible Advanced Engine & Simulation Options Drawer */}
        <div className={`intransitive-accordion ${showAdvancedOptions ? 'open' : ''}`}>
          <button
            type="button"
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            className="intransitive-accordion-header"
          >
            <span className="intransitive-accordion-title">
              <Sliders size={12} color="#7c3aed" />
              <span>Advanced Search & Options</span>
            </span>
            <span className={`intransitive-accordion-chevron ${showAdvancedOptions ? 'open' : ''}`}>
              <ChevronDown size={13} />
            </span>
          </button>

          {showAdvancedOptions && (
            <div className="intransitive-accordion-body">
              {/* Fast Board Zoom Toggle Row */}
              {onToggleZoom && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.55rem', background: '#faf8f5', borderRadius: '7px', border: '1px solid #eee8de', fontSize: '0.72rem' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: '#4a4239' }}>
                    <Zap size={13} color="#ea580c" /> Fast Board Zoom (6ms/move):
                  </span>
                  <button
                    type="button"
                    onClick={onToggleZoom}
                    className={`intransitive-mini-btn ${isZoomEnabled ? 'active' : ''}`}
                    style={{ padding: '0.15rem 0.45rem', fontSize: '0.68rem' }}
                  >
                    {isZoomEnabled ? 'Enabled' : 'Disabled'}
                  </button>
                </div>
              )}

              {/* Independent Fighter Engine Search Controls */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.55rem',
                  padding: '0.5rem 0.65rem',
                  background: '#faf8f5',
                  borderRadius: '7px',
                  border: '1px solid #eee8de',
                }}
              >
                {/* Fighter A (Blue) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontWeight: 700,
                        color: '#1d4ed8',
                      }}
                    >
                      <Activity size={12} color="#2563eb" />
                      <span>{checkpointA?.name?.split(' ')[0] || 'Fighter A'} (Blue):</span>
                    </span>

                    <div className="intransitive-segmented-switch">
                      <button
                        type="button"
                        onClick={() => onChangeFighterAMode?.('depth')}
                        className={`intransitive-segmented-btn ${fighterAMode === 'depth' ? 'active' : ''}`}
                        title="Search with fixed ply depth"
                      >
                        <Target size={11} /> Depth
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeFighterAMode?.('time')}
                        className={`intransitive-segmented-btn ${fighterAMode === 'time' ? 'active' : ''}`}
                        title="Search with iterative deepening for allotted time"
                      >
                        <Clock size={11} /> Time
                      </button>
                    </div>
                  </div>

                  {fighterAMode === 'depth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                        <span style={{ color: '#6b635b' }}>Depth:</span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontWeight: 700,
                            color: '#1d4ed8',
                            background: '#eff6ff',
                            padding: '0.05rem 0.35rem',
                            borderRadius: '3px',
                            border: '1px solid #bfdbfe',
                            fontSize: '0.67rem',
                          }}
                        >
                          {DEPTH_LABELS[fighterADepth] || `D${fighterADepth}`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="6"
                        step="1"
                        value={fighterADepth}
                        onChange={(e) => onChangeFighterADepth?.(parseInt(e.target.value, 10))}
                        className="intransitive-range-slider blue"
                        disabled={isSimulating}
                        style={{ height: '4px' }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Clock size={12} color="#2563eb" />
                        <span style={{ fontSize: '0.7rem', color: '#6b635b' }}>Time:</span>
                        <input
                          type="number"
                          min="0.1"
                          max="60"
                          step="0.5"
                          value={fighterATimeSec}
                          onChange={(e) => onChangeFighterATimeSec?.(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                          disabled={isSimulating}
                          className="intransitive-input-number warm"
                          style={{ width: '50px', padding: '0.15rem 0.35rem', fontSize: '0.72rem' }}
                        />
                        <span style={{ fontSize: '0.7rem', color: '#6b635b' }}>s</span>
                      </div>
                      <div className="intransitive-mini-btn-group">
                        {[0.5, 1.0, 2.0].map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => onChangeFighterATimeSec?.(t)}
                            disabled={isSimulating}
                            className={`intransitive-mini-btn blue ${fighterATimeSec === t ? 'active' : ''}`}
                            style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                          >
                            {t}s
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ height: '1px', background: '#eee8de' }} />

                {/* Fighter B (Red) */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem' }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        fontWeight: 700,
                        color: '#c2410c',
                      }}
                    >
                      <Activity size={12} color="#ea580c" />
                      <span>{checkpointB?.name?.split(' ')[0] || 'Fighter B'} (Red):</span>
                    </span>

                    <div className="intransitive-segmented-switch">
                      <button
                        type="button"
                        onClick={() => onChangeFighterBMode?.('depth')}
                        className={`intransitive-segmented-btn ${fighterBMode === 'depth' ? 'active' : ''}`}
                        title="Search with fixed ply depth"
                      >
                        <Target size={11} /> Depth
                      </button>
                      <button
                        type="button"
                        onClick={() => onChangeFighterBMode?.('time')}
                        className={`intransitive-segmented-btn ${fighterBMode === 'time' ? 'active' : ''}`}
                        title="Search with iterative deepening for allotted time"
                      >
                        <Clock size={11} /> Time
                      </button>
                    </div>
                  </div>

                  {fighterBMode === 'depth' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.7rem' }}>
                        <span style={{ color: '#6b635b' }}>Depth:</span>
                        <span
                          style={{
                            fontFamily: "'JetBrains Mono', monospace",
                            fontWeight: 700,
                            color: '#c2410c',
                            background: '#fff7ed',
                            padding: '0.05rem 0.35rem',
                            borderRadius: '3px',
                            border: '1px solid #fed7aa',
                            fontSize: '0.67rem',
                          }}
                        >
                          {DEPTH_LABELS[fighterBDepth] || `D${fighterBDepth}`}
                        </span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="6"
                        step="1"
                        value={fighterBDepth}
                        onChange={(e) => onChangeFighterBDepth?.(parseInt(e.target.value, 10))}
                        className="intransitive-range-slider red"
                        disabled={isSimulating}
                        style={{ height: '4px' }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        <Clock size={12} color="#ea580c" />
                        <span style={{ fontSize: '0.7rem', color: '#6b635b' }}>Time:</span>
                        <input
                          type="number"
                          min="0.1"
                          max="60"
                          step="0.5"
                          value={fighterBTimeSec}
                          onChange={(e) => onChangeFighterBTimeSec?.(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                          disabled={isSimulating}
                          className="intransitive-input-number warm"
                          style={{ width: '50px', padding: '0.15rem 0.35rem', fontSize: '0.72rem' }}
                        />
                        <span style={{ fontSize: '0.7rem', color: '#6b635b' }}>s</span>
                      </div>
                      <div className="intransitive-mini-btn-group">
                        {[0.5, 1.0, 2.0].map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() => onChangeFighterBTimeSec?.(t)}
                            disabled={isSimulating}
                            className={`intransitive-mini-btn red ${fighterBTimeSec === t ? 'active' : ''}`}
                            style={{ padding: '0.1rem 0.35rem', fontSize: '0.65rem' }}
                          >
                            {t}s
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* AlphaZero Dynamic Opening Exploration Indicator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.3rem 0.55rem',
                  background: '#f8fafc',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.69rem',
                  color: '#334155',
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}>
                  <Sparkles size={12} color="#2563eb" />
                  <span>AlphaZero Dynamic Branching:</span>
                </span>
                <span style={{ color: '#059669', fontWeight: 600, fontSize: '0.68rem' }}>
                  τ=15 cp Active
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Inline Live Results During Simulation */}
        {isSimulating && arenaLiveResults && (() => {
          const liveGames = arenaLiveResults.winsA + arenaLiveResults.winsB + arenaLiveResults.draws;
          const liveWinRateA = liveGames > 0 ? Math.round((arenaLiveResults.winsA / liveGames) * 100) : 0;
          const liveWinRateB = liveGames > 0 ? Math.round((arenaLiveResults.winsB / liveGames) * 100) : 0;
          const liveDrawRate = liveGames > 0 ? Math.round((arenaLiveResults.draws / liveGames) * 100) : 0;
          const progress = Math.min(100, Math.round((Math.max(liveGames, arenaLiveResults.gameIndex) / arenaLiveResults.totalGames) * 100));
          return (
            <div className="intransitive-arena-inline-results">
              <span className="intransitive-arena-inline-score" style={{ color: '#7c3aed' }}>
                ◆ {arenaLiveResults.winsA}
              </span>
              <span className="intransitive-arena-inline-draw">
                — {arenaLiveResults.draws}
              </span>
              <span className="intransitive-arena-inline-score" style={{ color: '#c2410c' }}>
                ◇ {arenaLiveResults.winsB}
              </span>
              <div className="intransitive-arena-inline-bar">
                <div className="intransitive-win-bar" style={{ height: '6px', borderRadius: '3px' }}>
                  <div className="intransitive-win-seg-a" style={{ width: `${liveWinRateA}%`, transition: 'width 0.2s ease', background: '#7c3aed' }} />
                  <div className="intransitive-win-seg-draw" style={{ width: `${liveDrawRate}%`, transition: 'width 0.2s ease' }} />
                  <div className="intransitive-win-seg-b" style={{ width: `${liveWinRateB}%`, transition: 'width 0.2s ease', background: '#c2410c' }} />
                </div>
              </div>
              <span className="intransitive-arena-inline-progress">
                {arenaLiveResults.gameIndex}/{arenaLiveResults.totalGames} ({progress}%)
              </span>
            </div>
          );
        })()}

        {/* Tournament Result Telemetry */}
        {tournamentResult && (
          <div className="intransitive-tournament-result-box">
            {/* Wins Summary */}
            <div className="intransitive-tournament-scores">
              <span style={{ color: '#7c3aed', fontWeight: 700 }}>
                ◆ {checkpointA?.name?.split(' ')[0] || 'Fighter A'} (
                {tournamentResult.thinkTimeSecA ? `${tournamentResult.thinkTimeSecA}s` : `D${tournamentResult.depthA ?? fighterADepth}`}
                ): {tournamentResult.winsA} ({tournamentResult.winRateA}%)
              </span>
              <span style={{ color: '#786f66' }}>
                {tournamentResult.draws} draws ({tournamentResult.drawRate}%)
                {tournamentResult.isCancelled && (
                  <span style={{ marginLeft: '0.35rem', color: '#b45309', fontWeight: 700 }}>
                    [Stopped early: {tournamentResult.gamesPlayed} games]
                  </span>
                )}
              </span>
              <span style={{ color: '#c2410c', fontWeight: 700 }}>
                ◇ {checkpointB?.name?.split(' ')[0] || 'Fighter B'} (
                {tournamentResult.thinkTimeSecB ? `${tournamentResult.thinkTimeSecB}s` : `D${tournamentResult.depthB ?? fighterBDepth}`}
                ): {tournamentResult.winsB} ({tournamentResult.winRateB}%)
              </span>
            </div>

            {/* Win Distribution Bar */}
            <div className="intransitive-win-bar">
              <div
                className="intransitive-win-seg-a"
                style={{ width: `${tournamentResult.winRateA}%` }}
                title={`${checkpointA?.name}: ${tournamentResult.winRateA}%`}
              />
              <div
                className="intransitive-win-seg-draw"
                style={{ width: `${tournamentResult.drawRate}%` }}
                title={`Draws: ${tournamentResult.drawRate}%`}
              />
              <div
                className="intransitive-win-seg-b"
                style={{ width: `${tournamentResult.winRateB}%` }}
                title={`${checkpointB?.name}: ${tournamentResult.winRateB}%`}
              />
            </div>

            {/* Extended Match Stats: Average Moves & Tactical Accuracy */}
            <div className="intransitive-tournament-submetrics">
              <div className="intransitive-submetric-cell">
                <Activity size={12} color="#786f66" />
                <span>Avg Length:</span>
                <strong>{tournamentResult.avgGameLength ?? 0} plies</strong>
              </div>

              <div className="intransitive-submetric-cell">
                <Target size={12} color="#059669" />
                <span>Tactical Accuracy:</span>
                <strong>
                  <span style={{ color: '#7c3aed' }}>{tournamentResult.accuracyA ?? 50}%</span>
                  {' / '}
                  <span style={{ color: '#c2410c' }}>{tournamentResult.accuracyB ?? 50}%</span>
                </strong>
              </div>
            </div>

            {onExportTournamentPGN && (
              <div style={{ marginTop: '0.45rem', paddingTop: '0.35rem', borderTop: '1px solid #f0ebe1' }}>
                <button
                  type="button"
                  onClick={onExportTournamentPGN}
                  className="intransitive-btn-secondary"
                  style={{ width: '100%', justifyContent: 'center', padding: '0.35rem 0.65rem', fontSize: '0.74rem' }}
                  title="Download all games played in this tournament as a PGN collection"
                >
                  <Download size={12} /> Export All Games (PGN)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

