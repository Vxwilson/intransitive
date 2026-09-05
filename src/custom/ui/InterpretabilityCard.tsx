import React, { useState, useMemo } from 'react';
import { TrendingUp, Grid, Sparkles } from 'lucide-react';
import { BOARD_SIZE, NUM_SQUARES, squareToAlgebraic } from '../core/constants';
import { ROCK, PAPER, SCISSORS } from '../core/types';
import type { PieceType } from '../core/types';
import type { EvaluationWeights, GenerationPoint } from '../engine/types';

interface InterpretabilityCardProps {
  weights: EvaluationWeights;
  history: GenerationPoint[];
}

export const InterpretabilityCard: React.FC<InterpretabilityCardProps> = ({
  weights,
  history,
}) => {
  const [activeTab, setActiveTab] = useState<'chart' | 'heatmap'>('chart');
  const [selectedPieceHeatmap, setSelectedPieceHeatmap] = useState<PieceType>(ROCK);
  const [hoveredSquare, setHoveredSquare] = useState<{ sq: number; val: number } | null>(null);

  // SVG Chart Geometry
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return null;

    const width = 360;
    const height = 140;
    const padding = 20;

    const maxGen = Math.max(1, history[history.length - 1].generation);
    const maxVal = Math.max(
      10,
      ...history.map((h) => Math.max(h.R, h.P, h.S)),
      weights.goalDistanceWeight / 3
    );

    const getX = (gen: number) => padding + (gen / maxGen) * (width - 2 * padding);
    const getY = (val: number) => height - padding - (val / maxVal) * (height - 2 * padding);

    const pointsR = history.map((h) => `${getX(h.generation)},${getY(h.R)}`).join(' ');
    const pointsP = history.map((h) => `${getX(h.generation)},${getY(h.P)}`).join(' ');
    const pointsS = history.map((h) => `${getX(h.generation)},${getY(h.S)}`).join(' ');

    return { width, height, pointsR, pointsP, pointsS, maxVal, maxGen };
  }, [history, weights.goalDistanceWeight]);

  // Heatmap values for the selected piece
  const heatmapValues = useMemo(() => {
    const table = weights.pst[selectedPieceHeatmap];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < NUM_SQUARES; i++) {
      const v = table[i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { table, min, max };
  }, [weights, selectedPieceHeatmap]);

  const getHeatmapColor = (val: number) => {
    if (val === 0) return '#f7f5ee';
    if (val > 0) {
      const intensity = Math.min(1, val / Math.max(1, heatmapValues.max));
      return `rgba(37, 99, 235, ${0.18 + intensity * 0.72})`;
    } else {
      const intensity = Math.min(1, Math.abs(val) / Math.max(1, Math.abs(heatmapValues.min)));
      return `rgba(220, 38, 38, ${0.18 + intensity * 0.72})`;
    }
  };

  return (
    <div className="intransitive-editorial-card">
      {/* Sub-tab Switcher Header */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-sub-tabs">
          <button
            type="button"
            onClick={() => setActiveTab('chart')}
            className={`intransitive-sub-tab-btn ${activeTab === 'chart' ? 'active' : ''}`}
          >
            <TrendingUp size={14} /> Piece Value Dynamics
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('heatmap')}
            className={`intransitive-sub-tab-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
          >
            <Grid size={14} /> Positional Heatmap
          </button>
        </div>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#786f66', fontFamily: "'JetBrains Mono', monospace" }}>
          <Sparkles size={13} color="#c2410c" /> Tabula Rasa Weights
        </span>
      </div>

      {/* Current Parameter Metrics Bar */}
      <div className="intransitive-weights-grid">
        <div className="intransitive-weight-cell rock">
          <span className="intransitive-weight-cell-label" style={{ color: '#b45309' }}>Rock</span>
          <p className="intransitive-weight-cell-val">
            {weights.pieceValues.R.toFixed(1)}
          </p>
        </div>
        <div className="intransitive-weight-cell paper">
          <span className="intransitive-weight-cell-label" style={{ color: '#047857' }}>Paper</span>
          <p className="intransitive-weight-cell-val">
            {weights.pieceValues.P.toFixed(1)}
          </p>
        </div>
        <div className="intransitive-weight-cell scissors">
          <span className="intransitive-weight-cell-label" style={{ color: '#be123c' }}>Scissors</span>
          <p className="intransitive-weight-cell-val">
            {weights.pieceValues.S.toFixed(1)}
          </p>
        </div>
        <div className="intransitive-weight-cell goal">
          <span className="intransitive-weight-cell-label" style={{ color: '#1d4ed8' }}>Goal Proximity</span>
          <p className="intransitive-weight-cell-val">
            {weights.goalDistanceWeight.toFixed(1)}
          </p>
        </div>
        <div className="intransitive-weight-cell runner">
          <span className="intransitive-weight-cell-label" style={{ color: '#7c3aed' }}>Runner Threat</span>
          <p className="intransitive-weight-cell-val">
            {(weights.runnerWeight ?? 100).toFixed(1)}
          </p>
        </div>
      </div>

      {/* Tab 1: Live SVG Evolution Line Chart */}
      {activeTab === 'chart' && (
        <div className="intransitive-chart-container">
          <div className="intransitive-chart-header">
            <span>Evolution across Generations</span>
            <div className="intransitive-chart-legend">
              <div className="intransitive-legend-pill" style={{ color: '#b45309' }}>
                <span className="intransitive-legend-indicator" style={{ background: '#d97706' }} /> Rock
              </div>
              <div className="intransitive-legend-pill" style={{ color: '#047857' }}>
                <span className="intransitive-legend-indicator" style={{ background: '#059669' }} /> Paper
              </div>
              <div className="intransitive-legend-pill" style={{ color: '#be123c' }}>
                <span className="intransitive-legend-indicator" style={{ background: '#dc2626' }} /> Scissors
              </div>
            </div>
          </div>

          {chartData ? (
            <svg
              viewBox={`0 0 ${chartData.width} ${chartData.height}`}
              className="intransitive-chart-svg"
            >
              {/* Background grid lines */}
              <line
                x1="20"
                y1="120"
                x2="340"
                y2="120"
                stroke="#e8e2d8"
                strokeWidth="1"
              />
              <line
                x1="20"
                y1="70"
                x2="340"
                y2="70"
                stroke="#eee8de"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <line
                x1="20"
                y1="20"
                x2="340"
                y2="20"
                stroke="#eee8de"
                strokeDasharray="4 4"
                strokeWidth="1"
              />

              {/* Polylines for R, P, S */}
              <polyline
                points={chartData.pointsR}
                fill="none"
                stroke="#d97706"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={chartData.pointsP}
                fill="none"
                stroke="#059669"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={chartData.pointsS}
                fill="none"
                stroke="#dc2626"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '120px', fontSize: '0.75rem', color: '#8c827a' }}>
              Train games to observe live weight evolution
            </div>
          )}
        </div>
      )}

      {/* Tab 2: 9x9 Positional Heatmap */}
      {activeTab === 'heatmap' && (
        <div className="intransitive-heatmap-container">
          <div className="intransitive-heatmap-bar">
            <div className="intransitive-mini-btn-group">
              <button
                type="button"
                onClick={() => setSelectedPieceHeatmap(ROCK)}
                className={`intransitive-mini-btn ${selectedPieceHeatmap === ROCK ? 'active' : ''}`}
              >
                Rock Map
              </button>
              <button
                type="button"
                onClick={() => setSelectedPieceHeatmap(PAPER)}
                className={`intransitive-mini-btn ${selectedPieceHeatmap === PAPER ? 'active' : ''}`}
              >
                Paper Map
              </button>
              <button
                type="button"
                onClick={() => setSelectedPieceHeatmap(SCISSORS)}
                className={`intransitive-mini-btn ${selectedPieceHeatmap === SCISSORS ? 'active' : ''}`}
              >
                Scissors Map
              </button>
            </div>

            <span className="intransitive-heatmap-hover-info">
              {hoveredSquare
                ? `${squareToAlgebraic(hoveredSquare.sq)}: ${hoveredSquare.val > 0 ? '+' : ''}${hoveredSquare.val.toFixed(1)}`
                : 'Hover square for value'}
            </span>
          </div>

          {/* 9x9 Mini Heatmap Grid */}
          <div className="intransitive-heatmap-matrix">
            {Array.from({ length: NUM_SQUARES }, (_, i) => {
              // Standard rank 8 down to 0
              const r = 8 - Math.floor(i / BOARD_SIZE);
              const f = i % BOARD_SIZE;
              const sq = r * BOARD_SIZE + f;
              const val = heatmapValues.table[sq] || 0;

              return (
                <div
                  key={sq}
                  onMouseEnter={() => setHoveredSquare({ sq, val })}
                  onMouseLeave={() => setHoveredSquare(null)}
                  className="intransitive-heatmap-cell"
                  style={{ backgroundColor: getHeatmapColor(val) }}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
