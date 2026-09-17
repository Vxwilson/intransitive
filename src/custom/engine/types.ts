/**
 * Intransitive Custom Engine & TD-Learning - Type Definitions
 */

import type { Player, Move } from '../core/types';
import type { GameHistory } from '../core/game';
import type { MatchGameLog } from '../harness/types';
import type { SerializedNNUEWeights } from './nnue/types';

export interface EvaluationWeights {
  pieceValues: {
    R: number;
    P: number;
    S: number;
  };
  goalDistanceWeight: number;
  runnerWeight?: number;
  threatBonus: number;
  vulnerabilityPenalty: number;
  tempoBonus: number;
  // Positional bonuses: 81 values for each piece type
  pst: {
    R: number[];
    P: number[];
    S: number[];
  };
}

export interface TrainingConfig {
  learningRate: number; // alpha, e.g. 0.015
  learningRateAnnealing?: boolean; // whether to anneal alpha with generation count
  lambda: number;       // eligibility trace decay, e.g. 0.7
  epsilon: number;      // exploration probability, e.g. 0.10
  searchDepth: number;  // 1, 2, or 3
  maxPliesPerGame: number;
}

/** Explicit move-selection semantics shared by live and evaluation paths. */
export type MovePolicy = 'competitive' | 'casual-opening' | 'training';

export interface GenerationPoint {
  generation: number;
  R: number;
  P: number;
  S: number;
  blueWinRate: number;
  loss?: number;
}

export interface TrainingStats {
  generation: number;
  gamesPlayed: number;
  blueWins: number;
  redWins: number;
  draws: number;
  /** Number of games that reached a rules-defined terminal state. */
  terminalGames?: number;
  /** Number of games stopped by the training safety cap without a result. */
  truncatedGames?: number;
  /** Number of positions recorded for training trajectories. */
  positionsSeen?: number;
  /** Learner color assignment counts for reproducibility diagnostics. */
  learnerBlueGames?: number;
  learnerRedGames?: number;
  /** Actual opponent checkpoint/version labels selected during training. */
  opponentVersions?: Record<string, number>;
  avgGameLength: number;
  history: GenerationPoint[];
  touchdownWins?: { blue: number; red: number };
  eliminationWins?: { blue: number; red: number };
  drawRepetition?: number;
  draw50Move?: number;
  immobilizations?: number;
  shortestGamePlies?: number;
  longestGamePlies?: number;
  currentAlpha?: number;
  currentLoss?: number;
}

export interface TrainingRunMetadata {
  schemaVersion: 1;
  engineVersion: string;
  engineCommit: string | 'unknown';
  algorithm: 'linear-td-self-play';
  config: TrainingConfig & {
    learnerColorPolicy: 'alternate' | 'blue' | 'red';
    opponentPolicy: 'league-heuristic' | 'fixed';
  };
  seed: number | 'unknown';
  startCheckpointId: string | 'unknown';
  startCheckpointName: string | 'unknown';
  requestedGames: number | 'unknown';
  actualGames: number | 'unknown';
  positions: number | 'unknown';
  terminalGames: number | 'unknown';
  truncatedGames: number | 'unknown';
  elapsedWallMs: number | 'unknown';
  elapsedCpuMs: number | 'unknown';
  learnerBlueGames: number | 'unknown';
  learnerRedGames: number | 'unknown';
  opponentVersions: Record<string, number>;
}

export interface RankedMove {
  move: Move;
  rank: number;
  score: number;
  san: string;
  threat?: string;
  pv?: string[];
  isMate?: boolean;
  mateInPlies?: number;
}

export interface Checkpoint {
  id: string;
  name: string;
  generation: number;
  timestamp: number;
  modelType?: 'linear' | 'nnue';
  weights?: EvaluationWeights;
  nnueWeights?: SerializedNNUEWeights;
  stats: TrainingStats;
  /** Optional Package 3 run metadata; absent on legacy checkpoints. */
  trainingMetadata?: TrainingRunMetadata;
}

// Features extracted from a game state for TD gradient calculation
export interface StateFeatures {
  materialR: number; // (Blue R - Red R)
  materialP: number; // (Blue P - Red P)
  materialS: number; // (Blue S - Red S)
  goalDistanceAdvantage: number; // (Blue goal proximity - Red goal proximity)
  runnerAdvantage: number; // (Blue runner threat - Red runner threat)
  threatAdvantage: number; // (Blue threats - Red threats)
  vulnerabilityAdvantage: number; // (Red vulnerabilities - Blue vulnerabilities)
  tempoAdvantage: number; // +1 if Blue turn, -1 if Red turn
  pstDeltas: {
    R: Float32Array; // 81 square deltas
    P: Float32Array;
    S: Float32Array;
  };
}

export interface AnalysisTelemetry {
  depth: number;
  maxDepth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  candidateMoves: RankedMove[];
  isSearching: boolean;
  currentFen?: string;
}

// Worker message protocol
export type WorkerRequest =
  | { type: 'START_TURBO'; totalGames: number; config?: Partial<TrainingConfig> }
  | { type: 'STOP_TURBO' }
  | {
      type: 'START_NNUE_TRAIN';
      totalGames: number;
      batchSize?: number;
      learningRate?: number;
      searchDepth?: number;
    }
  | { type: 'STOP_NNUE_TRAIN' }
  | {
      type: 'STEP_LIVE';
      currentFen?: string;
      /** Optional replay data; omitted FENs are treated as fresh history. */
      history?: GameHistory;
      /** Actual played ply; halfmoveClock is not a ply counter. */
      ply?: number;
      searchDepth?: number;
      thinkTimeSec?: number;
      movePolicy?: MovePolicy;
      config?: Partial<TrainingConfig>;
      customWeights?: EvaluationWeights;
      customNNUEWeights?: SerializedNNUEWeights;
    }
  | {
      type: 'ARENA_RUN';
      checkpointA: Checkpoint;
      checkpointB: Checkpoint;
      numGames: number;
      searchDepth?: number;
      searchDepthA?: number;
      searchDepthB?: number;
      thinkTimeSecA?: number;
      thinkTimeSecB?: number;
      streamMoves?: boolean;
      seed?: number;
      openingPlies?: number;
      safetyCap?: number;
      startFen?: string;
    }
  | { type: 'ARENA_PAUSE' }
  | { type: 'ARENA_RESUME' }
  | { type: 'ARENA_STOP' }
  | {
      type: 'START_ANALYSIS';
      currentFen: string;
      history?: GameHistory;
      weights?: EvaluationWeights;
      nnueWeights?: SerializedNNUEWeights;
      maxDepth?: number;
      count?: number;
    }
  | { type: 'STOP_ANALYSIS' }
  | { type: 'SET_WEIGHTS'; weights: EvaluationWeights; stats?: TrainingStats }
  | { type: 'SYNC_WEIGHTS'; weights: EvaluationWeights; stats?: TrainingStats }
  | { type: 'RESET_TRAINING' };

export type WorkerResponse =
  | {
      type: 'TURBO_PROGRESS';
      completed: number;
      total: number;
      nps: number;
      stats: TrainingStats;
      weights: EvaluationWeights;
    }
  | {
      type: 'TURBO_COMPLETE';
      stats: TrainingStats;
      weights: EvaluationWeights;
    }
  | {
      type: 'NNUE_TRAIN_PROGRESS';
      completed: number;
      total: number;
      loss: number;
      nps: number;
      bufferSize: number;
      stats: TrainingStats;
      nnueWeights: SerializedNNUEWeights;
    }
  | {
      type: 'NNUE_TRAIN_COMPLETE';
      stats: TrainingStats;
      nnueWeights: SerializedNNUEWeights;
    }
  | {
      type: 'ANALYSIS_PROGRESS';
      depth: number;
      maxDepth: number;
      nodes: number;
      nps: number;
      timeMs: number;
      candidateMoves: RankedMove[];
      currentFen?: string;
    }
  | {
      type: 'ANALYSIS_COMPLETE';
      depth: number;
      maxDepth: number;
      nodes: number;
      nps: number;
      timeMs: number;
      candidateMoves: RankedMove[];
      currentFen?: string;
    }
  | {
      type: 'LIVE_STEP';
      move: Move;
      san: string;
      fenAfter: string;
      evalScore: number;
      isOver: boolean;
      winner: Player | 'draw' | null;
    }
  | {
      type: 'ARENA_STREAM_MOVE';
      move: Move;
      san: string;
      fen: string;
      isOver: boolean;
      gameIndex: number;
      totalGames?: number;
      currentWinsA?: number;
      currentWinsB?: number;
      currentDraws?: number;
      truncations?: number;
      cancelledGames?: number;
      errors?: number;
      fighterAIsBlue?: boolean;
    }
  | {
      type: 'ARENA_RESULT';
      winRateA: number;
      winRateB: number;
      drawRate: number;
      winsA: number;
      winsB: number;
      draws: number;
      gamesPlayed: number;
      resolvedGames?: number;
      requestedGames?: number;
      truncations: number;
      cancelledGames: number;
      errors: number;
      avgGameLength?: number;
      depthA?: number;
      depthB?: number;
      thinkTimeSecA?: number;
      thinkTimeSecB?: number;
      seed?: number;
      pairCount?: number;
      openingPlies?: number;
      safetyCap?: number;
      uniqueOpeningCount?: number;
      duplicateOpeningCount?: number;
      isCancelled?: boolean;
      error?: string;
      /** Full audit logs; completedGames remains the compact PGN adapter shape. */
      gameLogs?: MatchGameLog[];
      completedGames?: {
        gameNumber: number;
        fighterAIsBlue: boolean;
        result: string;
        termination: string;
        moves: { san: string }[];
      }[];
    }
  | {
      type: 'CURRENT_STATE';
      weights: EvaluationWeights;
      stats: TrainingStats;
    };
