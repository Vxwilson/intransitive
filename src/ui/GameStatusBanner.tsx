import React, { useEffect } from 'react';
import confetti from 'canvas-confetti';
import type { GameStatus, Color } from '../core/types';
import { WHITE } from '../core/types';
import { Trophy, AlertCircle, RefreshCw } from 'lucide-react';

interface GameStatusBannerProps {
  status: GameStatus;
  activeColor: Color;
  onNewGame: () => void;
}

export const GameStatusBanner: React.FC<GameStatusBannerProps> = ({
  status,
  activeColor,
  onNewGame,
}) => {
  useEffect(() => {
    if (status === 'checkmate') {
      // Fire celebratory confetti!
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#38ef7d', '#11998e', '#f6d365', '#fda085'],
      });
    }
  }, [status]);

  if (status === 'in_progress') return null;

  let title = '';
  let description = '';
  let isWin = false;

  switch (status) {
    case 'checkmate': {
      isWin = true;
      const winner = activeColor === WHITE ? 'Black' : 'White';
      title = `Checkmate! ${winner} Wins!`;
      description = `${winner} has delivered checkmate. The game is decisive.`;
      break;
    }
    case 'stalemate':
      title = 'Stalemate - Draw';
      description = 'The active player has no legal moves and is not in check.';
      break;
    case 'draw_threefold':
      title = 'Draw by Threefold Repetition';
      description = 'The exact same board position has occurred three times.';
      break;
    case 'draw_50move':
      title = 'Draw by 50-Move Rule';
      description = '50 consecutive full moves without a pawn push or capture.';
      break;
    case 'draw_insufficient_material':
      title = 'Draw by Insufficient Material';
      description = 'Neither player has enough pieces left to force checkmate.';
      break;
  }

  return (
    <div className={`status-banner ${isWin ? 'banner-win' : 'banner-draw'}`}>
      <div className="banner-icon-wrapper">
        {isWin ? <Trophy size={28} className="trophy-icon" /> : <AlertCircle size={28} />}
      </div>
      <div className="banner-content">
        <h3 className="banner-title">{title}</h3>
        <p className="banner-desc">{description}</p>
      </div>
      <button className="banner-action-btn" onClick={onNewGame}>
        <RefreshCw size={16} />
        <span>Rematch</span>
      </button>
    </div>
  );
};
