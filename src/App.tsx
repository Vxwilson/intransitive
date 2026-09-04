import { useState, useEffect, useCallback, useMemo } from 'react';
import { Chess } from './core/chess';
import type { Move, GameStatus, Color } from './core/types';
import { MoveFlag, WHITE, BLACK } from './core/types';
import { sounds } from './audio/soundEffects';
import { generatePGN } from './core/pgn';
import { ChessBoard } from './ui/ChessBoard';
import { EvalBar } from './ui/EvalBar';
import { MoveHistory } from './ui/MoveHistory';
import { GameControls } from './ui/GameControls';
import { GameStatusBanner } from './ui/GameStatusBanner';
import { PerftModal } from './ui/PerftModal';
import { FenModal } from './ui/FenModal';
import { EngineStatsPanel } from './ui/EngineStatsPanel';
import type { GameMode, DifficultyLevel } from './engine/engineTypes';
import { DIFFICULTY_PRESETS, loadSavedSettings, saveUserSettings } from './engine/engineTypes';
import { engineClient } from './engine/engineClient';
import type { SearchUpdate } from './engine/search';
import { ShieldCheck, Cpu } from 'lucide-react';
import './styles/index.css';

export function App() {
  // Primary engine state
  const [chess] = useState<Chess>(() => new Chess());
  const [, setTick] = useState<number>(0);
  const rerender = useCallback(() => setTick((t) => t + 1), []);

  // Saved user settings from localStorage
  const savedSettings = useMemo(() => loadSavedSettings(), []);

  // Move history for SAN display and time-travel navigation
  const [moveHistory, setMoveHistory] = useState<
    { move: Move; san: string; fenAfter: string }[]
  >([]);
  const [activeHistoryIndex, setActiveHistoryIndex] = useState<number>(-1);

  // UI state
  const [isFlipped, setIsFlipped] = useState<boolean>(() =>
    savedSettings.isFlipped ?? (savedSettings.playerColor === BLACK)
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() =>
    savedSettings.soundEnabled ?? true
  );
  const [isHardwareExpanded, setIsHardwareExpanded] = useState<boolean>(() =>
    savedSettings.isHardwareExpanded ?? false
  );
  const [isPerftOpen, setIsPerftOpen] = useState<boolean>(false);
  const [isFenOpen, setIsFenOpen] = useState<boolean>(false);

  // Engine Analysis and AI Play vs Computer states (persisted across sessions)
  const [isAnalysisEnabled, setIsAnalysisEnabled] = useState<boolean>(() =>
    savedSettings.isAnalysisEnabled ?? true
  );
  const [latestStats, setLatestStats] = useState<SearchUpdate | null>(null);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [gameMode, setGameMode] = useState<GameMode>(() =>
    savedSettings.gameMode ?? 'human_vs_human'
  );
  const [playerColor, setPlayerColor] = useState<Color>(() =>
    savedSettings.playerColor !== undefined ? (savedSettings.playerColor as Color) : WHITE
  );
  const [difficulty, setDifficulty] = useState<DifficultyLevel>(() =>
    savedSettings.difficulty ?? 'intermediate'
  );
  const [multiPv, setMultiPv] = useState<number>(() =>
    Math.min(5, Math.max(1, savedSettings.multiPv ?? 1))
  );
  const [isInfinite, setIsInfinite] = useState<boolean>(() =>
    savedSettings.isInfinite ?? false
  );
  const [searchTimeSec, setSearchTimeSec] = useState<number>(() =>
    savedSettings.searchTimeSec ?? 8
  );
  const [hashMb, setHashMb] = useState<number>(() =>
    savedSettings.hashMb ?? 32
  );
  const [threads, setThreads] = useState<number>(() => {
    if (savedSettings.threads) return Math.min(16, Math.max(1, savedSettings.threads));
    return typeof navigator !== 'undefined' ? Math.min(navigator.hardwareConcurrency ?? 4, 16) : 4;
  });

  // Sync sound engine mute status with state
  useEffect(() => {
    sounds.enabled = soundEnabled;
  }, [soundEnabled]);

  // Automatically persist user settings to localStorage whenever changed
  useEffect(() => {
    saveUserSettings({
      isAnalysisEnabled,
      searchTimeSec,
      isInfinite,
      multiPv,
      threads,
      hashMb,
      gameMode,
      difficulty,
      playerColor,
      isFlipped,
      soundEnabled,
      isHardwareExpanded,
    });
  }, [
    isAnalysisEnabled,
    searchTimeSec,
    isInfinite,
    multiPv,
    threads,
    hashMb,
    gameMode,
    difficulty,
    playerColor,
    isFlipped,
    soundEnabled,
    isHardwareExpanded,
  ]);

  // Synchronize hash size and thread count with engine worker pool on startup
  useEffect(() => {
    if (savedSettings.hashMb) {
      engineClient.setHashSize(savedSettings.hashMb);
    }
    if (threads) {
      engineClient.setThreads(threads);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Active board is either current live game board or historical snapshot
  const activeBoard = useMemo(() => {
    if (activeHistoryIndex === -1 && moveHistory.length === 0) {
      return chess;
    }
    if (activeHistoryIndex >= 0 && activeHistoryIndex < moveHistory.length - 1) {
      const historicalChess = new Chess(moveHistory[activeHistoryIndex].fenAfter);
      return historicalChess;
    }
    return chess;
  }, [chess, activeHistoryIndex, moveHistory]);

  const isBrowsingHistory =
    activeHistoryIndex >= 0 && activeHistoryIndex < moveHistory.length - 1;

  const currentStatus: GameStatus = chess.getStatus();

  // Execute a move
  const handleMakeMove = useCallback(
    (move: Move) => {
      // If browsing history and making a move, rewind the game to that point
      if (isBrowsingHistory) {
        const targetFEN =
          activeHistoryIndex === -1
            ? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
            : moveHistory[activeHistoryIndex].fenAfter;
        chess.loadFEN(targetFEN);
        setMoveHistory((prev) => prev.slice(0, activeHistoryIndex + 1));
      }

      // Strictly validate move legality on current board state
      const legalMoves = chess.generateLegalMoves();
      const verifiedMove = legalMoves.find(
        (m) =>
          m.from === move.from &&
          m.to === move.to &&
          (m.promotion === undefined || m.promotion === move.promotion)
      );

      if (!verifiedMove) {
        console.warn('Rejected illegal or stale move:', move);
        return;
      }

      // Immediately halt any active search on move execution so workers do not burn CPU or emit stale stats
      engineClient.stop();
      setLatestStats(null);

      const san = chess.moveToSAN(verifiedMove);
      chess.makeMove(verifiedMove);
      const newFEN = chess.toFEN();

      // Trigger audio based on move dynamics
      const inCheck = chess.inCheck();
      const status = chess.getStatus();

      if (status === 'checkmate') {
        sounds.playVictory();
      } else if (inCheck) {
        sounds.playCheck();
      } else if (
        verifiedMove.flags === MoveFlag.CastleKingside ||
        verifiedMove.flags === MoveFlag.CastleQueenside
      ) {
        sounds.playCastle();
      } else if (
        verifiedMove.captured !== undefined ||
        verifiedMove.flags === MoveFlag.EnPassant
      ) {
        sounds.playCapture();
      } else {
        sounds.playMove();
      }

      setMoveHistory((prev) => {
        const trimmed = isBrowsingHistory
          ? prev.slice(0, activeHistoryIndex + 1)
          : prev;
        const next = [...trimmed, { move: verifiedMove, san, fenAfter: newFEN }];
        setActiveHistoryIndex(next.length - 1);
        return next;
      });

      rerender();
    },
    [chess, isBrowsingHistory, activeHistoryIndex, moveHistory, rerender]
  );

  // Undo move
  const handleUndo = useCallback(() => {
    if (moveHistory.length === 0) return;
    engineClient.stop();
    setIsSearching(false);
    setLatestStats(null);
    chess.unmakeMove();
    // If playing vs computer, undo twice to step back to player's turn
    if (gameMode === 'play_vs_computer' && moveHistory.length >= 2) {
      chess.unmakeMove();
      setMoveHistory((prev) => {
        const next = prev.slice(0, prev.length - 2);
        setActiveHistoryIndex(next.length - 1);
        return next;
      });
    } else {
      setMoveHistory((prev) => {
        const next = prev.slice(0, prev.length - 1);
        setActiveHistoryIndex(next.length - 1);
        return next;
      });
    }
    sounds.playMove();
    rerender();
  }, [chess, moveHistory.length, gameMode, rerender]);

  // New Game
  const handleNewGame = useCallback(() => {
    engineClient.stop();
    setIsSearching(false);
    chess.reset();
    setMoveHistory([]);
    setActiveHistoryIndex(-1);
    setLatestStats(null);
    sounds.playMove();
    rerender();
  }, [chess, rerender]);

  // Load custom FEN
  const handleLoadFEN = useCallback(
    (fen: string) => {
      engineClient.stop();
      setIsSearching(false);
      chess.loadFEN(fen);
      setMoveHistory([]);
      setActiveHistoryIndex(-1);
      setLatestStats(null);
      sounds.playMove();
      rerender();
    },
    [chess, rerender]
  );

  // Copy FEN
  const handleCopyFEN = useCallback(() => {
    navigator.clipboard.writeText(chess.toFEN());
  }, [chess]);

  // Export PGN
  const handleExportPGN = useCallback(() => {
    let result = '*';
    if (currentStatus === 'checkmate') {
      result = chess.activeColor === WHITE ? '0-1' : '1-0';
    } else if (
      currentStatus === 'stalemate' ||
      currentStatus === 'draw_threefold' ||
      currentStatus === 'draw_50move' ||
      currentStatus === 'draw_insufficient_material'
    ) {
      result = '1/2-1/2';
    }

    const pgnText = generatePGN(moveHistory, {}, result);
    const blob = new Blob([pgnText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chessesque-game-${new Date().toISOString().slice(0, 10)}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chess.activeColor, currentStatus, moveHistory]);

  const handleHashMbChange = useCallback((mb: number) => {
    setHashMb(mb);
    engineClient.setHashSize(mb);
  }, []);

  const handleThreadsChange = useCallback((t: number) => {
    setThreads(t);
    engineClient.setThreads(t);
  }, []);

  // Listen to engine client telemetry updates and search status
  useEffect(() => {
    const unsubStats = engineClient.subscribe((update) => {
      setLatestStats(update);
    });
    const unsubStatus = engineClient.onStatusChange((searching) => {
      setIsSearching(searching);
    });
    return () => {
      unsubStats();
      unsubStatus();
    };
  }, []);

  // Determine if it is computer's turn in Play vs Computer mode
  const isComputerTurn =
    gameMode === 'play_vs_computer' &&
    chess.activeColor !== playerColor &&
    currentStatus === 'in_progress' &&
    !isBrowsingHistory;

  // Background Search Lifecycle (Live Analysis & AI Opponent Move Generation)
  useEffect(() => {
    if (currentStatus !== 'in_progress') {
      engineClient.stop();
      return;
    }

    const currentFEN = activeBoard.toFEN();

    if (isComputerTurn) {
      const preset = DIFFICULTY_PRESETS[difficulty];
      const timer = setTimeout(() => {
        engineClient
          .search(currentFEN, {
            maxDepth: preset.depth,
            timeLimitMs: preset.timeLimitMs,
          })
          .then((res) => {
            // Strictly ensure the board position has not changed since search was initiated
            if (
              res.bestMove &&
              activeBoard.toFEN() === currentFEN &&
              activeBoard.activeColor !== playerColor
            ) {
              handleMakeMove(res.bestMove);
            }
          })
          .catch((err) => {
            console.error('Computer move execution error:', err);
          });
      }, 200);

      return () => {
        clearTimeout(timer);
        engineClient.stop();
      };
    } else if (isAnalysisEnabled && !isBrowsingHistory) {
      engineClient.search(currentFEN, {
        maxDepth: isInfinite ? 64 : 24,
        timeLimitMs: isInfinite ? 999999999 : searchTimeSec * 1000,
        multiPv: multiPv,
      });

      return () => {
        engineClient.stop();
      };
    } else {
      engineClient.stop();
    }
  }, [
    activeBoard,
    currentStatus,
    isComputerTurn,
    playerColor,
    isAnalysisEnabled,
    isBrowsingHistory,
    difficulty,
    multiPv,
    isInfinite,
    searchTimeSec,
    handleMakeMove,
  ]);

  // Keyboard navigation shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        setActiveHistoryIndex((prev) => Math.max(-1, prev - 1));
      } else if (e.key === 'ArrowRight') {
        setActiveHistoryIndex((prev) => Math.min(moveHistory.length - 1, prev + 1));
      } else if (e.key === 'f' || e.key === 'F') {
        setIsFlipped((f) => !f);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [moveHistory.length]);

  const lastMove =
    activeHistoryIndex >= 0 && moveHistory[activeHistoryIndex]
      ? moveHistory[activeHistoryIndex].move
      : null;

  // Candidate arrows for multi-line display on board:
  // Strictly validated against current active player and piece existence to prevent stale arrows
  const arrowsToDisplay = useMemo(() => {
    if (!isAnalysisEnabled && !isComputerTurn) return [];
    if (!latestStats) return [];

    const lines =
      latestStats.lines && latestStats.lines.length > 0
        ? latestStats.lines
        : latestStats.bestMove
        ? [
            {
              rank: 1,
              move: latestStats.bestMove,
            },
          ]
        : [];

    return lines
      .filter((line) => {
        if (!line.move) return false;
        const fromPiece = activeBoard.mailbox[line.move.from];
        return fromPiece && fromPiece.color === activeBoard.activeColor;
      })
      .map((line) => ({
        move: line.move,
        rank: line.rank,
      }));
  }, [isAnalysisEnabled, isComputerTurn, latestStats, activeBoard]);

  const bestMoveToDisplay = arrowsToDisplay.length > 0 ? arrowsToDisplay[0].move : null;

  // EvalBar values
  const engineEvalScore = latestStats ? latestStats.scoreWhite / 100 : null;
  const engineMateScore = latestStats?.isMate
    ? latestStats.scoreWhite >= 0
      ? Math.ceil((latestStats.mateInPlies ?? 0) / 2)
      : -Math.ceil((latestStats.mateInPlies ?? 0) / 2)
    : null;

  return (
    <div className="app-root">
      {/* Header */}
      <header className="app-header">
        <div className="brand-group">
          <div className="brand-badge-icon">
            <Cpu size={20} />
          </div>
          <div>
            <h1 className="brand-title">Chessesque</h1>
          </div>
          <span className="brand-phase-tag">Phase 2: Search Engine & AI</span>
        </div>

        <div className="header-status">
          <div className="turn-pill">
            <span
              className={`turn-dot ${
                activeBoard.activeColor === WHITE ? 'turn-dot-white' : 'turn-dot-black'
              }`}
            />
            <span>
              {isComputerTurn
                ? 'Computer Thinking...'
                : activeBoard.activeColor === WHITE
                ? 'White to Move'
                : 'Black to Move'}
            </span>
          </div>

          <button
            className="control-btn btn-highlight"
            onClick={() => setIsPerftOpen(true)}
            style={{ padding: '0.35rem 0.75rem' }}
          >
            <ShieldCheck size={16} />
            <span>Verify Rules (Perft)</span>
          </button>
        </div>
      </header>

      {/* Main Studio Arena */}
      <main className="app-container">
        {/* Status banner if checkmate or draw */}
        <GameStatusBanner
          status={currentStatus}
          activeColor={chess.activeColor}
          onNewGame={handleNewGame}
        />

        <div className="studio-workspace">
          {/* Board & Live Eval Bar */}
          <div className="board-arena">
            <EvalBar
              chess={activeBoard}
              isFlipped={isFlipped}
              engineScore={engineEvalScore}
              isMate={engineMateScore}
            />

            <ChessBoard
              chess={activeBoard}
              isFlipped={isFlipped}
              onMakeMove={handleMakeMove}
              lastMove={lastMove}
              bestMove={bestMoveToDisplay}
              arrows={arrowsToDisplay}
              showArrow={arrowsToDisplay.length > 0}
              interactive={
                currentStatus === 'in_progress' && !isBrowsingHistory && !isComputerTurn
              }
            />
          </div>

          {/* Right Control, Telemetry & Move Panel */}
          <aside className="side-panel">
            <GameControls
              onNewGame={handleNewGame}
              onFlipBoard={() => setIsFlipped((f) => !f)}
              onUndo={handleUndo}
              canUndo={moveHistory.length > 0}
              onExportPGN={handleExportPGN}
              onCopyFEN={handleCopyFEN}
              onOpenFENModal={() => setIsFenOpen(true)}
              onOpenPerftModal={() => setIsPerftOpen(true)}
              soundEnabled={soundEnabled}
              onToggleSound={() => setSoundEnabled((s) => !s)}
            />

            <EngineStatsPanel
              stats={latestStats}
              isSearching={isSearching}
              isAnalysisEnabled={isAnalysisEnabled}
              onToggleAnalysis={(enabled) => {
                setIsAnalysisEnabled(enabled);
                if (!enabled) setLatestStats(null);
              }}
              gameMode={gameMode}
              onChangeGameMode={setGameMode}
              playerColor={playerColor}
              onChangePlayerColor={(c) => {
                setPlayerColor(c);
                setIsFlipped(c === BLACK);
              }}
              difficulty={difficulty}
              onChangeDifficulty={setDifficulty}
              multiPv={multiPv}
              onChangeMultiPv={setMultiPv}
              isInfinite={isInfinite}
              onToggleInfinite={setIsInfinite}
              searchTimeSec={searchTimeSec}
              onChangeSearchTimeSec={setSearchTimeSec}
              hashMb={hashMb}
              onChangeHashMb={handleHashMbChange}
              threads={threads}
              onChangeThreads={handleThreadsChange}
              isHardwareExpanded={isHardwareExpanded}
              onToggleHardwareExpanded={setIsHardwareExpanded}
              onApplyMove={(move) => {
                if (currentStatus === 'in_progress' && !isComputerTurn) {
                  handleMakeMove(move);
                }
              }}
            />

            <MoveHistory
              moves={moveHistory}
              currentMoveIndex={activeHistoryIndex}
              onSelectMove={(idx) => setActiveHistoryIndex(idx)}
            />
          </aside>
        </div>
      </main>

      {/* Modals */}
      <PerftModal
        isOpen={isPerftOpen}
        onClose={() => setIsPerftOpen(false)}
        currentBoardFEN={chess.toFEN()}
      />

      <FenModal
        isOpen={isFenOpen}
        onClose={() => setIsFenOpen(false)}
        onLoadFEN={handleLoadFEN}
      />

      <footer className="app-footer">
        <p>
          Chessesque • High-Performance Bitboard Architecture & Trainable Game Engine Studio •
          Phase 2 Complete
        </p>
      </footer>
    </div>
  );
}

export default App;
