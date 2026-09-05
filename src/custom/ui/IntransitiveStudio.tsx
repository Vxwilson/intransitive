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
  Edit3,
  Activity,
  Target,
  Clock,
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
  AnalysisTelemetry,
} from '../engine/types';
import {
  getStoredCheckpoints,
  saveCheckpoint,
  renameCheckpoint,
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
import { ArenaRealtimeResultsCard } from './ArenaRealtimeResultsCard';
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
  analysisTargetDepth?: number;
  tournamentZoomEnabled?: boolean;
  arenaSearchDepth?: number;
  fighterADepth?: number;
  fighterBDepth?: number;
  fighterAMode?: 'depth' | 'time';
  fighterBMode?: 'depth' | 'time';
  fighterATimeSec?: number;
  fighterBTimeSec?: number;
  playOpponentMode?: 'depth' | 'time';
  playOpponentDepth?: number;
  playOpponentTimeSec?: number;
  trainingSearchDepth?: number;
  learningRateAnnealing?: boolean;
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
    avgGameLength?: number;
    accuracyA?: number;
    accuracyB?: number;
    depthA?: number;
    depthB?: number;
    thinkTimeSecA?: number;
    thinkTimeSecB?: number;
    isCancelled?: boolean;
  } | null>(null);

  // Visual Arena Fighters Selection
  const [fighterAId, setFighterAId] = useState<string>(initialSettings.fighterAId ?? 'current');
  const [fighterBId, setFighterBId] = useState<string>(initialSettings.fighterBId ?? 'preset-heuristic-master');
  const [tournamentZoomEnabled, setTournamentZoomEnabled] = useState<boolean>(
    initialSettings.tournamentZoomEnabled ?? true
  );
  const [arenaSearchDepth, setArenaSearchDepth] = useState<number>(
    initialSettings.arenaSearchDepth ?? 2
  );
  const [fighterADepth, setFighterADepth] = useState<number>(
    initialSettings.fighterADepth ?? initialSettings.arenaSearchDepth ?? 2
  );
  const [fighterBDepth, setFighterBDepth] = useState<number>(
    initialSettings.fighterBDepth ?? initialSettings.arenaSearchDepth ?? 2
  );
  const [fighterAMode, setFighterAMode] = useState<'depth' | 'time'>(
    initialSettings.fighterAMode ?? 'depth'
  );
  const [fighterBMode, setFighterBMode] = useState<'depth' | 'time'>(
    initialSettings.fighterBMode ?? 'depth'
  );
  const [fighterATimeSec, setFighterATimeSec] = useState<number>(
    initialSettings.fighterATimeSec ?? 1.0
  );
  const [fighterBTimeSec, setFighterBTimeSec] = useState<number>(
    initialSettings.fighterBTimeSec ?? 1.0
  );
  const [isTournamentPaused, setIsTournamentPaused] = useState<boolean>(false);
  const [trainingSearchDepth, setTrainingSearchDepth] = useState<number>(
    initialSettings.trainingSearchDepth ?? 1
  );
  const [learningRateAnnealing, setLearningRateAnnealing] = useState<boolean>(
    initialSettings.learningRateAnnealing ?? true
  );

  // Human Play Settings
  const [selectedOpponentId, setSelectedOpponentId] = useState<string>(
    initialSettings.selectedOpponentId ?? 'preset-heuristic-master'
  );
  const [playOpponentMode, setPlayOpponentMode] = useState<'depth' | 'time'>(
    initialSettings.playOpponentMode ?? 'depth'
  );
  const [playOpponentDepth, setPlayOpponentDepth] = useState<number>(
    initialSettings.playOpponentDepth ?? 2
  );
  const [playOpponentTimeSec, setPlayOpponentTimeSec] = useState<number>(
    initialSettings.playOpponentTimeSec ?? 1.0
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
  const [analysisTargetDepth, setAnalysisTargetDepth] = useState<number>(
    initialSettings.analysisTargetDepth ?? 4
  );
  const [analysisTelemetry, setAnalysisTelemetry] = useState<AnalysisTelemetry | null>(null);

  const handleTargetDepthChange = useCallback((depth: number) => {
    setAnalysisTargetDepth(depth);
  }, []);

  // Turbo Trainer Baseline & Snapshot State
  const [selectedBaselineId, setSelectedBaselineId] = useState<string>('preset-gen-0');
  const [snapshotName, setSnapshotName] = useState<string>(() => getDefaultCheckpointName(stats.generation));
  const [lastLoadedOrSavedGen, setLastLoadedOrSavedGen] = useState<number>(stats.generation);
  const [isSnapshotSaved, setIsSnapshotSaved] = useState<boolean>(false);

  // Tournament Live Board Zoom Queue & Refs
  const zoomQueueRef = useRef<{
    move: Move;
    san: string;
    fen: string;
    isOver: boolean;
    gameIndex?: number;
    totalGames?: number;
    currentWinsA?: number;
    currentWinsB?: number;
    currentDraws?: number;
  }[]>([]);
  const pendingTournamentResultRef = useRef<any>(null);
  const [isZoomingTournament, setIsZoomingTournament] = useState<boolean>(false);
  const currentZoomGameRef = useRef<number>(1);
  const [arenaLiveResults, setArenaLiveResults] = useState<{
    gameIndex: number;
    totalGames: number;
    winsA: number;
    winsB: number;
    draws: number;
    isSimulating: boolean;
  } | null>(null);
  const [arenaViewMode, setArenaViewMode] = useState<'realtime' | 'notation'>('realtime');

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

  // Worker references (training/gameplay worker + dedicated analysis worker)
  const workerRef = useRef<Worker | null>(null);
  const analysisWorkerRef = useRef<Worker | null>(null);
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

  const currentStatus = game.isTerminal();
  const isHumanTurn =
    activeTab === 'play' &&
    !currentStatus.isOver &&
    game.activePlayer === (humanColor === 'blue' ? PLAYER_BLUE : PLAYER_RED);

  // Synchronous candidate moves (instant baseline at Depth 1 for <1ms latency)
  const syncCandidateMoves = useMemo(() => {
    if (!isHumanTurn || !isAnalysisEnabled) return [];
    return getTopMoves(game, activeEvalModel.weights, 5, Math.min(1, analysisTargetDepth));
  }, [isHumanTurn, isAnalysisEnabled, game, activeEvalModel, analysisTargetDepth]);

  // Combined candidate moves: prefer deeper worker iterative results matching current position
  const candidateMoves = useMemo(() => {
    if (!isHumanTurn || !isAnalysisEnabled) return [];
    const currentFen = game.toFEN();
    if (
      analysisTelemetry &&
      analysisTelemetry.currentFen === currentFen &&
      analysisTelemetry.candidateMoves.length > 0
    ) {
      return analysisTelemetry.candidateMoves;
    }
    return syncCandidateMoves;
  }, [isHumanTurn, isAnalysisEnabled, game, analysisTelemetry, syncCandidateMoves]);

  // Derived real-time telemetry: reflects worker progress or instantaneous depth-1 baseline
  const displayedTelemetry = useMemo((): AnalysisTelemetry | null => {
    if (activeTab !== 'play' || !isAnalysisEnabled || game.isTerminal().isOver) return null;
    const currentFen = game.toFEN();
    if (analysisTelemetry && analysisTelemetry.currentFen === currentFen) {
      return analysisTelemetry;
    }
    return {
      depth: 1,
      maxDepth: analysisTargetDepth,
      nodes: 0,
      nps: 0,
      timeMs: 0,
      candidateMoves: syncCandidateMoves,
      isSearching: isHumanTurn,
      currentFen,
    };
  }, [activeTab, isAnalysisEnabled, game, analysisTelemetry, analysisTargetDepth, syncCandidateMoves, isHumanTurn]);

  // Background iterative deepening engine analysis trigger (only active during human's turn)
  useEffect(() => {
    if (activeTab !== 'play' || !isAnalysisEnabled || game.isTerminal().isOver || !isHumanTurn) {
      if (analysisWorkerRef.current) {
        analysisWorkerRef.current.terminate();
        analysisWorkerRef.current = null;
      }
      return;
    }

    // Terminate any previous analysis worker so stale searches are killed immediately with 0 latency
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate();
      analysisWorkerRef.current = null;
    }

    const currentFen = game.toFEN();
    const worker = new Worker(
      new URL('../engine/analysisWorker.ts', import.meta.url),
      { type: 'module' }
    );
    analysisWorkerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const data = event.data;
      if (data.type === 'ANALYSIS_PROGRESS') {
        setAnalysisTelemetry({
          depth: data.depth,
          maxDepth: data.maxDepth,
          nodes: data.nodes,
          nps: data.nps,
          timeMs: data.timeMs,
          candidateMoves: data.candidateMoves,
          isSearching: true,
          currentFen: data.currentFen,
        });
      } else if (data.type === 'ANALYSIS_COMPLETE') {
        setAnalysisTelemetry({
          depth: data.depth,
          maxDepth: data.maxDepth,
          nodes: data.nodes,
          nps: data.nps,
          timeMs: data.timeMs,
          candidateMoves: data.candidateMoves,
          isSearching: false,
          currentFen: data.currentFen,
        });
      }
    };

    worker.postMessage({
      type: 'START_ANALYSIS',
      currentFen,
      weights: activeEvalModel.weights,
      maxDepth: analysisTargetDepth,
      count: 5,
    });

    return () => {
      worker.terminate();
      if (analysisWorkerRef.current === worker) {
        analysisWorkerRef.current = null;
      }
    };
  }, [game, activeTab, isAnalysisEnabled, isHumanTurn, activeEvalModel, analysisTargetDepth]);

  // Persist settings on change
  useEffect(() => {
    saveSettingsToStorage({
      evalModelId,
      humanColor,
      selectedOpponentId,
      playOpponentMode,
      playOpponentDepth,
      playOpponentTimeSec,
      isAnalysisEnabled,
      analysisMaxRows,
      analysisTargetDepth,
      tournamentZoomEnabled,
      arenaSearchDepth,
      fighterADepth,
      fighterBDepth,
      fighterAMode,
      fighterBMode,
      fighterATimeSec,
      fighterBTimeSec,
      trainingSearchDepth,
      learningRateAnnealing,
      soundEnabled,
      delayMs,
      fighterAId,
      fighterBId,
    });
  }, [
    evalModelId,
    humanColor,
    selectedOpponentId,
    playOpponentMode,
    playOpponentDepth,
    playOpponentTimeSec,
    isAnalysisEnabled,
    analysisMaxRows,
    analysisTargetDepth,
    tournamentZoomEnabled,
    arenaSearchDepth,
    fighterADepth,
    fighterBDepth,
    fighterAMode,
    fighterBMode,
    fighterATimeSec,
    fighterBTimeSec,
    trainingSearchDepth,
    learningRateAnnealing,
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

          const nextGame = new IntransitiveGame(data.fenAfter);
          setGame(nextGame);
          setLastMove(data.move);
          setSelectedSquare(null);
          setMoveHistory((prev) => [
            ...prev,
            { move: data.move, san: data.san, fen: data.fenAfter },
          ]);
          setHistoryIndex((prev) => prev + 1);
          setAnalysisTelemetry(null);

          // Audio cues
          if (soundEnabledRef.current) {
            if (data.move.captured) {
              sounds.playCapture();
            } else {
              sounds.playMove();
            }
          }

          if (data.isOver) {
            setIsPlayingLive(false);
            if (soundEnabledRef.current) sounds.playVictory();
          }
          break;
        }

        case 'ARENA_STREAM_MOVE': {
          zoomQueueRef.current.push(data);
          // If zoom is disabled, update arenaLiveResults directly
          if (!tournamentZoomEnabledRef.current && (data.currentWinsA !== undefined || data.totalGames !== undefined)) {
            setArenaLiveResults({
              gameIndex: data.gameIndex ?? 1,
              totalGames: data.totalGames ?? 20,
              winsA: data.currentWinsA ?? 0,
              winsB: data.currentWinsB ?? 0,
              draws: data.currentDraws ?? 0,
              isSimulating: true,
            });
          }
          break;
        }

        case 'ARENA_RESULT': {
          setIsTournamentPaused(false);
          if (data.isCancelled) {
            // Early stop: drain queue immediately and display partial results
            zoomQueueRef.current = [];
            pendingTournamentResultRef.current = null;
            setIsZoomingTournament(false);
            setTournamentResult(data);
            setArenaLiveResults((prev) =>
              prev
                ? {
                    ...prev,
                    winsA: data.winsA,
                    winsB: data.winsB,
                    draws: data.draws,
                    gameIndex: data.gamesPlayed,
                    isSimulating: false,
                  }
                : null
            );
            if (soundEnabledRef.current) sounds.playCapture();
          } else if (tournamentZoomEnabledRef.current && isZoomingTournamentRef.current) {
            pendingTournamentResultRef.current = data;
          } else {
            setTournamentResult(data);
            setArenaLiveResults((prev) =>
              prev
                ? {
                    ...prev,
                    winsA: data.winsA,
                    winsB: data.winsB,
                    draws: data.draws,
                    gameIndex: data.gamesPlayed,
                    isSimulating: false,
                  }
                : null
            );
            setIsZoomingTournament(false);
            if (soundEnabledRef.current) sounds.playVictory();
          }
          break;
        }

        case 'ANALYSIS_PROGRESS': {
          setAnalysisTelemetry({
            depth: data.depth,
            maxDepth: data.maxDepth,
            nodes: data.nodes,
            nps: data.nps,
            timeMs: data.timeMs,
            candidateMoves: data.candidateMoves,
            isSearching: true,
            currentFen: data.currentFen,
          });
          break;
        }

        case 'ANALYSIS_COMPLETE': {
          setAnalysisTelemetry({
            depth: data.depth,
            maxDepth: data.maxDepth,
            nodes: data.nodes,
            nps: data.nps,
            timeMs: data.timeMs,
            candidateMoves: data.candidateMoves,
            isSearching: false,
            currentFen: data.currentFen,
          });
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
    if (!isZoomingTournament || isTournamentPaused) return;

    const timer = setInterval(() => {
      const qLen = zoomQueueRef.current.length;
      const batchSize = qLen > 300 ? 3 : qLen > 100 ? 2 : 1;

      let lastNext: {
        move: Move;
        san: string;
        fen: string;
        isOver: boolean;
        gameIndex?: number;
        totalGames?: number;
        currentWinsA?: number;
        currentWinsB?: number;
        currentDraws?: number;
      } | null = null;
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

        if (lastNext.currentWinsA !== undefined || lastNext.totalGames !== undefined) {
          setArenaLiveResults({
            gameIndex: lastNext.gameIndex ?? 1,
            totalGames: lastNext.totalGames ?? 20,
            winsA: lastNext.currentWinsA ?? 0,
            winsB: lastNext.currentWinsB ?? 0,
            draws: lastNext.currentDraws ?? 0,
            isSimulating: true,
          });
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
        const finalResult = pendingTournamentResultRef.current;
        pendingTournamentResultRef.current = null;
        setTournamentResult(finalResult);
        setArenaLiveResults((prev) =>
          prev
            ? {
                ...prev,
                winsA: finalResult.winsA,
                winsB: finalResult.winsB,
                draws: finalResult.draws,
                gameIndex: finalResult.gamesPlayed,
                isSimulating: false,
              }
            : {
                gameIndex: finalResult.gamesPlayed,
                totalGames: finalResult.gamesPlayed,
                winsA: finalResult.winsA,
                winsB: finalResult.winsB,
                draws: finalResult.draws,
                isSimulating: false,
              }
        );
        setIsZoomingTournament(false);
        if (soundEnabledRef.current) sounds.playVictory();
      }
    }, 6);

    return () => clearInterval(timer);
  }, [isZoomingTournament, isTournamentPaused]);

  // Visual Arena Live playback loop: alternates between Fighter A (Blue) and Fighter B (Red)
  useEffect(() => {
    if (!isPlayingLive || activeTab !== 'arena' || game.isTerminal().isOver) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    timerRef.current = setTimeout(() => {
      if (workerRef.current && isPlayingLive) {
        // In Visual Arena, Blue moves using Fighter A, Red moves using Fighter B
        const isBlue = game.activePlayer === PLAYER_BLUE;
        const activeFighterId = isBlue ? fighterAId : fighterBId;
        const activeDepth = isBlue ? fighterADepth : fighterBDepth;
        const fighterWeights = getWeightsById(activeFighterId);
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: game.toFEN(),
          searchDepth: activeDepth,
          customWeights: fighterWeights,
        });
      }
    }, delayMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlayingLive, activeTab, game, delayMs, fighterAId, fighterBId, fighterADepth, fighterBDepth, getWeightsById]);

  const handleResetGame = useCallback(() => {
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate();
      analysisWorkerRef.current = null;
    }
    setAnalysisTelemetry(null);
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
        const isBlue = game.activePlayer === PLAYER_BLUE;
        const activeFighterId = isBlue ? fighterAId : fighterBId;
        const activeDepth = isBlue ? fighterADepth : fighterBDepth;
        const watchWeights = getWeightsById(activeFighterId);
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: game.toFEN(),
          searchDepth: activeDepth,
          customWeights: watchWeights,
        });
      }
    }
  }, [historyIndex, moveHistory, game, fighterAId, fighterBId, fighterADepth, fighterBDepth, getWeightsById]);

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
    setSelectedSquare(null);
    setMoveHistory((prev) => [...prev, { move, san, fen: fenAfter }]);
    setHistoryIndex((prev) => prev + 1);
    setAnalysisTelemetry(null);

    // Cancel and immediately terminate any running background analysis worker with 0 latency
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate();
      analysisWorkerRef.current = null;
    }

    // Trigger AI response using selected opponent's weights and configured depth/thinkTime
    if (activeTab === 'play' && !nextGame.isTerminal().isOver) {
      const opponentWeights = getWeightsById(selectedOpponentId);
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: fenAfter,
          searchDepth: playOpponentMode === 'depth' ? playOpponentDepth : undefined,
          thinkTimeSec: playOpponentMode === 'time' ? playOpponentTimeSec : undefined,
          customWeights: opponentWeights,
        });
      }
    }
  }, [game, soundEnabled, activeTab, selectedOpponentId, playOpponentMode, playOpponentDepth, playOpponentTimeSec, getWeightsById]);

  // Start a fresh Human Game
  const handleStartHumanGame = useCallback((color: 'blue' | 'red', opponentId: string) => {
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate();
      analysisWorkerRef.current = null;
    }
    setAnalysisTelemetry(null);
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
      if (workerRef.current) {
        const opponentWeights = getWeightsById(opponentId);
        workerRef.current.postMessage({
          type: 'STEP_LIVE',
          currentFen: freshGame.toFEN(),
          searchDepth: playOpponentMode === 'depth' ? playOpponentDepth : undefined,
          thinkTimeSec: playOpponentMode === 'time' ? playOpponentTimeSec : undefined,
          customWeights: opponentWeights,
        });
      }
    } else {
      setIsBoardFlipped(false);
    }
  }, [playOpponentMode, playOpponentDepth, playOpponentTimeSec, getWeightsById]);

  // Undo in Human Play (steps back 2 plies to human's turn)
  const handleUndoHumanMove = useCallback(() => {
    if (analysisWorkerRef.current) {
      analysisWorkerRef.current.terminate();
      analysisWorkerRef.current = null;
    }
    setAnalysisTelemetry(null);
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
        config: {
          searchDepth: trainingSearchDepth,
          learningRateAnnealing,
        },
      });
    }
  }, [trainingSearchDepth, learningRateAnnealing]);

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
  const handleRunTournament = useCallback((
    cpA: Checkpoint,
    cpB: Checkpoint,
    games: number,
    depthA: number = fighterADepth,
    depthB: number = fighterBDepth,
    thinkTimeSecA?: number,
    thinkTimeSecB?: number
  ) => {
    setTournamentResult(null);
    setIsTournamentPaused(false);
    setArenaLiveResults({
      gameIndex: 1,
      totalGames: games,
      winsA: 0,
      winsB: 0,
      draws: 0,
      isSimulating: true,
    });
    setArenaViewMode('realtime');
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
        searchDepthA: depthA,
        searchDepthB: depthB,
        thinkTimeSecA,
        thinkTimeSecB,
        streamMoves: tournamentZoomEnabled,
      });
    }
  }, [tournamentZoomEnabled, fighterADepth, fighterBDepth, handleResetGame]);

  const handlePauseTournament = useCallback(() => {
    setIsTournamentPaused(true);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'ARENA_PAUSE' });
    }
  }, []);

  const handleResumeTournament = useCallback(() => {
    setIsTournamentPaused(false);
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'ARENA_RESUME' });
    }
  }, []);

  const handleStopTournament = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'ARENA_STOP' });
    }
  }, []);

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

  const handleRenameCheckpoint = useCallback((id: string, newName: string) => {
    const ok = renameCheckpoint(id, newName);
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

  const evalScore = useMemo(() => {
    if (candidateMoves.length > 0) {
      return candidateMoves[0].score;
    }
    return evaluate(game, activeEvalModel.weights);
  }, [candidateMoves, game, activeEvalModel]);

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

              {/* Opponent Engine Search Mode: Mutually Exclusive [ Depth | Time ] */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <div className="intransitive-segmented-switch">
                  <button
                    type="button"
                    onClick={() => setPlayOpponentMode('depth')}
                    className={`intransitive-segmented-btn ${playOpponentMode === 'depth' ? 'active' : ''}`}
                    title="Fixed search depth (D1-D6)"
                  >
                    <Target size={11} /> Depth
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlayOpponentMode('time')}
                    className={`intransitive-segmented-btn ${playOpponentMode === 'time' ? 'active' : ''}`}
                    title="Allotted thinking time per move"
                  >
                    <Clock size={11} /> Time
                  </button>
                </div>

                {playOpponentMode === 'depth' ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <input
                      type="range"
                      min="1"
                      max="6"
                      step="1"
                      value={playOpponentDepth}
                      onChange={(e) => setPlayOpponentDepth(parseInt(e.target.value, 10))}
                      className="intransitive-range-slider"
                      style={{ width: '80px' }}
                      title={`Opponent search depth: D${playOpponentDepth}`}
                    />
                    <span
                      style={{
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        fontFamily: "'JetBrains Mono', monospace",
                        color: '#ea580c',
                        background: '#fff7ed',
                        padding: '0.1rem 0.35rem',
                        borderRadius: '4px',
                        border: '1px solid #fed7aa',
                        minWidth: '26px',
                        textAlign: 'center',
                      }}
                      title={`Depth ${playOpponentDepth}`}
                    >
                      D{playOpponentDepth}
                    </span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                    <input
                      type="number"
                      min="0.1"
                      max="30"
                      step="0.5"
                      value={playOpponentTimeSec}
                      onChange={(e) => setPlayOpponentTimeSec(Math.max(0.1, parseFloat(e.target.value) || 0.1))}
                      className="intransitive-input-number warm"
                      style={{ width: '52px', padding: '0.15rem 0.35rem', fontSize: '0.72rem' }}
                      title="Opponent thinking time per move (seconds)"
                    />
                    <span style={{ fontSize: '0.7rem', color: '#6b635b' }}>s</span>
                    <div className="intransitive-mini-btn-group">
                      {[0.5, 1.0, 2.0].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPlayOpponentTimeSec(s)}
                          className={`intransitive-mini-btn ${playOpponentTimeSec === s ? 'active' : ''}`}
                          style={{ padding: '0.15rem 0.35rem', fontSize: '0.65rem' }}
                        >
                          {s}s
                        </button>
                      ))}
                    </div>
                  </div>
                )}
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

              {checkpoints.some((c) => c.id === selectedBaselineId && !c.id.startsWith('preset-')) && (
                <button
                  type="button"
                  onClick={() => {
                    const activeCp = checkpoints.find((c) => c.id === selectedBaselineId);
                    if (activeCp) {
                      const newName = window.prompt(`Rename model "${activeCp.name}":`, activeCp.name);
                      if (newName && newName.trim()) {
                        handleRenameCheckpoint(activeCp.id, newName.trim());
                      }
                    }
                  }}
                  className="intransitive-icon-btn"
                  style={{ width: '22px', height: '22px', color: '#4f46e5' }}
                  title="Rename selected baseline model"
                >
                  <Edit3 size={12} />
                </button>
              )}

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
          searchDepth={arenaSearchDepth}
          onChangeSearchDepth={setArenaSearchDepth}
          trainingSearchDepth={trainingSearchDepth}
          onChangeTrainingSearchDepth={setTrainingSearchDepth}
          learningRateAnnealing={learningRateAnnealing}
          onToggleAnnealing={() => setLearningRateAnnealing(!learningRateAnnealing)}
          delayMs={delayMs}
          onChangeDelayMs={setDelayMs}
          soundEnabled={soundEnabled}
          onToggleSound={() => setSoundEnabled(!soundEnabled)}
          onExportJSON={handleExportJSON}
          onImportJSON={handleImportJSON}
          onDeleteCheckpoint={handleDeleteCheckpoint}
          onRenameCheckpoint={handleRenameCheckpoint}
          onClearAllCheckpoints={handleClearAllCheckpoints}
          onResetSettings={() => {
            localStorage.removeItem(SETTINGS_KEY);
            setEvalModelId('preset-heuristic-master');
            setHumanColor('blue');
            setSelectedOpponentId('preset-heuristic-master');
            setIsAnalysisEnabled(true);
            setAnalysisMaxRows(3);
            setTournamentZoomEnabled(true);
            setArenaSearchDepth(2);
            setFighterADepth(2);
            setFighterBDepth(2);
            setFighterAMode('depth');
            setFighterBMode('depth');
            setFighterATimeSec(1.0);
            setFighterBTimeSec(1.0);
            setPlayOpponentMode('depth');
            setPlayOpponentDepth(2);
            setPlayOpponentTimeSec(1.0);
            setTrainingSearchDepth(1);
            setLearningRateAnnealing(true);
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
            trainingSearchDepth={trainingSearchDepth}
            onChangeTrainingSearchDepth={setTrainingSearchDepth}
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
                      : playOpponentMode === 'time'
                      ? `Computer is thinking (${playOpponentTimeSec}s)...`
                      : `Computer is thinking (Depth ${playOpponentDepth})...`
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
              arrows={activeTab === 'play' && isAnalysisEnabled ? candidateMoves.slice(0, analysisMaxRows) : []}
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
                  fighterADepth={fighterADepth}
                  fighterBDepth={fighterBDepth}
                  onChangeFighterADepth={setFighterADepth}
                  onChangeFighterBDepth={setFighterBDepth}
                  fighterAMode={fighterAMode}
                  fighterBMode={fighterBMode}
                  onChangeFighterAMode={setFighterAMode}
                  onChangeFighterBMode={setFighterBMode}
                  fighterATimeSec={fighterATimeSec}
                  fighterBTimeSec={fighterBTimeSec}
                  onChangeFighterATimeSec={setFighterATimeSec}
                  onChangeFighterBTimeSec={setFighterBTimeSec}
                  isPaused={isTournamentPaused}
                  onPauseTournament={handlePauseTournament}
                  onResumeTournament={handleResumeTournament}
                  onStopTournament={handleStopTournament}
                  onExportJSON={handleExportJSON}
                  onImportJSON={handleImportJSON}
                  tournamentResult={tournamentResult}
                  isSimulating={isZoomingTournament || Boolean(arenaLiveResults?.isSimulating)}
                  isZoomEnabled={tournamentZoomEnabled}
                  onToggleZoom={() => setTournamentZoomEnabled(!tournamentZoomEnabled)}
                />

                {(isZoomingTournament || arenaLiveResults?.isSimulating || (arenaLiveResults && arenaViewMode === 'realtime')) && arenaViewMode === 'realtime' ? (
                  <ArenaRealtimeResultsCard
                    isSimulating={Boolean(isZoomingTournament || arenaLiveResults?.isSimulating)}
                    isPaused={isTournamentPaused}
                    onPause={handlePauseTournament}
                    onResume={handleResumeTournament}
                    onStop={handleStopTournament}
                    gameIndex={arenaLiveResults?.gameIndex ?? 1}
                    totalGames={arenaLiveResults?.totalGames ?? 20}
                    winsA={arenaLiveResults?.winsA ?? 0}
                    winsB={arenaLiveResults?.winsB ?? 0}
                    draws={arenaLiveResults?.draws ?? 0}
                    fighterAName={checkpoints.find((c) => c.id === fighterAId)?.name || 'Fighter A'}
                    fighterBName={checkpoints.find((c) => c.id === fighterBId)?.name || 'Fighter B'}
                    fighterADepth={fighterADepth}
                    fighterBDepth={fighterBDepth}
                    fighterAMode={fighterAMode}
                    fighterBMode={fighterBMode}
                    fighterATimeSec={fighterATimeSec}
                    fighterBTimeSec={fighterBTimeSec}
                    currentPly={moveHistory.length}
                    lastSan={lastMove ? game.formatMoveSAN(lastMove) : ''}
                    onToggleView={() => setArenaViewMode('notation')}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    {arenaLiveResults && (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setArenaViewMode('realtime')}
                          className="intransitive-mini-btn"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.3rem',
                            fontSize: '0.69rem',
                            padding: '0.2rem 0.55rem',
                          }}
                        >
                          <Activity size={12} color="#ea580c" /> Show Real-time Results
                        </button>
                      </div>
                    )}
                    <MoveListSection
                      moves={moveHistory}
                      currentIndex={historyIndex}
                      onSelectIndex={handleSelectHistoryIndex}
                    />
                  </div>
                )}
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
                  telemetry={displayedTelemetry}
                  targetDepth={analysisTargetDepth}
                  onChangeTargetDepth={handleTargetDepthChange}
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
