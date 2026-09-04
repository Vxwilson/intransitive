import React from 'react';
import { Chess } from '../core/chess';
import { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN } from '../core/types';
import { popcount } from '../core/bitboard';

interface EvalBarProps {
  chess: Chess;
  isFlipped: boolean;
  engineScore?: number | null; // Centipawns if engine is searching
  isMate?: number | null; // Moves to mate if detected
}

export const EvalBar: React.FC<EvalBarProps> = ({
  chess,
  isFlipped,
  engineScore = null,
  isMate = null,
}) => {
  // Calculate material balance in pawns if engineScore is not supplied
  let evalScore = engineScore;

  if (evalScore === null) {
    const pieceValues: Record<number, number> = {
      [PAWN]: 1.0,
      [KNIGHT]: 3.05,
      [BISHOP]: 3.25,
      [ROOK]: 5.0,
      [QUEEN]: 9.0,
    };

    let material = 0;
    for (const [pt, val] of Object.entries(pieceValues)) {
      const type = parseInt(pt, 10);
      const wCount = popcount(chess.pieceBB[WHITE][type - 1]);
      const bCount = popcount(chess.pieceBB[1][type - 1]);
      material += (wCount - bCount) * val;
    }
    evalScore = material;
  }

  // Convert score into percentage for White (0% = Black winning, 50% = equal, 100% = White winning)
  // Logistic function: P = 1 / (1 + 10^(-score / 4))
  let whitePercent: number;
  if (isMate !== null) {
    whitePercent = isMate > 0 ? 100 : 0;
  } else {
    const clampedScore = Math.max(-15, Math.min(15, evalScore));
    whitePercent = 100 / (1 + Math.pow(10, -clampedScore / 4));
    whitePercent = Math.max(5, Math.min(95, whitePercent));
  }

  // If board is flipped (Black perspective), invert display bar
  const displayedWhitePercent = isFlipped ? 100 - whitePercent : whitePercent;

  // Format label
  let scoreLabel = '0.0';
  if (isMate !== null) {
    scoreLabel = `M${Math.abs(isMate)}`;
  } else {
    const abs = Math.abs(evalScore).toFixed(1);
    scoreLabel = evalScore > 0 ? `+${abs}` : evalScore < 0 ? `-${abs}` : '0.0';
  }

  return (
    <div className="eval-bar-container" title={`Evaluation: ${scoreLabel}`}>
      <div className="eval-bar-track">
        {/* Black side fill (top if not flipped) */}
        <div
          className="eval-bar-white"
          style={{ height: `${displayedWhitePercent}%` }}
        />
      </div>
      <div className="eval-score-badge">
        <span className="eval-score-text">{scoreLabel}</span>
      </div>
    </div>
  );
};
