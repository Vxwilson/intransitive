/**
 * PGN (Portable Game Notation) generation and formatting utilities.
 */

import type { Move } from './types';

export interface PgnHeaders {
  Event?: string;
  Site?: string;
  Date?: string;
  Round?: string;
  White?: string;
  Black?: string;
  Result?: string;
  [key: string]: string | undefined;
}

export function generatePGN(
  moves: { move: Move; san: string }[],
  headers: PgnHeaders = {},
  result: string = '*'
): string {
  const defaultHeaders: PgnHeaders = {
    Event: 'Casual Game',
    Site: 'Chessesque Engine Studio',
    Date: new Date().toISOString().split('T')[0].replace(/-/g, '.'),
    Round: '1',
    White: 'Player 1',
    Black: 'Player 2',
    Result: result,
    ...headers,
  };

  let pgn = '';
  for (const [key, val] of Object.entries(defaultHeaders)) {
    if (val !== undefined) {
      pgn += `[${key} "${val}"]\n`;
    }
  }
  pgn += '\n';

  let moveText = '';
  for (let i = 0; i < moves.length; i++) {
    if (i % 2 === 0) {
      const moveNum = Math.floor(i / 2) + 1;
      moveText += `${moveNum}. `;
    }
    moveText += `${moves[i].san} `;
  }

  moveText += result;
  pgn += moveText.trim();
  return pgn;
}
