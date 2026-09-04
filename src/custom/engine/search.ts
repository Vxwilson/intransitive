/**
 * Intransitive Custom Engine - Minimax Alpha-Beta Search & Move Selection
 * Supports depth 1-3 search with epsilon-greedy exploration for self-play training.
 */

import { PLAYER_BLUE } from '../core/types';
import type { Move } from '../core/types';
import type { IntransitiveGame } from '../core/game';
import type { EvaluationWeights, RankedMove } from './types';
import { evaluate, WIN_SCORE, LOSS_SCORE } from './evaluator';

export interface SearchResult {
  bestMove: Move | null;
  score: number;
}

/**
 * Minimax search with Alpha-Beta pruning.
 * Score is always evaluated from Blue's perspective (positive = Blue advantage).
 */
export function minimax(
  game: IntransitiveGame,
  depth: number,
  alpha: number,
  beta: number,
  weights: EvaluationWeights
): number {
  const status = game.isTerminal();
  if (depth === 0 || status.isOver) {
    return evaluate(game, weights);
  }

  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    return evaluate(game, weights);
  }

  const isMaximizing = game.activePlayer === PLAYER_BLUE;

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (let i = 0; i < moves.length; i++) {
      game.makeMove(moves[i]);
      const score = minimax(game, depth - 1, alpha, beta, weights);
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
      const score = minimax(game, depth - 1, alpha, beta, weights);
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

/**
 * Selects the best move for the active player.
 * If epsilon > 0, selects a random legal move with probability epsilon (exploration).
 */
export function selectMove(
  game: IntransitiveGame,
  weights: EvaluationWeights,
  depth: number = 1,
  epsilon: number = 0.0
): SearchResult {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) {
    return { bestMove: null, score: evaluate(game, weights) };
  }

  // Epsilon-greedy exploration during self-play
  if (epsilon > 0 && Math.random() < epsilon) {
    const randomMove = moves[Math.floor(Math.random() * moves.length)];
    game.makeMove(randomMove);
    const score = evaluate(game, weights);
    game.unmakeMove();
    return { bestMove: randomMove, score };
  }

  const isMaximizing = game.activePlayer === PLAYER_BLUE;
  let bestMove: Move | null = null;
  let bestScore = isMaximizing ? -Infinity : Infinity;

  // Shuffle moves slightly to prevent deterministic loops between identical evaluations
  const shuffled = [...moves].sort(() => Math.random() - 0.5);

  for (let i = 0; i < shuffled.length; i++) {
    const move = shuffled[i];
    game.makeMove(move);

    let score: number;
    if (depth <= 1) {
      score = evaluate(game, weights);
    } else {
      score = minimax(game, depth - 1, -Infinity, Infinity, weights);
    }

    game.unmakeMove();

    if (isMaximizing) {
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      // Instant winning move cutoff
      if (score >= WIN_SCORE) {
        break;
      }
    } else {
      if (score < bestScore) {
        bestScore = score;
        bestMove = move;
      }
      // Instant winning move cutoff for Red
      if (score <= LOSS_SCORE) {
        break;
      }
    }
  }

  return { bestMove: bestMove || shuffled[0], score: bestScore };
}

/**
 * Computes top N candidate moves for the current position, sorted from best to worst.
 * Supports 1 to 5 moves with scores, SAN notation, and tactical tags.
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
  const scoredMoves: Array<{ move: Move; score: number; san: string; threat?: string }> = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const san = game.formatMoveSAN(move);
    game.makeMove(move);

    let score: number;
    if (depth <= 1) {
      score = evaluate(game, weights);
    } else {
      score = minimax(game, depth - 1, -Infinity, Infinity, weights);
    }

    game.unmakeMove();

    // Generate brief tactical descriptor
    let threat: string | undefined;
    if (move.captured) {
      threat = `Capture ${move.captured}`;
    } else if (san.includes('#')) {
      threat = 'Touchdown Goal';
    } else if (Math.abs(score) >= WIN_SCORE - 100) {
      threat = 'Winning sequence';
    }

    scoredMoves.push({ move, score, san, threat });
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
    });
  }

  return result;
}
