import React from 'react';
import type { Color, PieceType } from '../core/types';
import { QUEEN, ROOK, BISHOP, KNIGHT } from '../core/types';
import { PieceIcon } from './PieceIcons';

interface PromotionModalProps {
  color: Color;
  isOpen: boolean;
  onSelect: (pieceType: PieceType) => void;
  onCancel: () => void;
}

export const PromotionModal: React.FC<PromotionModalProps> = ({
  color,
  isOpen,
  onSelect,
  onCancel,
}) => {
  if (!isOpen) return null;

  const choices = [
    { type: QUEEN, label: 'Queen' },
    { type: KNIGHT, label: 'Knight' },
    { type: ROOK, label: 'Rook' },
    { type: BISHOP, label: 'Bishop' },
  ];

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="promotion-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="promotion-title">Promote Pawn</h3>
        <p className="promotion-subtitle">Select piece to promote to:</p>
        <div className="promotion-choices">
          {choices.map(({ type, label }) => (
            <button
              key={type}
              className="promotion-option"
              onClick={() => onSelect(type)}
              title={label}
            >
              <div className="promotion-icon-wrapper">
                <PieceIcon color={color} type={type} />
              </div>
              <span className="promotion-name">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
