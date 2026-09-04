/**
 * IntransitiveArrowOverlay - 9x9 SVG vector candidate arrows for engine move analysis
 * Features graduated opacity, tailored shaft widths, and smooth gradients from rank 1 (best) to rank 5.
 */

import React from 'react';
import { BOARD_SIZE } from '../core/constants';
import type { RankedMove } from '../engine/types';

export interface IntransitiveArrowOverlayProps {
  arrows?: RankedMove[];
  flipped?: boolean;
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
    shaftHalfWidth: 4.2,
    headLength: 20,
    headHalfWidth: 11.5,
    opacity: 0.95,
    startColor: '#059669', // Emerald
    endColor: '#0284c7',   // Sky
    shadowColor: 'rgba(5, 150, 105, 0.45)',
  },
  2: {
    shaftHalfWidth: 3.5,
    headLength: 18,
    headHalfWidth: 10.0,
    opacity: 0.72,
    startColor: '#2563eb', // Royal Blue
    endColor: '#4f46e5',   // Indigo
    shadowColor: 'rgba(37, 99, 235, 0.35)',
  },
  3: {
    shaftHalfWidth: 2.9,
    headLength: 16,
    headHalfWidth: 8.5,
    opacity: 0.52,
    startColor: '#7c3aed', // Purple
    endColor: '#9333ea',   // Violet
    shadowColor: 'rgba(124, 58, 237, 0.25)',
  },
  4: {
    shaftHalfWidth: 2.3,
    headLength: 14,
    headHalfWidth: 7.2,
    opacity: 0.36,
    startColor: '#d97706', // Amber
    endColor: '#ea580c',   // Orange
    shadowColor: 'rgba(217, 119, 6, 0.2)',
  },
  5: {
    shaftHalfWidth: 1.8,
    headLength: 12,
    headHalfWidth: 6.0,
    opacity: 0.22,
    startColor: '#64748b', // Slate
    endColor: '#475569',   // Slate dark
    shadowColor: 'rgba(100, 116, 139, 0.15)',
  },
};

export const IntransitiveArrowOverlay: React.FC<IntransitiveArrowOverlayProps> = ({
  arrows = [],
  flipped = false,
}) => {
  if (!arrows || arrows.length === 0) return null;

  // Convert board square (0-80) to SVG 900x900 coordinates
  const getSquareCenter = (sq: number): { x: number; y: number } => {
    const rank = Math.floor(sq / BOARD_SIZE);
    const file = sq % BOARD_SIZE;

    const svgCol = flipped ? BOARD_SIZE - 1 - file : file;
    const svgRow = flipped ? rank : BOARD_SIZE - 1 - rank;

    return {
      x: svgCol * 100 + 50,
      y: svgRow * 100 + 50,
    };
  };

  // Sort descending by rank so Rank 1 (best move) is drawn LAST (rendered on top)
  const sortedArrows = [...arrows].sort((a, b) => b.rank - a.rank);

  return (
    <svg
      className="intransitive-arrow-overlay"
      viewBox="0 0 900 900"
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
          const style = RANK_STYLES[rank] || RANK_STYLES[5];
          const fromPos = getSquareCenter(arrow.move.from);
          const toPos = getSquareCenter(arrow.move.to);
          const gradId = `intransitive-arrow-grad-${rank}-${arrow.move.from}-${arrow.move.to}`;

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
        const style = RANK_STYLES[rank] || RANK_STYLES[5];
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
        const notchDepth = 3.5;
        const startOffset = 18;
        const tipOffset = 16;

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

        const gradId = `intransitive-arrow-grad-${rank}-${arrow.move.from}-${arrow.move.to}`;

        return (
          <g
            key={`${arrow.move.from}-${arrow.move.to}-${rank}`}
            style={{
              filter: `drop-shadow(0 1px 4px ${style.shadowColor})`,
            }}
          >
            {/* Origin square halo & anchor */}
            {rank === 1 ? (
              <>
                <circle
                  cx={fromPos.x}
                  cy={fromPos.y}
                  r="12"
                  fill="#059669"
                  fillOpacity="0.22"
                  stroke="#059669"
                  strokeWidth="1.5"
                />
                <circle
                  cx={fromPos.x}
                  cy={fromPos.y}
                  r="3.5"
                  fill="#059669"
                  fillOpacity="0.85"
                />
              </>
            ) : (
              <circle
                cx={fromPos.x}
                cy={fromPos.y}
                r={shaftHalfWidth + 1}
                fill={style.startColor}
                fillOpacity={style.opacity * 0.75}
              />
            )}

            {/* Rounded tail cap */}
            <circle
              cx={startX}
              cy={startY}
              r={shaftHalfWidth}
              fill={`url(#${gradId})`}
            />

            {/* Continuous arrow polygon */}
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
