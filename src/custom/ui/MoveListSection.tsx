/**
 * MoveListSection - Standard Algebraic Notation move list for Intransitive Studio
 * Displays paired turns (Blue & Red), active ply highlight, and time-travel navigation controls.
 */

import React, { useRef } from 'react';
import { ChevronFirst, ChevronLeft, ChevronRight, ChevronLast, ScrollText } from 'lucide-react';
import type { Move } from '../core/types';

export interface HistoryItem {
  move: Move;
  san: string;
  fen: string;
}

interface MoveListSectionProps {
  moves: HistoryItem[];
  currentIndex: number; // -1 for start position, otherwise index into moves array
  onSelectIndex: (index: number) => void;
}

export const MoveListSection: React.FC<MoveListSectionProps> = ({
  moves,
  currentIndex,
  onSelectIndex,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Group moves into turn pairs: Turn 1 (Blue, Red), Turn 2 (Blue, Red), etc.
  const turns: {
    num: number;
    blue: { item: HistoryItem; index: number };
    red?: { item: HistoryItem; index: number };
  }[] = [];

  for (let i = 0; i < moves.length; i += 2) {
    const turnNum = Math.floor(i / 2) + 1;
    turns.push({
      num: turnNum,
      blue: { item: moves[i], index: i },
      red: i + 1 < moves.length ? { item: moves[i + 1], index: i + 1 } : undefined,
    });
  }

  // Autoscroll removed: users prefer to stay focused on the board during live play

  return (
    <div className="intransitive-movelist-card">
      <div className="intransitive-movelist-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ScrollText size={15} color="#c2410c" />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#322a24' }}>
            Move Notation
          </span>
        </div>
        <span className="intransitive-movelist-badge">
          {moves.length} {moves.length === 1 ? 'ply' : 'plies'} ({turns.length} {turns.length === 1 ? 'turn' : 'turns'})
        </span>
      </div>

      {/* Move Rows Scroll Container */}
      <div className="intransitive-movelist-body" ref={scrollRef}>
        {turns.length === 0 ? (
          <div className="intransitive-movelist-empty">
            Game begins. Blue moves first.
          </div>
        ) : (
          turns.map((turn) => {
            const redMove = turn.red;
            const isBlueActive = currentIndex === turn.blue.index;
            const isRedActive = redMove ? currentIndex === redMove.index : false;

            return (
              <div key={turn.num} className="intransitive-movelist-row">
                <span className="intransitive-movelist-num">{turn.num}.</span>

                {/* Blue Move */}
                <button
                  type="button"
                  onClick={() => onSelectIndex(turn.blue.index)}
                  className={`intransitive-movelist-btn blue ${isBlueActive ? 'active' : ''}`}
                  title={`Ply ${turn.blue.index + 1}: ${turn.blue.item.san}`}
                >
                  {turn.blue.item.san}
                </button>

                {/* Red Move */}
                {redMove ? (
                  <button
                    type="button"
                    onClick={() => onSelectIndex(redMove.index)}
                    className={`intransitive-movelist-btn red ${isRedActive ? 'active' : ''}`}
                    title={`Ply ${redMove.index + 1}: ${redMove.item.san}`}
                  >
                    {redMove.item.san}
                  </button>
                ) : (
                  <span className="intransitive-movelist-btn empty" />
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Step Navigation Controls */}
      <div className="intransitive-movelist-nav">
        <button
          type="button"
          onClick={() => onSelectIndex(-1)}
          disabled={currentIndex === -1}
          title="Jump to Start (Ply 0)"
          className="intransitive-movelist-nav-btn"
        >
          <ChevronFirst size={14} />
        </button>
        <button
          type="button"
          onClick={() => onSelectIndex(Math.max(-1, currentIndex - 1))}
          disabled={currentIndex === -1}
          title="Previous Ply"
          className="intransitive-movelist-nav-btn"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => onSelectIndex(Math.min(moves.length - 1, currentIndex + 1))}
          disabled={currentIndex >= moves.length - 1}
          title="Next Ply"
          className="intransitive-movelist-nav-btn"
        >
          <ChevronRight size={14} />
        </button>
        <button
          type="button"
          onClick={() => onSelectIndex(moves.length - 1)}
          disabled={currentIndex >= moves.length - 1}
          title="Jump to Latest Ply"
          className="intransitive-movelist-nav-btn"
        >
          <ChevronLast size={14} />
        </button>
      </div>
    </div>
  );
};
