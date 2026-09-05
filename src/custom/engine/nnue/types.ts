/**
 * Intransitive 9x9 NNUE Engine - Type Definitions
 * Compact, efficiently updatable neural network architecture: 486 -> 128x2 -> 32 -> 1
 */

import type { Player } from '../../core/types';

export const NUM_SQUARES = 81;
export const NUM_CHANNELS = 6; // Us-R, Us-P, Us-S, Them-R, Them-P, Them-S
export const NUM_FEATURES = NUM_SQUARES * NUM_CHANNELS; // 486

export const ACC_SIZE = 128;      // Accumulator size per perspective
export const L1_SIZE = ACC_SIZE * 2; // 256 concatenated inputs to hidden layer
export const L2_SIZE = 32;       // Hidden layer size
export const OUTPUT_SCALE = 600; // Centipawn multiplier for output neuron

export interface NNUEWeights {
  // Feature Transformer (L0 -> Accumulator): 128 x 486
  // Flattened row-major: W0[neuron * NUM_FEATURES + featureIdx]
  w0: Float32Array;
  b0: Float32Array; // 128

  // Hidden Layer (L1 -> L2): 32 x 256
  // Flattened row-major: W1[neuron * L1_SIZE + inputIdx]
  w1: Float32Array;
  b1: Float32Array; // 32

  // Output Layer (L2 -> Output): 1 x 32
  w2: Float32Array; // 32
  b2: number;       // scalar bias
}

export interface NNUEAccumulator {
  blue: Float32Array; // 128 floats (perspective of Blue)
  red: Float32Array;  // 128 floats (perspective of Red)
}

export interface TrainingSample {
  // Sparse active feature indices for Blue and Red perspectives
  activeFeaturesBlue: number[];
  activeFeaturesRed: number[];
  activePlayer: Player;
  searchScore: number;    // Centipawn search evaluation (e.g. -10000..+10000)
  terminalOutcome: number; // +1 (Blue win), -1 (Red win), 0 (Draw)
  isTerminal: boolean;
}

export interface NNUETrainingConfig {
  learningRate: number;      // default 0.001
  weightDecay: number;       // default 1e-4 (AdamW L2 regularization)
  batchSize: number;         // default 256
  lambda: number;            // blend factor: lambda * searchTarget + (1 - lambda) * outcomeTarget (default 0.7)
  replayBufferCapacity: number; // default 50000
}

export interface SerializedNNUEWeights {
  w0: number[];
  b0: number[];
  w1: number[];
  b1: number[];
  w2: number[];
  b2: number;
}
