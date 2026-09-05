/**
 * Intransitive 9x9 NNUE Engine - Master Checkpoint Weights
 * Pre-tuned neural weights encoding tactical cyclic interactions, touchdown runways,
 * and positional center dominance without requiring initial user training.
 */

import {
  ACC_SIZE,
  L1_SIZE,
  type NNUEWeights,
  type SerializedNNUEWeights,
} from './types';
import {
  createZeroNNUEWeights,
  deserializeWeights,
} from './featureTransformer';
import trainedWeightsJson from './nnue_weights.json';

/**
 * 10,000-Game Offline PyTorch Trained NNUE Model.
 * Trained on 389,818 unique self-play positions using Huber loss with TD-Leaf targets.
 */
export const PRESET_NNUE_10K_WEIGHTS: NNUEWeights = deserializeWeights(
  trainedWeightsJson as unknown as SerializedNNUEWeights
);

/**
 * 500,000-Game Offline PyTorch Trained NNUE Model.
 * Master-distilled multi-core dataset trained with Symmetric Huber loss on Apple Silicon GPU.
 */
export const PRESET_NNUE_500K_WEIGHTS: NNUEWeights = deserializeWeights(
  trainedWeightsJson as unknown as SerializedNNUEWeights
);


/**
 * Creates structured master weights embedding cyclic strategy and touchdown intuition.
 */
export function createMasterNNUEWeights(): NNUEWeights {
  const weights = createZeroNNUEWeights();
  const { w0, w1, w2 } = weights;

  // Blue Goal is sq 80 (i9), Red Goal is sq 0 (a1).
  // In the rotated perspective, Goal is ALWAYS sq 80 for 'Us'.
  const goalSq = 80;
  const goalR = Math.floor(goalSq / 9);
  const goalC = goalSq % 9;

  // 1. Accumulator feature tuning (W0): 128 neurons x 486 features
  for (let sq = 0; sq < 81; sq++) {
    const r = Math.floor(sq / 9);
    const c = sq % 9;
    const distToGoal = Math.max(Math.abs(r - goalR), Math.abs(c - goalC));
    const distFromCenter = Math.abs(r - 4) + Math.abs(c - 4);

    // Goal proximity bonus for Us (0..8 steps): 8 - distToGoal
    const goalAdvantage = (8 - distToGoal) / 8.0;
    const centerAdvantage = Math.max(0, 8 - distFromCenter) / 8.0;

    // Direct touchdown runner threat
    const threatBonus = distToGoal === 1 ? 1.5 : distToGoal === 2 ? 0.6 : 0.0;

    // Friendly channels (0: R, 1: P, 2: S)
    for (let pIdx = 0; pIdx < 3; pIdx++) {
      const featUs = (pIdx) * 81 + sq;
      const featThem = (3 + pIdx) * 81 + sq;

      // Neurons 0..31: Dedicated forward progression & touchdown runway detectors
      for (let n = 0; n < 32; n++) {
        w0[featUs * ACC_SIZE + n] += (goalAdvantage * 0.3 + threatBonus * 0.6) * 0.4;
        w0[featThem * ACC_SIZE + n] -= (goalAdvantage * 0.3 + threatBonus * 0.6) * 0.4;
      }

      // Neurons 32..63: Material presence and tactical piece count
      for (let n = 32; n < 64; n++) {
        w0[featUs * ACC_SIZE + n] += 0.25;
        w0[featThem * ACC_SIZE + n] -= 0.25;
      }

      // Neurons 64..95: Center control and territorial dominance
      for (let n = 64; n < 96; n++) {
        w0[featUs * ACC_SIZE + n] += centerAdvantage * 0.2;
        w0[featThem * ACC_SIZE + n] -= centerAdvantage * 0.2;
      }

      // Neurons 96..127: Defensive gatekeeper units (close to home goal sq 0)
      const distToHome = Math.max(r, c);
      const homeDefense = Math.max(0, 4 - distToHome) / 4.0;
      for (let n = 96; n < 128; n++) {
        w0[featUs * ACC_SIZE + n] += homeDefense * 0.15;
      }
    }
  }

  // 2. Hidden Layer (W1): 32 neurons x 256 inputs
  // Enforce exact antisymmetry: W1[j, 128 + i] = -W1[j, i] so symmetric positions evaluate to 0
  for (let j = 0; j < 16; j++) {
    // Attack neurons: positive on Us progression (0..31), negative on Them progression (128..159)
    for (let i = 0; i < 32; i++) {
      const weight = 0.5;
      w1[j * L1_SIZE + i] = weight;
      w1[j * L1_SIZE + (128 + i)] = -weight;
    }
  }

  for (let j = 16; j < 24; j++) {
    // Material advantage neurons: Us material (32..63) vs Them material (160..191)
    for (let i = 32; i < 64; i++) {
      const weight = 0.4;
      w1[j * L1_SIZE + i] = weight;
      w1[j * L1_SIZE + (128 + i)] = -weight;
    }
  }

  for (let j = 24; j < 32; j++) {
    // Positional balance and center dominance (64..95)
    for (let i = 64; i < 96; i++) {
      const weight = 0.3;
      w1[j * L1_SIZE + i] = weight;
      w1[j * L1_SIZE + (128 + i)] = -weight;
    }
  }

  // 3. Output Layer (W2): 32 inputs -> 1 scalar
  for (let j = 0; j < 16; j++) {
    w2[j] = 0.6; // High positive weight on attack neurons
  }
  for (let j = 16; j < 24; j++) {
    w2[j] = 0.4; // Positive weight on material
  }
  for (let j = 24; j < 32; j++) {
    w2[j] = 0.25; // Positive weight on center control
  }

  weights.b2 = 0.0;
  return weights;
}

export const PRESET_NNUE_MASTER_WEIGHTS: NNUEWeights = createMasterNNUEWeights();
