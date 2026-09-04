import React from 'react';
import { ROCK, PAPER, SCISSORS, PLAYER_BLUE } from '../core/types';
import type { PieceType, Player } from '../core/types';

interface PieceIconProps {
  type: PieceType;
  player: Player;
  className?: string;
  size?: number;
}

/**
 * Aesthetic Minimalist Tokens for Intransitive.
 * Styled as handcrafted ceramic & wooden game medallions with refined gold/ivory emblems.
 */
export const PieceIcon: React.FC<PieceIconProps> = ({
  type,
  player,
  className = '',
  size = 40,
}) => {
  const isBlue = player === PLAYER_BLUE;

  const gradId = `token-grad-${player}-${type}`;
  const rimId = `token-rim-${player}-${type}`;

  // Palette: Deep Royal Cobalt vs Warm Terracotta Clay
  const gradStart = isBlue ? '#2563eb' : '#ea580c';
  const gradEnd = isBlue ? '#1e3a8a' : '#9a3412';
  const rimColor = isBlue ? '#93c5fd' : '#fdba74';
  const shadowColor = isBlue ? 'rgba(30, 58, 138, 0.32)' : 'rgba(154, 52, 18, 0.32)';
  const emblemColor = '#fffdfa'; // Warm ivory emblem

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      style={{
        display: 'block',
        filter: `drop-shadow(0 3px 6px ${shadowColor})`,
      }}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={gradStart} />
          <stop offset="100%" stopColor={gradEnd} />
        </linearGradient>
        <linearGradient id={rimId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.2" />
        </linearGradient>
      </defs>

      {/* Ceramic Token Base */}
      <circle cx="50" cy="50" r="46" fill={`url(#${gradId})`} />
      {/* Delicate Inner Ring */}
      <circle
        cx="50"
        cy="50"
        r="42"
        fill="none"
        stroke={rimColor}
        strokeWidth="1.5"
        opacity="0.65"
      />
      {/* 3D Rim Bevel */}
      <circle
        cx="50"
        cy="50"
        r="46"
        fill="none"
        stroke={`url(#${rimId})`}
        strokeWidth="2.5"
      />

      {/* EMBLEMS */}
      {type === ROCK && (
        <g fill={emblemColor} stroke={emblemColor} strokeLinecap="round" strokeLinejoin="round">
          {/* Minimalist Zen Stone / Carved Crystal Silhouette */}
          <polygon
            points="50,22 72,36 78,65 50,78 22,65 28,36"
            fill="none"
            strokeWidth="3.5"
          />
          <polygon
            points="50,22 72,36 50,48 28,36"
            fill={emblemColor}
            opacity="0.85"
          />
          <polygon
            points="28,36 50,48 50,78 22,65"
            fill={emblemColor}
            opacity="0.5"
          />
          <polygon
            points="72,36 78,65 50,78 50,48"
            fill={emblemColor}
            opacity="0.7"
          />
        </g>
      )}

      {type === PAPER && (
        <g fill={emblemColor} stroke={emblemColor} strokeLinecap="round" strokeLinejoin="round">
          {/* Aesthetic Origami Fold Emblem */}
          <polygon
            points="26,24 62,24 74,36 74,76 26,76"
            fill="none"
            strokeWidth="3.5"
          />
          {/* Folded Corner */}
          <polygon
            points="62,24 62,36 74,36"
            fill={emblemColor}
            opacity="0.9"
            strokeWidth="2"
          />
          {/* Clean Editorial Horizontal Score Lines */}
          <line x1="36" y1="42" x2="56" y2="42" strokeWidth="3" opacity="0.85" />
          <line x1="36" y1="52" x2="64" y2="52" strokeWidth="3" opacity="0.85" />
          <line x1="36" y1="62" x2="52" y2="62" strokeWidth="3" opacity="0.85" />
        </g>
      )}

      {type === SCISSORS && (
        <g stroke={emblemColor} strokeLinecap="round" strokeLinejoin="round">
          {/* Japanese Craft Shears Emblem */}
          {/* Left Handle Loop */}
          <circle cx="34" cy="70" r="10" fill="none" strokeWidth="3.5" />
          {/* Right Handle Loop */}
          <circle cx="66" cy="70" r="10" fill="none" strokeWidth="3.5" />
          {/* Left Blade running to top right */}
          <line x1="38" y1="62" x2="70" y2="24" strokeWidth="3.5" />
          {/* Right Blade running to top left */}
          <line x1="62" y1="62" x2="30" y2="24" strokeWidth="3.5" />
          {/* Pivot rivet */}
          <circle cx="50" cy="48" r="3.5" fill={emblemColor} stroke="none" />
        </g>
      )}
    </svg>
  );
};
