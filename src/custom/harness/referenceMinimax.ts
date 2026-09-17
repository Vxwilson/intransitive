import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import type { IntransitiveGame } from '../core/game';
import type { HarnessWeights, SearchLimit } from './types';
import { evaluateAny } from '../engine/search';
import { LOSS_SCORE, WIN_SCORE } from '../engine/evaluator';

export interface ReferenceContext {
  nodes: number;
  nodeLimit?: number;
  deadlineMs?: number;
}

export interface ReferenceCandidate {
  move: Move;
  score: number;
}

export interface ReferenceResult {
  bestMove: Move | null;
  score: number;
  candidates: ReferenceCandidate[];
  nodes: number;
  completedDepth: number;
  stopped: boolean;
  stopReason: 'depth' | 'node-budget' | 'time-budget' | 'fallback';
}

class ReferenceAbort extends Error {
  public readonly reason: 'node-budget' | 'time-budget';

  public constructor(reason: 'node-budget' | 'time-budget') {
    super(reason);
    this.reason = reason;
  }
}

function checkBudget(context: ReferenceContext): void {
  if (context.nodeLimit !== undefined && context.nodes >= context.nodeLimit) {
    throw new ReferenceAbort('node-budget');
  }
  if (context.deadlineMs !== undefined && performance.now() >= context.deadlineMs) {
    throw new ReferenceAbort('time-budget');
  }
}

function terminalScore(game: IntransitiveGame, ply: number): number | null {
  const status = game.isTerminal();
  if (!status.isOver) return null;
  if (status.winner === PLAYER_BLUE) return WIN_SCORE - ply;
  if (status.winner === PLAYER_RED) return LOSS_SCORE + ply;
  return 0;
}

/**
 * Deliberately slow correctness oracle for shallow positions. It has no TT,
 * runway proof, draw contempt, or selective extensions. Alpha-beta is kept
 * only as ordinary minimax pruning; the move order is the generator order.
 */
export function referenceMinimax(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: HarnessWeights,
  ply: number,
  context: ReferenceContext
): number {
  checkBudget(context);
  context.nodes++;

  const terminal = terminalScore(game, ply);
  if (terminal !== null) return terminal;
  if (depth <= 0) return evaluateAny(game, weights);

  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    return terminalScore(game, ply) ?? evaluateAny(game, weights);
  }

  if (game.activePlayer === PLAYER_BLUE) {
    let best = -Infinity;
    for (const move of moves) {
      checkBudget(context);
      game.makeMove(move);
      let score: number;
      try {
        score = referenceMinimax(game, depth - 1, alpha, beta, weights, ply + 1, context);
      } finally {
        game.unmakeMove();
      }
      best = Math.max(best, score);
      alpha = Math.max(alpha, best);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = Infinity;
  for (const move of moves) {
    checkBudget(context);
    game.makeMove(move);
    let score: number;
    try {
      score = referenceMinimax(game, depth - 1, alpha, beta, weights, ply + 1, context);
    } finally {
      game.unmakeMove();
    }
    best = Math.min(best, score);
    beta = Math.min(beta, best);
    if (alpha >= beta) break;
  }
  return best;
}

function searchDepth(
  game: IntransitiveGame,
  depth: number,
  weights: HarnessWeights,
  context: ReferenceContext
): ReferenceCandidate[] {
  const moves = game.generateLegalMoves();
  const candidates: ReferenceCandidate[] = [];
  const maximizing = game.activePlayer === PLAYER_BLUE;

  for (const move of moves) {
    checkBudget(context);
    game.makeMove(move);
    let score: number;
    try {
      score = referenceMinimax(game, depth - 1, -Infinity, Infinity, weights, 1, context);
    } finally {
      game.unmakeMove();
    }
    candidates.push({ move, score });
  }

  candidates.sort((a, b) => maximizing ? b.score - a.score : a.score - b.score);
  return candidates;
}

function searchLimits(limit: SearchLimit): Pick<ReferenceContext, 'nodeLimit' | 'deadlineMs'> {
  if (limit.kind === 'nodes') return { nodeLimit: Math.max(1, Math.floor(limit.value)) };
  if (limit.kind === 'time') return { deadlineMs: performance.now() + Math.max(1, limit.valueMs) };
  return {};
}

export function runReferenceSearch(
  game: IntransitiveGame,
  weights: HarnessWeights,
  limit: SearchLimit,
  maxDepth: number = 4
): ReferenceResult {
  const legalMoves = game.generateLegalMoves();
  if (legalMoves.length === 0) {
    return {
      bestMove: null,
      score: terminalScore(game, 0) ?? evaluateAny(game, weights),
      candidates: [],
      nodes: 0,
      completedDepth: 0,
      stopped: false,
      stopReason: 'fallback',
    };
  }

  const context: ReferenceContext = { nodes: 0, ...searchLimits(limit) };
  const depthLimit = limit.kind === 'depth' ? Math.max(1, Math.floor(limit.value)) : Math.max(1, Math.floor(maxDepth));
  let completedDepth = 0;
  let lastCandidates: ReferenceCandidate[] = [];
  let stopReason: ReferenceResult['stopReason'] = limit.kind === 'depth' ? 'depth' : 'fallback';
  let stopped = false;

  for (let depth = 1; depth <= depthLimit; depth++) {
    try {
      const candidates = searchDepth(game, depth, weights, context);
      lastCandidates = candidates;
      completedDepth = depth;
      stopReason = limit.kind === 'depth' ? 'depth' : limit.kind === 'nodes' ? 'node-budget' : 'time-budget';
    } catch (error) {
      if (!(error instanceof ReferenceAbort)) throw error;
      stopped = true;
      stopReason = error.reason;
      break;
    }
  }
  if (!stopped && completedDepth >= depthLimit) stopReason = 'depth';

  if (lastCandidates.length === 0) {
    const fallback = legalMoves[0];
    return {
      bestMove: fallback,
      score: evaluateAny(game, weights),
      candidates: [{ move: fallback, score: evaluateAny(game, weights) }],
      nodes: context.nodes,
      completedDepth,
      stopped: true,
      stopReason: 'fallback',
    };
  }

  const best = lastCandidates[0];
  return {
    bestMove: best.move,
    score: best.score,
    candidates: lastCandidates,
    nodes: context.nodes,
    completedDepth,
    stopped,
    stopReason,
  };
}

export function snapshotGame(game: IntransitiveGame): string {
  const repetitions = [...game.repetitionMap.entries()]
    .map(([key, count]) => `${key.toString()}:${count}`)
    .sort()
    .join('|');
  return JSON.stringify({
    board: Array.from(game.board),
    activePlayer: game.activePlayer,
    halfmoveClock: game.halfmoveClock,
    fullmoveNumber: game.fullmoveNumber,
    zobristKey: game.zobristKey.toString(),
    repetitions,
    blueCounts: game.blueCounts,
    redCounts: game.redCounts,
  });
}
