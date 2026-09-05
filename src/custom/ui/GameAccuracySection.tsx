/**
 * GameAccuracySection - Lichess-Style Post-Game Accuracy & Evaluation Analysis Component
 * Features an interactive SVG evaluation graph, dual-player accuracy metrics,
 * blunder/mistake classification, and quick turning-point navigation.
 */

import React, { useState, useMemo, useRef } from 'react';
import {
  TrendingUp,
  AlertTriangle,
  AlertOctagon,
  HelpCircle,
  Trophy,
  Zap,
  Activity,
  CheckCircle2,
} from 'lucide-react';
import { PLAYER_BLUE } from '../core/types';
import type { GameAnalysisResult } from '../engine/accuracy';

interface GameAccuracySectionProps {
  analysis: GameAnalysisResult;
  blueName?: string;
  redName?: string;
  modelName?: string;
  currentPlyIndex: number; // -1 for start, 0..N-1 for move index
  onSelectPly: (index: number) => void;
  onClose?: () => void;
}

export const GameAccuracySection: React.FC<GameAccuracySectionProps> = ({
  analysis,
  blueName = 'Blue Player',
  redName = 'Red Player',
  modelName = 'Master Model',
  currentPlyIndex,
  onSelectPly,
}) => {
  const [hoveredPly, setHoveredPly] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const { evalPoints, plies, blueStats, redStats, turningPoints, summary } = analysis;
  const N = evalPoints.length - 1;

  // SVG Dimension Constants
  const SVG_WIDTH = 640;
  const SVG_HEIGHT = 160;
  const PAD_X = 24;
  const PAD_Y = 16;
  const USABLE_W = SVG_WIDTH - PAD_X * 2;
  const USABLE_H = SVG_HEIGHT - PAD_Y * 2;
  const ZERO_Y = SVG_HEIGHT / 2; // y = 80
  const MAX_EVAL_CP = 600; // Capped eval range +/- 6.0 pawns

  // Map eval points to SVG coordinates
  const points = useMemo(() => {
    if (evalPoints.length === 0) return [];
    return evalPoints.map((pt, idx) => {
      const x = N > 0 ? PAD_X + (idx / N) * USABLE_W : SVG_WIDTH / 2;
      const clamped = Math.max(-MAX_EVAL_CP, Math.min(MAX_EVAL_CP, pt.eval));
      // Positive eval = up (lower Y), Negative eval = down (higher Y)
      const y = ZERO_Y - (clamped / MAX_EVAL_CP) * (USABLE_H / 2);
      return { x, y, ply: pt.ply, eval: pt.eval, san: pt.san };
    });
  }, [evalPoints, N, USABLE_W, USABLE_H, ZERO_Y]);

  // Construct SVG Path string for line
  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, pt, idx) => {
      return idx === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');
  }, [points]);

  // Upper polygon (Blue advantage area above zero-line)
  const blueAreaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    let d = `M ${startX} ${ZERO_Y}`;
    for (const pt of points) {
      const clippedY = Math.min(ZERO_Y, pt.y);
      d += ` L ${pt.x.toFixed(1)} ${clippedY.toFixed(1)}`;
    }
    d += ` L ${endX} ${ZERO_Y} Z`;
    return d;
  }, [points, ZERO_Y]);

  // Lower polygon (Red advantage area below zero-line)
  const redAreaPath = useMemo(() => {
    if (points.length === 0) return '';
    const startX = points[0].x;
    const endX = points[points.length - 1].x;
    let d = `M ${startX} ${ZERO_Y}`;
    for (const pt of points) {
      const clippedY = Math.max(ZERO_Y, pt.y);
      d += ` L ${pt.x.toFixed(1)} ${clippedY.toFixed(1)}`;
    }
    d += ` L ${endX} ${ZERO_Y} Z`;
    return d;
  }, [points, ZERO_Y]);

  // Phase separator X positions
  const openingEndIndex = Math.min(8, N);
  const openingEndX = N > 0 ? PAD_X + (openingEndIndex / N) * USABLE_W : null;

  const middleEndIndex = Math.min(24, N);
  const middleEndX = N > 24 ? PAD_X + (middleEndIndex / N) * USABLE_W : null;

  // Handle pointer hover scrub across SVG
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || points.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const svgX = (clientX / rect.width) * SVG_WIDTH;

    // Find nearest point
    let closestIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(points[i].x - svgX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    setHoveredPly(points[closestIdx].ply);
  };

  const handleMouseLeave = () => {
    setHoveredPly(null);
  };

  const handleClickSvg = () => {
    if (hoveredPly !== null) {
      onSelectPly(hoveredPly - 1);
    }
  };

  // Active highlighted point
  const activePly = hoveredPly !== null ? hoveredPly : currentPlyIndex >= 0 ? currentPlyIndex + 1 : null;
  const activePoint = activePly !== null && activePly >= 0 && activePly < points.length ? points[activePly] : null;
  const activePlyData = activePly !== null && activePly > 0 && activePly <= plies.length ? plies[activePly - 1] : null;

  return (
    <div className="intransitive-accuracy-card">
      {/* Header */}
      <div className="intransitive-accuracy-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="intransitive-accuracy-icon-badge">
            <Activity size={16} />
          </div>
          <div>
            <h3 className="intransitive-accuracy-title">Game Accuracy & Evaluation</h3>
            <span className="intransitive-accuracy-subtitle">
              Analyzed via {modelName} • {N} plies ({summary.leadChanges} lead {summary.leadChanges === 1 ? 'change' : 'changes'})
            </span>
          </div>
        </div>

        {summary.winner !== null && (
          <div className="intransitive-accuracy-winner-badge">
            <Trophy size={14} color="#ea580c" />
            <span>
              {summary.winner === 'draw'
                ? 'Drawn Game'
                : `${summary.winner === PLAYER_BLUE ? 'Blue' : 'Red'} Victory (${summary.reason ?? 'touchdown'})`}
            </span>
          </div>
        )}
      </div>

      {/* Dual Player Performance Grid (Lichess style) */}
      <div className="intransitive-accuracy-players-grid">
        {/* Blue Player Card */}
        <div className="intransitive-accuracy-player-box blue">
          <div className="intransitive-accuracy-player-top">
            <div className="intransitive-accuracy-name-row">
              <span className="intransitive-accuracy-dot blue" />
              <span className="intransitive-accuracy-player-name">{blueName}</span>
            </div>
            <div className="intransitive-accuracy-pct-badge blue">
              {blueStats.accuracy}% <small>Accuracy</small>
            </div>
          </div>

          <div className="intransitive-accuracy-stats-table">
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <CheckCircle2 size={13} color="#059669" /> Best Moves
              </span>
              <span className="stat-val">{blueStats.bestMoves}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <HelpCircle size={13} color="#d97706" /> Inaccuracies
              </span>
              <span className="stat-val inaccuracy">{blueStats.inaccuracies}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <AlertTriangle size={13} color="#ea580c" /> Mistakes
              </span>
              <span className="stat-val mistake">{blueStats.mistakes}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <AlertOctagon size={13} color="#dc2626" /> Blunders
              </span>
              <span className="stat-val blunder">{blueStats.blunders}</span>
            </div>
            <div className="intransitive-accuracy-stat-item cpl">
              <span className="stat-label">Avg Centipawn Loss</span>
              <span className="stat-val">{blueStats.acpl} cp</span>
            </div>
          </div>
        </div>

        {/* Red Player Card */}
        <div className="intransitive-accuracy-player-box red">
          <div className="intransitive-accuracy-player-top">
            <div className="intransitive-accuracy-name-row">
              <span className="intransitive-accuracy-dot red" />
              <span className="intransitive-accuracy-player-name">{redName}</span>
            </div>
            <div className="intransitive-accuracy-pct-badge red">
              {redStats.accuracy}% <small>Accuracy</small>
            </div>
          </div>

          <div className="intransitive-accuracy-stats-table">
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <CheckCircle2 size={13} color="#059669" /> Best Moves
              </span>
              <span className="stat-val">{redStats.bestMoves}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <HelpCircle size={13} color="#d97706" /> Inaccuracies
              </span>
              <span className="stat-val inaccuracy">{redStats.inaccuracies}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <AlertTriangle size={13} color="#ea580c" /> Mistakes
              </span>
              <span className="stat-val mistake">{redStats.mistakes}</span>
            </div>
            <div className="intransitive-accuracy-stat-item">
              <span className="stat-label">
                <AlertOctagon size={13} color="#dc2626" /> Blunders
              </span>
              <span className="stat-val blunder">{redStats.blunders}</span>
            </div>
            <div className="intransitive-accuracy-stat-item cpl">
              <span className="stat-label">Avg Centipawn Loss</span>
              <span className="stat-val">{redStats.acpl} cp</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Evaluation Graph Container */}
      <div className="intransitive-accuracy-graph-container">
        <div className="intransitive-accuracy-graph-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <TrendingUp size={14} color="#ea580c" />
            <span style={{ fontSize: '0.76rem', fontWeight: 700, color: '#322a24' }}>
              Evaluation Curve (Centipawns vs. Ply)
            </span>
          </div>

          {activePoint && (
            <div className="intransitive-accuracy-hover-readout">
              <strong style={{ color: '#322a24' }}>Ply {activePoint.ply}</strong>
              {activePlyData && <span style={{ color: '#574f46', fontWeight: 600 }}>({activePlyData.san})</span>}
              <span
                className={`eval-tag ${
                  activePoint.eval > 20
                    ? 'eval-tag-blue'
                    : activePoint.eval < -20
                    ? 'eval-tag-red'
                    : 'eval-tag-even'
                }`}
              >
                {activePoint.eval >= 0
                  ? `+${(activePoint.eval / 100).toFixed(1)}`
                  : `${(activePoint.eval / 100).toFixed(1)}`}
              </span>
              {activePlyData && activePlyData.cpl > 20 && (
                <span className={`tag-${activePlyData.classification}`}>
                  {activePlyData.classification} (+{activePlyData.cpl} cpl)
                </span>
              )}
            </div>
          )}
        </div>

        {/* SVG Curve */}
        <div className="intransitive-accuracy-svg-wrap">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
            className="intransitive-accuracy-svg"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={handleClickSvg}
          >
            <defs>
              {/* Blue advantage gradient fill (top) */}
              <linearGradient id="blueAdvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
              </linearGradient>

              {/* Red advantage gradient fill (bottom) */}
              <linearGradient id="redAdvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ea580c" stopOpacity="0.02" />
                <stop offset="100%" stopColor="#ea580c" stopOpacity="0.22" />
              </linearGradient>

              {/* Subtle background glow */}
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Background Canvas: Warm Ceramic Porcelain */}
            <rect
              x="0"
              y="0"
              width={SVG_WIDTH}
              height={SVG_HEIGHT}
              fill="#fcfaf7"
              rx="8"
              stroke="#ebe4da"
              strokeWidth="1"
            />

            {/* Zero Equilibrium Axis */}
            <line
              x1={PAD_X}
              y1={ZERO_Y}
              x2={SVG_WIDTH - PAD_X}
              y2={ZERO_Y}
              stroke="#c4b8aa"
              strokeWidth="1.2"
              strokeDasharray="4 4"
            />

            {/* Phase Dividers */}
            {openingEndX && (
              <g>
                <line
                  x1={openingEndX}
                  y1={PAD_Y}
                  x2={openingEndX}
                  y2={SVG_HEIGHT - PAD_Y}
                  stroke="#e2dacd"
                  strokeWidth="1"
                />
                <text
                  x={openingEndX - 4}
                  y={PAD_Y + 10}
                  fill="#8c8275"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="end"
                >
                  Opening
                </text>
              </g>
            )}

            {middleEndX && (
              <g>
                <line
                  x1={middleEndX}
                  y1={PAD_Y}
                  x2={middleEndX}
                  y2={SVG_HEIGHT - PAD_Y}
                  stroke="#e2dacd"
                  strokeWidth="1"
                />
                <text
                  x={middleEndX - 4}
                  y={PAD_Y + 10}
                  fill="#8c8275"
                  fontSize="9"
                  fontWeight="600"
                  textAnchor="end"
                >
                  Middlegame
                </text>
              </g>
            )}

            {/* Advantage Area Fills */}
            {blueAreaPath && <path d={blueAreaPath} fill="url(#blueAdvGrad)" />}
            {redAreaPath && <path d={redAreaPath} fill="url(#redAdvGrad)" />}

            {/* Main Evaluation Polyline Curve: Rich Burnt Orange */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="#c2410c"
                strokeWidth="2.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Blunder & Mistake Markers on the Line */}
            {points.map((pt) => {
              if (pt.ply === 0) return null;
              const plyData = plies[pt.ply - 1];
              if (!plyData) return null;
              if (plyData.classification === 'blunder') {
                return (
                  <circle
                    key={`b-${pt.ply}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="4.5"
                    fill="#dc2626"
                    stroke="#ffffff"
                    strokeWidth="2"
                  />
                );
              }
              if (plyData.classification === 'mistake') {
                return (
                  <circle
                    key={`m-${pt.ply}`}
                    cx={pt.x}
                    cy={pt.y}
                    r="3.8"
                    fill="#ea580c"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                  />
                );
              }
              return null;
            })}

            {/* Active Scrubbing Tracker Line & Dot */}
            {activePoint && (
              <g>
                <line
                  x1={activePoint.x}
                  y1={PAD_Y}
                  x2={activePoint.x}
                  y2={SVG_HEIGHT - PAD_Y}
                  stroke="#786f66"
                  strokeWidth="1.2"
                  strokeDasharray="2 2"
                  opacity="0.65"
                />
                <circle
                  cx={activePoint.x}
                  cy={activePoint.y}
                  r="5.5"
                  fill="#ffffff"
                  stroke="#c2410c"
                  strokeWidth="2.5"
                  filter="url(#glow)"
                />
              </g>
            )}

            {/* Axis Y scale legends */}
            <text x={PAD_X - 6} y={PAD_Y + 8} fill="#8c8275" fontSize="8.5" fontWeight="600" textAnchor="end">
              +6
            </text>
            <text x={PAD_X - 6} y={ZERO_Y + 3} fill="#8c8275" fontSize="8.5" fontWeight="600" textAnchor="end">
              0
            </text>
            <text x={PAD_X - 6} y={SVG_HEIGHT - PAD_Y} fill="#8c8275" fontSize="8.5" fontWeight="600" textAnchor="end">
              -6
            </text>
          </svg>
        </div>
      </div>

      {/* Review Key Turning Points (Lichess "Learn From Your Mistakes") */}
      {turningPoints.length > 0 && (
        <div className="intransitive-accuracy-turning-points">
          <div className="turning-points-title">
            <Zap size={13} color="#ea580c" />
            <span>Key Turning Points ({turningPoints.length}):</span>
          </div>
          <div className="turning-points-list">
            {turningPoints.map((tp) => {
              const isSelected = currentPlyIndex === tp.ply - 1;
              return (
                <button
                  key={`tp-${tp.ply}`}
                  type="button"
                  onClick={() => onSelectPly(tp.ply - 1)}
                  className={`turning-point-chip ${tp.classification} ${isSelected ? 'active' : ''}`}
                  title={`Jump to Ply ${tp.ply}: ${tp.san} (${tp.player === PLAYER_BLUE ? 'Blue' : 'Red'} ${tp.classification}, +${tp.cpl} cpl)`}
                >
                  <span className="chip-ply">Ply {tp.ply}</span>
                  <span className="chip-san">{tp.san}</span>
                  <span className="chip-tag">{tp.classification}</span>
                  <span className="chip-cpl">+{tp.cpl}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
