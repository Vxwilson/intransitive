/**
 * Perft (Performance Test) Suite for Chessesque.
 * Recursively counts legal leaf nodes at given depths to mathematically verify rule accuracy.
 */

import { Chess } from './chess';

export interface PerftResult {
  depth: number;
  nodes: number;
  timeMs: number;
  nps: number;
  expectedNodes?: number;
  matchesExpected?: boolean;
}

export interface DivideEntry {
  moveSan: string;
  from: string;
  to: string;
  nodes: number;
}

export const PERFT_TEST_SUITES = [
  {
    name: 'Initial Position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expected: [1, 20, 400, 8902, 197281, 4865609],
  },
  {
    name: 'Position 2 (Kiwipete - Pins & Castling)',
    fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    expected: [1, 48, 2039, 97862, 4085603],
  },
  {
    name: 'Position 3 (Endgame & En Passant)',
    fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    expected: [1, 14, 191, 2812, 43238, 674624],
  },
  {
    name: 'Position 4 (Discovered Checks & Promo)',
    fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    expected: [1, 6, 264, 9467, 422333],
  },
];

export function perft(chess: Chess, depth: number): number {
  if (depth === 0) return 1;

  const legalMoves = chess.generateLegalMoves();
  if (depth === 1) return legalMoves.length;

  let nodes = 0;
  for (const move of legalMoves) {
    chess.makeMove(move);
    nodes += perft(chess, depth - 1);
    chess.unmakeMove();
  }

  return nodes;
}

export function perftDivide(chess: Chess, depth: number): { entries: DivideEntry[]; totalNodes: number } {
  if (depth <= 0) return { entries: [], totalNodes: 1 };

  const legalMoves = chess.generateLegalMoves();
  const entries: DivideEntry[] = [];
  let totalNodes = 0;

  for (const move of legalMoves) {
    const san = chess.moveToSAN(move);
    const fromName = String.fromCharCode('a'.charCodeAt(0) + (move.from % 8)) + (Math.floor(move.from / 8) + 1);
    const toName = String.fromCharCode('a'.charCodeAt(0) + (move.to % 8)) + (Math.floor(move.to / 8) + 1);

    chess.makeMove(move);
    const subNodes = depth === 1 ? 1 : perft(chess, depth - 1);
    chess.unmakeMove();

    totalNodes += subNodes;
    entries.push({
      moveSan: san,
      from: fromName,
      to: toName,
      nodes: subNodes,
    });
  }

  return { entries, totalNodes };
}

export function runPerftBenchmark(fen: string, depth: number, expectedNodes?: number): PerftResult {
  const chess = new Chess(fen);
  const startTime = performance.now();
  const nodes = perft(chess, depth);
  const duration = Math.max(0.1, performance.now() - startTime);
  const nps = Math.round((nodes / duration) * 1000);

  return {
    depth,
    nodes,
    timeMs: Math.round(duration),
    nps,
    expectedNodes,
    matchesExpected: expectedNodes !== undefined ? nodes === expectedNodes : undefined,
  };
}
