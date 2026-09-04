import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Zap,
  Swords,
  Gamepad2,
  Trophy,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Undo2,
  ArrowUpDown,
  BookmarkPlus,
  Check,
  Settings as SettingsIcon,
} from 'lucide-react';
import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import { createZeroWeights, createHeuristicWeights, evaluate } from '../engine/evaluator';
import { getTopMoves, formatEvalScore } from '../engine/search';
import type {
  EvaluationWeights,
  TrainingStats,
  Checkpoint,
  WorkerResponse,
} from '../engine/types';
import {
  getStoredCheckpoints,
  saveCheckpoint,
  deleteCheckpoint,
  clearAllUserCheckpoints,
  exportCheckpointsJSON,
  importCheckpointsJSON,
  createInitialStats,
  PRESET_CHECKPOINTS,
  getDefaultCheckpointName,
} from '../engine/checkpoint';
import { IntransitiveBoard } from './IntransitiveBoard';
import { LiveControls } from './LiveControls';
import { TurboTrainerCard } from './TurboTrainerCard';
import { InterpretabilityCard } from './InterpretabilityCard';
import { ArenaCard } from './ArenaCard';
import { HumanAnalysisPanel } from './HumanAnalysisPanel';
import { MoveListSection } from './MoveListSection';
import { StudioSettingsCard } from './StudioSettingsCard';
import { sounds } from '../../audio/soundEffects';
import './intransitive.css';

type StudioTab = 'arena' | 'turbo' | 'play' | 'settings';

const SETTINGS_KEY = 'chessesque_intransitive_settings_v1';

interface SavedSettings {
  evalModelId?: string;
  humanColor?: 'blue' | 'red';
  selectedOpponentId?: string;
  isAnalysisEnabled?: boolean;
  analysisMaxRows?: number;
  tournamentZoomEnabled?: boolean;
  soundEnabled?: boolean;
  delayMs?: number;
  fighterAId?: string;
  fighterBId?: string;
}

function loadSavedSettings(): SavedSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore parse errors
  }
  return {};
}

function saveSettingsToStorage(settings: SavedSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export const IntransitiveStudio: React.FC = () => {
  const initialSettings = useMemo(() => loadSavedSettings(), []);

  // Game state
  const [game, setGame] = useState<IntransitiveGame>(() => new IntransitiveGame());
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<Move | null>(null);
  const [moveHistory, setMoveHistory] = useState<{ move: Move; san: string; fen: string }[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isBoardFlipped, setIsBoardFlipped] = useState<boolean>(false);

  // Model & Weights State
  const [weights, setWeights] = useState<EvaluationWeights>(() => createZeroWeights());
  const [stats, setStats] = useState<TrainingStats>(() => ({
    generation: 0,
    gamesPlayed: 0,
    blueWins: 0,
    redWins: 0,
    draws: 0,
    avgGameLength: 0,
    history: [{ generation: 0, R: 0, P: 0, S: 0, blueWinRate: 50 }],
  }));

  // UI Modes & Controls
  const [activeTab, setActiveTab] = useState<StudioTab>('arena');
  const [isPlayingLive, setIsPlayingLive] = useState<boolean>(false);
  const [delayMs, setDelayMs] = useState<number>(initialSettings.delayMs ?? 300);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(initialSettings.soundEnabled ?? true);

  // Turbo Worker State
  const [isTurboTraining, setIsTurboTraining] = useState<boolean>(false);
  const [turboProgress, setTurboProgress] = useState<{ completed: number; total: number; nps: number } | null>(null);

  // Checkpoints State
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(() => getStoredCheckpoints());
  const [tournamentResult, setTournamentResult] = useState<{
    winsA: number;
    winsB: number;
    draws: number;
    winRateA: number;
    winRateB: number;
    drawRate: number;
    gamesPlayed: number;
  } | null>(null);

  // Visual Arena Fighters Selection
  const [fighterAId, setFighterAId] = useState<string>(initialSettings.fighterAId ?? 'current');
  const [fighterBId, setFighterBId] = useState<string>(initialSettings.fighterBId ?? 'preset-heuristic-master');
  const [tournamentZoomEnabled, setTournamentZoomEnabled] = useState<boolean>(
    initialSettings.tournamentZoomEnabled ?? true
  );

  // Human Play Settings
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>(
    initialSettings.selectedOpponentId ?? 'preset-heuristic-master'
  );
  const [humanColor, setHumanColor] = useState<'blue' | 'red'>(
    initialSettings.humanColor ?? 'blue'
  );

  // Coupled Engine Model for Evaluation & Human Play Move Analysis
  const [evalModelId, setEvalModelId] = useState<string>(
    initialSettings.evalModelId ?? 'preset-heuristic-master'
  );
  const [isAnalysisEnabled, setIsAnalysisEnabled] = useState<boolean>(
    initialSettings.isAnalysisEnabled ?? true
  );
  const [analysisMaxRows, setAnalysisMaxRows] = useState<number>(
    initialSettings.analysisMaxRows ?? 3
  );

  // Turbo Trainer Baseline & Snapshot State
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('preset-gen-0');
  const [snapshotName, setSnapshotName] = useState<string>(() => getDefaultCheckpointName(stats.generation));
  const [lastLoadedOrSavedGen, setLastLoadedOrSavedGen] = useState<number>(stats.generation);
  const [isSnapshotSaved, setIsSnapshotSaved] = useState<boolean>(false);

  // Tournament Live Board Zoom Queue & Refs
  const zoomQueueRef = useRef<{ move: Move; san: string; fen: string; isOver: boolean; gameIndex?: number }[]>([]);
  const pendingTournamentResultRef = useRef<any>(null);
  const [isZoomingTournament, setIsZoomingTournament] = useState<boolean>(false);
  const currentZoomGameRef = useRef<number>(1);

  // Volatile state refs to avoid tearing down the Web Worker
  const soundEnabledRef = useRef(soundEnabled);
  const tournamentZoomEnabledRef = useRef(tournamentZoomEnabled);
  const isZoomingTournamentRef = useRef(isZoomingTournament);

  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    tournamentZoomEnabledRef.current = tournamentZoomEnabled;
  }, [tournamentZoomEnabled]);

  useEffect(() => {
    isZoomingTournamentRef.current = isZoomingTournament;
  }, [isZoomingTournament]);

  // Worker reference
  const workerRef = useRef<Worker | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper to fetch weights for a model identifier
  const getWeightsById = useCallback((id: string): EvaluationWeights => {
    if (id === 'current') return weights;
    if (id === 'preset-heuristic-master') return createHeuristicWeights();
    if (id === 'preset-gen-0') return createZeroWeights();
    const cp = checkpoints.find((c) => c.id === id);
    return cp ? cp.weights : weights;
  }, [weights, checkpoints]);

  // Coupled active evaluation model (used for both board eval and candidate move analysis)
  const activeEvalModel = useMemo(() => {
    if (evalModelId === 'preset-heuristic-master') {
      return {
        id: 'preset-heuristic-master',
        name: 'Heuristic Master',
        displayName: 'Heuristic',
        generation: 0,
        gamesPlayed: 10000,
        weights: createHeuristicWeights(),
      };
    }
    if (evalModelId === 'preset-gen-0') {
      return {
        id: 'preset-gen-0',
        name: 'Gen 0 Tabula Rasa',
        displayName: 'Gen 0',
        generation: 0,
        gamesPlayed: 0,
        weights: createZeroWeights(),
      };
    }
    if (evalModelId === 'current') {
      return {
        id: 'current',
        name: `Current Model (Gen ${stats.generation})`,
        displayName: `Gen ${stats.generation}`,
        generation: stats.generation,
        gamesPlayed: stats.gamesPlayed,
        weights: weights,
      };
    }
    const cp = checkpoints.find((c) => c.id === evalModelId);
    if (cp) {
      const label = cp.name.startsWith('Gen ') ? cp.name.split('_')[0] : `Gen ${cp.generation}`;
      return {
        id: cp.id,
        name: cp.name,
        displayName: label,
        generation: cp.generation,
        gamesPlayed: cp.stats?.gamesPlayed ?? cp.generation * 50,
        weights: cp.weights,
      };
    }
    return {
      id: 'preset-heuristic-master',
      name: 'Heuristic Master',
      displayName: 'Heuristic',
      generation: 0,
      gamesPlayed: 10000,
      weights: createHeuristicWeights(),
    };
  }, [evalModelId, stats, weights, checkpoints]);

  // Candidate moves for Human Play engine analysis (coupled with activeEvalModel)
  const candidateMoves = useMemo(() => {
    if (activeTab !== 'play' || !isAnalysisEnabled || game.isTerminal().isOver) return [];
    return getTopMoves(game, activeEvalModel.weights, analysisMaxRows, 2);
  }, [activeTab, isAnalysisEnabled, game, activeEvalModel, analysisMaxRows]);

  // Persist settings on change
  useEffect(() => {
    saveSettingsToStorage({
      evalModelId,
      humanColor,
      selectedOpponentId,
      isAnalysisEnabled,
      analysisMaxRows,
      tournamentZoomEnabled,
      soundEnabled,
      delayMs,
      fighterAId,
      fighterBId,
    });
  }, [
    evalModelId,
    humanColor,
    selectedOpponentId,
    isAnalysisEnabled,
    analysisMaxRows,
    tournamentZoomEnabled,
    soundEnabled,
    delayMs,
    fighterAId,
    fighterBId,
  ]);

  // Initialize Web Worker once on mount
  useEffect(() => {
    const worker = new Worker(
      new URL('../engine/trainingWorker.ts', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;

      switch (data.type) {
        case 'TURBO_PROGRESS': {
          setTurboProgress({
            completed: data.completed,
            total: data.total,
            nps: data.nps,
          });
          setStats(data.stats);
          setWeights(data.weights);
          setSnapshotName(getDefaultCheckpointName(data.stats.generation));
          setSelectedBaselineId('current');
          break;
        }

        case 'TURBO_COMPLETE': {
          setIsTurboTraining(false);
          setTurboProgress(null);
          setStats(data.stats);
          setWeights(data.weights);
          setSnapshotName(getDefaultCheckpointName(data.stats.generation));
          setSelectedBaselineId('current');
          if (soundEnabledRef.current) sounds.playVictory();
          break;
        }

        case 'LIVE_STEP': {
          if (!data.san) {
            setIsPlayingLive(false);
            return;
          }

          setGame((prevGame) => {
            const nextGame = prevGame.clone();
            nextGame.makeMove(data.move);

            // Audio cues
            if (soundEnabledRef.current) {
              if (data.move.captured) {
                sounds.playCapture();
              } else {
                sounds.playMove();
              }
            }

            setLastMove(data.move);
            setMoveHistory((prev) => [
              ...prev,
              { move: data.move, san: data.san, fen: data.fenAfter },
            ]);
            setHistoryIndex((prev) => prev + 1);

            if (data.isOver) {
              setIsPlayingLive(false);
              if (soundEnabledRef.current) sounds.playVictory();
            }

            return nextGame;
          });
          break;
        }

        case 'ARENA_STREAM_MOVE': {
          zoomQueueRef.current.push(data);
          break;
        }

        case 'ARENA_RESULT': {
          if (tournamentZoomEnabledRef.current && isZoomingTournamentRef.current) {
            pendingTournamentResultRef.current = data;
          } else {
            setTournamentResult(data);
            setIsZoomingTournament(false);
            if (soundEnabledRef.current) sounds.playVictory();
          }
          break;
        }

        case 'CURRENT_STATE': {
          setWeights(data.weights);
          setStats(data.stats);
          break;
        }
      }
    };

    return () => {
      worker.terminate();
    };
  }, []);

  // Tournament Live Board Zoom ticker (6ms per tick with adaptive draining)
  useEffect(() => {
    if (!isZoomingTournament) return;

    const timer = setInterval(() => {
      const qLen = zoomQueueRef.current.length;
      const batchSize = qLen > 300 ? 3 : qLen > 100 ? 2 : 1;

      let lastNext: { move: Move; san: string; fen: string; isOver: boolean; gameIndex?: number } | null = null;
      for (let b = 0; b < batchSize; b++) {
        const item = zoomQueueRef.current.shift();
        if (item) lastNext = item;
        else break;
      }

      if (lastNext) {
        if (lastNext.gameIndex && lastNext.gameIndex !== currentZoomGameRef.current) {
          currentZoomGameRef.current = lastNext.gameIndex;
          setMoveHistory([]);
          setHistoryIndex(-1);
        }

        setGame(new IntransitiveGame(lastNext.fen));
        setLastMove(lastNext.move);
        setMoveHistory((prev) => [
          ...prev,
          { move: lastNext!.move, san: lastNext!.san, fen: lastNext!.fen },
        ]);
        setHistoryIndex((prev) => prev + 1);

        if (soundEnabledRef.current && lastNext.isOver) {
          sounds.playCapture();
        }
      } else if (pendingTournamentResultRef.current) {
        setTournamentResult(pendingTournamentResultRef.current);
        pendingTournamentResultRef.current = null;
        setIsZoomingTournament(false);
        if (soundEnabledRef.current) sounds.playVictory();
      }
    }, 6);

    return () => clearInterval(timer);
  }, [isZoomingTournament]);

  // Visual Arena Live playback loop: alternates between Fighter A (Blue) and Fighter B (Red)
  useEffect(() => {
    if (!isPlayingLive || activeTab !== 'arena' || game.isTerminal().isOver) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    timerRef.current = setTimeout(() => {
      if (workerRef.current && isPlayingLive) {
        // In Visual Arena, Blue moves using Fighter A, Red moves using Fighter B
        const activeFighterId = game.activePlayer === PLAYER_BLUE ? fighterAId : fighterBId;
        const fighterWeights = getWeightsById(activeFighterId);
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: game.toFEN(),
          customWeights: fighterWeights,
        });
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlayingLive, activeTab, game, delayMs, fighterAId, fighterBId, getWeightsById]);

  // Reset Game
  const handleResetGame = useCallback(() => {
    setIsPlayingLive(false);
    setIsZoomingTournament(false);
    zoomQueueRef.current = [];
    pendingTournamentResultRef.current = null;
    const freshGame = new IntransitiveGame();
    setGame(freshGame);
    setSelectedSquare(null);
    setLastMove(null);
    setMoveHistory([]);
    setHistoryIndex(-1);
  }, []);

  // Step Controls
  const handleStepForward = useCallback(() => {
    if (historyIndex < moveHistory.length - 1) {
      const nextIndex = historyIndex + 1;
      const target = moveHistory[nextIndex];
      const g = new IntransitiveGame(target.fen);
      setGame(g);
      setLastMove(target.move);
      setHistoryIndex(nextIndex);
    } else {
      // Ask worker for 1 live step based on current active fighter
      if (workerRef.current && !game.isTerminal().isOver) {
        const activeFighterId = game.activePlayer === PLAYER_BLUE ? fighterAId : fighterBId;
        const watchWeights = getWeightsById(activeFighterId);
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: game.toFEN(),
          customWeights: watchWeights,
        });
      }
    }
  }, [historyIndex, moveHistory, game, fighterAId, fighterBId, getWeightsById]);

  const handleStepBackward = useCallback(() => {
    if (historyIndex > 0) {
      const prevIndex = historyIndex - 1;
      const target = moveHistory[prevIndex];
      const g = new IntransitiveGame(target.fen);
      setGame(g);
      setLastMove(target.move);
      setHistoryIndex(prevIndex);
    } else if (historyIndex === 0) {
      handleResetGame();
    }
  }, [historyIndex, moveHistory, handleResetGame]);

  // Jump to specific ply in move history
  const handleSelectHistoryIndex = useCallback((index: number) => {
    setIsPlayingLive(false);
    if (index === -1) {
      const fresh = new IntransitiveGame();
      setGame(fresh);
      setSelectedSquare(null);
      setLastMove(null);
      setHistoryIndex(-1);
    } else if (index >= 0 && index < moveHistory.length) {
      const target = moveHistory[index];
      const g = new IntransitiveGame(target.fen);
      setGame(g);
      setSelectedSquare(null);
      setLastMove(target.move);
      setHistoryIndex(index);
    }
  }, [moveHistory]);

  // Human Move Handler
  const handleHumanMove = useCallback((move: Move) => {
    const nextGame = game.clone();
    const san = nextGame.formatMoveSAN(move);
    const ok = nextGame.makeMove(move);
    if (!ok) return;

    if (soundEnabled) {
      if (move.captured) sounds.playCapture();
      else sounds.playMove();
    }

    const fenAfter = nextGame.toFEN();
    setGame(nextGame);
    setLastMove(move);
    setMoveHistory((prev) => [...prev, { move, san, fen: fenAfter }]);
    setHistoryIndex((prev) => prev + 1);

    // Trigger AI response using selected opponent's weights
    if (activeTab === 'play' && !nextGame.isTerminal().isOver) {
      const opponentWeights = getWeightsById(selectedOpponentId);
      setTimeout(() => {
        if (workerRef.current) {
          workerRef.current.postMessage({
            type: 'STEP_LIVE',
            currentFen: fenAfter,
            customWeights: opponentWeights,
          });
        }
      }, 250);
    }
  }, [game, soundEnabled, activeTab, selectedOpponentId, getWeightsById]);

  // Start a fresh Human Game
  const handleStartHumanGame = useCallback((color: 'blue' | 'red', opponentId: string) => {
    setHumanColor(color);
    setSelectedOpponentId(opponentId);
    setIsPlayingLive(false);
    const freshGame = new IntransitiveGame();
    setGame(freshGame);
    setSelectedSquare(null);
    setLastMove(null);
    setMoveHistory([]);
    setHistoryIndex(-1);

    // Auto-adjust board flip if human plays Red
    if (color === 'red') {
      setIsBoardFlipped(true);
      // AI plays first as Blue
      setTimeout(() => {
        if (workerRef.current) {
          const opponentWeights = getWeightsById(opponentId);
          workerRef.current.postMessage({
            type: 'STEP_LIVE',
            currentFen: freshGame.toFEN(),
            customWeights: opponentWeights,
          });
        }
      }, 350);
    } else {
      setIsBoardFlipped(false);
    }
  }, [getWeightsById]);

  // Undo in Human Play (steps back 2 plies to human's turn)
  const handleUndoHumanMove = useCallback(() => {
    if (historyIndex >= 1) {
      const targetIndex = historyIndex - 2 >= 0 ? historyIndex - 2 : -1;
      handleSelectHistoryIndex(targetIndex);
    } else if (historyIndex === 0) {
      handleSelectHistoryIndex(-1);
    }
  }, [historyIndex, handleSelectHistoryIndex]);

  // Turbo Actions
  const handleStartTurbo = useCallback((totalGames: number) => {
    setIsPlayingLive(false);
    setIsTurboTraining(true);
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'START_TURBO',
        totalGames,
      });
    }
  }, []);

  const handleStopTurbo = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'STOP_TURBO' });
    }
    setIsTurboTraining(false);
  }, []);

  const handleResetTraining = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'RESET_TRAINING' });
    }
    handleResetGame();
    setSelectedBaselineId('preset-gen-0');
    setLastLoadedOrSavedGen(0);
    setSnapshotName(getDefaultCheckpointName(0));
  }, [handleResetGame]);

  // Baseline Loading & Top Bar Snapshot Handlers
  const handleLoadBaseline = useCallback((id: string) => {
    let newW: EvaluationWeights;
    let newStats: TrainingStats;

    if (id === 'preset-gen-0') {
      newW = createZeroWeights();
      newStats = createInitialStats(0);
      setSelectedBaselineId('preset-gen-0');
    } else if (id === 'preset-heuristic-master') {
      newW = createHeuristicWeights();
      const masterPreset = PRESET_CHECKPOINTS.find((c) => c.id === 'preset-heuristic-master');
      newStats = masterPreset?.stats ?? createInitialStats(1000);
      setSelectedBaselineId('preset-heuristic-master');
    } else if (id === 'current') {
      newW = weights;
      newStats = stats;
      setSelectedBaselineId('current');
    } else {
      const cp = checkpoints.find((c) => c.id === id);
      if (cp) {
        newW = cp.weights;
        newStats = cp.stats ?? createInitialStats(cp.generation);
        setSelectedBaselineId(cp.id);
      } else {
        newW = weights;
        newStats = stats;
      }
    }

    setWeights(newW);
    setStats(newStats);
    setLastLoadedOrSavedGen(newStats.generation);
    setSnapshotName(getDefaultCheckpointName(newStats.generation));

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'SET_WEIGHTS',
        weights: newW,
        stats: newStats,
      });
    }
  }, [checkpoints, weights, stats]);

  const handleSaveCurrentCheckpoint = useCallback((name: string) => {
    const cp = saveCheckpoint(name, stats.generation, weights, stats);
    setCheckpoints(getStoredCheckpoints());
    return cp;
  }, [stats, weights]);

  const handleHeaderSaveSnapshot = useCallback(() => {
    const finalName = snapshotName.trim() || getDefaultCheckpointName(stats.generation);
    handleSaveCurrentCheckpoint(finalName);
    setLastLoadedOrSavedGen(stats.generation);
    setIsSnapshotSaved(true);
    setTimeout(() => setIsSnapshotSaved(false), 2500);
  }, [snapshotName, stats.generation, handleSaveCurrentCheckpoint]);

  const isCustomInMemory = useMemo(() => {
    if (selectedBaselineId === 'current') return true;
    if (selectedBaselineId === 'preset-gen-0' && stats.generation === 0 && stats.gamesPlayed === 0) return false;
    if (selectedBaselineId === 'preset-heuristic-master') return false;
    const cp = checkpoints.find((c) => c.id === selectedBaselineId);
    if (cp && cp.generation === stats.generation) return false;
    return true;
  }, [selectedBaselineId, stats, checkpoints]);

  // Arena Actions
  const handleRunTournament = useCallback((cpA: Checkpoint, cpB: Checkpoint, games: number) => {
    setTournamentResult(null);
    if (tournamentZoomEnabled) {
      handleResetGame();
      currentZoomGameRef.current = 1;
      zoomQueueRef.current = [];
      pendingTournamentResultRef.current = null;
      setIsZoomingTournament(true);
    }
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'ARENA_RUN',
        checkpointA: cpA,
        checkpointB: cpB,
        numGames: games,
        streamMoves: tournamentZoomEnabled,
      });
    }
  }, [tournamentZoomEnabled, handleResetGame]);

  const handleExportJSON = useCallback(() => {
    const json = exportCheckpointsJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chessesque-intransitive-checkpoints-gen${stats.generation}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [stats.generation]);

  const handleImportJSON = useCallback((jsonStr: string) => {
    const ok = importCheckpointsJSON(jsonStr);
    if (ok) {
      setCheckpoints(getStoredCheckpoints());
    }
  }, []);

  const handleDeleteCheckpoint = useCallback((id: string) => {
    const ok = deleteCheckpoint(id);
    if (ok) {
      setCheckpoints(getStoredCheckpoints());
      if (fighterAId === id) setFighterAId('preset-heuristic-master');
      if (fighterBId === id) setFighterBId('preset-heuristic-master');
      if (evalModelId === id) setEvalModelId('preset-heuristic-master');
      if (selectedBaselineId === id) setSelectedBaselineId('preset-gen-0');
    }
  }, [fighterAId, fighterBId, evalModelId, selectedBaselineId]);

  const handleClearAllCheckpoints = useCallback(() => {
    const ok = clearAllUserCheckpoints();
    if (ok) {
      setCheckpoints(getStoredCheckpoints());
      setFighterAId('preset-heuristic-master');
      setFighterBId('preset-heuristic-master');
      setEvalModelId('preset-heuristic-master');
      setSelectedBaselineId('preset-gen-0');
    }
  }, []);

  const currentStatus = game.isTerminal();
  const evalScore = useMemo(() => {
    if (candidateMoves.length > 0) {
      return candidateMoves[0].score;
    }
    return evaluate(game, activeEvalModel.weights);
  }, [candidateMoves, game, activeEvalModel]);

  const isHumanTurn =
    activeTab === 'play' &&
    !currentStatus.isOver &&
    game.activePlayer === (humanColor === 'blue' ? PLAYER_BLUE : PLAYER_RED);

  return (
    <div className="intransitive-studio-root">
      {/* Studio Header Bar */}
      <div className="intransitive-studio-header">
        <div className="intransitive-brand-box">
          <div className="intransitive-brand-badge">
            <Swords size={22} />
          </div>
          <div className="intransitive-brand-info">
            <div className="intransitive-title-wrap">
              <h2 className="intransitive-main-title">
                Intransitive Studio
              </h2>
              <span className="intransitive-pill-tag">
                9x9 Cyclic RPS
              </span>
            </div>
            <p className="intransitive-main-subtitle">
              Reinforcement Learning Studio with Tabula Rasa self-play & real-time interpretability
            </p>
          </div>
        </div>

        {/* Tab List & Contextual Controls in Same Row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div className="intransitive-tab-list">
            <button
              type="button"
              onClick={() => {
                setActiveTab('arena');
                setIsPlayingLive(false);
              }}
              className={`intransitive-tab-button ${activeTab === 'arena' ? 'active' : ''}`}
            >
              <Swords size={14} color="#7c3aed" /> Visual Arena
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('turbo');
                setIsPlayingLive(false);
              }}
              className={`intransitive-tab-button ${activeTab === 'turbo' ? 'active' : ''}`}
            >
              <Zap size={14} color="#ea580c" /> Turbo Trainer
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('play');
                setIsPlayingLive(false);
              }}
              className={`intransitive-tab-button ${activeTab === 'play' ? 'active' : ''}`}
            >
              <Gamepad2 size={14} color="#059669" /> Human Play
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('settings');
                setIsPlayingLive(false);
              }}
              className={`intransitive-tab-button ${activeTab === 'settings' ? 'active' : ''}`}
            >
              <SettingsIcon size={14} color="#4f46e5" /> Settings
            </button>

            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Mute Audio' : 'Unmute Audio'}
              className="intransitive-mute-btn"
            >
              {soundEnabled ? <Volume2 size={16} color="#c2410c" /> : <VolumeX size={16} />}
            </button>
          </div>

          {/* Contextual Action Strip directly to the right of tabs */}
          {activeTab === 'play' && (
            <div className="intransitive-header-context-row">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span className="intransitive-strip-label">Opponent:</span>
                <select
                  value={selectedOpponentId}
                  onChange={(e) => setSelectedOpponentId(e.target.value)}
                  className="intransitive-dropdown mini"
                >
                  <option value="preset-heuristic-master">🏆 Heuristic Master (Boss)</option>
                  <option value="current">🤖 Current Model (Gen {stats.generation})</option>
                  <option value="preset-gen-0">👶 Gen 0 Tabula Rasa (Easy)</option>
                  {checkpoints
                    .filter((c) => !c.id.startsWith('preset-'))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        💾 {c.name} (Gen {c.generation})
                      </option>
                    ))}
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span className="intransitive-strip-label">Side:</span>
                <button
                  type="button"
                  onClick={() => setHumanColor('blue')}
                  className={`intransitive-mini-btn blue ${humanColor === 'blue' ? 'active' : ''}`}
                >
                  🔵 Blue
                </button>
                <button
                  type="button"
                  onClick={() => setHumanColor('red')}
                  className={`intransitive-mini-btn red ${humanColor === 'red' ? 'active' : ''}`}
                >
                  🔴 Red
                </button>
              </div>

              <button
                type="button"
                onClick={() => handleStartHumanGame(humanColor, selectedOpponentId)}
                className="intransitive-btn-primary mini"
              >
                <Play size={12} /> Start Game
              </button>
            </div>
          )}

          {activeTab === 'arena' && (
            <div className="intransitive-header-context-row">
              <span className="intransitive-strip-label">Fighters:</span>
              <select
                value={fighterAId}
                onChange={(e) => {
                  setFighterAId(e.target.value);
                  handleResetGame();
                }}
                className="intransitive-dropdown mini"
                title="Fighter A (Plays Blue)"
              >
                <option value="current">🤖 Current Model (Gen {stats.generation})</option>
                <option value="preset-heuristic-master">🏆 Heuristic Master</option>
                <option value="preset-gen-0">👶 Gen 0 Tabula Rasa</option>
                {checkpoints
                  .filter((c) => !c.id.startsWith('preset-'))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      💾 {c.name}
                    </option>
                  ))}
              </select>

              <span className="intransitive-strip-vs">vs</span>

              <select
                value={fighterBId}
                onChange={(e) => {
                  setFighterBId(e.target.value);
                  handleResetGame();
                }}
                className="intransitive-dropdown mini"
                title="Fighter B (Plays Red)"
              >
                <option value="preset-heuristic-master">🏆 Heuristic Master</option>
                <option value="current">🤖 Current Model (Gen {stats.generation})</option>
                <option value="preset-gen-0">👶 Gen 0 Tabula Rasa</option>
                {checkpoints
                  .filter((c) => !c.id.startsWith('preset-'))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      💾 {c.name}
                    </option>
                  ))}
              </select>

              <button
                type="button"
                onClick={handleResetGame}
                className="intransitive-btn-secondary mini"
                title="Reset Board"
              >
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          )}

          {activeTab === 'turbo' && (
            <div className="intransitive-header-context-row">
              <span className="intransitive-strip-label">Load Baseline:</span>
              <select
                value={selectedBaselineId}
                onChange={(e) => {
                  const id = e.target.value;
                  handleLoadBaseline(id);
                }}
                className="intransitive-dropdown mini"
              >
                <option value="preset-gen-0">👶 None / From Scratch (Tabula Rasa Gen 0)</option>
                <option value="preset-heuristic-master">🏆 Heuristic Master (Benchmark)</option>
                {checkpoints
                  .filter((c) => !c.id.startsWith('preset-'))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      💾 {c.name} (Gen {c.generation})
                    </option>
                  ))}
                {isCustomInMemory && (
                  <option value="current">🤖 Current In-Memory Weights (Gen {stats.generation})</option>
                )}
              </select>

              <div className="intransitive-header-save-group">
                <input
                  type="text"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="Gen X_MMDD_HHMMSS"
                  className="intransitive-header-snapshot-input"
                  title="Default checkpoint snapshot name. Edit as desired."
                />
                <button
                  type="button"
                  onClick={handleHeaderSaveSnapshot}
                  disabled={isTurboTraining || stats.generation === lastLoadedOrSavedGen}
                  className="intransitive-btn-secondary mini"
                  title={
                    stats.generation === lastLoadedOrSavedGen
                      ? 'Baseline just loaded or snapshot already saved for this generation'
                      : `Save Gen ${stats.generation} Snapshot`
                  }
                >
                  {isSnapshotSaved ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#059669' }}>
                      <Check size={12} /> Saved!
                    </span>
                  ) : (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <BookmarkPlus size={12} color="#d97706" /> Save Snapshot
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content: Settings, Turbo Trainer, or 2-column for Visual Arena & Human Play */}
      {activeTab === 'settings' ? (
        <StudioSettingsCard
          evalModelId={evalModelId}
          onChangeEvalModelId={setEvalModelId}
          checkpoints={checkpoints}
          currentGeneration={stats.generation}
          humanColor={humanColor}
          onChangeHumanColor={setHumanColor}
          selectedOpponentId={selectedOpponentId}
          onChangeOpponentId={setSelectedOpponentId}
          isAnalysisEnabled={isAnalysisEnabled}
          onToggleAnalysis={() => setIsAnalysisEnabled(!isAnalysisEnabled)}
          analysisMaxRows={analysisMaxRows}
          onChangeMaxRows={setAnalysisMaxRows}
          tournamentZoomEnabled={tournamentZoomEnabled}
          onToggleTournamentZoom={() => setTournamentZoomEnabled(!tournamentZoomEnabled)}
          delayMs={delayMs}
          onChangeDelayMs={setDelayMs}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
          onExportJSON={handleExportJSON}
          onImportJSON={handleImportJSON}
          onDeleteCheckpoint={handleDeleteCheckpoint}
          onClearAllCheckpoints={handleClearAllCheckpoints}
          onResetSettings={() => {
            localStorage.removeItem(SETTINGS_KEY);
            setEvalModelId('preset-heuristic-master');
            setHumanColor('blue');
            setSelectedOpponentId('preset-heuristic-master');
            setIsAnalysisEnabled(true);
            setAnalysisMaxRows(3);
            setTournamentZoomEnabled(true);
            setSoundEnabled(true);
            setDelayMs(300);
            setFighterAId('current');
            setFighterBId('preset-heuristic-master');
          }}
        />
      ) : activeTab === 'turbo' ? (
        <div className="intransitive-turbo-layout">
          <TurboTrainerCard
            isTraining={isTurboTraining}
            progress={turboProgress}
            stats={stats}
            onStartTurbo={handleStartTurbo}
            onStopTurbo={handleStopTurbo}
            onResetTraining={handleResetTraining}
          />

          <InterpretabilityCard
            weights={weights}
            history={stats.history}
          />
        </div>
      ) : (
        <div className="intransitive-two-col">
          {/* Left Column: 9x9 Board & Mode-Appropriate Controls */}
          <div className="intransitive-col-board">
            {/* Status & Eval Banner */}
            <div className="intransitive-status-card">
              <div className="intransitive-turn-info">
                <span
                  className={`intransitive-turn-circle ${
                    game.activePlayer === PLAYER_BLUE ? 'blue' : 'red'
                  }`}
                />
                <span className="intransitive-turn-text">
                  {currentStatus.isOver
                    ? currentStatus.winner === 'draw'
                      ? 'Game Drawn'
                      : `${currentStatus.winner === PLAYER_BLUE ? 'Blue' : 'Red'} Wins by ${currentStatus.reason}!`
                    : activeTab === 'play'
                    ? isHumanTurn
                      ? `Your Turn (${humanColor === 'blue' ? 'Blue' : 'Red'})`
                      : `Computer is thinking...`
                    : `${game.activePlayer === PLAYER_BLUE ? 'Blue' : 'Red'} to move (Ply ${game.halfmoveClock + 1})`}
                </span>
              </div>

              <div
                className="intransitive-eval-display"
                title={`Evaluated by ${activeEvalModel.name} (${activeEvalModel.gamesPlayed.toLocaleString()} games experience). Configured in Settings tab.`}
                style={{ cursor: 'help' }}
              >
                <span style={{ color: '#8c827a' }}>Eval:</span>
                <span
                  style={{
                    color:
                      Math.abs(evalScore) >= 9900
                        ? evalScore > 0
                          ? '#059669'
                          : '#dc2626'
                        : evalScore > 50
                        ? '#2563eb'
                        : evalScore < -50
                        ? '#dc2626'
                        : '#4a4239',
                    fontWeight: Math.abs(evalScore) >= 9900 ? 800 : 700,
                  }}
                >
                  {formatEvalScore(evalScore)}
                </span>
                <span style={{ fontSize: '0.65rem', color: '#8c827a', marginLeft: '0.2rem' }}>
                  ({activeEvalModel.displayName})
                </span>
              </div>
            </div>

            {/* Interactive 9x9 Board with Candidate Arrows (in Human Play) */}
            <IntransitiveBoard
              game={game}
              selectedSquare={selectedSquare}
              onSelectSquare={setSelectedSquare}
              onMakeMove={handleHumanMove}
              lastMove={lastMove}
              isInteractive={isHumanTurn}
              flipped={isBoardFlipped}
              arrows={activeTab === 'play' && isAnalysisEnabled ? candidateMoves : []}
            />

            {/* Bottom Controls: LiveControls for Visual Arena, Human Controls Bar for Human Play */}
            {activeTab === 'arena' ? (
              <LiveControls
                isPlaying={isPlayingLive}
                onTogglePlay={() => {
                  if (currentStatus.isOver) handleResetGame();
                  setIsPlayingLive(!isPlayingLive);
                }}
                onStepForward={handleStepForward}
                onStepBackward={handleStepBackward}
                onReset={handleResetGame}
                canStepBack={historyIndex >= 0}
                canStepForward={!currentStatus.isOver || historyIndex < moveHistory.length - 1}
                delayMs={delayMs}
                onChangeDelay={setDelayMs}
              />
            ) : (
              /* Human Play Controls Toolbar */
              <div className="intransitive-human-bar">
                <button
                  type="button"
                  onClick={() => handleStartHumanGame(humanColor, selectedOpponentId)}
                  className="intransitive-btn-secondary"
                  style={{ padding: '0.45rem 0.8rem', fontSize: '0.75rem' }}
                >
                  <RotateCcw size={14} /> New Game
                </button>

                <button
                  type="button"
                  onClick={handleUndoHumanMove}
                  disabled={historyIndex < 0}
                  className="intransitive-btn-secondary"
                  style={{ padding: '0.45rem 0.8rem', fontSize: '0.75rem' }}
                  title="Undo previous human and AI move"
                >
                  <Undo2 size={14} /> Undo Move
                </button>

                <button
                  type="button"
                  onClick={() => setIsBoardFlipped(!isBoardFlipped)}
                  className="intransitive-btn-secondary"
                  style={{ padding: '0.45rem 0.8rem', fontSize: '0.75rem' }}
                  title="Flip board view"
                >
                  <ArrowUpDown size={14} /> Flip Board
                </button>
              </div>
            )}

            {/* Win Condition Callout Modal if Game Ends */}
            {currentStatus.isOver && (
              <div className="intransitive-victory-banner">
                <div className="intransitive-victory-content">
                  <Trophy size={20} color="#ea580c" />
                  <div>
                    <h4 className="intransitive-victory-title">
                      {currentStatus.winner === 'draw'
                        ? 'Game Concluded in a Draw'
                        : `${currentStatus.winner === PLAYER_BLUE ? 'Blue' : 'Red'} Victory!`}
                    </h4>
                    <p className="intransitive-victory-sub" style={{ textTransform: 'capitalize' }}>
                      Condition: {currentStatus.reason}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleResetGame}
                  className="intransitive-btn-primary"
                  style={{ padding: '0.45rem 0.9rem' }}
                >
                  Play Again
                </button>
              </div>
            )}
          </div>

          {/* Right Column: Cards according to Tab Mode */}
          <div className="intransitive-col-cards">
            {/* Visual Arena Card */}
            {activeTab === 'arena' && (
              <>
                <ArenaCard
                  checkpoints={checkpoints}
                  currentGeneration={stats.generation}
                  fighterAId={fighterAId}
                  fighterBId={fighterBId}
                  onChangeFighterA={(id: string) => {
                    setFighterAId(id);
                    handleResetGame();
                  }}
                  onChangeFighterB={(id: string) => {
                    setFighterBId(id);
                    handleResetGame();
                  }}
                  onRunTournament={handleRunTournament}
                  onExportJSON={handleExportJSON}
                  onImportJSON={handleImportJSON}
                  tournamentResult={tournamentResult}
                  isSimulating={isZoomingTournament}
                  isZoomEnabled={tournamentZoomEnabled}
                  onToggleZoom={() => setTournamentZoomEnabled(!tournamentZoomEnabled)}
                />

                <MoveListSection
                  moves={moveHistory}
                  currentIndex={historyIndex}
                  onSelectIndex={handleSelectHistoryIndex}
                />
              </>
            )}

            {/* Human Play Mode */}
            {activeTab === 'play' && (
              <>
                <HumanAnalysisPanel
                  isEnabled={isAnalysisEnabled}
                  onToggleEnabled={() => setIsAnalysisEnabled(!isAnalysisEnabled)}
                  selectedModelName={activeEvalModel.name}
                  maxRows={analysisMaxRows}
                  onChangeMaxRows={setAnalysisMaxRows}
                  candidateMoves={candidateMoves}
                  onApplyMove={handleHumanMove}
                  isHumanTurn={isHumanTurn}
                />

                <MoveListSection
                  moves={moveHistory}
                  currentIndex={historyIndex}
                  onSelectIndex={handleSelectHistoryIndex}
                />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
