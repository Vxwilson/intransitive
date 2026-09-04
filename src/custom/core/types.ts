/**
 * Intransitive (9x9 RPS Board Game) - Type Definitions
 */

export const PLAYER_BLUE = 0;
export const PLAYER_RED = 1;
export type Player = typeof PLAYER_BLUE | typeof PLAYER_RED;

export const ROCK = 'R';
export const PAPER = 'P';
export const SCISSORS = 'S';
export type PieceType = typeof ROCK | typeof PAPER | typeof SCISSORS;

export const PIECE_TYPES: PieceType[] = [ROCK, PAPER, SCISSORS];

// Numerical piece codes for high-speed Uint8Array board
export const EMPTY = 0;
export const BLUE_ROCK = 1;
export const BLUE_PAPER = 2;
export const BLUE_SCISSORS = 3;
export const RED_ROCK = 4;
export const RED_PAPER = 5;
export const RED_SCISSORS = 6;

export type PieceCode =
  | typeof EMPTY
  | typeof BLUE_ROCK
  | typeof BLUE_PAPER
  | typeof BLUE_SCISSORS
  | typeof RED_ROCK
  | typeof RED_PAPER
  | typeof RED_SCISSORS;

export interface DecodedPiece {
  player: Player;
  pieceType: PieceType;
}

export function encodePiece(player: Player, pieceType: PieceType): PieceCode {
  if (player === PLAYER_BLUE) {
    if (pieceType === ROCK) return BLUE_ROCK;
    if (pieceType === PAPER) return BLUE_PAPER;
    return BLUE_SCISSORS;
  } else {
    if (pieceType === ROCK) return RED_ROCK;
    if (pieceType === PAPER) return RED_PAPER;
    return RED_SCISSORS;
  }
}

export function decodePiece(code: number): DecodedPiece | null {
  switch (code) {
    case BLUE_ROCK:
      return { player: PLAYER_BLUE, pieceType: ROCK };
    case BLUE_PAPER:
      return { player: PLAYER_BLUE, pieceType: PAPER };
    case BLUE_SCISSORS:
      return { player: PLAYER_BLUE, pieceType: SCISSORS };
    case RED_ROCK:
      return { player: PLAYER_RED, pieceType: ROCK };
    case RED_PAPER:
      return { player: PLAYER_RED, pieceType: PAPER };
    case RED_SCISSORS:
      return { player: PLAYER_RED, pieceType: SCISSORS };
    default:
      return null;
  }
}

export interface Move {
  from: number; // 0..80
  to: number; // 0..80
  piece: PieceType;
  captured?: PieceType;
}

export type WinReason =
  | 'touchdown'
  | 'elimination'
  | 'immobilization'
  | 'repetition'
  | '50-move';

export interface GameStatus {
  isOver: boolean;
  winner: Player | 'draw' | null;
  reason: WinReason | null;
}

export interface UndoRecord {
  move: Move;
  capturedCode: number;
  halfmoveClock: number;
  zobristKey: bigint;
}
