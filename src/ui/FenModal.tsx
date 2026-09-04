import React, { useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { isValidFEN, START_FEN } from '../core/fen';

interface FenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadFEN: (fen: string) => void;
}

export const FenModal: React.FC<FenModalProps> = ({ isOpen, onClose, onLoadFEN }) => {
  const [fenInput, setFenInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleApply = () => {
    const trimmed = fenInput.trim();
    const val = isValidFEN(trimmed);
    if (!val.valid) {
      setError(val.error ?? 'Invalid FEN string');
      return;
    }
    setError(null);
    onLoadFEN(trimmed);
    onClose();
  };

  const handlePreset = (preset: string) => {
    setFenInput(preset);
    setError(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="fen-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3 className="modal-title">Load Position (FEN)</h3>
            <p className="modal-desc">Enter a Forsyth-Edwards Notation (FEN) record.</p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="fen-modal-body">
          <textarea
            className={`fen-textarea ${error ? 'input-error' : ''}`}
            placeholder={START_FEN}
            value={fenInput}
            onChange={(e) => {
              setFenInput(e.target.value);
              setError(null);
            }}
            rows={3}
          />

          {error && (
            <div className="fen-error-msg">
              <AlertCircle size={14} />
              <span>{error}</span>
            </div>
          )}

          <div className="fen-presets-row">
            <span className="preset-label">Quick Presets:</span>
            <button
              className="quick-preset-btn"
              onClick={() => handlePreset(START_FEN)}
            >
              Standard Start
            </button>
            <button
              className="quick-preset-btn"
              onClick={() =>
                handlePreset('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1')
              }
            >
              Kiwipete
            </button>
            <button
              className="quick-preset-btn"
              onClick={() =>
                handlePreset('r1bqkb1r/pppp1ppp/2n5/4p3/2B1n3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4')
              }
            >
              Italian Game
            </button>
            <button
              className="quick-preset-btn"
              onClick={() =>
                handlePreset('8/8/8/8/8/4k3/4p3/4K3 w - - 0 1')
              }
            >
              Stalemate Setup
            </button>
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleApply}>
              <Check size={16} />
              <span>Load Position</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
