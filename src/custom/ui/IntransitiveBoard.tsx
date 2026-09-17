import React, { useMemo, useRef, useState } from 'react';
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

  // Keep drag state in refs so a fast touch gesture cannot race React's render
  // cycle. The selected-square click interaction remains available as a
  // fallback for keyboard and tap users.
  const boardMatrixRef = useRef<HTMLDivElement>(null);
  const dragFromRef = useRef<number | null>(null);
  const dragTargetRef = useRef<number | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const pointerCaptureElementRef = useRef<HTMLElement | null>(null);
  const suppressClickRef = useRef(false);
  const [dragFromSquare, setDragFromSquare] = useState<number | null>(null);
  const [dragTargetSquare, setDragTargetSquare] = useState<number | null>(null);

  const ranks = useMemo(() => {
    const r = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    return flipped ? r : r.reverse();
  }, [flipped]);

  const files = useMemo(() => {
    const f = Array.from({ length: BOARD_SIZE }, (_, i) => i);
    return flipped ? f.reverse() : f;
  }, [flipped]);

  const allLegalMoves = game.generateLegalMoves();

  const getSquareFromPoint = (clientX: number, clientY: number): number | null => {
    const matrix = boardMatrixRef.current;
    if (!matrix) return null;

    const rect = matrix.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

    const displayFile = Math.min(BOARD_SIZE - 1, Math.floor((x / rect.width) * BOARD_SIZE));
    const displayRank = Math.min(BOARD_SIZE - 1, Math.floor((y / rect.height) * BOARD_SIZE));
    return ranks[displayRank] * BOARD_SIZE + files[displayFile];
  };

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

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>, sq: number) => {
    if (!isInteractive || (event.pointerType === 'mouse' && event.button !== 0)) return;

    const piece = decodePiece(game.board[sq]);
    if (!piece || piece.player !== game.activePlayer) return;

    event.preventDefault();
    dragFromRef.current = sq;
    dragTargetRef.current = sq;
    pointerIdRef.current = event.pointerId;
    pointerCaptureElementRef.current = event.currentTarget;
    suppressClickRef.current = false;
    setDragFromSquare(sq);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId || dragFromRef.current === null) return;

    const nextTarget = getSquareFromPoint(event.clientX, event.clientY);
    if (nextTarget !== dragTargetRef.current) {
      dragTargetRef.current = nextTarget;
      setDragTargetSquare(nextTarget);
    }
  };

  const clearPointerDrag = () => {
    const captureElement = pointerCaptureElementRef.current;
    const pointerId = pointerIdRef.current;
    if (captureElement && pointerId !== null && captureElement.hasPointerCapture?.(pointerId)) {
      captureElement.releasePointerCapture(pointerId);
    }
    dragFromRef.current = null;
    dragTargetRef.current = null;
    pointerIdRef.current = null;
    pointerCaptureElementRef.current = null;
    setDragFromSquare(null);
    setDragTargetSquare(null);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId || dragFromRef.current === null) return;

    const from = dragFromRef.current;
    const to = dragTargetRef.current;
    const draggedMove = to === null
      ? undefined
      : allLegalMoves.find((move) => move.from === from && move.to === to);

    event.preventDefault();
    suppressClickRef.current = true;

    if (draggedMove && to !== from && onMakeMove) {
      onMakeMove(draggedMove);
      onSelectSquare(null);
    } else {
      // A tap on a piece keeps the original select/deselect behavior.
      handleSquareClick(from);
    }

    clearPointerDrag();
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId || dragFromRef.current === null) return;
    // A cancelled gesture (usually the browser reclaiming the touch for a
    // scroll/OS gesture) must not suppress the next unrelated board tap.
    suppressClickRef.current = false;
    clearPointerDrag();
  };

  const handleClick = (sq: number) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    handleSquareClick(sq);
  };

  return (
    <div className="intransitive-board-outer">
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1' }}>
        <div
          ref={boardMatrixRef}
          className="intransitive-board-matrix"
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
        >
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
            const isDragTarget = dragTargetSquare === sq && allLegalMoves.some((move) => move.from === dragFromSquare && move.to === sq);

            const isBlueGoal = sq === BLUE_GOAL_SQUARE;
            const isRedGoal = sq === RED_GOAL_SQUARE;

            // Checkerboard pattern
            const isDark = (rank + file) % 2 === 0;

            const squareClasses = [
              'intransitive-grid-square',
              isDark ? 'dark' : 'light',
              isSelected ? 'selected' : '',
              isDragTarget ? 'drag-target' : '',
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
                onPointerDown={(event) => handlePointerDown(event, sq)}
                onClick={() => handleClick(sq)}
                className={squareClasses}
                aria-label={`Square ${FILE_LETTERS[file]}${RANK_NUMBERS[rank]}`}
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
                  <div
                    className="intransitive-piece-token"
                    style={{ transform: isSelected ? 'scale(1.1)' : 'scale(1)' }}
                  >
                    <PieceIcon
                      type={piece.pieceType}
                      player={piece.player as Player}
                      size={41}
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
