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
import { evaluateNNUE } from './nnue/nnueEvaluator';
import type { NNUEWeights } from './nnue/types';
import { globalIntransitiveTT, TTFlag } from './transposition';

import {
  findUnstoppableRunway,
  evaluateRunwayRace,
  type UnstoppableRunway,
} from './runway';

export { findUnstoppableRunway, evaluateRunwayRace, type UnstoppableRunway };

export function isNNUEWeights(w: EvaluationWeights | NNUEWeights): w is NNUEWeights {
  return typeof w === 'object' && w !== null && 'w0' in w;
}

export function evaluateAny(game: IntransitiveGame, weights: EvaluationWeights | NNUEWeights): number {
  if (isNNUEWeights(weights)) {
    return evaluateNNUE(game, weights);
  }
  return evaluate(game, weights);
}

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

export const DRAW_CONTEMPT_FACTOR = 120;
export const REPETITION_PENALTY_2FOLD = 60;

/**
 * Chebyshev distance to goal square (number of king-steps).
 */
export function goalChebyshevDist(sq: number, goalSq: number): number {
  const r1 = Math.floor(sq / 9), c1 = sq % 9;
  const r2 = Math.floor(goalSq / 9), c2 = goalSq % 9;
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

/**
 * Checks whether either player has an immediate touchdown threat (runner at distance 1).
 */
export function hasRunnerThreat(game: IntransitiveGame): boolean {
  for (let sq = 0; sq < 81; sq++) {
    const code = game.board[sq];
    if (code === 0) continue;
    // Blue pieces: code 1..3, Red pieces: code 9..11 (high bit set)
    const isBlue = code <= 3;
    const goalSq = isBlue ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;
    if (goalChebyshevDist(sq, goalSq) === 1) {
      return true;
    }
  }
  return false;
}

/**
 * Orders moves tactically: prioritize TT best move, touchdown wins, runner threats (dist 1 & 2), captures, and goal proximity.
 */
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

    // Distance 1 runner threat (immediate M1 threat)
    const aD1 = aDist === 1 ? 10000 : 0;
    const bD1 = bDist === 1 ? 10000 : 0;
    if (aD1 !== bD1) return bD1 - aD1;

    // Distance 2 runner threat
    const aD2 = aDist === 2 ? 3000 : 0;
    const bD2 = bDist === 2 ? 3000 : 0;
    if (aD2 !== bD2) return bD2 - aD2;

    const aCap = a.captured !== undefined ? 1500 : 0;
    const bCap = b.captured !== undefined ? 1500 : 0;
    if (aCap !== bCap) return bCap - aCap;

    return aDist - bDist;
  });
}

/**
 * Minimax search with Alpha-Beta pruning, Transposition Table, Touchdown Threat Extensions, and mate-distance scoring.
 * Score is always evaluated from Blue's perspective (positive = Blue advantage).
 */
export function minimax(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: EvaluationWeights | NNUEWeights,
  ply: number = 0,
  context?: { nodes: number },
  extensions: number = 0
): number {
  if (context) context.nodes++;
  const status = game.isTerminal();
  if (status.isOver) {
    if (status.winner === PLAYER_BLUE) return WIN_SCORE - ply;
    if (status.winner === PLAYER_RED) return LOSS_SCORE + ply;
    if (ply > 0) {
      return game.activePlayer === PLAYER_RED ? -DRAW_CONTEMPT_FACTOR : DRAW_CONTEMPT_FACTOR;
    }
    return DRAW_SCORE;
  }

  // Runway cutoff: if a mathematically unstoppable runway exists, resolve immediately!
  const runwayEval = evaluateRunwayRace(game);
  if (runwayEval) {
    return runwayEval.score > 0 ? runwayEval.score - ply : runwayEval.score + ply;
  }

  // TT probe (internal nodes)
  const origAlpha = alpha;
  const origBeta = beta;
  let ttMove: Move | null = null;

  if (ply > 0) {
    const entry = globalIntransitiveTT.probe(game.zobristKey, ply);
    if (entry) {
      ttMove = entry.bestMove;
      if (entry.depth >= depth) {
        if (entry.flag === TTFlag.Exact) {
          return entry.score;
        } else if (entry.flag === TTFlag.LowerBound) {
          alpha = Math.max(alpha, entry.score);
        } else if (entry.flag === TTFlag.UpperBound) {
          beta = Math.min(beta, entry.score);
        }
        if (alpha >= beta) {
          return entry.score;
        }
      }
    }
  }

  // Touchdown Extension: if a runner is within 1 step of goal, extend search branch by 1 ply (depth >= 3)
  let effectiveDepth = depth;
  let nextExtensions = extensions;
  if (depth >= 3 && extensions < 2 && hasRunnerThreat(game)) {
    effectiveDepth = depth + 1;
    nextExtensions = extensions + 1;
  }

  if (effectiveDepth <= 0) {
    return evaluateAny(game, weights);
  }

  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    const term = game.isTerminal();
    if (term.winner === PLAYER_BLUE) return WIN_SCORE - ply;
    if (term.winner === PLAYER_RED) return LOSS_SCORE + ply;
    return evaluateAny(game, weights);
  }

  // Tactical move ordering: TT best move, touchdown wins, runner threats, captures
  if (effectiveDepth > 1 && moves.length > 1) {
    orderMovesTactically(moves, game.activePlayer, ttMove);
  }

  const isMaximizing = game.activePlayer === PLAYER_BLUE;
  let bestMove: Move | null = moves[0];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      game.makeMove(move);
      const repCount = game.getRepetitionCount();
      let score: number;
      if (repCount >= 3) {
        score = -DRAW_CONTEMPT_FACTOR;
      } else {
        score = minimax(game, effectiveDepth - 1, alpha, beta, weights, ply + 1, context, nextExtensions);
        if (repCount === 2) {
          score -= REPETITION_PENALTY_2FOLD;
        }
      }
      game.unmakeMove();

      if (score > maxEval) {
        maxEval = score;
        bestMove = move;
      }
      if (score > alpha) {
        alpha = score;
      }
      if (beta <= alpha) {
        break; // Beta cutoff
      }
    }

    let flag: (typeof TTFlag)[keyof typeof TTFlag] = TTFlag.Exact;
    if (maxEval <= origAlpha) {
      flag = TTFlag.UpperBound;
    } else if (maxEval >= origBeta) {
      flag = TTFlag.LowerBound;
    }
    globalIntransitiveTT.store(game.zobristKey, depth, maxEval, flag, bestMove, ply);

    return maxEval;
  } else {
    let minEval = Infinity;
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i];
      game.makeMove(move);
      const repCount = game.getRepetitionCount();
      let score: number;
      if (repCount >= 3) {
        score = DRAW_CONTEMPT_FACTOR;
      } else {
        score = minimax(game, effectiveDepth - 1, alpha, beta, weights, ply + 1, context, nextExtensions);
        if (repCount === 2) {
          score += REPETITION_PENALTY_2FOLD;
        }
      }
      game.unmakeMove();

      if (score < minEval) {
        minEval = score;
        bestMove = move;
      }
      if (score < beta) {
        beta = score;
      }
      if (beta <= alpha) {
        break; // Alpha cutoff
      }
    }

    let flag: (typeof TTFlag)[keyof typeof TTFlag] = TTFlag.Exact;
    if (minEval <= origAlpha) {
      flag = TTFlag.UpperBound;
    } else if (minEval >= origBeta) {
      flag = TTFlag.LowerBound;
    }
    globalIntransitiveTT.store(game.zobristKey, depth, minEval, flag, bestMove, ply);

    return minEval;
  }
}

export interface SelectMoveOptions {
  depth?: number;
  temperature?: number;      // Softmax temperature (in centipawns, e.g. 15-20 cp). 0 = greedy.
  rootNoise?: number;        // Dirichlet exploration noise fraction (e.g. 0.25 in AlphaZero). 0 = disabled.
  ply?: number;              // Current game ply for temperature annealing.
  openingPlies?: number;     // Number of initial plies to apply temperature (default 6).
  thinkTimeSec?: number;     // Thinking time budget in seconds (mutually exclusive with fixed depth).
  thinkTimeMs?: number;      // Thinking time budget in milliseconds.
}

/**
 * Core fixed-depth move selection for active player.
 */
function selectMoveFixedDepth(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  optionsOrDepth: number | SelectMoveOptions = 1,
  legacyEpsilon: number = 0.0
): SearchResult {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    return { bestMove: null, score: evaluateAny(game, weights) };
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

  // Increment TT age on root searches
  if (ply === 0) {
    globalIntransitiveTT.incrementAge();
  }

  // Anneal temperature: after openingPlies, drop temperature and noise to 0 for greedy conversion
  const isOpening = openingPlies !== undefined ? ply < openingPlies : true;
  const activeTemp = isOpening ? temperature : 0.0;
  const activeNoise = isOpening ? rootNoise : 0.0;

  // Root move ordering: prioritize touchdown wins, runner threats (dist 1 & 2), captures, and goal proximity
  orderMovesTactically(moves, game.activePlayer);

  const isMaximizing = game.activePlayer === PLAYER_BLUE;
  const scoredMoves: Array<{ move: Move; score: number }> = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    game.makeMove(move);

    let score: number;
    const term = game.isTerminal();
    const repCount = game.getRepetitionCount();

    if (term.isOver) {
      if (term.winner === PLAYER_BLUE) {
        score = WIN_SCORE - 1;
      } else if (term.winner === PLAYER_RED) {
        score = LOSS_SCORE + 1;
      } else {
        score = isMaximizing ? -DRAW_CONTEMPT_FACTOR : DRAW_CONTEMPT_FACTOR;
      }
    } else {
      const runwayEval = evaluateRunwayRace(game);
      if (runwayEval) {
        score = runwayEval.score > 0 ? runwayEval.score - 1 : runwayEval.score + 1;
      } else if (depth <= 1) {
        score = evaluateAny(game, weights);
      } else {
        score = minimax(game, depth - 1, -Infinity, Infinity, weights, 1);
      }
      if (repCount === 2) {
        score += isMaximizing ? -REPETITION_PENALTY_2FOLD : REPETITION_PENALTY_2FOLD;
      }
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
 * Selects a move for the active player.
 * Supports fixed depth (number or { depth }) or time-budgeted iterative deepening ({ thinkTimeSec } / { thinkTimeMs }).
 */
export function selectMove(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  optionsOrDepth: number | SelectMoveOptions = 1,
  legacyEpsilon: number = 0.0
): SearchResult {
  // If time budget is specified, run iterative deepening up to allotted time
  if (
    typeof optionsOrDepth === 'object' &&
    ((optionsOrDepth.thinkTimeSec && optionsOrDepth.thinkTimeSec > 0) ||
      (optionsOrDepth.thinkTimeMs && optionsOrDepth.thinkTimeMs > 0))
  ) {
    const timeLimitMs =
      (optionsOrDepth.thinkTimeSec ? optionsOrDepth.thinkTimeSec * 1000 : optionsOrDepth.thinkTimeMs) ??
      1000;
    const startTime = performance.now();
    const maxSearchDepth = optionsOrDepth.depth ?? 6;
    let bestResult: SearchResult = { bestMove: null, score: evaluateAny(game, weights) };

    for (let d = 1; d <= maxSearchDepth; d++) {
      const singleDepthOpts: SelectMoveOptions = {
        ...optionsOrDepth,
        depth: d,
        thinkTimeSec: undefined,
        thinkTimeMs: undefined,
      };
      const res = selectMoveFixedDepth(game, weights, singleDepthOpts, legacyEpsilon);
      if (res.bestMove) {
        bestResult = res;
      }

      // If decisive touchdown or forced mate is found, exit immediately
      if (Math.abs(res.score) >= WIN_SCORE - 100) {
        break;
      }

      const elapsed = performance.now() - startTime;
      // If we've consumed >= 60% of budget or are within 30ms of the limit, the next depth will overshoot
      if (elapsed >= timeLimitMs * 0.6 || elapsed >= timeLimitMs - 30) {
        break;
      }
    }

    return bestResult;
  }

  // Default: Direct fixed-depth search
  return selectMoveFixedDepth(game, weights, optionsOrDepth, legacyEpsilon);
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
  weights: EvaluationWeights | NNUEWeights,
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
      const score = evaluateAny(game, weights);
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
  weights: EvaluationWeights | NNUEWeights,
  count: number = 5,
  depth: number = 1,
  context?: { nodes: number },
  isAborted?: () => boolean
): RankedMove[] {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) return [];

  const isMaximizing = game.activePlayer === PLAYER_BLUE;

  // Root move ordering: prioritize touchdown wins, runner threats (dist 1 & 2), captures, and goal proximity
  if (moves.length > 1) {
    orderMovesTactically(moves, game.activePlayer);
  }

  const scoredMoves: Array<{
    move: Move;
    score: number;
    san: string;
    threat?: string;
    isMate: boolean;
    mateInPlies?: number;
  }> = [];

  let hasDecisiveMate = false;

  for (let i = 0; i < moves.length; i++) {
    if (isAborted && isAborted()) break;

    const move = moves[i];
    const san = game.formatMoveSAN(move);
    game.makeMove(move);

    let score: number;
    const term = game.isTerminal();
    const repCount = game.getRepetitionCount();

    if (term.isOver) {
      if (context) context.nodes++;
      if (term.winner === PLAYER_BLUE) {
        score = WIN_SCORE - 1;
      } else if (term.winner === PLAYER_RED) {
        score = LOSS_SCORE + 1;
      } else {
        score = isMaximizing ? -DRAW_CONTEMPT_FACTOR : DRAW_CONTEMPT_FACTOR;
      }
    } else {
      const runwayEval = evaluateRunwayRace(game);
      if (runwayEval) {
        if (context) context.nodes++;
        score = runwayEval.score > 0 ? runwayEval.score - 1 : runwayEval.score + 1;
      } else if (hasDecisiveMate && i >= count) {
        if (context) context.nodes++;
        score = evaluateAny(game, weights);
      } else if (depth <= 1) {
        if (context) context.nodes++;
        score = evaluateAny(game, weights);
        if (repCount === 2) {
          score += isMaximizing ? -REPETITION_PENALTY_2FOLD : REPETITION_PENALTY_2FOLD;
        }
      } else {
        score = minimax(game, depth - 1, -Infinity, Infinity, weights, 1, context);
        if (repCount === 2) {
          score += isMaximizing ? -REPETITION_PENALTY_2FOLD : REPETITION_PENALTY_2FOLD;
        }
      }
    }

    game.unmakeMove();

    // Mate / Touchdown detection
    const MATE_THRESHOLD = WIN_SCORE - 100;
    const isMate = Math.abs(score) >= MATE_THRESHOLD;
    if (isMate && ((isMaximizing && score > 0) || (!isMaximizing && score < 0))) {
      hasDecisiveMate = true;
    }
    let mateInPlies: number | undefined;
    if (isMate) {
      if (score > 0) {
        mateInPlies = WIN_SCORE - score;
      } else {
        mateInPlies = score - LOSS_SCORE;
      }
      if (mateInPlies <= 0) mateInPlies = 1;
    }

    // Generate accurate tactical & touchdown descriptor
    let threat: string | undefined;
    if (san.includes('#')) {
      threat = 'Touchdown Goal';
    } else if (term.isOver && term.winner === 'draw') {
      threat = 'Draw (Repetition/50M)';
    } else if (isMate) {
      const movesToMate = Math.max(1, Math.ceil((mateInPlies ?? 1) / 2));
      const isWinningMate = (isMaximizing && score > 0) || (!isMaximizing && score < 0);
      threat = isWinningMate ? `🏆 Forced Win (M${movesToMate})` : `❌ Forced Loss (-M${movesToMate})`;
    } else if (move.captured) {
      threat = `Capture ${move.captured}`;
    }

    scoredMoves.push({ move, score, san, threat, isMate, mateInPlies });
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
    if (isAborted && isAborted()) break;
    const item = scoredMoves[i];

    // Compute continuation line only for the top candidate moves
    game.makeMove(item.move);
    const pv = extractPVContinuation(game, weights, 5);
    game.unmakeMove();

    result.push({
      move: item.move,
      rank: i + 1,
      score: item.score,
      san: item.san,
      threat: item.threat,
      pv,
      isMate: item.isMate,
      mateInPlies: item.mateInPlies,
    });
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

/**
 * Runs an asynchronous or progressive iterative deepening search from Depth 1 to maxDepth.
 * Streams intermediate results after each depth, and stops early on forced mate or cancellation.
 */
export function runIterativeDeepeningAnalysis(
  game: IntransitiveGame,
  weights: EvaluationWeights | NNUEWeights,
  maxDepth: number = 6,
  count: number = 5,
  onProgress?: (result: AnalysisStepResult) => void,
  shouldStop?: () => boolean
): AnalysisStepResult {
  const startTime = performance.now();
  const context = { nodes: 0 };
  let lastResult: RankedMove[] = [];
  let achievedDepth = 1;

  for (let d = 1; d <= maxDepth; d++) {
    if (shouldStop && shouldStop()) break;

    const moves = getTopMoves(game, weights, count, d, context);
    lastResult = moves;
    achievedDepth = d;

    const elapsedMs = Math.max(1, performance.now() - startTime);
    const nps = Math.round((context.nodes * 1000) / elapsedMs);
    const isDone = d === maxDepth;

    const stepResult: AnalysisStepResult = {
      depth: d,
      maxDepth,
      nodes: context.nodes,
      nps,
      timeMs: Math.round(elapsedMs),
      candidateMoves: lastResult,
      isComplete: isDone,
    };

    if (onProgress) {
      onProgress(stepResult);
    }

    // Early termination: if top candidate move is a forced mate / touchdown fully resolved
    if (lastResult.length > 0 && lastResult[0].isMate) {
      const pliesNeeded = lastResult[0].mateInPlies ?? 99;
      if (pliesNeeded <= d) {
        break;
      }
    }
  }

  const totalElapsed = Math.max(1, performance.now() - startTime);
  return {
    depth: achievedDepth,
    maxDepth,
    nodes: context.nodes,
    nps: Math.round((context.nodes * 1000) / totalElapsed),
    timeMs: Math.round(totalElapsed),
    candidateMoves: lastResult,
    isComplete: true,
  };
}
