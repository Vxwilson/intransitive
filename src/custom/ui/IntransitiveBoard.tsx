import React, { useMemo } from 'react';
import {
  BOARD_SIZE,
  BLUE_GOAL_SQUARE,
  RED_GOAL_SQUARE,
  FILE_LETTERS,
  RANK_NUMBERS,
} from '../core/constants';
import { EMPTY, decodePiece } from '../core/types';
import type { Move, Player } from '../core/types';
import { PieceIcon } from './PieceIcons';
import type { IntransitiveGame } from '../core/game';
import { IntransitiveArrowOverlay } from './IntransitiveArrowOverlay';
import type { RankedMove } from '../engine/types';

interface IntransitiveBoardProps {
  game: IntransitiveGame;
  selectedSquare: number | null;
  onSelectSquare: (sq: number | null) => void;
  onMakeMove?: (move: Move) => void;
  lastMove?: Move | null;
  isInteractive?: boolean;
  flipped?: boolean;
  arrows?: RankedMove[];
}

export const IntransitiveBoard: React.FC<IntransitiveBoardProps> = ({
  game,
  selectedSquare,
  onSelectSquare,
  onMakeMove,
  lastMove = null,
  isInteractive = true,
  flipped = false,
  arrows = [],
}) => {
  const legalMovesForSelected = useMemo(() => {
    if (selectedSquare === null) return [];
    return game
      .generateLegalMoves()
      .filter((m) => m.from === selectedSquare);
  }, [game, selectedSquare]);

  const legalTargetsMap = useMemo(() => {
    const map = new Map<number, Move>();
    for (const m of legalMovesForSelected) {
      map.set(m.to, m);
    }
    return map;
  }, [legalMovesForSelected]);

  const ranks = useMemo(() => {
    const r = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    return flipped ? r : r.reverse();
  }, [flipped]);

  const files = useMemo(() => {
    const f = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    return flipped ? f.reverse() : f;
  }, [flipped]);

  const handleSquareClick = (sq: number) => {
    if (!isInteractive) return;

    if (selectedSquare !== null && legalTargetsMap.has(sq)) {
      const move = legalTargetsMap.get(sq);
      if (move && onMakeMove) {
        onMakeMove(move);
        onSelectSquare(null);
        return;
      }
    }

    const code = game.board[sq];
    if (code !== EMPTY) {
      const piece = decodePiece(code);
      if (piece && piece.player === game.activePlayer) {
        onSelectSquare(selectedSquare === sq ? null : sq);
        return;
      }
    }

    onSelectSquare(null);
  };

  return (
    <div className="intransitive-board-outer">
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
        <div className="intransitive-board-matrix">
        {ranks.map((rank) =>
          files.map((file) => {
            const sq = rank * BOARD_SIZE + file;
            const pieceCode = game.board[sq];
            const piece = decodePiece(pieceCode);

            const isSelected = selectedSquare === sq;
            const isLegalTarget = legalTargetsMap.has(sq);
            const targetMove = legalTargetsMap.get(sq);
            const isCaptureTarget = isLegalTarget && targetMove?.captured !== undefined;
            const isLastMoveFrom = lastMove?.from === sq;
            const isLastMoveTo = lastMove?.to === sq;

            const isBlueGoal = sq === BLUE_GOAL_SQUARE;
            const isRedGoal = sq === RED_GOAL_SQUARE;

            // Checkerboard pattern
            const isDark = (rank + file) % 2 === 0;

            const squareClasses = [
              'intransitive-grid-square',
              isDark ? 'dark' : 'light',
              isSelected ? 'selected' : '',
              isLastMoveFrom || isLastMoveTo ? 'last-move' : '',
              isBlueGoal ? 'blue-goal' : '',
              isRedGoal ? 'red-goal' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={sq}
                type="button"
                onClick={() => handleSquareClick(sq)}
                className={squareClasses}
              >
                {/* Goal Corner Callouts */}
                {isBlueGoal && (
                  <span className="intransitive-goal-tag blue">
                    Goal (Blue)
                  </span>
                )}
                {isRedGoal && (
                  <span className="intransitive-goal-tag red">
                    Goal (Red)
                  </span>
                )}

                {/* Minimalist Piece Medallion */}
                {piece && (
                  <div style={{ transform: isSelected ? 'scale(1.1)' : 'scale(1)' }}>
                    <PieceIcon
                      type={piece.pieceType}
                      player={piece.player as Player}
                      size={34}
                    />
                  </div>
                )}

                {/* Legal Move Dot */}
                {isLegalTarget && !isCaptureTarget && (
                  <div className="intransitive-dot-hint" />
                )}

                {/* Legal Capture Target Ring */}
                {isCaptureTarget && (
                  <div className="intransitive-capture-hint" />
                )}

                {/* Rank coordinate (on leftmost file) */}
                {file === (flipped ? BOARD_SIZE - 1 : 0) && (
                  <span className="intransitive-sq-rank">
                    {RANK_NUMBERS[rank]}
                  </span>
                )}

                {/* File coordinate (on bottom rank) */}
                {rank === (flipped ? BOARD_SIZE - 1 : 0) && (
                  <span className="intransitive-sq-file">
                    {FILE_LETTERS[file]}
                  </span>
                )}
              </button>
            );
          })
        )}
        </div>
        <IntransitiveArrowOverlay arrows={arrows} flipped={flipped} />
      </div>
    </div>
  );
};
