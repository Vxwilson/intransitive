/**
 * Intransitive 9x9 NNUE Engine - Feature Transformer & Accumulator Caching
 * Computes sparse board feature mappings and handles fast incremental updates on moves.
 */

import { EMPTY, PLAYER_BLUE, decodePiece } from '../../core/types';
import type { Player, PieceType, Move } from '../../core/types';
import type { IntransitiveGame } from '../../core/game';
import {
  NUM_SQUARES,
  ACC_SIZE,
  type NNUEWeights,
  type NNUEAccumulator,
  type SerializedNNUEWeights,
} from './types';

/**
 * Maps a board square from Red's perspective (180 degree rotation).
 * Rotates both rank and file: (8 - rank, 8 - file).
 */
export function rotSq(sq: number): number {
  const file = sq % 9;
  const rank = Math.floor(sq / 9);
  return (8 - rank) * 9 + (8 - file);
}

/**
 * Computes feature index (0..485) from piece type, friendliness, and perspective square.
 * Channels:
 *   0: Friendly Rock
 *   1: Friendly Paper
 *   2: Friendly Scissors
 *   3: Enemy Rock
 *   4: Enemy Paper
 *   5: Enemy Scissors
 */
export function getFeatureIndex(pieceType: PieceType, isFriendly: boolean, square: number): number {
  let pieceOffset = 0;
  if (pieceType === 'P') pieceOffset = 1;
  else if (pieceType === 'S') pieceOffset = 2;

  const channel = (isFriendly ? 0 : 3) + pieceOffset;
  return channel * NUM_SQUARES + square;
}

/**
 * Clones an accumulator (used when branching or backing up state).
 */
export function cloneAccumulator(acc: NNUEAccumulator): NNUEAccumulator {
  return {
    blue: new Float32Array(acc.blue),
    red: new Float32Array(acc.red),
  };
}

/**
 * Creates pure zero-initialized weights structure.
 */
export function createZeroNNUEWeights(): NNUEWeights {
  return {
    w0: new Float32Array(ACC_SIZE * 486),
    b0: new Float32Array(ACC_SIZE),
    w1: new Float32Array(32 * (ACC_SIZE * 2)),
    b1: new Float32Array(32),
    w2: new Float32Array(32),
    b2: 0,
  };
}

/**
 * Creates weights with He/Kaiming normal initialization.
 */
export function createRandomNNUEWeights(seed: number = 42): NNUEWeights {
  const weights = createZeroNNUEWeights();

  // Simple deterministic PRNG (xorshift32)
  let s = seed | 0;
  function rand(): number {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  }

  function randn(std: number): number {
    const u1 = Math.max(1e-15, rand());
    const u2 = rand();
    return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * std;
  }

  // W0: fan_in = 20 active pieces, fan_out = 128 -> std = sqrt(2 / 20) ~ 0.316
  const std0 = Math.sqrt(2.0 / 20.0);
  for (let i = 0; i < weights.w0.length; i++) {
    weights.w0[i] = randn(std0) * 0.5; // slight dampening for stable start
  }
  for (let i = 0; i < weights.b0.length; i++) {
    weights.b0[i] = 0.05; // slight positive bias for Clipped ReLU
  }

  // W1: fan_in = 256, fan_out = 32 -> std = sqrt(2 / 256) ~ 0.088
  const std1 = Math.sqrt(2.0 / 256.0);
  for (let i = 0; i < weights.w1.length; i++) {
    weights.w1[i] = randn(std1);
  }
  for (let i = 0; i < weights.b1.length; i++) {
    weights.b1[i] = 0.02;
  }

  // W2: fan_in = 32, fan_out = 1 -> std = sqrt(2 / 32) ~ 0.25
  const std2 = Math.sqrt(2.0 / 32.0);
  for (let i = 0; i < weights.w2.length; i++) {
    weights.w2[i] = randn(std2);
  }
  weights.b2 = 0;

  return weights;
}

/**
 * Computes accumulator from scratch by scanning all pieces on the board.
 */
export function computeAccumulatorFull(game: IntransitiveGame, weights: NNUEWeights): NNUEAccumulator {
  const blue = new Float32Array(ACC_SIZE);
  const red = new Float32Array(ACC_SIZE);

  // Initialize with bias b0
  blue.set(weights.b0);
  red.set(weights.b0);

  const { w0 } = weights;

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = game.board[sq];
    if (code === EMPTY) continue;

    const piece = decodePiece(code);
    if (!piece) continue;

    const rot = rotSq(sq);

    if (piece.player === PLAYER_BLUE) {
      // Blue is friendly for Blue, enemy for Red
      const featBlue = getFeatureIndex(piece.pieceType, true, sq);
      const featRed = getFeatureIndex(piece.pieceType, false, rot);

      const offsetBlue = featBlue * ACC_SIZE;
      const offsetRed = featRed * ACC_SIZE;

      for (let i = 0; i < ACC_SIZE; i++) {
        blue[i] += w0[offsetBlue + i];
        red[i] += w0[offsetRed + i];
      }
    } else {
      // Red is enemy for Blue, friendly for Red
      const featBlue = getFeatureIndex(piece.pieceType, false, sq);
      const featRed = getFeatureIndex(piece.pieceType, true, rot);

      const offsetBlue = featBlue * ACC_SIZE;
      const offsetRed = featRed * ACC_SIZE;

      for (let i = 0; i < ACC_SIZE; i++) {
        blue[i] += w0[offsetBlue + i];
        red[i] += w0[offsetRed + i];
      }
    }
  }

  return { blue, red };
}

/**
 * Incrementally updates both Blue and Red accumulators for a single move in-place.
 * Takes only ~128-384 float operations (< 0.0002 ms).
 */
export function updateAccumulatorMove(
  acc: NNUEAccumulator,
  move: Move,
  activePlayer: Player,
  weights: NNUEWeights
): void {
  const { from, to, piece, captured } = move;
  const { w0 } = weights;
  const { blue, red } = acc;

  const rotFrom = rotSq(from);
  const rotTo = rotSq(to);

  if (activePlayer === PLAYER_BLUE) {
    // 1. Moving friendly piece for Blue (enemy for Red)
    const fBlueOld = getFeatureIndex(piece, true, from) * ACC_SIZE;
    const fBlueNew = getFeatureIndex(piece, true, to) * ACC_SIZE;
    const fRedOld = getFeatureIndex(piece, false, rotFrom) * ACC_SIZE;
    const fRedNew = getFeatureIndex(piece, false, rotTo) * ACC_SIZE;

    for (let i = 0; i < ACC_SIZE; i++) {
      blue[i] += w0[fBlueNew + i] - w0[fBlueOld + i];
      red[i] += w0[fRedNew + i] - w0[fRedOld + i];
    }

    // 2. Captured piece (was Red piece at 'to' square)
    if (captured) {
      const fBlueCap = getFeatureIndex(captured, false, to) * ACC_SIZE;
      const fRedCap = getFeatureIndex(captured, true, rotTo) * ACC_SIZE;

      for (let i = 0; i < ACC_SIZE; i++) {
        blue[i] -= w0[fBlueCap + i];
        red[i] -= w0[fRedCap + i];
      }
    }
  } else {
    // Active player is Red:
    // 1. Moving friendly piece for Red (enemy for Blue)
    const fRedOld = getFeatureIndex(piece, true, rotFrom) * ACC_SIZE;
    const fRedNew = getFeatureIndex(piece, true, rotTo) * ACC_SIZE;
    const fBlueOld = getFeatureIndex(piece, false, from) * ACC_SIZE;
    const fBlueNew = getFeatureIndex(piece, false, to) * ACC_SIZE;

    for (let i = 0; i < ACC_SIZE; i++) {
      red[i] += w0[fRedNew + i] - w0[fRedOld + i];
      blue[i] += w0[fBlueNew + i] - w0[fBlueOld + i];
    }

    // 2. Captured piece (was Blue piece at 'to' square)
    if (captured) {
      const fRedCap = getFeatureIndex(captured, false, rotTo) * ACC_SIZE;
      const fBlueCap = getFeatureIndex(captured, true, to) * ACC_SIZE;

      for (let i = 0; i < ACC_SIZE; i++) {
        red[i] -= w0[fRedCap + i];
        blue[i] -= w0[fBlueCap + i];
      }
    }
  }
}

/**
 * Extracts active feature indices from the perspective of the specified player.
 */
export function getActiveFeatures(game: IntransitiveGame, perspective: Player): number[] {
  const features: number[] = [];
  const isBlue = perspective === PLAYER_BLUE;

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = game.board[sq];
    if (code === EMPTY) continue;

    const piece = decodePiece(code);
    if (!piece) continue;

    const targetSq = isBlue ? sq : rotSq(sq);
    const isFriendly = piece.player === perspective;
    features.push(getFeatureIndex(piece.pieceType, isFriendly, targetSq));
  }

  return features;
}

/**
 * Serialization helpers for saving/loading NNUE weights in JSON.
 */
export function serializeWeights(weights: NNUEWeights): SerializedNNUEWeights {
  return {
    w0: Array.from(weights.w0),
    b0: Array.from(weights.b0),
    w1: Array.from(weights.w1),
    b1: Array.from(weights.b1),
    w2: Array.from(weights.w2),
    b2: weights.b2,
  };
}

export function deserializeWeights(raw: SerializedNNUEWeights): NNUEWeights {
  return {
    w0: new Float32Array(raw.w0),
    b0: new Float32Array(raw.b0),
    w1: new Float32Array(raw.w1),
    b1: new Float32Array(raw.b1),
    w2: new Float32Array(raw.w2),
    b2: raw.b2,
  };
}
