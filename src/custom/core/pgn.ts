/**
 * Intransitive (9x9 RPS Board Game) - PGN (Portable Game Notation) Serializer
 * Generates standards-compliant PGN strings for single matches and multi-game tournaments.
 */

import { INITIAL_INTRANSITIVE_FEN } from './fen';
import type { Move } from './types';

export interface PGNGameData {
  event?: string;
  site?: string;
  date?: string;
  round?: number | string;
  white?: string; // Blue plays as White in standard chess PGN readers
  black?: string; // Red plays as Black in standard chess PGN readers
  result?: string; // "1-0", "0-1", "1/2-1/2", "*"
  termination?: string;
  fen?: string;
  moves: { san: string; move?: Move }[];
}

export interface PGNTournamentData {
  event?: string;
  site?: string;
  date?: string;
  fighterAName: string;
  fighterBName: string;
  games: {
    gameNumber: number;
    fighterAIsBlue: boolean;
    result: string;
    termination: string;
    moves: { san: string }[];
  }[];
}

/**
 * Format current date as YYYY.MM.DD
 */
export function getFormattedDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

/**
 * Format single game to PGN string
 */
export function generateGamePGN(data: PGNGameData): string {
  const dateStr = data.date || getFormattedDate();
  const event = data.event || 'Intransitive Match';
  const site = data.site || 'Intransitive Studio';
  const round = data.round !== undefined ? String(data.round) : '1';
  const white = data.white || 'Blue';
  const black = data.black || 'Red';
  const result = data.result || '*';

  const headers: string[] = [
    `[Event "${event}"]`,
    `[Site "${site}"]`,
    `[Date "${dateStr}"]`,
    `[Round "${round}"]`,
    `[White "${white}"]`,
    `[Black "${black}"]`,
    `[Result "${result}"]`,
    `[Variant "Intransitive 9x9 RPS"]`,
    `[Blue "${white}"]`,
    `[Red "${black}"]`,
  ];

  if (data.termination) {
    headers.push(`[Termination "${data.termination}"]`);
  }

  // Include FEN if not the standard starting position
  if (data.fen && data.fen !== INITIAL_INTRANSITIVE_FEN) {
    headers.push(`[SetUp "1"]`);
    headers.push(`[FEN "${data.fen}"]`);
  }

  // Format move pairs
  const movePairs: string[] = [];
  for (let i = 0; i < data.moves.length; i += 2) {
    const moveNum = Math.floor(i / 2) + 1;
    const blueSan = data.moves[i].san;
    const redSan = i + 1 < data.moves.length ? data.moves[i + 1].san : null;

    if (redSan) {
      movePairs.push(`${moveNum}. ${blueSan} ${redSan}`);
    } else {
      movePairs.push(`${moveNum}. ${blueSan}`);
    }
  }

  const movetext = movePairs.length > 0 ? `${movePairs.join(' ')} ${result}` : result;

  return `${headers.join('\n')}\n\n${movetext}\n`;
}

/**
 * Format multi-game tournament to aggregated PGN collection
 */
export function generateTournamentPGN(tournament: PGNTournamentData): string {
  const dateStr = tournament.date || getFormattedDate();
  const event = tournament.event || `Tournament: ${tournament.fighterAName} vs ${tournament.fighterBName}`;
  const site = tournament.site || 'Intransitive Studio';

  const pgnGames = tournament.games.map((g) => {
    const white = g.fighterAIsBlue ? tournament.fighterAName : tournament.fighterBName;
    const black = g.fighterAIsBlue ? tournament.fighterBName : tournament.fighterAName;

    return generateGamePGN({
      event,
      site,
      date: dateStr,
      round: g.gameNumber,
      white,
      black,
      result: g.result,
      termination: g.termination,
      moves: g.moves,
    });
  });

  return pgnGames.join('\n');
}

/**
 * Browser file download helper
 */
export function downloadTextFile(filename: string, content: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Extract SAN move tokens from a PGN string
 */
export function parsePGNMoves(pgn: string): string[] {
  // Strip out headers [Key "Value"]
  const withoutHeaders = pgn.replace(/\[[^\]]*\]/g, ' ');
  // Strip out comments {comment} or ;comment
  const withoutComments = withoutHeaders.replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ');
  // Match tokens
  const tokens = withoutComments.split(/\s+/);
  const moves: string[] = [];
  const moveRegex = /^[RPSrps][a-i][1-9][\-x][RPSrps]?[a-i][1-9][#]?$/;

  for (const token of tokens) {
    const cleaned = token.replace(/^\d+\.+/, '').trim();
    if (moveRegex.test(cleaned)) {
      moves.push(cleaned);
    }
  }
  return moves;
}
