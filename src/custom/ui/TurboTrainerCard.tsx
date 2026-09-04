/**
 * TurboTrainerCard - High-speed background trainer with arbitrary batch sizes,
 * rich outcome analytics, and timestamped checkpoint naming (Gen X_MMDD_HHMMSS).
 */

import React, { useState } from 'react';
import {
  Square,
  Cpu,
  Rocket,
  Activity,
  BarChart3,
  Crosshair,
  ShieldAlert,
  Sliders,
  Sparkles,
} from 'lucide-react';
import type { TrainingStats } from '../engine/types';

interface TurboTrainerCardProps {
  isTraining: boolean;
  progress: { completed: number; total: number; nps: number } | null;
  stats: TrainingStats;
  onStartTurbo: (games: number) => void;
  onStopTurbo: () => void;
  onResetTraining: () => void;
}

export const TurboTrainerCard: React.FC<TurboTrainerCardProps> = ({
  isTraining,
  progress,
  stats,
  onStartTurbo,
  onStopTurbo,
  onResetTraining,
}) => {
  const [customAmount, setCustomAmount] = useState<number>(300);

  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : 0;

  const totalDecisive = stats.blueWins + stats.redWins;
  const bluePercent = totalDecisive > 0 ? Math.round((stats.blueWins / totalDecisive) * 100) : 50;
  const redPercent = 100 - bluePercent;

  const handleStartCustom = () => {
    const games = Math.max(1, Math.min(50000, Number(customAmount) || 100));
    onStartTurbo(games);
  };

  return (
    <div className="intransitive-editorial-card intransitive-turbo-container">
      {/* Header */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-card-heading">
          <div className="intransitive-card-icon-wrap" style={{ background: '#fff7ed', color: '#ea580c', borderColor: '#fed7aa' }}>
            <Cpu size={18} />
          </div>
          <div className="intransitive-card-text">
            <h3>Turbo Background Trainer</h3>
            <p>High-speed Tabula Rasa self-play in headless background Web Worker</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onResetTraining}
          disabled={isTraining}
          className="intransitive-btn-text"
        >
          Reset to Gen 0
        </button>
      </div>

      {/* Progress Telemetry Bar (When Training) */}
      {isTraining && progress && (
        <div className="intransitive-progress-box">
          <div className="intransitive-progress-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: '#ea580c', fontWeight: 700 }}>
              <Activity size={15} /> Turbo Self-Play in Progress...
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>
              {progress.completed.toLocaleString()} / {progress.total.toLocaleString()} Games ({percent}%)
            </span>
          </div>

          {/* Progress Track */}
          <div className="intransitive-progress-track">
            <div
              className="intransitive-progress-fill"
              style={{ width: `${percent}%` }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem', color: '#786f66', paddingTop: '0.3rem' }}>
            <span>
              Worker Throughput: <strong style={{ color: '#241e19', fontFamily: "'JetBrains Mono', monospace" }}>{progress.nps.toLocaleString()}</strong> plies/sec
            </span>
            <button
              type="button"
              onClick={onStopTurbo}
              className="intransitive-btn-stop"
            >
              <Square size={11} fill="currentColor" /> Stop Early
            </button>
          </div>
        </div>
      )}

      {/* Lifetime Core Metrics Grid */}
      <div className="intransitive-metrics-grid" style={{ marginTop: '0.4rem' }}>
        <div className="intransitive-metric-item">
          <span className="intransitive-metric-label">Generation</span>
          <span className="intransitive-metric-val" style={{ color: '#c2410c' }}>Gen {stats.generation}</span>
        </div>

        <div className="intransitive-metric-item">
          <span className="intransitive-metric-label">Games Played</span>
          <span className="intransitive-metric-val">{stats.gamesPlayed.toLocaleString()}</span>
        </div>

        <div className="intransitive-metric-item">
          <span className="intransitive-metric-label">Win Ratio</span>
          <span className="intransitive-metric-val" style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
            <span style={{ color: '#2563eb' }}>{bluePercent}% B</span> / <span style={{ color: '#ea580c' }}>{redPercent}% R</span>
          </span>
        </div>

        <div className="intransitive-metric-item">
          <span className="intransitive-metric-label">Avg Length</span>
          <span className="intransitive-metric-val">{stats.avgGameLength} plies</span>
        </div>
      </div>

      {/* Arbitrary Training Amount Input Bar (Placed under metrics grid) */}
      {!isTraining && (
        <div className="intransitive-custom-train-bar" style={{ marginTop: '0.65rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <Sliders size={15} color="#6b635b" />
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#322a24' }}>
              Custom Amount:
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1 }}>
            <input
              type="number"
              min="1"
              max="50000"
              step="50"
              value={customAmount}
              onChange={(e) => setCustomAmount(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="intransitive-input-number warm"
              style={{ width: '85px', padding: '0.4rem 0.6rem', fontSize: '0.84rem', fontWeight: 700 }}
            />
            <span style={{ fontSize: '0.75rem', color: '#6b635b' }}>games</span>

            {/* Quick Preset Additive Chips */}
            <div className="intransitive-mini-btn-group">
              {[100, 300, 500, 2500].map((val) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setCustomAmount(val)}
                  className={`intransitive-mini-btn ${customAmount === val ? 'active' : ''}`}
                  style={{ padding: '0.25rem 0.5rem', fontSize: '0.72rem' }}
                >
                  {val.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartCustom}
            className="intransitive-btn-primary"
            style={{ padding: '0.45rem 1.1rem', fontSize: '0.78rem' }}
          >
            <Rocket size={14} /> Train {customAmount.toLocaleString()} Games
          </button>
        </div>
      )}

      {/* AlphaZero Exploration & Anti-Cycle Safeguards Strip */}
      <div
        style={{
          marginTop: '0.65rem',
          padding: '0.55rem 0.75rem',
          background: '#fcfaf7',
          border: '1px solid #ebd9c8',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          fontSize: '0.74rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 700, color: '#43281c' }}>
            <Sparkles size={14} color="#d97706" />
            <span>AlphaZero Exploration Engine & Anti-Cycle Safeguards</span>
          </div>
          <span
            style={{
              fontSize: '0.68rem',
              color: '#059669',
              background: '#ecfdf5',
              padding: '0.1rem 0.45rem',
              borderRadius: '4px',
              border: '1px solid #a7f3d0',
              fontWeight: 600,
            }}
          >
            Active
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: '0.35rem',
            color: '#6b635b',
            fontSize: '0.71rem',
            marginTop: '0.1rem',
          }}
        >
          <div>
            <strong style={{ color: '#292524' }}>Dirichlet Noise:</strong> α=0.30, ε=0.25 (Plies 0–4)
          </div>
          <div>
            <strong style={{ color: '#292524' }}>Softmax Temp:</strong> τ=24 cp → 10 cp → 0 (Greedy)
          </div>
          <div>
            <strong style={{ color: '#292524' }}>Adaptive LR:</strong> α={stats.currentAlpha !== undefined ? stats.currentAlpha.toFixed(4) : '0.0150'} (Annealed)
          </div>
          <div>
            <strong style={{ color: '#292524' }}>Opponent Mix:</strong> 65% Self / 20% League / 15% Anchor
          </div>
          <div>
            <strong style={{ color: '#292524' }}>TD Signal:</strong> Backward eligibility TD(λ=0.7)
          </div>
        </div>
      </div>

      {/* Rich Statistical Deep-Dive Section */}
      <div className="intransitive-stats-deep-section">
        <div className="intransitive-stats-deep-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <BarChart3 size={15} color="#c2410c" />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#322a24' }}>
              Game Outcome & Terminal Breakdown
            </span>
          </div>
          <span style={{ fontSize: '0.72rem', color: '#786f66' }}>
            Distribution across all {stats.gamesPlayed.toLocaleString()} games
          </span>
        </div>

        <div className="intransitive-stats-deep-grid">
          {/* Touchdown Outcomes */}
          <div className="intransitive-stats-subcard">
            <div className="intransitive-stats-subcard-title">
              <Crosshair size={13} color="#2563eb" /> Touchdowns (Goal reached)
            </div>
            <div className="intransitive-stats-row">
              <span>Blue Touchdowns (i9):</span>
              <strong style={{ color: '#2563eb' }}>{stats.touchdownWins?.blue ?? 0}</strong>
            </div>
            <div className="intransitive-stats-row">
              <span>Red Touchdowns (a1):</span>
              <strong style={{ color: '#ea580c' }}>{stats.touchdownWins?.red ?? 0}</strong>
            </div>
          </div>

          {/* Elimination Outcomes */}
          <div className="intransitive-stats-subcard">
            <div className="intransitive-stats-subcard-title">
              <ShieldAlert size={13} color="#d97706" /> Eliminations (All pieces captured)
            </div>
            <div className="intransitive-stats-row">
              <span>Blue Army Eliminated:</span>
              <strong style={{ color: '#ea580c' }}>{stats.eliminationWins?.red ?? 0}</strong>
            </div>
            <div className="intransitive-stats-row">
              <span>Red Army Eliminated:</span>
              <strong style={{ color: '#2563eb' }}>{stats.eliminationWins?.blue ?? 0}</strong>
            </div>
          </div>

          {/* Draws & Immobilizations */}
          <div className="intransitive-stats-subcard">
            <div className="intransitive-stats-subcard-title">
              <BarChart3 size={13} color="#7c3aed" /> Draws & Immobilizations
            </div>
            <div className="intransitive-stats-row">
              <span>Repetition Draws:</span>
              <strong>{stats.drawRepetition ?? 0}</strong>
            </div>
            <div className="intransitive-stats-row">
              <span>50-Move Limit / Stalemate:</span>
              <strong>{(stats.draw50Move ?? 0) + (stats.immobilizations ?? 0)}</strong>
            </div>
          </div>

          {/* Ply Extremes */}
          <div className="intransitive-stats-subcard">
            <div className="intransitive-stats-subcard-title">
              <Activity size={13} color="#059669" /> Ply Extremes
            </div>
            <div className="intransitive-stats-row">
              <span>Shortest Decisive Game:</span>
              <strong>{stats.shortestGamePlies ? `${stats.shortestGamePlies} plies` : '—'}</strong>
            </div>
            <div className="intransitive-stats-row">
              <span>Longest Game:</span>
              <strong>{stats.longestGamePlies ? `${stats.longestGamePlies} plies` : '—'}</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
