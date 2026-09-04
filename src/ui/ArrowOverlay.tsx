/**
 * ArrowOverlay - Pure SVG vector overlay to display the engine's candidate moves
 * Supports Multi-PV lines with graduated opacity, slightly thinner stroke widths,
 * and harmonious gradients while guaranteeing zero-dimension clipping immunity.
 */

import React from 'react';
import type { Move, Square } from '../core/types';

export interface ArrowItem {
  move: Move;
  rank: number; // 1-indexed: 1 = best move, 2 = 2nd candidate, etc.
  score?: number;
}

export interface ArrowOverlayProps {
  move?: Move | null;
  arrows?: ArrowItem[];
  isFlipped: boolean;
}

interface RankStyle {
  shaftHalfWidth: number;
  headLength: number;
  headHalfWidth: number;
  opacity: number;
  startColor: string;
  endColor: string;
  shadowColor: string;
}

const RANK_STYLES: Record<number, RankStyle> = {
  1: {
    shaftHalfWidth: 5.0, // 10px shaft
    headLength: 26,
    headHalfWidth: 15, // 30px wingspan
    opacity: 0.95,
    startColor: '#10b981', // Emerald
    endColor: '#06b6d4', // Cyan
    shadowColor: 'rgba(6, 182, 212, 0.75)',
  },
  2: {
    shaftHalfWidth: 4.2, // 8.4px shaft
    headLength: 24,
    headHalfWidth: 13.5, // 27px wingspan
    opacity: 0.72,
    startColor: '#0ea5e9', // Sky Blue
    endColor: '#3b82f6', // Royal Blue
    shadowColor: 'rgba(14, 165, 233, 0.5)',
  },
  3: {
    shaftHalfWidth: 3.5, // 7.0px shaft
    headLength: 22,
    headHalfWidth: 12.0, // 24px wingspan
    opacity: 0.52,
    startColor: '#6366f1', // Indigo
    endColor: '#8b5cf6', // Violet
    shadowColor: 'rgba(99, 102, 241, 0.35)',
  },
  4: {
    shaftHalfWidth: 2.9, // 5.8px shaft
    headLength: 20,
    headHalfWidth: 10.5, // 21px wingspan
    opacity: 0.38,
    startColor: '#14b8a6', // Teal
    endColor: '#64748b', // Slate
    shadowColor: 'rgba(20, 184, 166, 0.25)',
  },
  5: {
    shaftHalfWidth: 2.4, // 4.8px shaft
    headLength: 18,
    headHalfWidth: 9.5, // 19px wingspan
    opacity: 0.28,
    startColor: '#94a3b8', // Light Slate
    endColor: '#475569', // Muted Slate
    shadowColor: 'rgba(148, 163, 184, 0.15)',
  },
};

export const ArrowOverlay: React.FC<ArrowOverlayProps> = ({
  move,
  arrows: customArrows,
  isFlipped,
}) => {
  // Normalize candidate arrows
  const arrowList: ArrowItem[] = customArrows && customArrows.length > 0
    ? customArrows
    : move
    ? [{ move, rank: 1 }]
    : [];

  if (arrowList.length === 0) return null;

  // Convert board square (0-63) to SVG 800x800 coordinate (cx, cy)
  const getSquareCenter = (sq: Square): { x: number; y: number } => {
    const rank = Math.floor(sq / 8); // 0 to 7
    const file = sq % 8; // 0 to 7

    const svgCol = isFlipped ? 7 - file : file;
    const svgRow = isFlipped ? rank : 7 - rank;

    return {
      x: svgCol * 100 + 50,
      y: svgRow * 100 + 50,
    };
  };

  // Sort descending by rank so Rank 1 (best move) is drawn LAST (rendered on top)
  const sortedArrows = [...arrowList].sort((a, b) => b.rank - a.rank);

  return (
    <svg
      className="arrow-overlay"
      viewBox="0 0 800 800"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 10,
      }}
    >
      <defs>
        {sortedArrows.map((arrow) => {
          const rank = Math.min(5, Math.max(1, arrow.rank));
          const style = RANK_STYLES[rank];
          const fromPos = getSquareCenter(arrow.move.from);
          const toPos = getSquareCenter(arrow.move.to);
          const gradId = `chessesque-arrow-grad-${rank}-${arrow.move.from}-${arrow.move.to}`;

          return (
            <linearGradient
              key={gradId}
              id={gradId}
              gradientUnits="userSpaceOnUse"
              x1={fromPos.x}
              y1={fromPos.y}
              x2={toPos.x}
              y2={toPos.y}
            >
              <stop offset="0%" stopColor={style.startColor} stopOpacity={style.opacity} />
              <stop offset="100%" stopColor={style.endColor} stopOpacity={style.opacity} />
            </linearGradient>
          );
        })}
      </defs>

      {sortedArrows.map((arrow) => {
        const rank = Math.min(5, Math.max(1, arrow.rank));
        const style = RANK_STYLES[rank];
        const fromPos = getSquareCenter(arrow.move.from);
        const toPos = getSquareCenter(arrow.move.to);

        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const length = Math.hypot(dx, dy);

        if (length === 0) return null;

        const angle = Math.atan2(dy, dx);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Perpendicular unit vector
        const perpX = -sin;
        const perpY = cos;

        const shaftHalfWidth = style.shaftHalfWidth;
        const headLength = style.headLength;
        const headHalfWidth = style.headHalfWidth;
        const notchDepth = 4.5;
        const startOffset = 12;
        const tipOffset = 6;

        const startX = fromPos.x + cos * startOffset;
        const startY = fromPos.y + sin * startOffset;

        const tipX = toPos.x - cos * tipOffset;
        const tipY = toPos.y - sin * tipOffset;

        const baseCenterX = tipX - cos * headLength;
        const baseCenterY = tipY - sin * headLength;

        const notchX = baseCenterX + cos * notchDepth;
        const notchY = baseCenterY + sin * notchDepth;

        const leftWingX = baseCenterX + perpX * headHalfWidth;
        const leftWingY = baseCenterY + perpY * headHalfWidth;

        const rightWingX = baseCenterX - perpX * headHalfWidth;
        const rightWingY = baseCenterY - perpY * headHalfWidth;

        const shaftEndLeftX = notchX + perpX * shaftHalfWidth;
        const shaftEndLeftY = notchY + perpY * shaftHalfWidth;

        const shaftEndRightX = notchX - perpX * shaftHalfWidth;
        const shaftEndRightY = notchY - perpY * shaftHalfWidth;

        const shaftStartLeftX = startX + perpX * shaftHalfWidth;
        const shaftStartLeftY = startY + perpY * shaftHalfWidth;

        const shaftStartRightX = startX - perpX * shaftHalfWidth;
        const shaftStartRightY = startY - perpY * shaftHalfWidth;

        const arrowPoints = [
          `${shaftStartLeftX.toFixed(2)},${shaftStartLeftY.toFixed(2)}`,
          `${shaftEndLeftX.toFixed(2)},${shaftEndLeftY.toFixed(2)}`,
          `${leftWingX.toFixed(2)},${leftWingY.toFixed(2)}`,
          `${tipX.toFixed(2)},${tipY.toFixed(2)}`,
          `${rightWingX.toFixed(2)},${rightWingY.toFixed(2)}`,
          `${shaftEndRightX.toFixed(2)},${shaftEndRightY.toFixed(2)}`,
          `${shaftStartRightX.toFixed(2)},${shaftStartRightY.toFixed(2)}`,
        ].join(' ');

        const gradId = `chessesque-arrow-grad-${rank}-${arrow.move.from}-${arrow.move.to}`;

        return (
          <g
            key={`${arrow.move.from}-${arrow.move.to}-${rank}`}
            style={{
              filter: `drop-shadow(0 2px 6px ${style.shadowColor})`,
            }}
          >
            {/* Origin Square Halo & Center Anchor for Rank 1 (or subtle anchor for higher ranks) */}
            {rank === 1 ? (
              <>
                <circle
                  cx={fromPos.x}
                  cy={fromPos.y}
                  r="14"
                  fill="#10b981"
                  fillOpacity="0.25"
                  stroke="#10b981"
                  strokeWidth="2"
                />
                <circle
                  cx={fromPos.x}
                  cy={fromPos.y}
                  r="4"
                  fill="#10b981"
                  fillOpacity="0.8"
                />
              </>
            ) : (
              <circle
                cx={fromPos.x}
                cy={fromPos.y}
                r={shaftHalfWidth}
                fill={style.startColor}
                fillOpacity={style.opacity * 0.7}
              />
            )}

            {/* Rounded shaft tail cap */}
            <circle
              cx={startX}
              cy={startY}
              r={shaftHalfWidth}
              fill={`url(#${gradId})`}
            />

            {/* Continuous arrow polygon (Shaft + Head) */}
            <polygon
              points={arrowPoints}
              fill={`url(#${gradId})`}
            />
          </g>
        );
      })}
    </svg>
  );
};
