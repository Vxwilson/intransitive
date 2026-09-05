/**
 * Intransitive 9x9 NNUE Engine - Mini-Batch AdamW Trainer & Replay Buffer
 * Implements self-play experience collection, mini-batch sampling, and analytical backpropagation.
 */

import { PLAYER_BLUE } from '../../core/types';
import {
  ACC_SIZE,
  L1_SIZE,
  L2_SIZE,
  NUM_FEATURES,
  type NNUEWeights,
  type TrainingSample,
  type NNUETrainingConfig,
} from './types';

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-15, Math.min(15, x))));
}

export class NNUETrainer {
  public weights: NNUEWeights;
  public config: NNUETrainingConfig;
  public replayBuffer: TrainingSample[] = [];

  // AdamW moment accumulators
  private mW0: Float32Array;
  private vW0: Float32Array;
  private mB0: Float32Array;
  private vB0: Float32Array;

  private mW1: Float32Array;
  private vW1: Float32Array;
  private mB1: Float32Array;
  private vB1: Float32Array;

  private mW2: Float32Array;
  private vW2: Float32Array;
  private mB2: number = 0;
  private vB2: number = 0;

  private step: number = 0;

  constructor(weights: NNUEWeights, config: Partial<NNUETrainingConfig> = {}) {
    this.weights = weights;
    this.config = {
      learningRate: config.learningRate ?? 0.001,
      weightDecay: config.weightDecay ?? 1e-4,
      batchSize: config.batchSize ?? 256,
      lambda: config.lambda ?? 0.7,
      replayBufferCapacity: config.replayBufferCapacity ?? 50000,
    };

    // Initialize moments
    this.mW0 = new Float32Array(ACC_SIZE * NUM_FEATURES);
    this.vW0 = new Float32Array(ACC_SIZE * NUM_FEATURES);
    this.mB0 = new Float32Array(ACC_SIZE);
    this.vB0 = new Float32Array(ACC_SIZE);

    this.mW1 = new Float32Array(L2_SIZE * L1_SIZE);
    this.vW1 = new Float32Array(L2_SIZE * L1_SIZE);
    this.mB1 = new Float32Array(L2_SIZE);
    this.vB1 = new Float32Array(L2_SIZE);

    this.mW2 = new Float32Array(L2_SIZE);
    this.vW2 = new Float32Array(L2_SIZE);
  }

  /**
   * Appends a sample to the replay buffer (FIFO when capacity is reached).
   */
  public addSample(sample: TrainingSample): void {
    if (this.replayBuffer.length >= this.config.replayBufferCapacity) {
      // Overwrite oldest
      const idx = Math.floor(Math.random() * this.replayBuffer.length);
      this.replayBuffer[idx] = sample;
    } else {
      this.replayBuffer.push(sample);
    }
  }

  /**
   * Appends multiple samples from a completed game.
   */
  public addGameTrajectory(samples: TrainingSample[]): void {
    for (let i = 0; i < samples.length; i++) {
      this.addSample(samples[i]);
    }
  }

  /**
   * Executes one mini-batch of gradient descent using AdamW.
   */
  public trainBatch(batchSize: number = this.config.batchSize): { loss: number; samplesTrained: number } {
    if (this.replayBuffer.length === 0) {
      return { loss: 0, samplesTrained: 0 };
    }

    const actualBatch = Math.min(batchSize, this.replayBuffer.length);
    const { learningRate, weightDecay, lambda } = this.config;

    // Allocate batch gradient accumulators
    const gW0 = new Float32Array(ACC_SIZE * NUM_FEATURES);
    const gB0 = new Float32Array(ACC_SIZE);
    const gW1 = new Float32Array(L2_SIZE * L1_SIZE);
    const gB1 = new Float32Array(L2_SIZE);
    const gW2 = new Float32Array(L2_SIZE);
    let gB2 = 0;

    let totalLoss = 0;

    // Temporary activations for backward pass
    const l1 = new Float32Array(L1_SIZE);
    const l2 = new Float32Array(L2_SIZE);
    const dL2 = new Float32Array(L2_SIZE);
    const dL1 = new Float32Array(L1_SIZE);

    const { w0, b0, w1, b1, w2, b2 } = this.weights;

    for (let b = 0; b < actualBatch; b++) {
      // Sample uniformly from buffer
      const sIdx = Math.floor(Math.random() * this.replayBuffer.length);
      const sample = this.replayBuffer[sIdx];

      const isBlue = sample.activePlayer === PLAYER_BLUE;
      const featUs = isBlue ? sample.activeFeaturesBlue : sample.activeFeaturesRed;
      const featThem = isBlue ? sample.activeFeaturesRed : sample.activeFeaturesBlue;

      // 1. Forward Accumulator
      // Clear L1
      for (let i = 0; i < ACC_SIZE; i++) {
        let accUs = b0[i];
        for (let k = 0; k < featUs.length; k++) {
          accUs += w0[featUs[k] * ACC_SIZE + i];
        }
        l1[i] = accUs > 0 ? (accUs < 1.0 ? accUs : 1.0) : 0;

        let accThem = b0[i];
        for (let k = 0; k < featThem.length; k++) {
          accThem += w0[featThem[k] * ACC_SIZE + i];
        }
        l1[ACC_SIZE + i] = accThem > 0 ? (accThem < 1.0 ? accThem : 1.0) : 0;
      }

      // 2. Forward Layer 2
      for (let j = 0; j < L2_SIZE; j++) {
        let sum = b1[j];
        const rOffset = j * L1_SIZE;
        for (let i = 0; i < L1_SIZE; i++) {
          sum += w1[rOffset + i] * l1[i];
        }
        l2[j] = sum > 0 ? (sum < 1.0 ? sum : 1.0) : 0;
      }

      // 3. Forward Output
      let rawOut = b2;
      for (let j = 0; j < L2_SIZE; j++) {
        rawOut += w2[j] * l2[j];
      }

      // 4. Target Calculation (Sigmoid scale: Centipawn / 400)
      const qNorm = isBlue ? sample.searchScore : -sample.searchScore;
      const qProb = sigmoid(qNorm / 400);

      const zNorm = isBlue ? sample.terminalOutcome : -sample.terminalOutcome;
      const zProb = (zNorm + 1.0) / 2.0;

      const target = lambda * qProb + (1 - lambda) * zProb;
      const pred = sigmoid(rawOut);

      // BCE Loss & Gradient w.r.t rawOut: dLoss / dRawOut = pred - target
      const loss = -target * Math.log(Math.max(1e-7, pred)) - (1 - target) * Math.log(Math.max(1e-7, 1 - pred));
      totalLoss += loss;

      const dOut = (pred - target) / actualBatch;

      // 5. Backward Output Layer
      gB2 += dOut;
      for (let j = 0; j < L2_SIZE; j++) {
        gW2[j] += dOut * l2[j];
        dL2[j] = dOut * w2[j];
      }

      // 6. Backward Layer 2 (Hidden)
      for (let j = 0; j < L2_SIZE; j++) {
        // Derivative of Clipped ReLU: 1 if 0 < l2[j] < 1 else 0
        const dAct = l2[j] > 0 && l2[j] < 1.0 ? dL2[j] : 0;
        gB1[j] += dAct;

        const rOffset = j * L1_SIZE;
        for (let i = 0; i < L1_SIZE; i++) {
          gW1[rOffset + i] += dAct * l1[i];
          dL1[i] += dAct * w1[rOffset + i];
        }
      }

      // 7. Backward Layer 1 (Accumulator)
      for (let i = 0; i < ACC_SIZE; i++) {
        const dActUs = l1[i] > 0 && l1[i] < 1.0 ? dL1[i] : 0;
        const dActThem = l1[ACC_SIZE + i] > 0 && l1[ACC_SIZE + i] < 1.0 ? dL1[ACC_SIZE + i] : 0;

        gB0[i] += dActUs + dActThem;

        for (let k = 0; k < featUs.length; k++) {
          gW0[featUs[k] * ACC_SIZE + i] += dActUs;
        }
        for (let k = 0; k < featThem.length; k++) {
          gW0[featThem[k] * ACC_SIZE + i] += dActThem;
        }
      }
    }

    // 8. AdamW Parameter Updates
    this.step++;
    const t = this.step;
    const beta1 = 0.9;
    const beta2 = 0.999;
    const eps = 1e-8;

    const bc1 = 1 - Math.pow(beta1, t);
    const bc2 = 1 - Math.pow(beta2, t);

    function updateParamVector(
      p: Float32Array,
      g: Float32Array,
      m: Float32Array,
      v: Float32Array,
      wd: number
    ) {
      for (let i = 0; i < p.length; i++) {
        // Weight decay
        p[i] -= learningRate * wd * p[i];

        // Gradient update
        m[i] = beta1 * m[i] + (1 - beta1) * g[i];
        v[i] = beta2 * v[i] + (1 - beta2) * g[i] * g[i];

        const mHat = m[i] / bc1;
        const vHat = v[i] / bc2;

        p[i] -= (learningRate * mHat) / (Math.sqrt(vHat) + eps);
      }
    }

    updateParamVector(w0, gW0, this.mW0, this.vW0, weightDecay);
    updateParamVector(b0, gB0, this.mB0, this.vB0, 0); // no weight decay on bias
    updateParamVector(w1, gW1, this.mW1, this.vW1, weightDecay);
    updateParamVector(b1, gB1, this.mB1, this.vB1, 0);
    updateParamVector(w2, gW2, this.mW2, this.vW2, weightDecay);

    // Scalar b2 update
    this.mB2 = beta1 * this.mB2 + (1 - beta1) * gB2;
    this.vB2 = beta2 * this.vB2 + (1 - beta2) * gB2 * gB2;
    const mB2Hat = this.mB2 / bc1;
    const vB2Hat = this.vB2 / bc2;
    this.weights.b2 -= (learningRate * mB2Hat) / (Math.sqrt(vB2Hat) + eps);

    return {
      loss: totalLoss / actualBatch,
      samplesTrained: actualBatch,
    };
  }
}
