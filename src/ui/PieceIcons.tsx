import React from 'react';
import type { Color, PieceType } from '../core/types';
import { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../core/types';

interface PieceIconProps {
  color: Color;
  type: PieceType;
  className?: string;
}

export const PieceIcon: React.FC<PieceIconProps> = ({ color, type, className = '' }) => {
  const isWhite = color === WHITE;

  // Custom premium gradient and stroke styling
  const fill = isWhite ? 'url(#piece-white-gradient)' : 'url(#piece-black-gradient)';
  const stroke = isWhite ? '#4a3b32' : '#111318';
  const highlight = isWhite ? '#ffffff' : '#3c404d';

  return (
    <svg
      viewBox="0 0 45 45"
      className={`chess-piece-svg ${className}`}
      style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
    >
      <defs>
        <linearGradient id="piece-white-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#f5f0eb" />
          <stop offset="100%" stopColor="#e2d7cb" />
        </linearGradient>
        <linearGradient id="piece-black-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#2e313b" />
          <stop offset="60%" stopColor="#1e2027" />
          <stop offset="100%" stopColor="#121317" />
        </linearGradient>
        <filter id="piece-shadow" x="-10%" y="-10%" width="130%" height="130%">
          <feDropShadow dx="0.5" dy="1.5" stdDeviation="1" floodOpacity={isWhite ? '0.35' : '0.6'} />
        </filter>
      </defs>

      <g filter="url(#piece-shadow)">
        {type === PAWN && (
          <path
            d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {type === KNIGHT && (
          <path
            d="M22 10c-3.13 0-5.87 2.14-6.66 5.16L13 22l3 2.5s-1.5 2.5-1 4.5c.67 2.67 3.5 3 3.5 3s.5 2 2.5 3.5c1.33 1 3 1.5 5 1.5 3.5 0 6.5-2.5 7.5-6 .67-2.33 1-5 1-8 0-4-3-8-7.5-9.5z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {type === BISHOP && (
          <g>
            <path
              d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2zM15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2zM25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M17.5 26h10M22.5 21v10"
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </g>
        )}

        {type === ROOK && (
          <path
            d="M9 39h27v-3H9v3zm3-3v-4.5h21V36H12zm2-4.5l1.5-13.5h14L31 31.5H14zM11 14h23v4H11v-4zM9 10h4.5v4H9v-4zm6.75 0h4.5v4h-4.5v-4zm6.75 0H27v4h-4.5v-4zm6.75 0H36v4h-4.5v-4z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {type === QUEEN && (
          <g>
            <path
              d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM11 20a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM38 20a2 2 0 1 1-4 0 2 2 0 1 1 4 0z"
              fill={highlight}
              stroke={stroke}
              strokeWidth="1"
            />
            <path
              d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11-8.5-15-8.5 15-7-11 2 12zm0 3c8.5-1 21-1 27 0v2.5c0 2-2 3.5-3.5 3.5h-20C11 35 9 33.5 9 31.5V29zm0 6.5h27v3.5H9v-3.5z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        )}

        {type === KING && (
          <g>
            {/* Cross */}
            <path
              d="M22.5 11.5V6M20 8.5h5"
              stroke={stroke}
              strokeWidth="1.8"
              strokeLinecap="round"
            />
            <path
              d="M22.5 25c6.24-.89 12-2.34 14-6-1.5-6.5-6.5-9-14-9s-12.5 2.5-14 9c2 3.66 7.76 5.11 14 6zm0 2.5c-7 0-11 2-11 4.5h22c0-2.5-4-4.5-11-4.5zm-11.5 8h23v4h-23v-4z"
              fill={fill}
              stroke={stroke}
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="22.5" cy="18" r="2.5" fill={highlight} stroke={stroke} strokeWidth="1" />
          </g>
        )}
      </g>
    </svg>
  );
};
