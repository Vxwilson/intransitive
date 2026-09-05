/**
 * Intransitive Custom Engine - TD(lambda) Reinforcement Learning
 * Implements Temporal Difference Leaf learning on linear evaluation parameters.
 */

import { NUM_SQUARES } from '../core/constants';
import type { EvaluationWeights, StateFeatures, TrainingConfig } from './types';

export interface TrajectoryStep {
  features: StateFeatures;
  evalScore: number;
}

export class TDLearner {
  public config: TrainingConfig;

  constructor(config: Partial<TrainingConfig> = {}) {
    this.config = {
      learningRate: config.learningRate ?? 0.015,
      learningRateAnnealing: config.learningRateAnnealing ?? true,
      lambda: config.lambda ?? 0.7,
      epsilon: config.epsilon ?? 0.10,
      searchDepth: config.searchDepth ?? 1,
      maxPliesPerGame: config.maxPliesPerGame ?? 80,
    };
  }

  /**
   * Computes current effective learning rate based on generation count.
   * Uses square-root decay schedule: alpha(gen) = max(0.002, alpha_0 / sqrt(1 + gen / 2500)).
   */
  public getEffectiveLearningRate(generation: number = 0): number {
    const base = this.config.learningRate;
    if (this.config.learningRateAnnealing === false) {
      return base;
    }
    const decayed = base / Math.sqrt(1 + Math.max(0, generation) / 2500);
    return Math.max(0.002, decayed);
  }

  /**
   * Applies TD(lambda) updates to the weights using the game trajectory and terminal outcome.
   *
   * @param weights Current evaluation weights (mutated in-place and returned)
   * @param trajectory Sequence of state feature vectors and evaluations during the game
   * @param terminalOutcome Terminal reward: +1000 (Blue Win), -1000 (Red Win), 0 (Draw)
   * @param currentGeneration Optional generation index for learning rate annealing
   */
  public updateWeights(
    weights: EvaluationWeights,
    trajectory: TrajectoryStep[],
    terminalOutcome: number,
    currentGeneration: number = 0
  ): EvaluationWeights {
    const T = trajectory.length;
    if (T === 0) return weights;

    const { lambda } = this.config;
    const effectiveAlpha = this.getEffectiveLearningRate(currentGeneration);

    // Compute TD errors: delta_t = V(s_{t+1}) - V(s_t)
    const deltas: number[] = new Array(T);
    for (let t = 0; t < T - 1; t++) {
      deltas[t] = trajectory[t + 1].evalScore - trajectory[t].evalScore;
    }
    // Terminal delta
    deltas[T - 1] = terminalOutcome - trajectory[T - 1].evalScore;

    // Backward eligibility trace accumulation
    // E_t = delta_t + lambda * E_{t+1}
    const E: number[] = new Array(T);
    let runningE = 0;
    for (let t = T - 1; t >= 0; t--) {
      runningE = deltas[t] + lambda * runningE;
      E[t] = runningE;
    }

    // Accumulate gradients
    let dR = 0;
    let dP = 0;
    let dS = 0;
    let dGoal = 0;
    let dRunner = 0;
    let dThreat = 0;
    let dVuln = 0;
    let dTempo = 0;

    const dPstR = new Float32Array(NUM_SQUARES);
    const dPstP = new Float32Array(NUM_SQUARES);
    const dPstS = new Float32Array(NUM_SQUARES);

    // Scaling factor to normalize step size across game length
    const scale = effectiveAlpha / Math.sqrt(T);

    for (let t = 0; t < T; t++) {
      const err = E[t] * scale;
      const feat = trajectory[t].features;

      dR += err * feat.materialR;
      dP += err * feat.materialP;
      dS += err * feat.materialS;
      // Normalize goal gradient to match material feature scale (goal proximity sums across pieces)
      dGoal += (err * feat.goalDistanceAdvantage) * 0.15;
      dRunner += err * feat.runnerAdvantage;
      dThreat += err * feat.threatAdvantage;
      dVuln += err * feat.vulnerabilityAdvantage;
      dTempo += err * feat.tempoAdvantage;

      for (let sq = 0; sq < NUM_SQUARES; sq++) {
        if (feat.pstDeltas.R[sq] !== 0) dPstR[sq] += err * feat.pstDeltas.R[sq];
        if (feat.pstDeltas.P[sq] !== 0) dPstP[sq] += err * feat.pstDeltas.P[sq];
        if (feat.pstDeltas.S[sq] !== 0) dPstS[sq] += err * feat.pstDeltas.S[sq];
      }
    }

    // Gradient delta clipping per game to prevent outlier shock
    const MAX_PIECE_DELTA = 3.0;
    dR = Math.max(-MAX_PIECE_DELTA, Math.min(MAX_PIECE_DELTA, dR));
    dP = Math.max(-MAX_PIECE_DELTA, Math.min(MAX_PIECE_DELTA, dP));
    dS = Math.max(-MAX_PIECE_DELTA, Math.min(MAX_PIECE_DELTA, dS));

    const MAX_PARAM_DELTA = 3.0;
    dGoal = Math.max(-MAX_PARAM_DELTA, Math.min(MAX_PARAM_DELTA, dGoal));
    dRunner = Math.max(-MAX_PARAM_DELTA, Math.min(MAX_PARAM_DELTA, dRunner));
    dThreat = Math.max(-MAX_PARAM_DELTA, Math.min(MAX_PARAM_DELTA, dThreat));
    dVuln = Math.max(-MAX_PARAM_DELTA, Math.min(MAX_PARAM_DELTA, dVuln));
    dTempo = Math.max(-MAX_PARAM_DELTA, Math.min(MAX_PARAM_DELTA, dTempo));

    // Apply updates with minimum piece floor of 5.0 (pieces never become 1-value throwaway tokens)
    let newR = Math.max(5.0, Math.min(300, weights.pieceValues.R + dR));
    let newP = Math.max(5.0, Math.min(300, weights.pieceValues.P + dP));
    let newS = Math.max(5.0, Math.min(300, weights.pieceValues.S + dS));

    // Adaptive mean-centering regularization to stabilize cyclic limit cycles (R > S > P > R)
    // Prevents runaways (e.g. Paper ballooning to 155 while Scissors crashes to 79)
    const meanVal = (newR + newP + newS) / 3;
    if (meanVal > 15) {
      const maxDev = Math.max(Math.abs(newR - meanVal), Math.abs(newP - meanVal), Math.abs(newS - meanVal));
      const decay = maxDev > 25 ? 0.02 : 0.005;
      newR = Math.max(5.0, newR - (newR - meanVal) * decay);
      newP = Math.max(5.0, newP - (newP - meanVal) * decay);
      newS = Math.max(5.0, newS - (newS - meanVal) * decay);
    }

    weights.pieceValues.R = newR;
    weights.pieceValues.P = newP;
    weights.pieceValues.S = newS;

    // Anchor goal distance weight with a minimum floor of 10.0 so the engine never unlearns touchdown
    weights.goalDistanceWeight = Math.max(10.0, Math.min(100, weights.goalDistanceWeight + dGoal));
    weights.runnerWeight = Math.max(15.0, Math.min(120, (weights.runnerWeight ?? 80) + dRunner));
    weights.threatBonus = Math.max(2.0, Math.min(50, weights.threatBonus + dThreat));
    weights.vulnerabilityPenalty = Math.max(2.0, Math.min(50, weights.vulnerabilityPenalty + dVuln));
    weights.tempoBonus = Math.max(0, Math.min(20, weights.tempoBonus + dTempo));


    // Update PST tables
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      weights.pst.R[sq] = Math.max(-50, Math.min(50, weights.pst.R[sq] + dPstR[sq]));
      weights.pst.P[sq] = Math.max(-50, Math.min(50, weights.pst.P[sq] + dPstP[sq]));
      weights.pst.S[sq] = Math.max(-50, Math.min(50, weights.pst.S[sq] + dPstS[sq]));
    }

    return weights;
  }
}
