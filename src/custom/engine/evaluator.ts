/**
 * Intransitive Custom Engine - Evaluation & Feature Extraction
 * Computes linear positional evaluation V(s) and exact gradient features
 * for TD-Learning backpropagation.
 */

import {
  BOARD_SIZE,
  NUM_SQUARES,
  ADJACENCY_TABLE,
  BLUE_GOAL_SQUARE,
  RED_GOAL_SQUARE,
  canCapture,
} from '../core/constants';
import {
  PLAYER_BLUE,
  PLAYER_RED,
  EMPTY,
  decodePiece,
} from '../core/types';

/**
 * Chebyshev distance on 9x9 board (number of 8-directional King steps).
 */
export function chebyshevDist(sq1: number, sq2: number): number {
  const f1 = sq1 % BOARD_SIZE;
  const r1 = Math.floor(sq1 / BOARD_SIZE);
  const f2 = sq2 % BOARD_SIZE;
  const r2 = Math.floor(sq2 / BOARD_SIZE);
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}
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
    runnerWeight: 0,
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
    runnerWeight: w.runnerWeight !== undefined ? w.runnerWeight : 80,
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
  weights.runnerWeight = 80;
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
 * Computes tactical runner threat units for Blue and Red.
 * An uncatchable runner is a piece within 3 steps of the goal where no enemy
 * predator can intercept it before it touches down.
 */
export function computeRunnerUnits(game: IntransitiveGame): { blueRunnerUnits: number; redRunnerUnits: number } {
  let blueRunnerUnits = 0;
  let redRunnerUnits = 0;

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = game.board[sq];
    if (code === EMPTY) continue;

    const piece = decodePiece(code);
    if (!piece) continue;

    const isBlue = piece.player === PLAYER_BLUE;
    const goalSq = isBlue ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;
    const dist = chebyshevDist(sq, goalSq);

    if (dist <= 3 && dist > 0) {
      // Check if goal square is blocked by friendly piece or uncapturable enemy piece
      const goalCode = game.board[goalSq];
      let goalBlocked = false;
      if (goalCode !== EMPTY) {
        const goalPiece = decodePiece(goalCode);
        if (goalPiece && (goalPiece.player === piece.player || !canCapture(piece.pieceType, goalPiece.pieceType))) {
          goalBlocked = true;
        }
      }

      if (!goalBlocked) {
        let canBeIntercepted = false;
        for (let eSq = 0; eSq < NUM_SQUARES; eSq++) {
          const eCode = game.board[eSq];
          if (eCode === EMPTY) continue;
          const enemy = decodePiece(eCode);
          if (!enemy || enemy.player === piece.player) continue;

          if (canCapture(enemy.pieceType, piece.pieceType)) {
            const predatorDistToGoal = chebyshevDist(eSq, goalSq);
            const predatorDistToRunner = chebyshevDist(eSq, sq);
            if (Math.min(predatorDistToGoal, predatorDistToRunner) <= dist) {
              canBeIntercepted = true;
              break;
            }
          }
        }

        if (!canBeIntercepted) {
          let units = 0;
          if (dist === 1) units = 5;
          else if (dist === 2) units = 3;
          else if (dist === 3) units = 1;

          if (isBlue) blueRunnerUnits = Math.max(blueRunnerUnits, units);
          else redRunnerUnits = Math.max(redRunnerUnits, units);
        }
      }
    }
  }

  return { blueRunnerUnits, redRunnerUnits };
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
      // Blue goal is i9. True 8-way King distance is Chebyshev (max 8).
      const distToGoal = chebyshevDist(sq, BLUE_GOAL_SQUARE);
      blueGoalProx += 8 - distToGoal;

      // PST delta for Blue
      pstDeltas[piece.pieceType][sq] += 1;
    } else {
      // Red goal is a1.
      const distToGoal = chebyshevDist(sq, RED_GOAL_SQUARE);
      redGoalProx += 8 - distToGoal;

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

  const { blueRunnerUnits, redRunnerUnits } = computeRunnerUnits(game);

  return {
    materialR: game.blueCounts.R - game.redCounts.R,
    materialP: game.blueCounts.P - game.redCounts.P,
    materialS: game.blueCounts.S - game.redCounts.S,
    goalDistanceAdvantage: blueGoalProx - redGoalProx,
    runnerAdvantage: blueRunnerUnits - redRunnerUnits,
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
  const runnerWeight = weights.runnerWeight !== undefined ? weights.runnerWeight : 100;
  const rVal = weights.pieceValues?.R ?? 100;
  const pVal = weights.pieceValues?.P ?? 100;
  const sVal = weights.pieceValues?.S ?? 100;
  const goalDistW = weights.goalDistanceWeight ?? 20;
  const threatB = weights.threatBonus ?? 15;
  const vulnP = weights.vulnerabilityPenalty ?? 20;
  const tempoB = weights.tempoBonus ?? 5;

  let score =
    features.materialR * rVal +
    features.materialP * pVal +
    features.materialS * sVal +
    features.goalDistanceAdvantage * goalDistW +
    features.runnerAdvantage * runnerWeight +
    features.threatAdvantage * threatB +
    features.vulnerabilityAdvantage * vulnP +
    features.tempoAdvantage * tempoB;

  // PST evaluation
  if (weights.pst && weights.pst.R && weights.pst.P && weights.pst.S) {
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      if (features.pstDeltas.R[sq] !== 0) score += features.pstDeltas.R[sq] * (weights.pst.R[sq] || 0);
      if (features.pstDeltas.P[sq] !== 0) score += features.pstDeltas.P[sq] * (weights.pst.P[sq] || 0);
      if (features.pstDeltas.S[sq] !== 0) score += features.pstDeltas.S[sq] * (weights.pst.S[sq] || 0);
    }
  }

  return Math.round(score);
}
