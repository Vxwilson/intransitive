/**
 * Intransitive Custom Engine - Minimax Alpha-Beta Search & Move Selection
 * Supports depth 1-3 search with epsilon-greedy exploration for self-play training.
 */

import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import { BLUE_GOAL_SQUARE, RED_GOAL_SQUARE } from '../core/constants';
import type { IntransitiveGame } from '../core/game';
import type { EvaluationWeights, RankedMove } from './types';
import { evaluate, WIN_SCORE, LOSS_SCORE, DRAW_SCORE } from './evaluator';

export interface SearchResult {
  bestMove: Move | null;
  score: number;
}

/**
 * Format score into display string:
 * - If forced win/mate: "+M1", "+M2", "-M1", "-M2" (moves to mate)
 * - If standard score: "+250", "-120", "0"
 */
export function formatEvalScore(
  score: number,
  isMate?: boolean,
  mateInPlies?: number
): string {
  const MATE_THRESHOLD = WIN_SCORE - 100;
  if (isMate || Math.abs(score) >= MATE_THRESHOLD) {
    const plies = Math.max(1, mateInPlies ?? (score > 0 ? WIN_SCORE - score : score - LOSS_SCORE));
    const moves = Math.max(1, Math.ceil(plies / 2));
    const sign = score >= 0 ? '+' : '-';
    return `${sign}M${moves}`;
  }
  return score > 0 ? `+${score}` : `${score}`;
}

/**
 * Minimax search with Alpha-Beta pruning and mate-distance scoring.
 * Score is always evaluated from Blue's perspective (positive = Blue advantage).
 */
export function minimax(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: EvaluationWeights,
  ply: number = 0
): number {
  const status = game.isTerminal();
  if (status.isOver) {
    if (status.winner === PLAYER_BLUE) return WIN_SCORE - ply;
    if (status.winner === PLAYER_RED) return LOSS_SCORE + ply;
    return DRAW_SCORE;
  }
  if (depth === 0) {
    return evaluate(game, weights);
  }

  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    const term = game.isTerminal();
    if (term.winner === PLAYER_BLUE) return WIN_SCORE - ply;
    if (term.winner === PLAYER_RED) return LOSS_SCORE + ply;
    return evaluate(game, weights);
  }

  // Tactical move ordering: prioritize touchdown wins and captures to maximize alpha-beta cutoffs
  if (depth > 1 && moves.length > 1) {
    const goalSquare = game.activePlayer === PLAYER_BLUE ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;
    moves.sort((a, b) => {
      const aGoal = a.to === goalSquare ? 10000 : 0;
      const bGoal = b.to === goalSquare ? 10000 : 0;
      if (aGoal !== bGoal) return bGoal - aGoal;
      const aCap = a.captured !== undefined ? 1000 : 0;
      const bCap = b.captured !== undefined ? 1000 : 0;
      return bCap - aCap;
    });
  }

  const isMaximizing = game.activePlayer === PLAYER_BLUE;

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      game.makeMove(moves[i]);
      const score = minimax(game, depth - 1, alpha, beta, weights, ply + 1);
      game.unmakeMove();

      if (score > maxEval) {
        maxEval = score;
      }
      if (score > alpha) {
        alpha = score;
      }
      if (beta <= alpha) {
        break; // Beta cutoff
      }
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (let i = 0; i < moves.length; i++) {
      game.makeMove(moves[i]);
      const score = minimax(game, depth - 1, alpha, beta, weights, ply + 1);
      game.unmakeMove();

      if (score < minEval) {
        minEval = score;
      }
      if (score < beta) {
        beta = score;
      }
      if (beta <= alpha) {
        break; // Alpha cutoff
      }
    }
    return minEval;
  }
}

export interface SelectMoveOptions {
  depth?: number;
  temperature?: number;      // Softmax temperature (in centipawns, e.g. 15-20 cp). 0 = greedy.
  rootNoise?: number;        // Dirichlet exploration noise fraction (e.g. 0.25 in AlphaZero). 0 = disabled.
  ply?: number;              // Current game ply for temperature annealing.
  openingPlies?: number;     // Number of initial plies to apply temperature (default 6).
}

/**
 * Selects a move for the active player using AlphaZero-style Softmax temperature
 * sampling and Dirichlet root noise, with automatic annealing to deterministic play.
 */
export function selectMove(
  game: IntransitiveGame,
  weights: EvaluationWeights,
  optionsOrDepth: number | SelectMoveOptions = 1,
  legacyEpsilon: number = 0.0
): SearchResult {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    return { bestMove: null, score: evaluate(game, weights) };
  }

  // Parse options
  let depth = 1;
  let temperature = 0.0;
  let rootNoise = 0.0;
  let ply = 0;
  let openingPlies: number | undefined = undefined;

  if (typeof optionsOrDepth === 'number') {
    depth = optionsOrDepth;
    if (legacyEpsilon > 0 && Math.random() < legacyEpsilon) {
      temperature = 25.0; // convert legacy epsilon into soft exploration
    }
  } else {
    depth = optionsOrDepth.depth ?? 1;
    temperature = optionsOrDepth.temperature ?? 0.0;
    rootNoise = optionsOrDepth.rootNoise ?? 0.0;
    ply = optionsOrDepth.ply ?? 0;
    openingPlies = optionsOrDepth.openingPlies;
  }

  // Anneal temperature: after openingPlies, drop temperature and noise to 0 for greedy conversion
  const isOpening = openingPlies !== undefined ? ply < openingPlies : true;
  const activeTemp = isOpening ? temperature : 0.0;
  const activeNoise = isOpening ? rootNoise : 0.0;

  const isMaximizing = game.activePlayer === PLAYER_BLUE;
  const scoredMoves: Array<{ move: Move; score: number }> = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    game.makeMove(move);

    let score: number;
    if (depth <= 1) {
      score = evaluate(game, weights);
    } else {
      score = minimax(game, depth - 1, -Infinity, Infinity, weights, 1);
    }

    game.unmakeMove();

    // Instant win cutoff: always play immediate decisive touchdowns
    if (isMaximizing && score >= WIN_SCORE - 100) {
      return { bestMove: move, score };
    }
    if (!isMaximizing && score <= LOSS_SCORE + 100) {
      return { bestMove: move, score };
    }

    scoredMoves.push({ move, score });
  }

  // If activeTemp is 0 (or near 0), perform exact greedy argmax
  if (activeTemp <= 0.001) {
    let bestMove = scoredMoves[0].move;
    let bestScore = scoredMoves[0].score;

    for (let i = 1; i < scoredMoves.length; i++) {
      if (isMaximizing) {
        if (scoredMoves[i].score > bestScore) {
          bestScore = scoredMoves[i].score;
          bestMove = scoredMoves[i].move;
        }
      } else {
        if (scoredMoves[i].score < bestScore) {
          bestScore = scoredMoves[i].score;
          bestMove = scoredMoves[i].move;
        }
      }
    }
    return { bestMove, score: bestScore };
  }

  // AlphaZero Softmax Policy Calculation
  const bestScore = isMaximizing
    ? Math.max(...scoredMoves.map((m) => m.score))
    : Math.min(...scoredMoves.map((m) => m.score));

  // Compute base Softmax distribution
  const baseProbs = scoredMoves.map((m) => {
    const delta = isMaximizing
      ? (m.score - bestScore) / activeTemp
      : (bestScore - m.score) / activeTemp;
    return Math.exp(Math.max(-30, delta));
  });

  const sumBase = baseProbs.reduce((acc, p) => acc + p, 0);
  let finalProbs = baseProbs.map((p) => (sumBase > 0 ? p / sumBase : 1 / baseProbs.length));

  // Blend Dirichlet root noise (if activeNoise > 0, e.g. 0.25 in self-play training)
  if (activeNoise > 0) {
    const alpha = 0.3; // AlphaZero parameter for game branching
    const gammas = scoredMoves.map(() => sampleGamma(alpha));
    const sumGamma = gammas.reduce((acc, g) => acc + g, 0);
    const noiseVector = gammas.map((g) => (sumGamma > 0 ? g / sumGamma : 1 / gammas.length));

    finalProbs = finalProbs.map(
      (p, idx) => (1 - activeNoise) * p + activeNoise * noiseVector[idx]
    );
  }

  // Sample move from final distribution
  const r = Math.random();
  let cumulative = 0;
  let selectedIndex = 0;

  for (let i = 0; i < finalProbs.length; i++) {
    cumulative += finalProbs[i];
    if (r <= cumulative) {
      selectedIndex = i;
      break;
    }
  }

  return {
    bestMove: scoredMoves[selectedIndex].move,
    score: scoredMoves[selectedIndex].score,
  };
}

/**
 * Samples a Gamma(alpha, 1) random variable using Marsaglia and Tsang method.
 * Used for generating exact Dirichlet distributions.
 */
function sampleGamma(alpha: number): number {
  if (alpha < 1) {
    const u = Math.max(1e-10, Math.random());
    return sampleGamma(alpha + 1) * Math.pow(u, 1 / alpha);
  }
  const d = alpha - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (let iter = 0; iter < 100; iter++) {
    const u1 = Math.max(1e-10, Math.random());
    const u2 = Math.random();
    const z = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const v = 1 + c * z;
    if (v <= 0) continue;
    const v3 = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * z * z * z * z) return d * v3;
    if (Math.log(u) < 0.5 * z * z + d * (1 - v3 + Math.log(v3))) return d * v3;
  }
  return 1.0;
}

/**
 * Extracts a continuation line (Principal Variation) of up to `maxPlies` subsequent moves.
 * Alternates between players picking their best evaluated response.
 */
function extractPVContinuation(
  game: IntransitiveGame,
  weights: EvaluationWeights,
  maxPlies: number = 5
): string[] {
  const pv: string[] = [];
  let unmakeCount = 0;

  for (let step = 0; step < maxPlies; step++) {
    const term = game.isTerminal();
    if (term.isOver) break;

    const replies = game.generateLegalMoves();
    if (replies.length === 0) break;

    const isBlue = game.activePlayer === PLAYER_BLUE;
    let bestReply: Move | null = null;
    let bestScore = isBlue ? -Infinity : Infinity;

    for (let j = 0; j < replies.length; j++) {
      const reply = replies[j];
      game.makeMove(reply);
      const score = evaluate(game, weights);
      game.unmakeMove();

      if (isBlue) {
        if (score > bestScore) {
          bestScore = score;
          bestReply = reply;
        }
      } else {
        if (score < bestScore) {
          bestScore = score;
          bestReply = reply;
        }
      }
    }

    if (!bestReply) break;

    const san = game.formatMoveSAN(bestReply);
    pv.push(san);
    game.makeMove(bestReply);
    unmakeCount++;
  }

  for (let k = 0; k < unmakeCount; k++) {
    game.unmakeMove();
  }

  return pv;
}

/**
 * Computes top N candidate moves for the current position, sorted from best to worst.
 * Supports 1 to 5 moves with scores, SAN notation, tactical tags, and up to 5-move PV lines.
 */
export function getTopMoves(
  game: IntransitiveGame,
  weights: EvaluationWeights,
  count: number = 5,
  depth: number = 1
): RankedMove[] {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) return [];

  const isMaximizing = game.activePlayer === PLAYER_BLUE;
  const scoredMoves: Array<{
    move: Move;
    score: number;
    san: string;
    threat?: string;
    pv: string[];
    isMate: boolean;
    mateInPlies?: number;
  }> = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const san = game.formatMoveSAN(move);
    game.makeMove(move);

    let score: number;
    if (depth <= 1) {
      score = evaluate(game, weights);
    } else {
      score = minimax(game, depth - 1, -Infinity, Infinity, weights, 1);
    }

    // Extract up to 5 subsequent moves for the continuation line
    const pv = extractPVContinuation(game, weights, 5);

    game.unmakeMove();

    // Mate detection
    const MATE_THRESHOLD = WIN_SCORE - 100;
    const isMate = Math.abs(score) >= MATE_THRESHOLD;
    let mateInPlies: number | undefined;
    if (isMate) {
      if (score > 0) {
        mateInPlies = WIN_SCORE - score;
      } else {
        mateInPlies = score - LOSS_SCORE;
      }
      if (mateInPlies <= 0) mateInPlies = 1;
    }

    // Generate brief tactical descriptor
    let threat: string | undefined;
    if (san.includes('#')) {
      threat = 'Touchdown Goal';
    } else if (isMate) {
      threat = `Forced Win (${formatEvalScore(score, isMate, mateInPlies)})`;
    } else if (move.captured) {
      threat = `Capture ${move.captured}`;
    }

    scoredMoves.push({ move, score, san, threat, pv, isMate, mateInPlies });
  }

  // Sort best to worst based on active player
  if (isMaximizing) {
    scoredMoves.sort((a, b) => b.score - a.score);
  } else {
    scoredMoves.sort((a, b) => a.score - b.score);
  }

  const limit = Math.min(count, scoredMoves.length);
  const result: RankedMove[] = [];
  for (let i = 0; i < limit; i++) {
    result.push({
      move: scoredMoves[i].move,
      rank: i + 1,
      score: scoredMoves[i].score,
      san: scoredMoves[i].san,
      threat: scoredMoves[i].threat,
      pv: scoredMoves[i].pv,
      isMate: scoredMoves[i].isMate,
      mateInPlies: scoredMoves[i].mateInPlies,
    });
  }

  return result;
}
