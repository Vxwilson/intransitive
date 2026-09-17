/**
 * Intransitive custom engine search.
 *
 * Package 1 deliberately favors a small, auditable search over clever
 * shortcuts: terminal draws are exact zeroes, runway analysis is not a proof
 * cutoff, and the transposition table supplies move ordering only. Every
 * root search owns its context and therefore cannot reuse scores from another
 * evaluator, clock, or repetition history.
 */

import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import { BLUE_GOAL_SQUARE, RED_GOAL_SQUARE } from '../core/constants';
import type { IntransitiveGame } from '../core/game';
import type { EvaluationWeights, RankedMove } from './types';
import { evaluate, WIN_SCORE, LOSS_SCORE, DRAW_SCORE } from './evaluator';
import { evaluateNNUE } from './nnue/nnueEvaluator';
import type { NNUEWeights } from './nnue/types';
import { IntransitiveTT } from './transposition';
import {
  findUnstoppableRunway,
  evaluateRunwayRace,
  type UnstoppableRunway,
} from './runway';

export { findUnstoppableRunway, evaluateRunwayRace, type UnstoppableRunway };

export const MAX_SEARCH_DEPTH = 64;
export const DEFAULT_TT_SIZE_BITS = 16;

export type SearchLimit =
  | { kind: 'depth'; depth: number }
  | { kind: 'nodes'; nodes: number }
  | { kind: 'time'; timeMs: number };

export type SearchStopReason =
  | 'depth'
  | 'node-budget'
  | 'time-budget'
  | 'aborted'
  | 'fallback';

export type SearchScoreKind = 'exact' | 'partial' | 'static' | 'bound';

export interface SearchContext {
  nodes: number;
  startedAt: number;
  deadlineMs?: number;
  nodeLimit?: number;
  shouldStop?: () => boolean;
  /** Move-ordering table owned by this root-search session. */
  tt: IntransitiveTT;
}

export type SearchContextInput = SearchContext | { nodes: number };

export interface SearchContextOptions {
  deadlineMs?: number;
  nodeLimit?: number;
  shouldStop?: () => boolean;
  tt?: IntransitiveTT;
}

export interface SearchResult {
  bestMove: Move | null;
  /** Blue-relative score. */
  score: number;
  completedDepth: number;
  nodes: number;
  elapsedMs: number;
  pv: Move[];
  stopReason: SearchStopReason;
  scoreKind: SearchScoreKind;
}

export class SearchAbort extends Error {
  public readonly reason: Exclude<SearchStopReason, 'depth' | 'fallback'>;

  public constructor(reason: Exclude<SearchStopReason, 'depth' | 'fallback'>) {
    super(reason);
    this.name = 'SearchAbort';
    this.reason = reason;
  }
}

export function isSearchAbort(error: unknown): error is SearchAbort {
  return error instanceof SearchAbort;
}

export function createSearchContext(options: SearchContextOptions = {}): SearchContext {
  return {
    nodes: 0,
    startedAt: performance.now(),
    deadlineMs: options.deadlineMs,
    nodeLimit: options.nodeLimit,
    shouldStop: options.shouldStop,
    tt: options.tt ?? new IntransitiveTT(DEFAULT_TT_SIZE_BITS),
  };
}

function normalizeContext(
  input: SearchContextInput | undefined,
  shouldStop?: () => boolean
): SearchContext {
  if (!input) return createSearchContext({ shouldStop });

  const context = input as SearchContext;
  if (!context.tt) context.tt = new IntransitiveTT(DEFAULT_TT_SIZE_BITS);
  if (!context.startedAt) context.startedAt = performance.now();
  if (shouldStop) {
    const previous = context.shouldStop;
    context.shouldStop = () => Boolean(previous?.() || shouldStop());
  }
  return context;
}

function checkSearchNode(context: SearchContext): void {
  if (context.shouldStop?.()) throw new SearchAbort('aborted');
  if (context.nodeLimit !== undefined && context.nodes >= context.nodeLimit) {
    throw new SearchAbort('node-budget');
  }
  if (context.deadlineMs !== undefined && performance.now() >= context.deadlineMs) {
    throw new SearchAbort('time-budget');
  }
  context.nodes++;
}

function terminalScore(game: IntransitiveGame, ply: number): number | null {
  const status = game.isTerminal();
  if (!status.isOver) return null;
  if (status.winner === PLAYER_BLUE) return WIN_SCORE - ply;
  if (status.winner === PLAYER_RED) return LOSS_SCORE + ply;
  return DRAW_SCORE;
}

export function isNNUEWeights(w: EvaluationWeights | NNUEWeights): w is NNUEWeights {
  return typeof w === 'object' && w !== null && 'w0' in w;
}

export function evaluateAny(game: IntransitiveGame, weights: EvaluationWeights | NNUEWeights): number {
  if (isNNUEWeights(weights)) return evaluateNNUE(game, weights);
  return evaluate(game, weights);
}

/** Format a Blue-relative score into a compact display string. */
export function formatEvalScore(
  score: number,
  isMate?: boolean,
  mateInPlies?: number
): string {
  const mateThreshold = WIN_SCORE - 100;
  if (isMate || Math.abs(score) >= mateThreshold) {
    const plies = Math.max(
      1,
      mateInPlies ?? (score > 0 ? WIN_SCORE - score : score - LOSS_SCORE)
    );
    const moves = Math.max(1, Math.ceil(plies / 2));
    return `${score >= 0 ? '+' : '-'}M${moves}`;
  }
  return score > 0 ? `+${score}` : `${score}`;
}

/** @deprecated Draw contempt is disabled in correctness-first search. */
export const DRAW_CONTEMPT_FACTOR = 0;
/** @deprecated Twofold repetition penalties are disabled in correctness-first search. */
export const REPETITION_PENALTY_2FOLD = 0;

export function goalChebyshevDist(sq: number, goalSq: number): number {
  const r1 = Math.floor(sq / 9), c1 = sq % 9;
  const r2 = Math.floor(goalSq / 9), c2 = goalSq % 9;
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

export function hasRunnerThreat(game: IntransitiveGame): boolean {
  for (let sq = 0; sq < 81; sq++) {
    const code = game.board[sq];
    if (code === 0) continue;
    const isBlue = code <= 3;
    const goalSq = isBlue ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;
    if (goalChebyshevDist(sq, goalSq) === 1) return true;
  }
  return false;
}

/** Tactical ordering only; it does not assign a score or prove a result. */
export function orderMovesTactically(
  moves: Move[],
  activePlayer: typeof PLAYER_BLUE | typeof PLAYER_RED,
  ttMove?: Move | null
): void {
  if (moves.length <= 1) return;
  const goalSquare = activePlayer === PLAYER_BLUE ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;
  moves.sort((a, b) => {
    if (ttMove) {
      if (a.from === ttMove.from && a.to === ttMove.to) return -1;
      if (b.from === ttMove.from && b.to === ttMove.to) return 1;
    }
    const aGoal = a.to === goalSquare ? 20000 : 0;
    const bGoal = b.to === goalSquare ? 20000 : 0;
    if (aGoal !== bGoal) return bGoal - aGoal;

    const aDist = goalChebyshevDist(a.to, goalSquare);
    const bDist = goalChebyshevDist(b.to, goalSquare);
    const aD1 = aDist === 1 ? 10000 : 0;
    const bD1 = bDist === 1 ? 10000 : 0;
    if (aD1 !== bD1) return bD1 - aD1;
    const aD2 = aDist === 2 ? 3000 : 0;
    const bD2 = bDist === 2 ? 3000 : 0;
    if (aD2 !== bD2) return bD2 - aD2;

    const aCap = a.captured !== undefined ? 1500 : 0;
    const bCap = b.captured !== undefined ? 1500 : 0;
    if (aCap !== bCap) return bCap - aCap;
    return aDist - bDist;
  });
}

interface NodeResult {
  score: number;
  pv: Move[];
  forced: boolean;
}

interface RootCandidate {
  move: Move;
  score: number;
  pv: Move[];
  forced: boolean;
}

interface RootDepthResult {
  candidates: RootCandidate[];
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.piece === b.piece && a.captured === b.captured;
}

function searchNode(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: EvaluationWeights | NNUEWeights,
  ply: number,
  context: SearchContext
): NodeResult {
  checkSearchNode(context);

  const terminal = terminalScore(game, ply);
  if (terminal !== null) {
    return { score: terminal, pv: [], forced: game.isTerminal().winner !== 'draw' };
  }
  if (depth <= 0) return { score: evaluateAny(game, weights), pv: [], forced: false };

  const entry = context.tt.probe(game.zobristKey, ply);
  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    const noMoveScore = terminalScore(game, ply);
    return {
      score: noMoveScore ?? evaluateAny(game, weights),
      pv: [],
      forced: noMoveScore !== null && game.isTerminal().winner !== 'draw',
    };
  }
  orderMovesTactically(moves, game.activePlayer, entry?.bestMove);

  const maximizing = game.activePlayer === PLAYER_BLUE;
  let bestScore = maximizing ? -Infinity : Infinity;
  let bestMove: Move | null = null;
  let bestPv: Move[] = [];
  let bestForced = false;

  for (const move of moves) {
    checkSearchNode(context);
    if (!game.makeMove(move)) continue;

    let child: NodeResult;
    try {
      child = searchNode(game, depth - 1, alpha, beta, weights, ply + 1, context);
    } finally {
      game.unmakeMove();
    }

    const isBetter = maximizing ? child.score > bestScore : child.score < bestScore;
    if (isBetter || bestMove === null) {
      bestScore = child.score;
      bestMove = move;
      bestPv = [move, ...child.pv];
      bestForced = child.forced;
    }

    if (maximizing) alpha = Math.max(alpha, bestScore);
    else beta = Math.min(beta, bestScore);
    if (alpha >= beta) break;
  }

  if (bestMove) context.tt.storeMove(game.zobristKey, depth, bestMove);
  return { score: bestScore, pv: bestPv, forced: bestForced };
}

/** Legacy-compatible recursive entry point. */
export function minimax(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: EvaluationWeights | NNUEWeights,
  ply: number = 0,
  contextInput?: SearchContextInput,
  _extensions: number = 0
): number {
  const context = normalizeContext(contextInput);
  return searchNode(game, depth, alpha, beta, weights, ply, context).score;
}

export interface SelectMoveOptions {
  /** Fixed-depth mode. In time/node mode this is only a legacy hint. */
  depth?: number;
  /** Separate maximum-depth safety ceiling for time/node searches. */
  maxDepth?: number;
  temperature?: number;
  rootNoise?: number;
  /** Actual game ply, not halfmoveClock. */
  ply?: number;
  openingPlies?: number;
  thinkTimeSec?: number;
  thinkTimeMs?: number;
  limit?: SearchLimit;
  shouldStop?: () => boolean;
  rng?: () => number;
}

function rootSearchDepth(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  depth: number,
  context: SearchContext
): RootDepthResult {
  checkSearchNode(context);

  const moves = game.generateLegalMoves();
  if (moves.length === 0) return { candidates: [] };

  const ttEntry = context.tt.probe(game.zobristKey, 0);
  orderMovesTactically(moves, game.activePlayer, ttEntry?.bestMove);

  const candidates: RootCandidate[] = [];
  for (const move of moves) {
    checkSearchNode(context);
    if (!game.makeMove(move)) continue;

    let child: NodeResult;
    try {
      child = searchNode(game, Math.max(0, depth - 1), -Infinity, Infinity, weights, 1, context);
    } finally {
      game.unmakeMove();
    }
    candidates.push({ move, score: child.score, pv: [move, ...child.pv], forced: child.forced });
  }

  const maximizing = game.activePlayer === PLAYER_BLUE;
  candidates.sort((a, b) => maximizing ? b.score - a.score : a.score - b.score);
  if (candidates[0]) context.tt.storeMove(game.zobristKey, depth, candidates[0].move);
  return { candidates };
}

function movePolicyChoice(
  candidates: RootCandidate[],
  maximizing: boolean,
  temperature: number,
  rootNoise: number,
  rng: () => number
): RootCandidate {
  if (temperature <= 0.001 && rootNoise <= 0) return candidates[0];

  const bestScore = candidates[0].score;
  const baseProbs = candidates.map((candidate) => {
    const delta = maximizing
      ? (candidate.score - bestScore) / Math.max(0.001, temperature)
      : (bestScore - candidate.score) / Math.max(0.001, temperature);
    return Math.exp(Math.max(-30, delta));
  });
  const sumBase = baseProbs.reduce((sum, value) => sum + value, 0);
  let probabilities = baseProbs.map((value) => sumBase > 0 ? value / sumBase : 1 / baseProbs.length);

  if (rootNoise > 0) {
    const gammas = candidates.map(() => sampleGamma(0.3, rng));
    const sumGamma = gammas.reduce((sum, value) => sum + value, 0);
    const noise = gammas.map((value) => sumGamma > 0 ? value / sumGamma : 1 / gammas.length);
    probabilities = probabilities.map((value, index) =>
      (1 - rootNoise) * value + rootNoise * noise[index]
    );
  }

  const random = rng();
  let cumulative = 0;
  for (let i = 0; i < probabilities.length; i++) {
    cumulative += probabilities[i];
    if (random <= cumulative) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

function fallbackResult(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  context: SearchContext,
  reason: SearchStopReason
): SearchResult {
  const moves = game.generateLegalMoves();
  orderMovesTactically(moves, game.activePlayer);
  const bestMove = moves[0] ?? null;
  return {
    bestMove,
    score: evaluateAny(game, weights),
    completedDepth: 0,
    nodes: context.nodes,
    elapsedMs: Math.max(0, performance.now() - context.startedAt),
    pv: bestMove ? [bestMove] : [],
    stopReason: reason,
    scoreKind: 'static',
  };
}

function selectMoveFixedDepth(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  optionsOrDepth: number | SelectMoveOptions,
  legacyEpsilon: number,
  context?: SearchContext
): SearchResult {
  const options: SelectMoveOptions = typeof optionsOrDepth === 'number'
    ? { depth: optionsOrDepth }
    : optionsOrDepth;
  const depth = Math.max(1, Math.floor(options.depth ?? 1));
  const searchContext = context ?? createSearchContext({ shouldStop: options.shouldStop });
  const rng = options.rng ?? Math.random;
  let temperature = options.temperature ?? 0;
  const rootNoise = options.rootNoise ?? 0;
  if (typeof optionsOrDepth === 'number' && legacyEpsilon > 0 && rng() < legacyEpsilon) {
    temperature = 25;
  }

  const openingPlies = options.openingPlies;
  const activePly = options.ply ?? 0;
  const isOpening = openingPlies === undefined ? true : activePly < openingPlies;
  const activeTemperature = isOpening ? temperature : 0;
  const activeRootNoise = isOpening ? rootNoise : 0;

  let root: RootDepthResult;
  try {
    root = rootSearchDepth(game, weights, depth, searchContext);
  } catch (error) {
    if (isSearchAbort(error)) {
      if (context) throw error;
      return fallbackResult(game, weights, searchContext, error.reason);
    }
    throw error;
  }

  if (root.candidates.length === 0) {
    return {
      bestMove: null,
      score: terminalScore(game, 0) ?? evaluateAny(game, weights),
      completedDepth: depth,
      nodes: searchContext.nodes,
      elapsedMs: Math.max(0, performance.now() - searchContext.startedAt),
      pv: [],
      stopReason: 'depth',
      scoreKind: 'exact',
    };
  }

  const selected = movePolicyChoice(
    root.candidates,
    game.activePlayer === PLAYER_BLUE,
    activeTemperature,
    activeRootNoise,
    rng
  );
  return {
    bestMove: selected.move,
    score: selected.score,
    completedDepth: depth,
    nodes: searchContext.nodes,
    elapsedMs: Math.max(0, performance.now() - searchContext.startedAt),
    pv: selected.pv,
    stopReason: 'depth',
    scoreKind: 'exact',
  };
}

function limitFromOptions(options: SelectMoveOptions): SearchLimit | null {
  if (options.limit) return options.limit;
  if (options.thinkTimeSec !== undefined && options.thinkTimeSec > 0) {
    return { kind: 'time', timeMs: options.thinkTimeSec * 1000 };
  }
  if (options.thinkTimeMs !== undefined && options.thinkTimeMs > 0) {
    return { kind: 'time', timeMs: options.thinkTimeMs };
  }
  return null;
}

/** Select a move using fixed depth or a mutually-exclusive time/node limit. */
export function selectMove(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  optionsOrDepth: number | SelectMoveOptions = 1,
  legacyEpsilon: number = 0
): SearchResult {
  if (typeof optionsOrDepth === 'number') {
    return selectMoveFixedDepth(game, weights, optionsOrDepth, legacyEpsilon);
  }

  const options = optionsOrDepth;
  const limit = limitFromOptions(options);
  if (!limit || limit.kind === 'depth') {
    return selectMoveFixedDepth(
      game,
      weights,
      { ...options, depth: limit?.kind === 'depth' ? limit.depth : options.depth },
      legacyEpsilon
    );
  }

  const startedAt = performance.now();
  const normalizedLimit = limit.kind === 'nodes'
    ? { kind: 'nodes' as const, nodes: Math.max(1, Math.floor(limit.nodes)) }
    : { kind: 'time' as const, timeMs: Math.max(1, limit.timeMs) };
  const context = createSearchContext(
    normalizedLimit.kind === 'nodes'
      ? { nodeLimit: normalizedLimit.nodes, shouldStop: options.shouldStop }
      : { deadlineMs: startedAt + normalizedLimit.timeMs, shouldStop: options.shouldStop }
  );
  const maxDepth = Math.max(1, Math.min(MAX_SEARCH_DEPTH, Math.floor(options.maxDepth ?? MAX_SEARCH_DEPTH)));
  const legalMoves = game.generateLegalMoves();
  if (legalMoves.length === 0) return fallbackResult(game, weights, context, 'fallback');

  let best: SearchResult | null = null;
  let stopReason: SearchStopReason = 'depth';
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      const result = selectMoveFixedDepth(
        game,
        weights,
        { ...options, depth, thinkTimeSec: undefined, thinkTimeMs: undefined, limit: undefined },
        legacyEpsilon,
        context
      );
      if (result.bestMove) best = result;
    } catch (error) {
      if (!isSearchAbort(error)) throw error;
      stopReason = error.reason;
      break;
    }
  }

  if (!best) {
    return fallbackResult(game, weights, context, stopReason === 'depth' ? 'fallback' : stopReason);
  }

  const reachedDepthCeiling = best.completedDepth >= maxDepth;
  stopReason = reachedDepthCeiling
    ? 'depth'
    : (stopReason === 'depth'
      ? normalizedLimit.kind === 'nodes' ? 'node-budget' : 'time-budget'
      : stopReason);
  return {
    ...best,
    nodes: context.nodes,
    elapsedMs: Math.max(0, performance.now() - context.startedAt),
    stopReason,
    scoreKind: stopReason === 'depth' ? 'exact' : 'partial',
  };
}

function sampleGamma(alpha: number, rng: () => number): number {
  if (alpha < 1) {
    const u = Math.max(1e-10, rng());
    return sampleGamma(alpha + 1, rng) * Math.pow(u, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 100; iter++) {
    const u1 = Math.max(1e-10, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const v = 1 + c * z;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * z * z * z * z) return d * v3;
    if (Math.log(u) < 0.5 * z * z + d * (1 - v3 + Math.log(v3))) return d * v3;
  }
  return 1;
}

function formatPVContinuation(game: IntransitiveGame, pv: Move[]): string[] {
  if (pv.length <= 1) return [];
  let made = 0;
  const result: string[] = [];
  try {
    if (!game.makeMove(pv[0])) return result;
    made++;
    for (let i = 1; i < pv.length; i++) {
      if (game.isTerminal().isOver) break;
      const legal = game.generateLegalMoves().find((move) => sameMove(move, pv[i]));
      if (!legal) break;
      result.push(game.formatMoveSAN(legal));
      if (!game.makeMove(legal)) break;
      made++;
    }
    return result;
  } finally {
    while (made > 0) {
      game.unmakeMove();
      made--;
    }
  }
}

function candidateMetadata(game: IntransitiveGame, candidate: RootCandidate): RankedMove {
  const san = game.formatMoveSAN(candidate.move);
  const mateThreshold = WIN_SCORE - 100;
  const isMate = candidate.forced && Math.abs(candidate.score) >= mateThreshold;
  const mateInPlies = isMate
    ? Math.max(1, candidate.score > 0 ? WIN_SCORE - candidate.score : candidate.score - LOSS_SCORE)
    : undefined;
  let threat: string | undefined;
  if (san.includes('#')) threat = 'Touchdown Goal';
  else if (isMate) {
    const movesToMate = Math.max(1, Math.ceil((mateInPlies ?? 1) / 2));
    const isWinningMate = game.activePlayer === PLAYER_BLUE ? candidate.score > 0 : candidate.score < 0;
    threat = isWinningMate ? `🏆 Forced Win (M${movesToMate})` : `❌ Forced Loss (-M${movesToMate})`;
  } else if (candidate.move.captured) {
    threat = `Capture ${candidate.move.captured}`;
  }
  return {
    move: candidate.move,
    rank: 0,
    score: candidate.score,
    san,
    threat,
    pv: formatPVContinuation(game, candidate.pv),
    isMate,
    mateInPlies,
  };
}

/** Compute top candidates at one fully completed depth. */
export function getTopMoves(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  count: number = 5,
  depth: number = 1,
  contextInput?: SearchContextInput,
  isAborted?: () => boolean
): RankedMove[] {
  const context = normalizeContext(contextInput, isAborted);
  const root = rootSearchDepth(game, weights, Math.max(1, Math.floor(depth)), context);
  const result: RankedMove[] = [];
  for (let i = 0; i < Math.min(Math.max(0, count), root.candidates.length); i++) {
    if (isAborted?.()) throw new SearchAbort('aborted');
    const item = candidateMetadata(game, root.candidates[i]);
    item.rank = i + 1;
    result.push(item);
  }
  return result;
}

export interface AnalysisStepResult {
  depth: number;
  maxDepth: number;
  nodes: number;
  nps: number;
  timeMs: number;
  candidateMoves: RankedMove[];
  isComplete: boolean;
}

export function runIterativeDeepeningAnalysis(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  maxDepth: number = 6,
  count: number = 5,
  onProgress?: (result: AnalysisStepResult) => void,
  shouldStop?: () => boolean
): AnalysisStepResult {
  const boundedMaxDepth = Math.max(1, Math.min(MAX_SEARCH_DEPTH, Math.floor(maxDepth)));
  const context = createSearchContext({ shouldStop });
  let lastResult: RankedMove[] = [];
  let achievedDepth = 0;
  let interrupted = false;

  for (let depth = 1; depth <= boundedMaxDepth; depth++) {
    if (shouldStop?.()) {
      interrupted = true;
      break;
    }
    try {
      lastResult = getTopMoves(game, weights, count, depth, context);
      achievedDepth = depth;
    } catch (error) {
      if (!isSearchAbort(error)) throw error;
      interrupted = true;
      break;
    }

    const elapsedMs = Math.max(1, performance.now() - context.startedAt);
    onProgress?.({
      depth,
      maxDepth: boundedMaxDepth,
      nodes: context.nodes,
      nps: Math.round((context.nodes * 1000) / elapsedMs),
      timeMs: Math.round(elapsedMs),
      candidateMoves: lastResult,
      isComplete: depth === boundedMaxDepth,
    });
  }

  const elapsedMs = Math.max(1, performance.now() - context.startedAt);
  return {
    depth: achievedDepth,
    maxDepth: boundedMaxDepth,
    nodes: context.nodes,
    nps: Math.round((context.nodes * 1000) / elapsedMs),
    timeMs: Math.round(elapsedMs),
    candidateMoves: lastResult,
    isComplete: !interrupted && achievedDepth >= boundedMaxDepth,
  };
}
