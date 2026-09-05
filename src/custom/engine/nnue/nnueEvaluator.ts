/**
 * Intransitive 9x9 NNUE Engine - Forward Pass & Static Position Evaluation
 * High-speed inference: (486 -> 128x2 -> 32 -> 1) with Clipped ReLU.
 * Evaluates > 200,000 positions/sec in a single thread.
 */

import { PLAYER_BLUE, PLAYER_RED } from '../../core/types';
import type { Player } from '../../core/types';
import type { IntransitiveGame } from '../../core/game';
import { computeAccumulatorFull } from './featureTransformer';
import {
  ACC_SIZE,
  L1_SIZE,
  L2_SIZE,
  OUTPUT_SCALE,
  type NNUEWeights,
  type NNUEAccumulator,
} from './types';

// Preallocated thread-local buffers to eliminate GC allocations during search
const threadL1 = new Float32Array(L1_SIZE); // 256
const threadL2 = new Float32Array(L2_SIZE); // 32

export const WIN_SCORE = 10000;
export const LOSS_SCORE = -10000;
export const DRAW_SCORE = 0;

/**
 * Evaluates the position using the NNUE neural network.
 * Always returns score from the perspective of BLUE (positive = Blue advantage, negative = Red advantage),
 * matching the evaluation convention in search.ts.
 */
export function evaluateNNUE(
  game: IntransitiveGame,
  weights: NNUEWeights,
  cachedAcc?: NNUEAccumulator
): number {
  // 1. Check terminal status
  const status = game.isTerminal();
  if (status.isOver) {
    if (status.winner === PLAYER_BLUE) return WIN_SCORE;
    if (status.winner === PLAYER_RED) return LOSS_SCORE;
    return DRAW_SCORE;
  }

  // 2. Obtain accumulator (use cached if available, else compute from scratch)
  const acc = cachedAcc ?? computeAccumulatorFull(game, weights);
  const activePlayer = game.activePlayer;

  // Active player is "Us", opponent is "Them"
  const accUs = activePlayer === PLAYER_BLUE ? acc.blue : acc.red;
  const accThem = activePlayer === PLAYER_BLUE ? acc.red : acc.blue;

  // 3. Layer 1: Clipped ReLU activation [0.0, 1.0]
  // First 128 units: active player's accumulator
  // Second 128 units: opponent's accumulator
  for (let i = 0; i < ACC_SIZE; i++) {
    const valUs = accUs[i];
    threadL1[i] = valUs > 0 ? (valUs < 1.0 ? valUs : 1.0) : 0;

    const valThem = accThem[i];
    threadL1[ACC_SIZE + i] = valThem > 0 ? (valThem < 1.0 ? valThem : 1.0) : 0;
  }

  // 4. Layer 2: Hidden Layer (32 units) with Clipped ReLU
  const { w1, b1, w2, b2 } = weights;

  for (let j = 0; j < L2_SIZE; j++) {
    let sum = b1[j];
    const rowOffset = j * L1_SIZE;

    // Unroll by 4 for SIMD/JIT friendly execution
    for (let i = 0; i < L1_SIZE; i += 4) {
      sum +=
        w1[rowOffset + i] * threadL1[i] +
        w1[rowOffset + i + 1] * threadL1[i + 1] +
        w1[rowOffset + i + 2] * threadL1[i + 2] +
        w1[rowOffset + i + 3] * threadL1[i + 3];
    }

    threadL2[j] = sum > 0 ? (sum < 1.0 ? sum : 1.0) : 0;
  }

  // 5. Output Layer: Scalar dot product
  let out = b2;
  for (let j = 0; j < L2_SIZE; j++) {
    out += w2[j] * threadL2[j];
  }

  // 6. Scale output to centipawns
  let scoreActive = out * OUTPUT_SCALE;

  // Apply mild 50-move clock urgency decay
  if (game.halfmoveClock > 0 && Math.abs(scoreActive) > 0) {
    const clockFactor = Math.min(1.0, game.halfmoveClock / 100);
    scoreActive *= 1.0 - 0.25 * clockFactor;
  }

  const cpScore = Math.round(scoreActive);

  // Convert from active player perspective to Blue perspective
  return activePlayer === PLAYER_BLUE ? cpScore : -cpScore;
}

/**
 * Evaluates position from the perspective of a specified player.
 */
export function evaluateNNUEPerspective(
  game: IntransitiveGame,
  weights: NNUEWeights,
  perspective: Player,
  cachedAcc?: NNUEAccumulator
): number {
  const blueScore = evaluateNNUE(game, weights, cachedAcc);
  return perspective === PLAYER_BLUE ? blueScore : -blueScore;
}
