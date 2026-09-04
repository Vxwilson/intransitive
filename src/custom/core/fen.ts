/**
 * Intransitive (9x9 RPS Board Game) - FEN Serialization & Parsing
 * Format:
 *   <board 9 ranks from 9 down to 1> <activePlayer: b|r> <halfmoveClock> <fullmoveNumber>
 * Blue pieces: uppercase (R, P, S)
 * Red pieces: lowercase (r, p, s)
 * Empty squares: 1..9
 */

import {
  BOARD_SIZE,
  NUM_SQUARES,
} from './constants';
import {
  PLAYER_BLUE,
  PLAYER_RED,
  EMPTY,
  BLUE_ROCK,
  BLUE_PAPER,
  BLUE_SCISSORS,
  RED_ROCK,
  RED_PAPER,
  RED_SCISSORS,
} from './types';
import type { Player, PieceCode } from './types';

export const INITIAL_INTRANSITIVE_FEN =
  '9/4pr3/4spr2/5spr1/1PS3sp1/1RPS5/2RPS4/3RP4/9 b 0 1';

export function boardToFEN(
  board: Uint8Array,
  activePlayer: Player,
  halfmoveClock: number = 0,
  fullmoveNumber: number = 1
): string {
  const ranks: string[] = [];

  // Ranks from 9 (index 8) down to 1 (index 0)
  for (let r = BOARD_SIZE - 1; r >= 0; r--) {
    let rankStr = '';
    let emptyCount = 0;

    for (let f = 0; f < BOARD_SIZE; f++) {
      const sq = r * BOARD_SIZE + f;
      const piece = board[sq];

      if (piece === EMPTY) {
        emptyCount++;
      } else {
        if (emptyCount > 0) {
          rankStr += emptyCount.toString();
          emptyCount = 0;
        }
        switch (piece) {
          case BLUE_ROCK:
            rankStr += 'R';
            break;
          case BLUE_PAPER:
            rankStr += 'P';
            break;
          case BLUE_SCISSORS:
            rankStr += 'S';
            break;
          case RED_ROCK:
            rankStr += 'r';
            break;
          case RED_PAPER:
            rankStr += 'p';
            break;
          case RED_SCISSORS:
            rankStr += 's';
            break;
        }
      }
    }

    if (emptyCount > 0) {
      rankStr += emptyCount.toString();
    }
    ranks.push(rankStr);
  }

  const activeStr = activePlayer === PLAYER_BLUE ? 'b' : 'r';
  return `${ranks.join('/')} ${activeStr} ${halfmoveClock} ${fullmoveNumber}`;
}

export function fenToBoard(fen: string): {
  board: Uint8Array;
  activePlayer: Player;
  halfmoveClock: number;
  fullmoveNumber: number;
} {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 2) {
    throw new Error(`Invalid Intransitive FEN: "${fen}"`);
  }

  const [boardPart, activePart, halfmovePart, fullmovePart] = parts;
  const rankStrings = boardPart.split('/');
  if (rankStrings.length !== BOARD_SIZE) {
    throw new Error(`Invalid rank count in FEN: expected ${BOARD_SIZE}, got ${rankStrings.length}`);
  }

  const board = new Uint8Array(NUM_SQUARES);

  for (let rankIdx = 0; rankIdx < BOARD_SIZE; rankIdx++) {
    // Rank strings are ordered from rank 9 down to 1
    const r = BOARD_SIZE - 1 - rankIdx;
    const rankStr = rankStrings[rankIdx];
    let fileIdx = 0;

    for (let i = 0; i < rankStr.length; i++) {
      const ch = rankStr[i];
      if (ch >= '1' && ch <= '9') {
        fileIdx += parseInt(ch, 10);
      } else {
        if (fileIdx >= BOARD_SIZE) {
          throw new Error(`Rank overflow at rank ${r + 1}`);
        }
        const sq = r * BOARD_SIZE + fileIdx;
        let code: PieceCode = EMPTY;
        switch (ch) {
          case 'R':
            code = BLUE_ROCK;
            break;
          case 'P':
            code = BLUE_PAPER;
            break;
          case 'S':
            code = BLUE_SCISSORS;
            break;
          case 'r':
            code = RED_ROCK;
            break;
          case 'p':
            code = RED_PAPER;
            break;
          case 's':
            code = RED_SCISSORS;
            break;
          default:
            throw new Error(`Unknown piece char in FEN: ${ch}`);
        }
        board[sq] = code;
        fileIdx++;
      }
    }

    if (fileIdx !== BOARD_SIZE) {
      throw new Error(`Invalid file count in rank ${r + 1}: expected ${BOARD_SIZE}, got ${fileIdx}`);
    }
  }

  const activePlayer: Player = activePart.toLowerCase() === 'b' ? PLAYER_BLUE : PLAYER_RED;
  const halfmoveClock = halfmovePart ? parseInt(halfmovePart, 10) : 0;
  const fullmoveNumber = fullmovePart ? parseInt(fullmovePart, 10) : 1;

  return {
    board,
    activePlayer,
    halfmoveClock,
    fullmoveNumber,
  };
}
