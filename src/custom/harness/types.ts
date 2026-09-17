import type { Move, PieceType } from '../core/types';
import type { EvaluationWeights, RankedMove } from '../engine/types';
import type { NNUEWeights } from '../engine/nnue/types';

export type HarnessWeights = EvaluationWeights | NNUEWeights;

export type SearchLimit =
  | { kind: 'depth'; value: number }
  | { kind: 'nodes'; value: number }
  | { kind: 'time'; valueMs: number };

export type HarnessEngine = 'production' | 'reference';

export interface FixtureMove {
  from: number;
  to: number;
  piece: PieceType;
  captured?: PieceType;
}

export interface IntransitiveFixture {
  id: string;
  category: string;
  description: string;
  fen: string;
  startFen?: string;
  history?: FixtureMove[];
  provenance: string;
}

export interface SearchRequest {
  engine: HarnessEngine;
  limit: SearchLimit;
  maxDepth?: number;
  count?: number;
  /** Production-only root policy; full is useful for MultiPV comparisons. */
  rootMode?: 'greedy' | 'full';
}

export type SearchStopReason = 'depth' | 'node-budget' | 'time-budget' | 'fallback' | 'unsupported';

export interface HarnessSearchResult {
  bestMove: Move | null;
  score: number;
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  stopReason: SearchStopReason;
  scoreKind: 'engine' | 'exact' | 'partial' | 'static';
  candidates: RankedMove[];
}

export type MatchOutcome = 'A' | 'B' | 'draw' | 'truncated' | 'cancelled' | 'error';

export interface MatchAgent {
  modelId: string;
  modelName: string;
  kind: 'search' | 'random';
  weights?: HarnessWeights;
  search?: SearchRequest;
}

export interface LoggedMove {
  ply: number;
  player: 'blue' | 'red';
  move: Move;
  san: string;
  fen: string;
  source: 'opening' | 'engine' | 'random';
  nodes?: number;
  elapsedMs?: number;
  completedDepth?: number;
}

/**
 * The exact random opening shared by both games in a paired evaluation.
 * Keeping the moves, rather than only the resulting FEN, preserves repetition
 * history and makes the opening independently replayable.
 */
export interface MatchOpening {
  startFen: string;
  seed: number;
  requestedPlies: number;
  moves: Move[];
  identity: string;
}

export interface MatchMoveEvent {
  pairIndex: number;
  gameIndex: number;
  totalGames: number;
  aIsBlue: boolean;
  opening: MatchOpening;
  move: LoggedMove;
  isOver: boolean;
}

export interface MatchGameLog {
  kind: 'intransitive-match-game';
  schemaVersion: 2;
  engineVersion: string;
  pairIndex: number;
  gameIndex: number;
  seed: number;
  openingSeed: number;
  openingPlies: number;
  startFen: string;
  opening: MatchOpening;
  /** Complete move history, including the shared opening. */
  history: { startFen: string; moves: Move[] };
  /** Stable hash of the complete replay and recorded outcome. */
  gameHash: string;
  aIsBlue: boolean;
  modelIds: { blue: string; red: string };
  limits: { blue: SearchLimit | 'random'; red: SearchLimit | 'random' };
  moves: LoggedMove[];
  outcome: MatchOutcome;
  reason: string | null;
  plies: number;
  elapsedMs: number;
  capHit: boolean;
}

export interface PairedMatchReport {
  kind: 'intransitive-paired-match-report';
  schemaVersion: 2;
  engineVersion: string;
  seed: number;
  pairCount: number;
  requestedGames: number;
  openingPlies: number;
  safetyCap: number;
  uniqueOpeningCount: number;
  duplicateOpeningCount: number;
  gamesPlayed: number;
  resolvedGames: number;
  winsA: number;
  winsB: number;
  draws: number;
  truncations: number;
  cancelledGames: number;
  errors: number;
  scoreA: number;
  scoreAPerResolvedGame: number | null;
  averagePlies: number;
  capHitRate: number;
  games?: MatchGameLog[];
}

export interface BenchmarkSample {
  fixtureId: string;
  engine: HarnessEngine;
  repetition: number;
  score: number;
  selectedMove: string | null;
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  stopReason: SearchStopReason;
  scoreKind: HarnessSearchResult['scoreKind'];
}

export interface BenchmarkFixtureSummary {
  fixtureId: string;
  engine: HarnessEngine;
  samples: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  medianNodes: number;
  medianScore: number;
  selectedMoves: string[];
}

export interface BenchmarkReport {
  kind: 'intransitive-search-benchmark-report';
  schemaVersion: 1;
  engineVersion: string;
  modelId: string;
  limit: SearchLimit;
  rootMode?: 'greedy' | 'full';
  warmupRuns: number;
  measuredRuns: number;
  fixtures: BenchmarkFixtureSummary[];
  overall: {
    medianMs: number;
    p95Ms: number;
    maxMs: number;
    medianNodes: number;
  };
  rawSamples: BenchmarkSample[];
}
