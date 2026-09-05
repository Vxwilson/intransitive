import React, { useState, useMemo } from 'react';
import { TrendingUp, Grid, Sparkles, BrainCircuit } from 'lucide-react';
import { BOARD_SIZE, NUM_SQUARES, squareToAlgebraic } from '../core/constants';
import { ROCK, PAPER, SCISSORS } from '../core/types';
import type { PieceType } from '../core/types';
import type { EvaluationWeights, GenerationPoint } from '../engine/types';
import type { NNUEWeights } from '../engine/nnue/types';
import { getFeatureIndex } from '../engine/nnue/featureTransformer';

interface InterpretabilityCardProps {
  weights: EvaluationWeights;
  history: GenerationPoint[];
  nnueWeights?: NNUEWeights | null;
  isNNUEMode?: boolean;
}

export const InterpretabilityCard: React.FC<InterpretabilityCardProps> = ({
  weights,
  history,
  nnueWeights,
  isNNUEMode = false,
}) => {
  const [activeTab, setActiveTab] = useState<'chart' | 'heatmap'>('chart');
  const [selectedPieceHeatmap, setSelectedPieceHeatmap] = useState<PieceType>(ROCK);
  const [selectedNNUEChannel, setSelectedNNUEChannel] = useState<{ piece: PieceType; isFriendly: boolean }>({
    piece: ROCK,
    isFriendly: true,
  });
  const [hoveredSquare, setHoveredSquare] = useState<{ sq: number; val: number } | null>(null);

  // SVG Chart Geometry (Linear or NNUE Loss)
  const chartData = useMemo(() => {
    if (!history || history.length === 0) return null;

    const width = 360;
    const height = 140;
    const padding = 20;

    const maxGen = Math.max(1, history[history.length - 1].generation);

    if (isNNUEMode) {
      const validLossPoints = history.filter((h) => h.loss !== undefined && h.loss !== null);
      if (validLossPoints.length === 0) return null;
      const maxLoss = Math.max(0.2, ...validLossPoints.map((h) => h.loss!));
      const getX = (gen: number) => padding + (gen / maxGen) * (width - 2 * padding);
      const getY = (loss: number) => height - padding - (loss / maxLoss) * (height - 2 * padding);
      const pointsLoss = validLossPoints.map((h) => `${getX(h.generation)},${getY(h.loss!)}`).join(' ');
      return { width, height, pointsLoss, maxLoss, maxGen, isNNUE: true };
    }

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

    return { width, height, pointsR, pointsP, pointsS, maxVal, maxGen, isNNUE: false };
  }, [history, weights.goalDistanceWeight, isNNUEMode]);

  // Heatmap values for Linear or NNUE
  const heatmapValues = useMemo(() => {
    if (isNNUEMode && nnueWeights) {
      const { piece, isFriendly } = selectedNNUEChannel;
      const values = new Float32Array(NUM_SQUARES);
      let min = Infinity;
      let max = -Infinity;

      for (let sq = 0; sq < NUM_SQUARES; sq++) {
        const featIdx = getFeatureIndex(piece, isFriendly, sq);
        const offset = featIdx * 128;
        let sum = 0;
        for (let n = 0; n < 128; n++) {
          sum += nnueWeights.w0[offset + n];
        }
        const avg = sum / 128;
        values[sq] = avg;
        if (avg < min) min = avg;
        if (avg > max) max = avg;
      }

      return { table: values, min, max };
    }

    // Linear PST
    const table = weights.pst[selectedPieceHeatmap];
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < NUM_SQUARES; i++) {
      const v = table[i] || 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return { table, min, max };
  }, [isNNUEMode, nnueWeights, selectedNNUEChannel, weights, selectedPieceHeatmap]);

  const getHeatmapColor = (val: number) => {
    if (Math.abs(val) < 1e-4) return '#f7f5ee';
    if (val > 0) {
      const intensity = Math.min(1, val / Math.max(1e-4, heatmapValues.max));
      return `rgba(37, 99, 235, ${0.18 + intensity * 0.72})`;
    } else {
      const intensity = Math.min(1, Math.abs(val) / Math.max(1e-4, Math.abs(heatmapValues.min)));
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
            <TrendingUp size={14} /> {isNNUEMode ? 'Training Dynamics' : 'Piece Value Dynamics'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('heatmap')}
            className={`intransitive-sub-tab-btn ${activeTab === 'heatmap' ? 'active' : ''}`}
          >
            <Grid size={14} /> {isNNUEMode ? 'NNUE Spatial Map' : 'Positional Heatmap'}
          </button>
        </div>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.72rem', color: '#786f66', fontFamily: "'JetBrains Mono', monospace" }}>
          {isNNUEMode ? <BrainCircuit size={13} color="#7c3aed" /> : <Sparkles size={13} color="#c2410c" />}
          {isNNUEMode ? 'NNUE 66k Weights' : 'Tabula Rasa Weights'}
        </span>
      </div>

      {/* Current Parameter Metrics Bar */}
      {!isNNUEMode ? (
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
      ) : (
        <div className="intransitive-weights-grid">
          <div className="intransitive-weight-cell" style={{ background: '#f5f3ff', borderColor: '#ddd6fe' }}>
            <span className="intransitive-weight-cell-label" style={{ color: '#6d28d9' }}>Architecture</span>
            <p className="intransitive-weight-cell-val" style={{ fontSize: '0.85rem' }}>486→256→32→1</p>
          </div>
          <div className="intransitive-weight-cell" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
            <span className="intransitive-weight-cell-label" style={{ color: '#1d4ed8' }}>Parameters</span>
            <p className="intransitive-weight-cell-val" style={{ fontSize: '0.85rem' }}>70,593</p>
          </div>
          <div className="intransitive-weight-cell" style={{ background: '#ecfdf5', borderColor: '#a7f3d0' }}>
            <span className="intransitive-weight-cell-label" style={{ color: '#047857' }}>Current Loss</span>
            <p className="intransitive-weight-cell-val" style={{ fontSize: '0.85rem' }}>
              {(history[history.length - 1]?.loss ?? 0.09).toFixed(4)}
            </p>
          </div>
          <div className="intransitive-weight-cell" style={{ background: '#fff7ed', borderColor: '#fed7aa' }}>
            <span className="intransitive-weight-cell-label" style={{ color: '#c2410c' }}>Optimizer</span>
            <p className="intransitive-weight-cell-val" style={{ fontSize: '0.85rem' }}>AdamW</p>
          </div>
        </div>
      )}

      {/* Tab 1: Live SVG Evolution Line Chart */}
      {activeTab === 'chart' && (
        <div className="intransitive-chart-container">
          <div className="intransitive-chart-header">
            <span>Evolution across Generations</span>
            <div className="intransitive-chart-legend">
              {isNNUEMode ? (
                <div className="intransitive-legend-pill" style={{ color: '#7c3aed' }}>
                  <span className="intransitive-legend-indicator" style={{ background: '#7c3aed' }} /> AdamW Loss (BCE)
                </div>
              ) : (
                <>
                  <div className="intransitive-legend-pill" style={{ color: '#b45309' }}>
                    <span className="intransitive-legend-indicator" style={{ background: '#d97706' }} /> Rock
                  </div>
                  <div className="intransitive-legend-pill" style={{ color: '#047857' }}>
                    <span className="intransitive-legend-indicator" style={{ background: '#059669' }} /> Paper
                  </div>
                  <div className="intransitive-legend-pill" style={{ color: '#be123c' }}>
                    <span className="intransitive-legend-indicator" style={{ background: '#dc2626' }} /> Scissors
                  </div>
                </>
              )}
            </div>
          </div>

          {chartData ? (
            <svg
              viewBox={`0 0 ${chartData.width} ${chartData.height}`}
              className="intransitive-chart-svg"
            >
              {/* Background grid lines */}
              <line x1="20" y1="120" x2="340" y2="120" stroke="#e8e2d8" strokeWidth="1" />
              <line x1="20" y1="70" x2="340" y2="70" stroke="#eee8de" strokeDasharray="4 4" strokeWidth="1" />
              <line x1="20" y1="20" x2="340" y2="20" stroke="#eee8de" strokeDasharray="4 4" strokeWidth="1" />

              {chartData.isNNUE ? (
                <polyline fill="none" stroke="#7c3aed" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={chartData.pointsLoss} />
              ) : (
                <>
                  <polyline fill="none" stroke="#d97706" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={chartData.pointsR} />
                  <polyline fill="none" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={chartData.pointsP} />
                  <polyline fill="none" stroke="#dc2626" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" points={chartData.pointsS} />
                </>
              )}
            </svg>
          ) : (
            <div className="intransitive-chart-empty">No generation history recorded yet</div>
          )}
        </div>
      )}

      {/* Tab 2: 9x9 Positional Heatmap */}
      {activeTab === 'heatmap' && (
        <div className="intransitive-heatmap-container">
          <div className="intransitive-heatmap-header">
            <span>{isNNUEMode ? 'Learned Spatial Activation Map' : 'Learned Piece-Square Table (PST)'}</span>

            {/* Piece Selector Chips */}
            {!isNNUEMode ? (
              <div className="intransitive-mini-btn-group">
                <button
                  type="button"
                  onClick={() => setSelectedPieceHeatmap(ROCK)}
                  className={`intransitive-mini-btn ${selectedPieceHeatmap === ROCK ? 'active' : ''}`}
                >
                  Rock
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPieceHeatmap(PAPER)}
                  className={`intransitive-mini-btn ${selectedPieceHeatmap === PAPER ? 'active' : ''}`}
                >
                  Paper
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedPieceHeatmap(SCISSORS)}
                  className={`intransitive-mini-btn ${selectedPieceHeatmap === SCISSORS ? 'active' : ''}`}
                >
                  Scissors
                </button>
              </div>
            ) : (
              <div className="intransitive-mini-btn-group">
                <button
                  type="button"
                  onClick={() => setSelectedNNUEChannel({ piece: ROCK, isFriendly: true })}
                  className={`intransitive-mini-btn ${selectedNNUEChannel.piece === ROCK && selectedNNUEChannel.isFriendly ? 'active' : ''}`}
                >
                  Us Rock
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNNUEChannel({ piece: PAPER, isFriendly: true })}
                  className={`intransitive-mini-btn ${selectedNNUEChannel.piece === PAPER && selectedNNUEChannel.isFriendly ? 'active' : ''}`}
                >
                  Us Paper
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNNUEChannel({ piece: SCISSORS, isFriendly: true })}
                  className={`intransitive-mini-btn ${selectedNNUEChannel.piece === SCISSORS && selectedNNUEChannel.isFriendly ? 'active' : ''}`}
                >
                  Us Scissors
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNNUEChannel({ piece: ROCK, isFriendly: false })}
                  className={`intransitive-mini-btn red ${selectedNNUEChannel.piece === ROCK && !selectedNNUEChannel.isFriendly ? 'active' : ''}`}
                >
                  Them Rock
                </button>
              </div>
            )}
          </div>

          {/* 9x9 Grid Rendering */}
          <div className="intransitive-heatmap-matrix">
            {Array.from({ length: 9 }).map((_, rankIdx) => {
              const rank = 8 - rankIdx;
              return Array.from({ length: 9 }).map((__, file) => {
                const sq = rank * BOARD_SIZE + file;
                const val = heatmapValues.table[sq] || 0;
                const color = getHeatmapColor(val);

                return (
                  <div
                    key={sq}
                    className="intransitive-heatmap-cell"
                    style={{ backgroundColor: color }}
                    onMouseEnter={() => setHoveredSquare({ sq, val })}
                    onMouseLeave={() => setHoveredSquare(null)}
                    title={`${squareToAlgebraic(sq)}: ${val.toFixed(2)}`}
                  />
                );
              });
            })}
          </div>

          {hoveredSquare && (
            <div style={{ textAlign: 'center', fontSize: '0.75rem', color: '#6b635b', marginTop: '0.4rem', fontFamily: "'JetBrains Mono', monospace" }}>
              Square {squareToAlgebraic(hoveredSquare.sq)}: <strong>{hoveredSquare.val > 0 ? `+${hoveredSquare.val.toFixed(3)}` : hoveredSquare.val.toFixed(3)}</strong>
            </div>
          )}

          <div className="intransitive-heatmap-legend">
            <span style={{ color: '#dc2626' }}>Red: Negative Penalty</span>
            <span style={{ color: '#786f66' }}>Neutral: 0.0</span>
            <span style={{ color: '#2563eb' }}>Blue: Positive Advantage</span>
          </div>
        </div>
      )}
    </div>
  );
};
