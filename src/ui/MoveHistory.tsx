import React, { useEffect, useRef } from 'react';
import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast } from 'lucide-react';
import type { Move } from '../core/types';

interface MoveHistoryProps {
  moves: { move: Move; san: string }[];
  currentMoveIndex: number; // -1 for start position, otherwise index into moves array
  onSelectMove: (index: number) => void;
}

export const MoveHistory: React.FC<MoveHistoryProps> = ({
  moves,
  currentMoveIndex,
  onSelectMove,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group moves into turns (pairs of White and Black)
  const turns: { num: number; white: { move: Move; san: string; index: number }; black?: { move: Move; san: string; index: number } }[] = [];

  for (let i = 0; i < moves.length; i += 2) {
    const turnNum = Math.floor(i / 2) + 1;
    turns.push({
      num: turnNum,
      white: { ...moves[i], index: i },
      black: i + 1 < moves.length ? { ...moves[i + 1], index: i + 1 } : undefined,
    });
  }

  // Scroll to active move
  useEffect(() => {
    if (scrollRef.current) {
      const activeEl = scrollRef.current.querySelector('.history-move.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentMoveIndex, moves.length]);

  return (
    <div className="move-history-card">
      <div className="history-header">
        <h4 className="history-title">Move Notation</h4>
        <span className="history-count">
          {moves.length} {moves.length === 1 ? 'ply' : 'plies'}
        </span>
      </div>

      <div className="history-list" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="history-empty">Game begins. White to move.</div>
        ) : (
          turns.map((turn) => {
            const blackMove = turn.black;
            return (
              <div key={turn.num} className="history-turn-row">
                <span className="turn-number">{turn.num}.</span>

                {/* White Move */}
                <button
                  className={`history-move ${currentMoveIndex === turn.white.index ? 'active' : ''}`}
                  onClick={() => onSelectMove(turn.white.index)}
                >
                  {turn.white.san}
                </button>

                {/* Black Move */}
                {blackMove ? (
                  <button
                    className={`history-move ${currentMoveIndex === blackMove.index ? 'active' : ''}`}
                    onClick={() => onSelectMove(blackMove.index)}
                  >
                    {blackMove.san}
                  </button>
                ) : (
                  <span className="history-move-placeholder" />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Navigation step buttons */}
      <div className="history-controls">
        <button
          className="history-nav-btn"
          onClick={() => onSelectMove(-1)}
          disabled={currentMoveIndex === -1}
          title="Jump to Start (Home)"
        >
          <ChevronFirst size={16} />
        </button>
        <button
          className="history-nav-btn"
          onClick={() => onSelectMove(Math.max(-1, currentMoveIndex - 1))}
          disabled={currentMoveIndex === -1}
          title="Previous Move (Left Arrow)"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="history-nav-btn"
          onClick={() => onSelectMove(Math.min(moves.length - 1, currentMoveIndex + 1))}
          disabled={currentMoveIndex >= moves.length - 1}
          title="Next Move (Right Arrow)"
        >
          <ChevronRight size={16} />
        </button>
        <button
          className="history-nav-btn"
          onClick={() => onSelectMove(moves.length - 1)}
          disabled={currentMoveIndex >= moves.length - 1}
          title="Jump to Current (End)"
        >
          <ChevronLast size={16} />
        </button>
      </div>
    </div>
  );
};
