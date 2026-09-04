import React, { useState } from 'react';
import {
  RotateCcw,
  ArrowUpDown,
  Volume2,
  VolumeX,
  Copy,
  Download,
  Terminal,
  FileCode,
  Check,
} from 'lucide-react';
import { sounds } from '../audio/soundEffects';

interface GameControlsProps {
  onNewGame: () => void;
  onFlipBoard: () => void;
  onUndo: () => void;
  canUndo: boolean;
  onExportPGN: () => void;
  onCopyFEN: () => void;
  onOpenFENModal: () => void;
  onOpenPerftModal: () => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

export const GameControls: React.FC<GameControlsProps> = ({
  onNewGame,
  onFlipBoard,
  onUndo,
  canUndo,
  onExportPGN,
  onCopyFEN,
  onOpenFENModal,
  onOpenPerftModal,
  soundEnabled: controlledSoundEnabled,
  onToggleSound,
}) => {
  const [internalSoundEnabled, setInternalSoundEnabled] = useState(true);
  const [fenCopied, setFenCopied] = useState(false);

  const isAudioActive = controlledSoundEnabled !== undefined ? controlledSoundEnabled : internalSoundEnabled;

  const toggleSound = () => {
    if (onToggleSound) {
      onToggleSound();
    } else {
      sounds.enabled = !sounds.enabled;
      setInternalSoundEnabled(sounds.enabled);
    }
  };

  const handleCopyFEN = () => {
    onCopyFEN();
    setFenCopied(true);
    setTimeout(() => setFenCopied(false), 1800);
  };

  return (
    <div className="game-controls-bar">
      <button className="control-btn" onClick={onNewGame} title="Start a fresh game">
        <RotateCcw size={16} />
        <span>New Game</span>
      </button>

      <button className="control-btn" onClick={onFlipBoard} title="Flip board perspective">
        <ArrowUpDown size={16} />
        <span>Flip</span>
      </button>

      <button
        className="control-btn"
        onClick={onUndo}
        disabled={!canUndo}
        title="Take back last move"
      >
        <span>Undo</span>
      </button>

      <button
        className={`control-btn ${isAudioActive ? '' : 'btn-muted'}`}
        onClick={toggleSound}
        title={isAudioActive ? 'Mute audio synthesizer' : 'Unmute audio synthesizer'}
      >
        {isAudioActive ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>

      <button className="control-btn" onClick={handleCopyFEN} title="Copy current FEN position">
        {fenCopied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
        <span>{fenCopied ? 'Copied' : 'FEN'}</span>
      </button>

      <button className="control-btn" onClick={onExportPGN} title="Export PGN notation">
        <Download size={16} />
        <span>PGN</span>
      </button>

      <button className="control-btn" onClick={onOpenFENModal} title="Load custom FEN position">
        <FileCode size={16} />
        <span>Load FEN</span>
      </button>

      <button
        className="control-btn btn-highlight"
        onClick={onOpenPerftModal}
        title="Run Perft verification suite"
      >
        <Terminal size={16} />
        <span>Perft Test</span>
      </button>
    </div>
  );
};
