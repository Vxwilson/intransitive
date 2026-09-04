/**
 * Intransitive (9x9 RPS Board Game) - Zobrist Hashing
 * Provides fast 64-bit atomic hashing for O(1) state identification,
 * transposition tables, and 3-fold repetition detection.
 */

import { NUM_SQUARES } from './constants';
import { PLAYER_RED } from './types';
import type { Player } from './types';

// Deterministic 64-bit PRNG (SplitMix64) to ensure identical keys across threads
class SplitMix64 {
  private state: bigint;

  constructor(seed: bigint = 0x9e3779b97f4a7c15n) {
    this.state = seed;
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return (z ^ (z >> 31n)) & 0xffffffffffffffffn;
  }
}

// 7 piece codes (0: EMPTY, 1: B_R, 2: B_P, 3: B_S, 4: R_R, 5: R_P, 6: R_S) x 81 squares
export const ZOBRIST_PIECES: bigint[][] = [];
export let ZOBRIST_SIDE_TO_MOVE: bigint;

function initZobrist(): void {
  const prng = new SplitMix64(0x13374242cafe55a0n);

  for (let pieceCode = 0; pieceCode <= 6; pieceCode++) {
    const squareKeys: bigint[] = [];
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      if (pieceCode === 0) {
        squareKeys.push(0n);
      } else {
        squareKeys.push(prng.next());
      }
    }
    ZOBRIST_PIECES.push(squareKeys);
  }

  ZOBRIST_SIDE_TO_MOVE = prng.next();
}

initZobrist();

/**
 * Computes full Zobrist hash of a board and active player from scratch.
 */
export function computeZobristHash(board: Uint8Array, activePlayer: Player): bigint {
  let hash = 0n;
  for (let sq = 0; sq < NUM_SQUARES; sq++) {
    const code = board[sq];
    if (code !== 0) {
      hash ^= ZOBRIST_PIECES[code][sq];
    }
  }
  if (activePlayer === PLAYER_RED) {
    hash ^= ZOBRIST_SIDE_TO_MOVE;
  }
  return hash;
}
