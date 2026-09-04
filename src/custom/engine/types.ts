/**
 * Intransitive Custom Engine & TD-Learning - Type Definitions
 */

import type { Player, Move } from '../core/types';

export interface EvaluationWeights {
  pieceValues: {
    R: number;
    P: number;
    S: number;
  };
  goalDistanceWeight: number;
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

export interface GenerationPoint {
  generation: number;
  R: number;
  P: number;
  S: number;
  blueWinRate: number;
}

export interface TrainingStats {
  generation: number;
  gamesPlayed: number;
  blueWins: number;
  redWins: number;
  draws: number;
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
  weights: EvaluationWeights;
  stats: TrainingStats;
}

// Features extracted from a game state for TD gradient calculation
export interface StateFeatures {
  materialR: number; // (Blue R - Red R)
  materialP: number; // (Blue P - Red P)
  materialS: number; // (Blue S - Red S)
  goalDistanceAdvantage: number; // (Blue goal proximity - Red goal proximity)
  threatAdvantage: number; // (Blue threats - Red threats)
  vulnerabilityAdvantage: number; // (Red vulnerabilities - Blue vulnerabilities)
  tempoAdvantage: number; // +1 if Blue turn, -1 if Red turn
  pstDeltas: {
    R: Float32Array; // 81 square deltas
    P: Float32Array;
    S: Float32Array;
  };
}

// Worker message protocol
export type WorkerRequest =
  | { type: 'START_TURBO'; totalGames: number; config?: Partial<TrainingConfig> }
  | { type: 'STOP_TURBO' }
  | { type: 'STEP_LIVE'; currentFen?: string; searchDepth?: number; config?: Partial<TrainingConfig>; customWeights?: EvaluationWeights }
  | { type: 'ARENA_RUN'; checkpointA: Checkpoint; checkpointB: Checkpoint; numGames: number; searchDepth?: number; streamMoves?: boolean }
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
      avgGameLength?: number;
      accuracyA?: number;
      accuracyB?: number;
    }
  | {
      type: 'CURRENT_STATE';
      weights: EvaluationWeights;
      stats: TrainingStats;
    };
