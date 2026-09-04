/**
 * Bitboard mathematical utilities, constants, and precomputed attack lookup tables.
 * Squares are indexed 0 (a1) to 63 (h8).
 */

import type { Square } from './types';
import { WHITE, BLACK } from './types';

export const EMPTY_BB = 0n;
export const ALL_BB = 0xFFFFFFFFFFFFFFFFn;

export const FILE_A = 0x0101010101010101n;
export const FILE_B = FILE_A << 1n;
export const FILE_C = FILE_A << 2n;
export const FILE_D = FILE_A << 3n;
export const FILE_E = FILE_A << 4n;
export const FILE_F = FILE_A << 5n;
export const FILE_G = FILE_A << 6n;
export const FILE_H = FILE_A << 7n;

export const RANK_1 = 0x00000000000000FFn;
export const RANK_2 = RANK_1 << 8n;
export const RANK_3 = RANK_1 << 16n;
export const RANK_4 = RANK_1 << 24n;
export const RANK_5 = RANK_1 << 32n;
export const RANK_6 = RANK_1 << 40n;
export const RANK_7 = RANK_1 << 48n;
export const RANK_8 = RANK_1 << 56n;

export const SQUARE_BB: bigint[] = new Array(64);
for (let i = 0; i < 64; i++) {
  SQUARE_BB[i] = 1n << BigInt(i);
}

export function squareBB(sq: Square): bigint {
  return SQUARE_BB[sq];
}

/**
 * Counts the number of set bits (popcount) in a 64-bit integer.
 */
export function popcount(bb: bigint): number {
  let count = 0;
  let b = bb;
  while (b > 0n) {
    b &= b - 1n;
    count++;
  }
  return count;
}

/**
 * Finds the index of the least significant set bit (0-63).
 * Returns -1 if bitboard is empty.
 */
export function bitScanForward(bb: bigint): number {
  if (bb === 0n) return -1;
  // Calculate trailing zeros of lower 32 bits and upper 32 bits
  const low = Number(BigInt.asUintN(32, bb));
  if (low !== 0) {
    return Math.clz32(low & -low) ^ 31;
  }
  const high = Number(BigInt.asUintN(32, bb >> 32n));
  return 32 + (Math.clz32(high & -high) ^ 31);
}

// Precomputed attack tables
export const KNIGHT_ATTACKS: bigint[] = new Array(64);
export const KING_ATTACKS: bigint[] = new Array(64);
export const PAWN_ATTACKS: [bigint[], bigint[]] = [new Array(64), new Array(64)];

// Initialize Knight attacks
(function initKnightAttacks() {
  const knightOffsets = [
    [-2, -1], [-2, 1], [-1, -2], [-1, 2],
    [1, -2], [1, 2], [2, -1], [2, 1]
  ];

  for (let sq = 0; sq < 64; sq++) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    let bb = 0n;

    for (const [df, dr] of knightOffsets) {
      const nf = file + df;
      const nr = rank + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        bb |= 1n << BigInt(nr * 8 + nf);
      }
    }
    KNIGHT_ATTACKS[sq] = bb;
  }
})();

// Initialize King attacks
(function initKingAttacks() {
  const kingOffsets = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1],           [0, 1],
    [1, -1],  [1, 0],  [1, 1]
  ];

  for (let sq = 0; sq < 64; sq++) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);
    let bb = 0n;

    for (const [df, dr] of kingOffsets) {
      const nf = file + df;
      const nr = rank + dr;
      if (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
        bb |= 1n << BigInt(nr * 8 + nf);
      }
    }
    KING_ATTACKS[sq] = bb;
  }
})();

// Initialize Pawn attacks
(function initPawnAttacks() {
  for (let sq = 0; sq < 64; sq++) {
    const file = sq % 8;
    const rank = Math.floor(sq / 8);

    // White attacks (moving towards rank 8, i.e., rank + 1)
    let wAttacks = 0n;
    if (rank < 7) {
      if (file > 0) wAttacks |= 1n << BigInt((rank + 1) * 8 + (file - 1)); // West-North (+7)
      if (file < 7) wAttacks |= 1n << BigInt((rank + 1) * 8 + (file + 1)); // East-North (+9)
    }
    PAWN_ATTACKS[WHITE][sq] = wAttacks;

    // Black attacks (moving towards rank 1, i.e., rank - 1)
    let bAttacks = 0n;
    if (rank > 0) {
      if (file > 0) bAttacks |= 1n << BigInt((rank - 1) * 8 + (file - 1)); // West-South (-9)
      if (file < 7) bAttacks |= 1n << BigInt((rank - 1) * 8 + (file + 1)); // East-South (-7)
    }
    PAWN_ATTACKS[BLACK][sq] = bAttacks;
  }
})();

/**
 * Generates sliding ray attacks with early blocker termination.
 */
export function getBishopAttacks(sq: Square, occupied: bigint): bigint {
  let attacks = 0n;
  const file = sq % 8;
  const rank = Math.floor(sq / 8);

  const directions = [
    [1, 1],   // North-East
    [-1, 1],  // North-West
    [1, -1],  // South-East
    [-1, -1], // South-West
  ];

  for (const [df, dr] of directions) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const targetSq = r * 8 + f;
      const targetBB = 1n << BigInt(targetSq);
      attacks |= targetBB;
      if ((occupied & targetBB) !== 0n) {
        break; // Blocked
      }
      f += df;
      r += dr;
    }
  }

  return attacks;
}

export function getRookAttacks(sq: Square, occupied: bigint): bigint {
  let attacks = 0n;
  const file = sq % 8;
  const rank = Math.floor(sq / 8);

  const directions = [
    [0, 1],  // North
    [0, -1], // South
    [1, 0],  // East
    [-1, 0], // West
  ];

  for (const [df, dr] of directions) {
    let f = file + df;
    let r = rank + dr;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const targetSq = r * 8 + f;
      const targetBB = 1n << BigInt(targetSq);
      attacks |= targetBB;
      if ((occupied & targetBB) !== 0n) {
        break; // Blocked
      }
      f += df;
      r += dr;
    }
  }

  return attacks;
}

export function getQueenAttacks(sq: Square, occupied: bigint): bigint {
  return getBishopAttacks(sq, occupied) | getRookAttacks(sq, occupied);
}
