/**
 * Zobrist Hashing implementation for O(1) state fingerprinting,
 * 3-fold repetition detection, and transposition table indexing.
 */

import type { Color, PieceType, Square } from './types';

// Deterministic PRNG for reproducible Zobrist keys (XorShift64)
class XorShift64 {
  private state: bigint;

  constructor(seed: bigint = 88172645463325252n) {
    this.state = seed;
  }

  next(): bigint {
    let x = this.state;
    x ^= x << 13n;
    x ^= x >> 7n;
    x ^= x << 17n;
    this.state = x;
    return BigInt.asUintN(64, x);
  }
}

const rng = new XorShift64(0x1827364554637281n);

// 2 colors, 6 piece types, 64 squares
export const ZOBRIST_PIECES: bigint[][][] = [
  // White
  [
    new Array(64), // Pawn
    new Array(64), // Knight
    new Array(64), // Bishop
    new Array(64), // Rook
    new Array(64), // Queen
    new Array(64), // King
  ],
  // Black
  [
    new Array(64), // Pawn
    new Array(64), // Knight
    new Array(64), // Bishop
    new Array(64), // Rook
    new Array(64), // Queen
    new Array(64), // King
  ],
];

for (let c = 0; c < 2; c++) {
  for (let pt = 0; pt < 6; pt++) {
    for (let sq = 0; sq < 64; sq++) {
      ZOBRIST_PIECES[c][pt][sq] = rng.next();
    }
  }
}

export const ZOBRIST_BLACK_TURN = rng.next();

export const ZOBRIST_CASTLING: bigint[] = new Array(16);
for (let i = 0; i < 16; i++) {
  ZOBRIST_CASTLING[i] = rng.next();
}

export const ZOBRIST_EP_FILE: bigint[] = new Array(8);
for (let i = 0; i < 8; i++) {
  ZOBRIST_EP_FILE[i] = rng.next();
}

export function getPieceZobrist(color: Color, piece: PieceType, sq: Square): bigint {
  return ZOBRIST_PIECES[color][piece - 1][sq];
}

export function getCastlingZobrist(castlingRights: number): bigint {
  return ZOBRIST_CASTLING[castlingRights & 0b1111];
}

export function getEpZobrist(epSquare: Square | null): bigint {
  if (epSquare === null) return 0n;
  const file = epSquare % 8;
  return ZOBRIST_EP_FILE[file];
}
