/**
 * Runtime-neutral self-play job protocol and game generation.
 *
 * This module deliberately has no browser, Node, worker, or trainer state.
 * A coordinator creates a serializable job containing frozen model snapshots;
 * a worker (or the serial baseline) generates a trajectory and returns a
 * result. Learning and statistics are applied elsewhere.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { GameHistory } from '../core/game';
import type { GameStatus, Move, Player } from '../core/types';
import { evaluate, extractFeatures } from './evaluator';
import { selectMove } from './search';
import type { TrajectoryStep } from './tdLearner';
import type { EvaluationWeights } from './types';

export const SELF_PLAY_JOB_SCHEMA_VERSION = 1 as const;
export const SELF_PLAY_POLICY_VERSION = 'training-v1' as const;

export type LearnerColor = 'blue' | 'red';
export type SelfPlayRngDerivation = 'per-game-v1' | 'legacy-serial-v1';

export interface SelfPlayModelSnapshot {
  /** Stable model identity, such as a checkpoint ID or `current-learner`. */
  modelId: string;
  /** Content/version identity; never use a rolling league slot as this value. */
  versionId: string;
  /** Deep-cloned for the lifetime of the job. Workers must not mutate it. */
  weights: EvaluationWeights;
}

export interface SelfPlayOpening {
  /** Replaying moves preserves repetition history; a FEN alone does not. */
  history: GameHistory;
  /** Optional stable identity for audit logs and paired replay. */
  identity?: string;
}

export interface SelfPlayGameJob {
  schemaVersion: typeof SELF_PLAY_JOB_SCHEMA_VERSION;
  /** Stable identity used for exactly-once dispatch and result commits. */
  jobId: string;
  runId: string;
  batchId: number;
  gameId: number;
  /** Coordinator learner version at dispatch time. */
  learnerVersion: number;
  /** Derived from run seed and game ID, never from worker or completion order. */
  seed: number;
  rngDerivation: SelfPlayRngDerivation;
  learnerColor: LearnerColor;
  learner: SelfPlayModelSnapshot;
  opponent: SelfPlayModelSnapshot;
  search: {
    depth: number;
    maxPlies: number;
    policy: typeof SELF_PLAY_POLICY_VERSION;
  };
  /** Optional legacy/custom starting FEN when no replay history is supplied. */
  startFen?: string;
  /** Omit for the legacy initial position. Set this to replay an opening/history. */
  opening?: SelfPlayOpening;
}

export interface SelfPlayOutcome {
  winner: Player | 'draw' | null;
  reason: string | null;
  isTerminal: boolean;
  isTruncated: boolean;
  /** Blue-relative reward: +1000, -1000, or 0. */
  terminalReward: number;
}

export interface SelfPlayTelemetry {
  generatedMoves: number;
  generatedPositions: number;
  searchNodes: number;
  searchTimeMs: number;
  totalTimeMs: number;
}

export interface SelfPlayGameResult {
  schemaVersion: typeof SELF_PLAY_JOB_SCHEMA_VERSION;
  jobId: string;
  runId: string;
  batchId: number;
  gameId: number;
  learnerVersion: number;
  learnerColor: LearnerColor;
  opponentId: string;
  opponentVersionId: string;
  seed: number;
  rngDerivation: SelfPlayRngDerivation;
  /** Features/evaluations recorded against the learner snapshot in the job. */
  trajectory: TrajectoryStep[];
  /** Includes replayed opening moves when a job has an opening. */
  moves: Move[];
  outcome: SelfPlayOutcome;
  telemetry: SelfPlayTelemetry;
}

export function makeSelfPlayJobId(runId: string, batchId: number, gameId: number): string {
  return `${runId}/batch-${batchId}/game-${gameId}`;
}

/**
 * Deterministically derives an independent per-game seed. The exact mixing
 * function is part of the v1 job protocol, so changing it requires a new
 * protocol version for reproducible resume.
 */
export function deriveSelfPlaySeed(runSeed: number, gameId: number, stream = 0): number {
  let value = (runSeed ^ 0x9e3779b9 ^ gameId ^ stream) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

export function createSelfPlayRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Gives a snapshot a stable content-derived version ID without requiring a
 * Node crypto import. This is an identity for audit/replay, not a security
 * hash or a substitute for checkpoint integrity verification.
 */
export function evaluationWeightsVersionId(
  modelId: string,
  weights: EvaluationWeights,
  generation?: number
): string {
  const serialized = JSON.stringify(weights);
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index++) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  const generationPart = generation === undefined ? 'content' : `g${generation}`;
  return `${modelId}@${generationPart}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function signedTerminalReward(status: GameStatus): number {
  if (!status.isOver) return 0;
  if (status.winner === PLAYER_BLUE) return 1000;
  if (status.winner === PLAYER_RED) return -1000;
  return 0;
}

function trainingMoveSchedule(ply: number): { temperature: number; rootNoise: number } {
  if (ply < 5) return { temperature: 24.0, rootNoise: 0.25 };
  if (ply < 9) return { temperature: 10.0, rootNoise: 0.08 };
  return { temperature: 0.0, rootNoise: 0.0 };
}

function createJobGame(job: SelfPlayGameJob): IntransitiveGame {
  if (job.opening) return IntransitiveGame.fromHistory(job.opening.history);
  return new IntransitiveGame(job.startFen);
}

/**
 * Generates one game without mutating learner weights, league state, or
 * statistics. The optional RNG is an adapter hook: the serial compatibility
 * path can supply its existing seeded stream, while worker adapters can use a
 * stream derived from `job.seed`.
 */
export function generateSelfPlayGame(
  job: SelfPlayGameJob,
  rng: () => number = createSelfPlayRng(job.seed)
): SelfPlayGameResult {
  if (job.schemaVersion !== SELF_PLAY_JOB_SCHEMA_VERSION) {
    throw new Error(`Unsupported self-play job schema: ${job.schemaVersion}`);
  }
  if (job.search.policy !== SELF_PLAY_POLICY_VERSION) {
    throw new Error(`Unsupported self-play policy: ${job.search.policy}`);
  }
  if (!Number.isInteger(job.gameId) || job.gameId < 0) {
    throw new Error(`Invalid self-play game ID: ${job.gameId}`);
  }
  if (!Number.isInteger(job.search.maxPlies) || job.search.maxPlies < 0) {
    throw new Error(`Invalid self-play ply cap: ${job.search.maxPlies}`);
  }
  if (!Number.isInteger(job.search.depth) || job.search.depth < 1) {
    throw new Error(`Invalid self-play search depth: ${job.search.depth}`);
  }
  if (job.startFen !== undefined && job.opening !== undefined) {
    throw new Error('Self-play job cannot specify both a starting FEN and replay history');
  }

  const startedAt = performance.now();
  const game = createJobGame(job);
  const moves = job.opening ? [...job.opening.history.moves] : [];
  const trajectory: TrajectoryStep[] = [];
  let searchNodes = 0;
  let searchTimeMs = 0;

  while (moves.length < job.search.maxPlies) {
    const status = game.isTerminal();
    if (status.isOver) break;

    // `moves.length` is the actual played ply, including any replayed
    // opening. This keeps the exploration schedule history-aware.
    const currentPly = moves.length;
    const isBlue = game.activePlayer === PLAYER_BLUE;
    const currentWeights = isBlue === (job.learnerColor === 'blue')
      ? job.learner.weights
      : job.opponent.weights;
    const schedule = trainingMoveSchedule(currentPly);
    const searchResult = selectMove(game, currentWeights, {
      depth: job.search.depth,
      temperature: schedule.temperature,
      rootNoise: schedule.rootNoise,
      ply: currentPly,
      rng,
    });
    searchNodes += searchResult.nodes;
    searchTimeMs += searchResult.elapsedMs;

    if (!searchResult.bestMove) break;

    // The learning signal is always Blue-relative and is evaluated under the
    // learner snapshot, even on plies played by the opponent.
    trajectory.push({
      features: extractFeatures(game),
      evalScore: evaluate(game, job.learner.weights),
    });
    moves.push(searchResult.bestMove);
    if (!game.makeMove(searchResult.bestMove)) {
      throw new Error(`Generated illegal self-play move at ply ${currentPly}`);
    }
  }

  const finalStatus = game.isTerminal();
  const isTerminal = finalStatus.isOver;
  const outcome: SelfPlayOutcome = {
    winner: finalStatus.winner,
    reason: finalStatus.reason ?? (isTerminal ? null : 'max-plies'),
    isTerminal,
    isTruncated: !isTerminal,
    terminalReward: signedTerminalReward(finalStatus),
  };

  return {
    schemaVersion: SELF_PLAY_JOB_SCHEMA_VERSION,
    jobId: job.jobId,
    runId: job.runId,
    batchId: job.batchId,
    gameId: job.gameId,
    learnerVersion: job.learnerVersion,
    learnerColor: job.learnerColor,
    opponentId: job.opponent.modelId,
    opponentVersionId: job.opponent.versionId,
    seed: job.seed,
    rngDerivation: job.rngDerivation,
    trajectory,
    moves,
    outcome,
    telemetry: {
      generatedMoves: moves.length - (job.opening?.history.moves.length ?? 0),
      generatedPositions: trajectory.length,
      searchNodes,
      searchTimeMs,
      totalTimeMs: performance.now() - startedAt,
    },
  };
}
