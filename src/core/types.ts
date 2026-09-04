/**
 * Core type definitions for the Chessesque engine and board state.
 */

export type Color = 0 | 1; // 0 = White, 1 = Black
export const WHITE: Color = 0;
export const BLACK: Color = 1;

export type PieceType = 1 | 2 | 3 | 4 | 5 | 6; // 1=Pawn, 2=Knight, 3=Bishop, 4=Rook, 5=Queen, 6=King
export const PAWN: PieceType = 1;
export const KNIGHT: PieceType = 2;
export const BISHOP: PieceType = 3;
export const ROOK: PieceType = 4;
export const QUEEN: PieceType = 5;
export const KING: PieceType = 6;

export interface Piece {
  type: PieceType;
  color: Color;
}

/**
 * Squares are indexed 0 (a1) through 63 (h8)
 * File: 0 = a, 7 = h (index % 8)
 * Rank: 0 = 1, 7 = 8 (index >> 3)
 */
export type Square = number;

export const SQUARES = {
  a1: 0, b1: 1, c1: 2, d1: 3, e1: 4, f1: 5, g1: 6, h1: 7,
  a2: 8, b2: 9, c2: 10, d2: 11, e2: 12, f2: 13, g2: 14, h2: 15,
  a3: 16, b3: 17, c3: 18, d3: 19, e3: 20, f3: 21, g3: 22, h3: 23,
  a4: 24, b4: 25, c4: 26, d4: 27, e4: 28, f4: 29, g4: 30, h4: 31,
  a5: 32, b5: 33, c5: 34, d5: 35, e5: 36, f5: 37, g5: 38, h5: 39,
  a6: 40, b6: 41, c6: 42, d6: 43, e6: 44, f6: 45, g6: 46, h6: 47,
  a7: 48, b7: 49, c7: 50, d7: 51, e7: 52, f7: 53, g7: 54, h7: 55,
  a8: 56, b8: 57, c8: 58, d8: 59, e8: 60, f8: 61, g8: 62, h8: 63,
} as const;

export const SQUARE_NAMES = [
  'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
  'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
  'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
  'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
  'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
  'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
  'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
  'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
];

export const CASTLE_WK = 1; // 0b0001
export const CASTLE_WQ = 2; // 0b0010
export const CASTLE_BK = 4; // 0b0100
export const CASTLE_BQ = 8; // 0b1000

export const MoveFlag = {
  Quiet: 0,
  DoublePawnPush: 1,
  CastleKingside: 2,
  CastleQueenside: 3,
  EnPassant: 4,
  Promotion: 5,
} as const;

export type MoveFlag = (typeof MoveFlag)[keyof typeof MoveFlag];

export interface Move {
  from: Square;
  to: Square;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
  flags: MoveFlag;
  san?: string;
}

export interface StateRecord {
  move: Move;
  castlingRights: number;
  epSquare: Square | null;
  halfmoveClock: number;
  zobristHash: bigint;
  capturedPiece: PieceType | null;
}

export type GameStatus =
  | 'in_progress'
  | 'checkmate'
  | 'stalemate'
  | 'draw_threefold'
  | 'draw_50move'
  | 'draw_insufficient_material';
