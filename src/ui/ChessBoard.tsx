import React, { useState } from 'react';
import type {
  Square,
  Move,
  PieceType,
} from '../core/types';
import {
  MoveFlag,
  WHITE,
  BLACK,
  KING,
  PAWN,
  SQUARE_NAMES,
} from '../core/types';
import { Chess } from '../core/chess';
import { PieceIcon } from './PieceIcons';
import { PromotionModal } from './PromotionModal';
import { ArrowOverlay, type ArrowItem } from './ArrowOverlay';

interface ChessBoardProps {
  chess: Chess;
  isFlipped: boolean;
  onMakeMove: (move: Move) => void;
  lastMove: Move | null;
  interactive?: boolean;
  bestMove?: Move | null;
  arrows?: ArrowItem[];
  showArrow?: boolean;
}

export const ChessBoard: React.FC<ChessBoardProps> = ({
  chess,
  isFlipped,
  onMakeMove,
  lastMove,
  interactive = true,
  bestMove = null,
  arrows = [],
  showArrow = false,
}) => {
  const [selectedSq, setSelectedSq] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Move[]>([]);
  const [pendingPromotionMove, setPendingPromotionMove] = useState<{ from: Square; to: Square; captured?: PieceType } | null>(null);
  const [draggedSq, setDraggedSq] = useState<Square | null>(null);

  const activeColor = chess.activeColor;
  const inCheck = chess.inCheck();

  // Find active king square for check warning highlight
  let checkKingSq: Square | null = null;
  if (inCheck) {
    for (let sq = 0; sq < 64; sq++) {
      const p = chess.mailbox[sq];
      if (p && p.type === KING && p.color === activeColor) {
        checkKingSq = sq;
        break;
      }
    }
  }

  const handleSquareClick = (sq: Square) => {
    if (!interactive) return;

    // If we already selected a piece and clicked on a valid target square
    if (selectedSq !== null) {
      const targetMove = legalTargets.find((m) => m.to === sq);
      if (targetMove) {
        executeMoveOrPromptPromotion(targetMove);
        return;
      }
    }

    // Select or deselect piece
    const piece = chess.mailbox[sq];
    if (piece && piece.color === activeColor) {
      setSelectedSq(sq);
      const moves = chess.generateLegalMoves().filter((m) => m.from === sq);
      setLegalTargets(moves);
    } else {
      setSelectedSq(null);
      setLegalTargets([]);
    }
  };

  const executeMoveOrPromptPromotion = (move: Move) => {
    // Check if this move is a pawn promotion
    const isPromo =
      move.piece === PAWN &&
      ((move.flags === MoveFlag.Promotion) ||
        (activeColor === WHITE && Math.floor(move.to / 8) === 7) ||
        (activeColor === BLACK && Math.floor(move.to / 8) === 0));

    if (isPromo) {
      setPendingPromotionMove({ from: move.from, to: move.to, captured: move.captured });
    } else {
      onMakeMove(move);
      setSelectedSq(null);
      setLegalTargets([]);
    }
  };

  const handlePromotionSelect = (promoType: PieceType) => {
    if (!pendingPromotionMove) return;
    const move: Move = {
      from: pendingPromotionMove.from,
      to: pendingPromotionMove.to,
      piece: PAWN,
      captured: pendingPromotionMove.captured,
      promotion: promoType,
      flags: MoveFlag.Promotion,
    };
    onMakeMove(move);
    setPendingPromotionMove(null);
    setSelectedSq(null);
    setLegalTargets([]);
  };

  const handleDragStart = (e: React.DragEvent, sq: Square) => {
    if (!interactive) return;
    const piece = chess.mailbox[sq];
    if (!piece || piece.color !== activeColor) {
      e.preventDefault();
      return;
    }

    setDraggedSq(sq);
    setSelectedSq(sq);
    const moves = chess.generateLegalMoves().filter((m) => m.from === sq);
    setLegalTargets(moves);

    // Set ghost drag image if needed
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', sq.toString());
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, toSq: Square) => {
    e.preventDefault();
    if (!draggedSq && selectedSq === null) return;
    const fromSq = draggedSq ?? selectedSq!;
    setDraggedSq(null);

    const targetMove = legalTargets.find((m) => m.to === toSq && m.from === fromSq);
    if (targetMove) {
      executeMoveOrPromptPromotion(targetMove);
    }
  };

  // Generate 8x8 squares in order according to flipped state
  const ranks = isFlipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const files = isFlipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return (
    <div className="board-wrapper">
      <div className="chessboard">
        {ranks.map((r, rankIdx) => (
          <div key={r} className="board-row">
            {files.map((f, fileIdx) => {
              const sq = r * 8 + f;
              const isLight = (r + f) % 2 !== 0;
              const piece = chess.mailbox[sq];
              const isSelected = selectedSq === sq;
              const isLastMove = lastMove?.from === sq || lastMove?.to === sq;
              const isCheckKing = checkKingSq === sq;
              const legalMove = legalTargets.find((m) => m.to === sq);
              const isCapture = legalMove && (piece !== null || legalMove.flags === MoveFlag.EnPassant);

              return (
                <div
                  key={sq}
                  className={`square ${isLight ? 'square-light' : 'square-dark'} ${
                    isSelected ? 'square-selected' : ''
                  } ${isLastMove ? 'square-last-move' : ''} ${isCheckKing ? 'square-check' : ''}`}
                  onClick={() => handleSquareClick(sq)}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, sq)}
                  data-square={SQUARE_NAMES[sq]}
                >
                  {/* Rank coordinate (on leftmost file) */}
                  {fileIdx === 0 && (
                    <span className="coord coord-rank">{r + 1}</span>
                  )}

                  {/* File coordinate (on bottom rank) */}
                  {rankIdx === 7 && (
                    <span className="coord coord-file">
                      {String.fromCharCode('a'.charCodeAt(0) + f)}
                    </span>
                  )}

                  {/* Piece */}
                  {piece && (
                    <div
                      className={`piece-container ${
                        piece.color === activeColor && interactive ? 'piece-interactive' : ''
                      }`}
                      draggable={piece.color === activeColor && interactive}
                      onDragStart={(e) => handleDragStart(e, sq)}
                    >
                      <PieceIcon color={piece.color} type={piece.type} />
                    </div>
                  )}

                  {/* Legal move indicator */}
                  {legalMove && (
                    <div
                      className={`legal-hint ${isCapture ? 'legal-capture-ring' : 'legal-dot'}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {showArrow && (arrows.length > 0 || bestMove) && (
          <ArrowOverlay move={bestMove} arrows={arrows} isFlipped={isFlipped} />
        )}
      </div>

      <PromotionModal
        color={activeColor}
        isOpen={pendingPromotionMove !== null}
        onSelect={handlePromotionSelect}
        onCancel={() => {
          setPendingPromotionMove(null);
          setSelectedSq(null);
          setLegalTargets([]);
        }}
      />
    </div>
  );
};
