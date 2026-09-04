/**
 * Intransitive Custom Engine - Evaluation & Feature Extraction
 * Computes linear positional evaluation V(s) and exact gradient features
 * for TD-Learning backpropagation.
 */

import {
  BOARD_SIZE,
  NUM_SQUARES,
  ADJACENCY_TABLE,
  canCapture,
} from '../core/constants';
import {
  PLAYER_BLUE,
  PLAYER_RED,
  EMPTY,
  decodePiece,
} from '../core/types';
import type { IntransitiveGame } from '../core/game';
import type { EvaluationWeights, StateFeatures } from './types';

export const WIN_SCORE = 10000;
export const LOSS_SCORE = -10000;
export const DRAW_SCORE = 0;

/**
 * Creates a pure Tabula Rasa (0-knowledge) weight set.
 */
export function createZeroWeights(): EvaluationWeights {
  return {
    pieceValues: {
      R: 0,
      P: 0,
      S: 0,
    },
    goalDistanceWeight: 0,
    threatBonus: 0,
    vulnerabilityPenalty: 0,
    tempoBonus: 0,
    pst: {
      R: new Array(NUM_SQUARES).fill(0),
      P: new Array(NUM_SQUARES).fill(0),
      S: new Array(NUM_SQUARES).fill(0),
    },
  };
}

/**
 * Creates an independent deep clone of evaluation weights.
 */
export function cloneWeights(w: EvaluationWeights): EvaluationWeights {
  return {
    pieceValues: { ...w.pieceValues },
    goalDistanceWeight: w.goalDistanceWeight,
    threatBonus: w.threatBonus,
    vulnerabilityPenalty: w.vulnerabilityPenalty,
    tempoBonus: w.tempoBonus,
    pst: {
      R: [...w.pst.R],
      P: [...w.pst.P],
      S: [...w.pst.S],
    },
  };
}

/**
 * Creates heuristic baseline weights for benchmarks and arena play.
 */
export function createHeuristicWeights(): EvaluationWeights {
  const weights = createZeroWeights();
  weights.pieceValues = { R: 100, P: 100, S: 100 };
  weights.goalDistanceWeight = 20;
  weights.threatBonus = 15;
  weights.vulnerabilityPenalty = 20;
  weights.tempoBonus = 5;

  // Center encouragement
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const f = sq % BOARD_SIZE;
    const r = Math.floor(sq / BOARD_SIZE);
    const distFromCenter = Math.abs(f - 4) + Math.abs(r - 4);
    const bonus = Math.max(0, 8 - distFromCenter) * 2;
    weights.pst.R[sq] = bonus;
    weights.pst.P[sq] = bonus;
    weights.pst.S[sq] = bonus;
  }

  return weights;
}

/**
 * Extracts analytical feature vector x(s) where V(s) = w^T x(s).
 * The feature vector represents the exact gradient dV/dw.
 */
export function extractFeatures(game: IntransitiveGame): StateFeatures {
  let blueGoalProx = 0;
  let redGoalProx = 0;

  let blueThreats = 0;
  let redThreats = 0;
  let blueVulns = 0;
  let redVulns = 0;

  const pstDeltas = {
    R: new Float32Array(NUM_SQUARES),
    P: new Float32Array(NUM_SQUARES),
    S: new Float32Array(NUM_SQUARES),
  };

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = game.board[sq];
    if (code === EMPTY) continue;

    const piece = decodePiece(code);
    if (!piece) continue;

    const file = sq % BOARD_SIZE;
    const rank = Math.floor(sq / BOARD_SIZE);

    if (piece.player === PLAYER_BLUE) {
      // Blue goal is i9 (file 8, rank 8). Max Manhattan distance is 16.
      const distToGoal = (8 - file) + (8 - rank);
      blueGoalProx += 16 - distToGoal;

      // PST delta for Blue
      pstDeltas[piece.pieceType][sq] += 1;
    } else {
      // Red goal is a1 (file 0, rank 0).
      const distToGoal = file + rank;
      redGoalProx += 16 - distToGoal;

      // PST delta for Red (rotational symmetry around e5)
      const rotSq = (8 - rank) * BOARD_SIZE + (8 - file);
      pstDeltas[piece.pieceType][rotSq] -= 1;
    }

    // Threats and vulnerabilities to adjacent squares
    const neighbors = ADJACENCY_TABLE[sq];
    for (let i = 0; i < neighbors.length; i++) {
      const neighborCode = game.board[neighbors[i]];
      if (neighborCode === EMPTY) continue;

      const neighborPiece = decodePiece(neighborCode);
      if (!neighborPiece || neighborPiece.player === piece.player) continue;

      // Attacking prey
      if (canCapture(piece.pieceType, neighborPiece.pieceType)) {
        if (piece.player === PLAYER_BLUE) {
          blueThreats++;
        } else {
          redThreats++;
        }
      }

      // Vulnerable to predator
      if (canCapture(neighborPiece.pieceType, piece.pieceType)) {
        if (piece.player === PLAYER_BLUE) {
          blueVulns++;
        } else {
          redVulns++;
        }
      }
    }
  }

  return {
    materialR: game.blueCounts.R - game.redCounts.R,
    materialP: game.blueCounts.P - game.redCounts.P,
    materialS: game.blueCounts.S - game.redCounts.S,
    goalDistanceAdvantage: blueGoalProx - redGoalProx,
    threatAdvantage: blueThreats - redThreats,
    vulnerabilityAdvantage: redVulns - blueVulns,
    tempoAdvantage: game.activePlayer === PLAYER_BLUE ? 1 : -1,
    pstDeltas,
  };
}

/**
 * Evaluates board position. Always returns score from perspective of Blue:
 * Positive score = Blue advantage, Negative score = Red advantage.
 */
export function evaluate(game: IntransitiveGame, weights: EvaluationWeights): number {
  // Check terminal state
  const status = game.isTerminal();
  if (status.isOver) {
    if (status.winner === PLAYER_BLUE) return WIN_SCORE;
    if (status.winner === PLAYER_RED) return LOSS_SCORE;
    return DRAW_SCORE;
  }

  const features = extractFeatures(game);

  let score =
    features.materialR * weights.pieceValues.R +
    features.materialP * weights.pieceValues.P +
    features.materialS * weights.pieceValues.S +
    features.goalDistanceAdvantage * weights.goalDistanceWeight +
    features.threatAdvantage * weights.threatBonus +
    features.vulnerabilityAdvantage * weights.vulnerabilityPenalty +
    features.tempoAdvantage * weights.tempoBonus;

  // PST evaluation
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    if (features.pstDeltas.R[sq] !== 0) score += features.pstDeltas.R[sq] * weights.pst.R[sq];
    if (features.pstDeltas.P[sq] !== 0) score += features.pstDeltas.P[sq] * weights.pst.P[sq];
    if (features.pstDeltas.S[sq] !== 0) score += features.pstDeltas.S[sq] * weights.pst.S[sq];
  }

  return Math.round(score);
}
