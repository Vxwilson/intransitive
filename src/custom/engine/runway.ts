/**
 * Intransitive (9x9 RPS Board Game) - Unstoppable Runway & Corridor Detection
 *
 * Mathematically proves whether a runner piece has an unblockable, uninterceptable
 * geodesic highway to the touchdown goal square from arbitrary distances (1 to 8 moves).
 */

import {
  NUM_SQUARES,
  ADJACENCY_TABLE,
  BLUE_GOAL_SQUARE,
  RED_GOAL_SQUARE,
  canCapture,
} from '../core/constants';
import { PLAYER_BLUE, PLAYER_RED, EMPTY, decodePiece } from '../core/types';
import type { Player, PieceType } from '../core/types';
import type { IntransitiveGame } from '../core/game';

export interface UnstoppableRunway {
  player: Player;
  runnerSq: number;
  runnerType: PieceType;
  targetGoal: number;
  distance: number;       // Chebyshev steps to goal (1..8)
  pliesToWin: number;     // 2D - 1 if runner moves first, 2D if opponent moves first
  path: number[];         // [p0, p1, ..., pD]
}

interface EnemyPieceInfo {
  sq: number;
  pieceType: PieceType;
  countersRunner: boolean;      // canCapture(enemy, runner)
  captureableByRunner: boolean;  // canCapture(runner, enemy)
}

/**
 * Chebyshev distance to goal square (number of king-steps).
 */
export function goalChebyshevDist(sq: number, goalSq: number): number {
  const r1 = Math.floor(sq / 9), c1 = sq % 9;
  const r2 = Math.floor(goalSq / 9), c2 = goalSq % 9;
  return Math.max(Math.abs(r1 - r2), Math.abs(c1 - c2));
}

/**
 * Searches for an unstoppable runway for the specified player.
 * Checks all friendly pieces and all geodesic paths to the goal.
 *
 * @param game The current game state
 * @param player The runner player (PLAYER_BLUE or PLAYER_RED)
 * @param isRunnerTurn Whether it is currently the runner player's turn to move
 * @returns The fastest UnstoppableRunway if one exists, or null
 */
export function findUnstoppableRunway(
  game: IntransitiveGame,
  player: Player,
  isRunnerTurn: boolean
): UnstoppableRunway | null {
  const goalSq = player === PLAYER_BLUE ? BLUE_GOAL_SQUARE : RED_GOAL_SQUARE;

  // Single pass to collect friendly runners and enemy pieces
  const runners: Array<{ sq: number; pieceType: PieceType; distToGoal: number }> = [];
  const rawEnemies: Array<{ sq: number; pieceType: PieceType }> = [];

  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = game.board[sq];
    if (code === EMPTY) continue;

    const decoded = decodePiece(code);
    if (!decoded) continue;

    if (decoded.player === player) {
      const dist = goalChebyshevDist(sq, goalSq);
      if (dist === 0) {
        return {
          player,
          runnerSq: sq,
          runnerType: decoded.pieceType,
          targetGoal: goalSq,
          distance: 0,
          pliesToWin: 0,
          path: [sq],
        };
      }
      runners.push({ sq, pieceType: decoded.pieceType, distToGoal: dist });
    } else {
      rawEnemies.push({ sq, pieceType: decoded.pieceType });
    }
  }

  // Sort runners ascending by distance to goal to find the fastest runway first
  runners.sort((a, b) => a.distToGoal - b.distToGoal);

  let bestRunway: UnstoppableRunway | null = null;

  for (let i = 0; i < runners.length; i++) {
    const runner = runners[i];

    // If we already found a runway faster than this runner's theoretical minimum, we can stop
    const minPossiblePlies = isRunnerTurn ? runner.distToGoal * 2 - 1 : runner.distToGoal * 2;
    if (bestRunway && bestRunway.pliesToWin <= minPossiblePlies) {
      break;
    }

    const enemyPieces: EnemyPieceInfo[] = [];
    for (let j = 0; j < rawEnemies.length; j++) {
      const e = rawEnemies[j];
      enemyPieces.push({
        sq: e.sq,
        pieceType: e.pieceType,
        countersRunner: canCapture(e.pieceType, runner.pieceType),
        captureableByRunner: canCapture(runner.pieceType, e.pieceType),
      });
    }

    // Attempt to find a guaranteed safe geodesic path
    const path = findSafeGeodesicPath(
      game,
      runner.sq,
      goalSq,
      runner.distToGoal,
      runner.pieceType,
      player,
      enemyPieces,
      isRunnerTurn
    );

    if (path) {
      const pliesToWin = minPossiblePlies;
      if (!bestRunway || pliesToWin < bestRunway.pliesToWin) {
        bestRunway = {
          player,
          runnerSq: runner.sq,
          runnerType: runner.pieceType,
          targetGoal: goalSq,
          distance: runner.distToGoal,
          pliesToWin,
          path,
        };
      }
    }
  }

  return bestRunway;
}

/**
 * Recursive DFS to find at least one safe geodesic path from runnerSq to goalSq.
 */
function findSafeGeodesicPath(
  game: IntransitiveGame,
  runnerSq: number,
  goalSq: number,
  totalDistance: number,
  runnerType: PieceType,
  player: Player,
  enemyPieces: EnemyPieceInfo[],
  isRunnerTurn: boolean
): number[] | null {
  const currentPath: number[] = [runnerSq];

  function dfs(currSq: number, stepIdx: number): boolean {
    if (stepIdx === totalDistance) {
      return true;
    }

    const nextStepIdx = stepIdx + 1;
    const remainingDist = totalDistance - nextStepIdx;

    const neighbors = ADJACENCY_TABLE[currSq];
    for (let i = 0; i < neighbors.length; i++) {
      const nextSq = neighbors[i];

      // Geodesic constraint: distance to goal must strictly decrease by 1
      if (goalChebyshevDist(nextSq, goalSq) !== remainingDist) {
        continue;
      }

      // Check current square occupancy
      const occ = game.board[nextSq];
      if (occ !== EMPTY) {
        const occPiece = decodePiece(occ);
        if (!occPiece) continue;
        // Cannot pass through friendly pieces
        if (occPiece.player === player) continue;
        // Cannot pass through enemy pieces runner cannot capture
        if (!canCapture(runnerType, occPiece.pieceType)) continue;
      }

      // Check safety against all enemy pieces along this step
      let isStepSafe = true;
      for (let j = 0; j < enemyPieces.length; j++) {
        const e = enemyPieces[j];
        const distE = goalChebyshevDist(e.sq, nextSq);

        if (isRunnerTurn) {
          if (nextStepIdx < totalDistance) {
            // Intermediate square: enemy counter piece can capture if distE <= nextStepIdx
            if (e.countersRunner && distE <= nextStepIdx) {
              isStepSafe = false;
              break;
            }
            // Non-captureable enemy piece can block if distE <= nextStepIdx - 1
            if (!e.captureableByRunner && distE <= nextStepIdx - 1) {
              isStepSafe = false;
              break;
            }
          } else {
            // Goal square: touchdown occurs on runner's turn nextStepIdx.
            // Game ends instantly. Opponent only has turns 1..(totalDistance - 1) to block.
            if (!e.captureableByRunner && distE <= totalDistance - 1) {
              isStepSafe = false;
              break;
            }
          }
        } else {
          // Opponent moves first
          if (nextStepIdx < totalDistance) {
            if (e.countersRunner && distE <= nextStepIdx + 1) {
              isStepSafe = false;
              break;
            }
            if (!e.captureableByRunner && distE <= nextStepIdx) {
              isStepSafe = false;
              break;
            }
          } else {
            // Goal square: opponent has turns 1..totalDistance to block
            if (!e.captureableByRunner && distE <= totalDistance) {
              isStepSafe = false;
              break;
            }
          }
        }
      }

      if (isStepSafe) {
        currentPath.push(nextSq);
        if (dfs(nextSq, nextStepIdx)) {
          return true;
        }
        currentPath.pop();
      }
    }

    return false;
  }

  const found = dfs(runnerSq, 0);
  return found ? currentPath : null;
}

/**
 * Evaluates whether either player has a decisive forced win via an unstoppable runway.
 * Returns:
 * - Positive score (+WIN_SCORE - plies) if Blue has a faster unstoppable runway
 * - Negative score (-WIN_SCORE + plies) if Red has a faster unstoppable runway
 * - null if no unstoppable runway exists for either player
 */
export function evaluateRunwayRace(
  game: IntransitiveGame
): { score: number; runway: UnstoppableRunway } | null {
  const isBlueTurn = game.activePlayer === PLAYER_BLUE;

  const blueRunway = findUnstoppableRunway(game, PLAYER_BLUE, isBlueTurn);
  const redRunway = findUnstoppableRunway(game, PLAYER_RED, !isBlueTurn);

  if (!blueRunway && !redRunway) {
    return null;
  }

  // If only Blue has a runway
  if (blueRunway && !redRunway) {
    return {
      score: 10000 - blueRunway.pliesToWin,
      runway: blueRunway,
    };
  }

  // If only Red has a runway
  if (!blueRunway && redRunway) {
    return {
      score: -10000 + redRunway.pliesToWin,
      runway: redRunway,
    };
  }

  // If both have runways, the side with strictly fewer pliesToWin wins first
  if (blueRunway && redRunway) {
    if (blueRunway.pliesToWin < redRunway.pliesToWin) {
      return {
        score: 10000 - blueRunway.pliesToWin,
        runway: blueRunway,
      };
    } else if (redRunway.pliesToWin < blueRunway.pliesToWin) {
      return {
        score: -10000 + redRunway.pliesToWin,
        runway: redRunway,
      };
    } else {
      // Simultaneous touchdown: whichever player moves first wins
      if (isBlueTurn) {
        return {
          score: 10000 - blueRunway.pliesToWin,
          runway: blueRunway,
        };
      } else {
        return {
          score: -10000 + redRunway.pliesToWin,
          runway: redRunway,
        };
      }
    }
  }

  return null;
}
