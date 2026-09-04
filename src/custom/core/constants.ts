/**
 * Intransitive (9x9 RPS Board Game) - Geometry, Rules & Adjacency Constants
 */

import {
  ROCK,
  PAPER,
  SCISSORS,
  PLAYER_BLUE,
  BLUE_ROCK,
  BLUE_PAPER,
  BLUE_SCISSORS,
  RED_ROCK,
  RED_PAPER,
  RED_SCISSORS,
} from './types';
import type { PieceType, Player, PieceCode } from './types';

export const BOARD_SIZE = 9;
export const NUM_SQUARES = 81;

export const FILE_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'] as const;
export const RANK_NUMBERS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export function squareToAlgebraic(sq: number): string {
  const file = sq % BOARD_SIZE;
  const rank = Math.floor(sq / BOARD_SIZE);
  return `${FILE_LETTERS[file]}${RANK_NUMBERS[rank]}`;
}

export function algebraicToSquare(coord: string): number {
  if (!coord || coord.length < 2) return -1;
  const fileChar = coord[0].toLowerCase();
  const rankChar = coord[1];
  const file = FILE_LETTERS.indexOf(fileChar as typeof FILE_LETTERS[number]);
  const rank = RANK_NUMBERS.indexOf(rankChar as typeof RANK_NUMBERS[number]);
  if (file === -1 || rank === -1) return -1;
  return rank * BOARD_SIZE + file;
}

// Goal corners
export const BLUE_GOAL_SQUARE = 80; // i9
export const RED_GOAL_SQUARE = 0;   // a1

export function isGoalSquare(sq: number, player: Player): boolean {
  return player === PLAYER_BLUE ? sq === BLUE_GOAL_SQUARE : sq === RED_GOAL_SQUARE;
}

// RPS Counter Lookup Table
// Rock (R) > Scissors (S)
// Scissors (S) > Paper (P)
// Paper (P) > Rock (R)
export function canCapture(attacker: PieceType, defender: PieceType): boolean {
  if (attacker === ROCK && defender === SCISSORS) return true;
  if (attacker === SCISSORS && defender === PAPER) return true;
  if (attacker === PAPER && defender === ROCK) return true;
  return false;
}

/**
 * Precomputed 8-neighbor adjacency lookup table for all 81 squares.
 * Eliminates boundary checks and branching in move generation.
 */
function buildAdjacencyTable(): readonly (readonly number[])[] {
  const table: number[][] = [];
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const file = sq % BOARD_SIZE;
    const rank = Math.floor(sq / BOARD_SIZE);
    const neighbors: number[] = [];

    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const nr = rank + dr;
        const nf = file + df;
        if (nr >= 0 && nr < BOARD_SIZE && nf >= 0 && nf < BOARD_SIZE) {
          neighbors.push(nr * BOARD_SIZE + nf);
        }
      }
    }
    table.push(neighbors);
  }
  return table;
}

export const ADJACENCY_TABLE = buildAdjacencyTable();

/**
 * Initial board layout matching the standard Intransitive specification:
 * Blue (10 pieces):
 *   - Rocks (3): b4, c3, d2
 *   - Papers (4): b5, c4, d3, e2
 *   - Scissors (3): c5, d4, e3
 * Red (10 pieces - 180° rotation around e5):
 *   - Scissors (3): e7, f6, g5
 *   - Papers (4): e8, f7, g6, h5
 *   - Rocks (3): f8, g7, h6
 */
export function getInitialBoardArray(): Uint8Array {
  const board = new Uint8Array(NUM_SQUARES);

  // Blue pieces
  const blueSetup: [string, PieceCode][] = [
    ['b4', BLUE_ROCK],
    ['c3', BLUE_ROCK],
    ['d2', BLUE_ROCK],
    ['b5', BLUE_PAPER],
    ['c4', BLUE_PAPER],
    ['d3', BLUE_PAPER],
    ['e2', BLUE_PAPER],
    ['c5', BLUE_SCISSORS],
    ['d4', BLUE_SCISSORS],
    ['e3', BLUE_SCISSORS],
  ];

  // Red pieces
  const redSetup: [string, PieceCode][] = [
    ['e7', RED_SCISSORS],
    ['f6', RED_SCISSORS],
    ['g5', RED_SCISSORS],
    ['e8', RED_PAPER],
    ['f7', RED_PAPER],
    ['g6', RED_PAPER],
    ['h5', RED_PAPER],
    ['f8', RED_ROCK],
    ['g7', RED_ROCK],
    ['h6', RED_ROCK],
  ];

  for (const [coord, piece] of blueSetup) {
    board[algebraicToSquare(coord)] = piece;
  }
  for (const [coord, piece] of redSetup) {
    board[algebraicToSquare(coord)] = piece;
  }

  return board;
}
