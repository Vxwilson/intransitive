/**
 * Classical Chess Evaluation Module
 * Uses PeSTO Piece-Square Tables (PST) with Middlegame (MG) and Endgame (EG) tapering.
 * Evaluates material, positional tables, bishop pairs, and tempo.
 */

import type { Square, PieceType } from '../core/types';
import {
  WHITE,
  BLACK,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
} from '../core/types';
import type { Chess } from '../core/chess';
import { popcount, bitScanForward } from '../core/bitboard';

// Base piece material values (in centipawns)
export const PIECE_VALUES: Record<number, { mg: number; eg: number }> = {
  [PAWN]: { mg: 100, eg: 130 },
  [KNIGHT]: { mg: 320, eg: 320 },
  [BISHOP]: { mg: 330, eg: 340 },
  [ROOK]: { mg: 500, eg: 520 },
  [QUEEN]: { mg: 900, eg: 960 },
  [KING]: { mg: 20000, eg: 20000 },
};

// Game phase contribution per piece type (total starting phase = 24)
export const PHASE_WEIGHTS: Record<number, number> = {
  [PAWN]: 0,
  [KNIGHT]: 1,
  [BISHOP]: 1,
  [ROOK]: 2,
  [QUEEN]: 4,
  [KING]: 0,
};

export const MAX_PHASE = 24;

/**
 * PeSTO Piece-Square Tables (calibrated from Ronald Friederich's PeSTO).
 * Arrays are indexed 0 (a1) to 63 (h8) from White's perspective.
 * For Black, the rank index is mirrored using (sq ^ 56).
 */

// PAWN
const MG_PAWN: number[] = [
    0,   0,   0,   0,   0,   0,   0,   0, // Rank 1 (a1-h1)
  -35,  -1, -20, -23, -15,  24,  38, -22, // Rank 2 (a2-h2)
  -26,  -4,  -4, -10,   3,   3,  33, -12, // Rank 3
  -27,  -2,  -5,  12,  17,   6,  10, -25, // Rank 4
  -14,  13,   6,  21,  23,  12,  17, -23, // Rank 5
   -6,   7,  26,  31,  65,  56,  25, -20, // Rank 6
   98, 134,  61,  95,  68, 126,  34, -11, // Rank 7
    0,   0,   0,   0,   0,   0,   0,   0, // Rank 8 (promoted)
];

const EG_PAWN: number[] = [
    0,   0,   0,   0,   0,   0,   0,   0, // Rank 1
  -12, -10, -10,   4,   3,   9,  10, -20, // Rank 2
   -4,   3,  13,  19,  21,  12,  -1,  -8, // Rank 3
   -6,   5,  14,  26,  32,  12,   2, -11, // Rank 4
   -4,  16,  25,  35,  41,  17,   7,  -6, // Rank 5
   -6,  23,  36,  49,  62,  30,  15,  -5, // Rank 6
   98, 134,  61,  95,  68, 126,  34, -11, // Rank 7
    0,   0,   0,   0,   0,   0,   0,   0, // Rank 8
];

// KNIGHT
const MG_KNIGHT: number[] = [
  -167, -89, -34, -49,  61, -97, -15, -107, // Rank 1
   -73, -41,  72,  36,  23,  62,   7,  -17, // Rank 2
   -47,  60,  37,  65,  84, 129,  73,   44, // Rank 3
    -9,  17,  19,  53,  37,  69,  18,   22, // Rank 4
   -13,   4,  16,  13,  28,  19,  21,   -8, // Rank 5
   -23,  -9,  12,  10,  19,  17,  25,  -16, // Rank 6
   -29, -53, -12,  -3,  -1,  18, -14,  -19, // Rank 7
  -105, -21, -58, -33, -17, -28, -19,  -23, // Rank 8
];

const EG_KNIGHT: number[] = [
  -58, -38, -13, -28, -31, -27, -63, -99,
  -25,  -8, -25,  -2,  -9, -25, -24, -52,
  -24, -20,  10,   9,  -1,  -9, -19, -41,
  -17,   3,  22,  22,  22,  11,   8, -18,
  -18,  -6,  16,  25,  16,  17,   4, -18,
  -23,  -3,  -1,  15,  10,  -3, -20, -22,
  -42, -20, -10,  -5,  -2, -20, -23, -44,
  -29, -51, -23, -15, -22, -18, -50, -64,
];

// BISHOP
const MG_BISHOP: number[] = [
  -29,   4, -82, -37, -25, -42,   7,  -8,
  -26,  16, -18, -12,  30,  59,  18, -47,
  -16,  37,  43,  40,  35,  50,  37,  -2,
   -4,   5,  19,  50,  37,  37,   7,  -2,
   -6,  13,  13,  26,  34,  12,  10,   4,
    0,  15,  15,  15,  14,  27,  18,  10,
    4,  15,  16,   0,   7,  21,  33,   1,
  -33,  -3, -14, -21, -13, -12, -39, -21,
];

const EG_BISHOP: number[] = [
  -14, -21, -11,  -8,  -7,  -9, -17, -24,
   -8,  -4,   7, -12,  -3, -13,  -4, -14,
    2,  -8,   0,  -1,  -2,   6,   0,   4,
   -3,   9,  12,   9,  14,  10,   3,   2,
   -6,   3,  13,  19,   7,  10,  -3,  -9,
  -12,  -3,   8,  10,  13,   3,  -7, -15,
  -14, -18,  -7,  -1,   4,  -9, -15, -27,
  -23,  -9, -23,  -5,  -9, -16,  -5, -17,
];

// ROOK
const MG_ROOK: number[] = [
   32,  42,  32,  51,  63,   9,  31,  43,
   27,  32,  58,  62,  80,  67,  26,  44,
   -5,  19,  26,  36,  17,  45,  61,  16,
  -24, -11,   7,  26,  24,  35,  -8, -20,
  -36, -26, -12,  -1,   9,  -7,   6, -23,
  -45, -25, -16, -17,   3,   0,  -5, -33,
  -44, -16, -20,  -9,  -1,  11,  -6, -71,
  -19, -13,   1,  17,  16,   7, -37, -26,
];

const EG_ROOK: number[] = [
  13, 10, 18, 15, 12,  12,   8,   5,
  11, 13, 13, 11, -3,   3,   8,   3,
   7,  7,  7,  5,  4,  -3,  -5,  -3,
   4,  3, 13,  1,  2,   1,  -1,   2,
   3,  5,  8,  4, -5,  -6,  -8, -11,
  -4,  0, -5, -1, -7, -12,  -8, -16,
  -6, -6,  0,  2, -9,  -9, -11,  -3,
  -9,  2,  3, -1, -5, -13,   4, -20,
];

// QUEEN
const MG_QUEEN: number[] = [
  -28,   0,  29,  12,  59,  44,  43,  45,
  -24, -39,  -5,   1, -16,  57,  28,  54,
  -13, -17,   7,   8,  29,  56,  47,  57,
  -27, -27, -16, -16,  -1,  17,  -2,   1,
   -9, -26,  -9, -10,  -2,  -4,   3,  -3,
  -14,   2, -11,  -2,  -5,   2,  14,   5,
  -35,  -8,  11,   2,   8,  15,  -3,   1,
   -1, -18,  -9,  10, -15, -25, -31, -50,
];

const EG_QUEEN: number[] = [
   -9,  22,  22,  27,  27,  19,  10,  20,
  -17,  20,  32,  41,  58,  25,  30,   0,
  -20,   6,   9,  49,  47,  35,  19,   9,
    3,  22,  24,  45,  57,  40,  57,  36,
  -18,  28,  19,  47,  31,  34,  39,  18,
  -16, -27,  15,   6,   9,  17,  10,   5,
  -22, -23, -30, -16, -16, -23, -36, -32,
  -33, -28, -22, -43,  -5, -32, -20, -41,
];

// KING
const MG_KING: number[] = [
  271, 327, 271, 198, 226, 271, 327, 271, // Rank 1 (Castled safety)
  181, 234, 181, 142, 142, 181, 234, 181, // Rank 2
   92, 142,  92,  68,  68,  92, 142,  92, // Rank 3
   14,  54,  14,   0,   0,  14,  54,  14, // Rank 4
  -20,  14, -20, -40, -40, -20,  14, -20, // Rank 5
  -40,   0, -40, -60, -60, -40,   0, -40, // Rank 6
  -60, -20, -60, -80, -80, -60, -20, -60, // Rank 7
  -80, -40, -80,-100,-100, -80, -40, -80, // Rank 8
];

const EG_KING: number[] = [
  -74, -35, -18, -18, -11,  15,   4, -17,
  -12,  17,  14,  17,  17,  38,  23,  11,
   10,  17,  23,  15,  20,  45,  44,  13,
   -8,  22,  24,  27,  26,  33,  26,   3,
  -18,  -4,  21,  24,  27,  23,   9, -11,
  -19,  -3,  11,  21,  23,  16,   7,  -9,
  -27, -11,   4,  13,  14,   4,  -5, -17,
  -53, -34, -21, -11, -28, -14, -24, -43,
];

const PST_TABLES: Record<number, { mg: number[]; eg: number[] }> = {
  [PAWN]: { mg: MG_PAWN, eg: EG_PAWN },
  [KNIGHT]: { mg: MG_KNIGHT, eg: EG_KNIGHT },
  [BISHOP]: { mg: MG_BISHOP, eg: EG_BISHOP },
  [ROOK]: { mg: MG_ROOK, eg: EG_ROOK },
  [QUEEN]: { mg: MG_QUEEN, eg: EG_QUEEN },
  [KING]: { mg: MG_KING, eg: EG_KING },
};

export interface EvalDetails {
  score: number;
  whiteScore: number;
  mgScore: number;
  egScore: number;
  phase: number;
  materialWhite: number;
  materialBlack: number;
}

/**
 * Calculates positional score and material for a side across all pieces.
 */
export function evaluateDetails(chess: Chess): EvalDetails {
  let mgWhite = 0;
  let mgBlack = 0;
  let egWhite = 0;
  let egBlack = 0;
  let gamePhase = 0;
  let materialWhite = 0;
  let materialBlack = 0;

  const pieceTypes: PieceType[] = [PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING];

  for (const pt of pieceTypes) {
    const val = PIECE_VALUES[pt];
    const pst = PST_TABLES[pt];
    const weight = PHASE_WEIGHTS[pt];

    // White pieces
    let wBits = chess.pieceBB[WHITE][pt - 1];
    while (wBits > 0n) {
      const sq = bitScanForward(wBits) as Square;
      wBits &= wBits - 1n;

      mgWhite += val.mg + pst.mg[sq];
      egWhite += val.eg + pst.eg[sq];
      gamePhase += weight;
      if (pt !== KING) materialWhite += val.mg;
    }

    // Black pieces (mirror square vertically via sq ^ 56)
    let bBits = chess.pieceBB[BLACK][pt - 1];
    while (bBits > 0n) {
      const sq = bitScanForward(bBits) as Square;
      bBits &= bBits - 1n;

      const mirroredSq = sq ^ 56;
      mgBlack += val.mg + pst.mg[mirroredSq];
      egBlack += val.eg + pst.eg[mirroredSq];
      gamePhase += weight;
      if (pt !== KING) materialBlack += val.mg;
    }
  }

  // Positional heuristics: Bishop pair bonus
  const wBishops = popcount(chess.pieceBB[WHITE][BISHOP - 1]);
  const bBishops = popcount(chess.pieceBB[BLACK][BISHOP - 1]);
  if (wBishops >= 2) {
    mgWhite += 30;
    egWhite += 50;
  }
  if (bBishops >= 2) {
    mgBlack += 30;
    egBlack += 50;
  }

  // Side to move tempo bonus
  const tempoBonus = 15;
  if (chess.activeColor === WHITE) {
    mgWhite += tempoBonus;
    egWhite += tempoBonus;
  } else {
    mgBlack += tempoBonus;
    egBlack += tempoBonus;
  }

  // Clamp game phase to max 24
  const phase = Math.min(gamePhase, MAX_PHASE);

  const mgScore = mgWhite - mgBlack;
  const egScore = egWhite - egBlack;

  // Tapered evaluation between middlegame and endgame
  const whiteScore = Math.round((mgScore * phase + egScore * (MAX_PHASE - phase)) / MAX_PHASE);

  // Return score relative to active player (Negamax friendly)
  const score = chess.activeColor === WHITE ? whiteScore : -whiteScore;

  return {
    score,
    whiteScore,
    mgScore,
    egScore,
    phase,
    materialWhite,
    materialBlack,
  };
}

/**
 * Fast classical evaluation function.
 * Returns score relative to the side to move (positive = side to move is ahead).
 */
export function evaluate(chess: Chess): number {
  return evaluateDetails(chess).score;
}

/**
 * Returns score strictly relative to White (positive = White is winning),
 * which is used for the EvalBar and user-facing status.
 */
export function evaluateWhite(chess: Chess): number {
  return evaluateDetails(chess).whiteScore;
}
