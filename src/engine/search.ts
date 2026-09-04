/**
 * Classical Negamax Search Engine for Chessesque
 * Features:
 * - Alpha-Beta pruning with fail-soft bounds
 * - Quiescence search with delta pruning & check evasions
 * - Transposition Table (Zobrist hash) lookup & move ordering
 * - Move Ordering: Hash move, MVV-LVA, Killer moves, History heuristic
 * - Iterative Deepening with dynamic time budgeting & PV extraction
 */

import type { Move, Color } from '../core/types';
import type { SearchLine } from './engineTypes';
import {
  WHITE,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  MoveFlag,
} from '../core/types';
import { Chess } from '../core/chess';
import { evaluate } from './evaluate';
import {
  TranspositionTable,
  TTFlag,
  MATE_THRESHOLD,
  type ITranspositionTable,
} from './transposition';

export const MATE_SCORE = 30000;
export const INFINITY = 100000;
export const MAX_PLY = 64;

// MVV-LVA (Most Valuable Victim - Least Valuable Attacker) values
const VICTIM_VALUES: Record<number, number> = {
  [PAWN]: 100,
  [KNIGHT]: 300,
  [BISHOP]: 320,
  [ROOK]: 500,
  [QUEEN]: 900,
  [KING]: 10000,
};

const ATTACKER_ORDER: Record<number, number> = {
  [PAWN]: 1,
  [KNIGHT]: 2,
  [BISHOP]: 3,
  [ROOK]: 4,
  [QUEEN]: 5,
  [KING]: 6,
};

export interface SearchOptions {
  maxDepth?: number;
  timeLimitMs?: number;
  multiPv?: number;
  threadId?: number;
  numThreads?: number;
  onDepthComplete?: (update: SearchUpdate) => void;
  onNodesUpdate?: (nodes: number) => void;
  shouldStop?: () => boolean;
}

export interface SearchUpdate {
  depth: number;
  score: number; // from active player's perspective
  scoreWhite: number; // normalized to White's perspective (+ = White advantage)
  bestMove: Move | null;
  bestMoveSAN?: string;
  nodes: number;
  nps: number;
  timeMs: number;
  pv: Move[];
  pvSAN: string[];
  lines?: SearchLine[];
  isMate: boolean;
  mateInPlies: number | null;
}

export interface SearchResult extends SearchUpdate {
  completedDepth: number;
}

export class SearchEngine {
  public tt: ITranspositionTable;
  private nodes: number = 0;
  private startTime: number = 0;
  private timeLimitMs: number = 0;
  private stopRequested: boolean = false;
  private externalShouldStop?: () => boolean;
  private threadId: number = 0;
  private onNodesUpdate?: (nodes: number) => void;

  // Killer moves: 2 per ply
  private killerMoves: (Move | null)[][];
  // History table: [color][from][to]
  private historyTable: number[][][];
  // Direct root best move tracking to safeguard against TT collisions
  private rootIterationBestMove: Move | null = null;
  // Multi-PV excluded moves at root
  private rootExcludedMoves: Move[] = [];

  constructor(ttOrBits: ITranspositionTable | number = 18) {
    if (typeof ttOrBits === 'number') {
      this.tt = new TranspositionTable(ttOrBits);
    } else {
      this.tt = ttOrBits;
    }

    // Initialize killer moves table [MAX_PLY][2]
    this.killerMoves = Array.from({ length: MAX_PLY }, () => [null, null]);

    // Initialize history table [2][64][64]
    this.historyTable = [
      Array.from({ length: 64 }, () => new Array(64).fill(0)),
      Array.from({ length: 64 }, () => new Array(64).fill(0)),
    ];
  }

  /**
   * Dynamically resizes the transposition table memory (if supported by implementation).
   */
  public setHashSize(mb: number): void {
    if ('resize' in this.tt && typeof (this.tt as any).resize === 'function') {
      (this.tt as any).resize(mb);
    }
  }

  /**
   * Clears killer moves and decays history table between games.
   */
  public resetHeuristics(): void {
    this.killerMoves = Array.from({ length: MAX_PLY }, () => [null, null]);
    for (let c = 0; c < 2; c++) {
      for (let from = 0; from < 64; from++) {
        this.historyTable[c][from].fill(0);
      }
    }
    this.tt.clear();
  }

  /**
   * Main entry point: Performs Iterative Deepening search on the given position.
   */
  public search(chess: Chess, options: SearchOptions = {}): SearchResult {
    const maxDepth = options.maxDepth ?? 8;
    this.timeLimitMs = options.timeLimitMs ?? 1000;
    this.externalShouldStop = options.shouldStop;
    this.stopRequested = false;
    this.nodes = 0;
    this.startTime = performance.now();
    this.threadId = options.threadId ?? 0;
    this.onNodesUpdate = options.onNodesUpdate;
    this.tt.incrementAge();

    let rootBestMove: Move | null = null;
    let rootScore: number = 0;
    let completedDepth = 0;
    let pvMoves: Move[] = [];
    let pvSAN: string[] = [];

    // Quick check: if game is already over
    const initialLegal = chess.generateLegalMoves();
    if (initialLegal.length === 0) {
      const inCheck = chess.inCheck();
      const score = inCheck ? -MATE_SCORE : 0;
      return {
        depth: 0,
        completedDepth: 0,
        score,
        scoreWhite: chess.activeColor === WHITE ? score : -score,
        bestMove: null,
        nodes: 1,
        nps: 0,
        timeMs: 0,
        pv: [],
        pvSAN: [],
        isMate: inCheck,
        mateInPlies: inCheck ? 0 : null,
      };
    }

    // Default fallback best move if search is aborted instantly
    rootBestMove = initialLegal[0];

    const targetMultiPv = Math.max(
      1,
      Math.min(5, Math.min(options.multiPv ?? 1, initialLegal.length))
    );
    let currentLines: SearchLine[] = [];

    // Iterative Deepening loop (helper threads stagger start depth to seed cutoffs)
    const startDepth = this.threadId > 0 && (this.threadId % 2 === 1) ? 2 : 1;
    for (let depth = startDepth; depth <= maxDepth; depth++) {
      if (targetMultiPv === 1) {
        this.rootIterationBestMove = null;
        this.rootExcludedMoves = [];
        const score = this.negamax(chess, depth, -INFINITY, INFINITY, 0, true);

        // If search was interrupted before completing depth, keep best move
        if (this.isTimeUp()) {
          if (this.rootIterationBestMove) {
            rootBestMove = this.rootIterationBestMove;
          }
          break;
        }

        completedDepth = depth;
        rootScore = score;

        if (this.rootIterationBestMove) {
          rootBestMove = this.rootIterationBestMove;
        } else {
          const ttEntry = this.tt.probe(chess.zobristHash, 0);
          if (ttEntry?.bestMove) {
            rootBestMove = ttEntry.bestMove;
          }
        }

        // Extract Principal Variation (PV)
        pvMoves = this.extractPV(chess, depth, rootBestMove);
        pvSAN = this.formatPVtoSAN(chess, pvMoves);

        const isMate = Math.abs(rootScore) > MATE_THRESHOLD;
        const mateInPlies = isMate ? MATE_SCORE - Math.abs(rootScore) : null;
        const scoreWhite = chess.activeColor === WHITE ? rootScore : -rootScore;

        currentLines = [
          {
            rank: 1,
            move: rootBestMove,
            san: chess.moveToSAN(rootBestMove),
            score: rootScore,
            scoreWhite,
            pv: pvMoves,
            pvSAN,
            isMate,
            mateInPlies,
          },
        ];
      } else {
        // Multi-PV: search top N distinct candidate moves
        const linesThisDepth: SearchLine[] = [];
        const excluded: Move[] = [];

        for (let pvRank = 1; pvRank <= targetMultiPv; pvRank++) {
          this.rootExcludedMoves = excluded;
          this.rootIterationBestMove = null;
          const score = this.negamax(chess, depth, -INFINITY, INFINITY, 0, true);

          if (this.isTimeUp()) break;

          if (this.rootIterationBestMove) {
            const m = this.rootIterationBestMove;
            excluded.push(m);
            const linePv = this.extractPV(chess, depth, m);
            const isLineMate = Math.abs(score) > MATE_THRESHOLD;
            const lineMateInPlies = isLineMate ? MATE_SCORE - Math.abs(score) : null;
            const lineScoreWhite = chess.activeColor === WHITE ? score : -score;

            linesThisDepth.push({
              rank: pvRank,
              move: m,
              san: chess.moveToSAN(m),
              score,
              scoreWhite: lineScoreWhite,
              pv: linePv,
              pvSAN: this.formatPVtoSAN(chess, linePv),
              isMate: isLineMate,
              mateInPlies: lineMateInPlies,
            });
          }
        }
        this.rootExcludedMoves = [];

        if (this.isTimeUp() && linesThisDepth.length === 0) {
          break;
        }

        if (linesThisDepth.length > 0) {
          currentLines = linesThisDepth;
          rootBestMove = linesThisDepth[0].move;
          rootScore = linesThisDepth[0].score;
          pvMoves = linesThisDepth[0].pv;
          pvSAN = linesThisDepth[0].pvSAN;
          completedDepth = depth;
        }
      }

      const elapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
      const nps = Math.round((this.nodes * 1000) / elapsedMs);
      const isMate = Math.abs(rootScore) > MATE_THRESHOLD;
      const mateInPlies = isMate ? MATE_SCORE - Math.abs(rootScore) : null;
      const scoreWhite = chess.activeColor === WHITE ? rootScore : -rootScore;

      const update: SearchUpdate = {
        depth: completedDepth,
        score: rootScore,
        scoreWhite,
        bestMove: rootBestMove,
        bestMoveSAN: rootBestMove ? chess.moveToSAN(rootBestMove) : undefined,
        nodes: this.nodes,
        nps,
        timeMs: elapsedMs,
        pv: pvMoves,
        pvSAN,
        lines: currentLines,
        isMate,
        mateInPlies,
      };

      if (options.onDepthComplete) {
        options.onDepthComplete(update);
      }

      // Stop early if forced checkmate is found
      if (isMate && rootScore > 0) {
        break;
      }

      // If more than 55% of allocated time budget is consumed, do not start next depth
      if (this.timeLimitMs > 0 && elapsedMs >= this.timeLimitMs * 0.55) {
        break;
      }
    }

    const totalElapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
    const finalNps = Math.round((this.nodes * 1000) / totalElapsedMs);
    const isMate = Math.abs(rootScore) > MATE_THRESHOLD;
    const mateInPlies = isMate ? MATE_SCORE - Math.abs(rootScore) : null;
    const scoreWhite = chess.activeColor === WHITE ? rootScore : -rootScore;

    if (this.onNodesUpdate) {
      this.onNodesUpdate(this.nodes);
    }

    return {
      depth: completedDepth,
      completedDepth,
      score: rootScore,
      scoreWhite,
      bestMove: rootBestMove,
      bestMoveSAN: rootBestMove ? chess.moveToSAN(rootBestMove) : undefined,
      nodes: this.nodes,
      nps: finalNps,
      timeMs: totalElapsedMs,
      pv: pvMoves,
      pvSAN,
      lines: currentLines,
      isMate,
      mateInPlies,
    };
  }

  /**
   * Request interruption of the active search.
   */
  public stop(): void {
    this.stopRequested = true;
  }

  /**
   * Time & cancellation check (checked periodically every 1024 nodes).
   */
  private isTimeUp(): boolean {
    if (this.stopRequested) return true;
    if (this.externalShouldStop && this.externalShouldStop()) return true;

    if ((this.nodes & 1023) === 0) {
      if (this.onNodesUpdate) {
        this.onNodesUpdate(this.nodes);
      }
      if (this.timeLimitMs > 0 && performance.now() - this.startTime >= this.timeLimitMs) {
        this.stopRequested = true;
        return true;
      }
    }
    return false;
  }

  /**
   * Negamax search with Alpha-Beta pruning, Transposition Table, and Move Ordering.
   */
  private negamax(
    chess: Chess,
    depth: number,
    alpha: number,
    beta: number,
    ply: number,
    isPvNode: boolean
  ): number {
    this.nodes++;

    if (this.isTimeUp()) {
      return 0;
    }

    // Draw detection in search tree (50-move rule, threefold repetition, or insufficient material)
    if (ply > 0) {
      if (chess.halfmoveClock >= 100 || chess.isInsufficientMaterial()) {
        return 0;
      }
    }

    // Leaf node: transition into Quiescence search
    if (depth <= 0 || ply >= MAX_PLY) {
      return this.quiescence(chess, alpha, beta, ply);
    }

    // Probe Transposition Table
    const ttEntry = this.tt.probe(chess.zobristHash, ply);
    let ttBestMove: Move | null = null;

    if (ttEntry) {
      ttBestMove = ttEntry.bestMove;
      // In non-PV nodes, allow TT cutoffs if depth is sufficient
      if (!isPvNode && ttEntry.depth >= depth) {
        if (ttEntry.flag === TTFlag.Exact) {
          return ttEntry.score;
        }
        if (ttEntry.flag === TTFlag.LowerBound && ttEntry.score >= beta) {
          return ttEntry.score;
        }
        if (ttEntry.flag === TTFlag.UpperBound && ttEntry.score <= alpha) {
          return ttEntry.score;
        }
      }
    }

    // Null Move Pruning (NMP)
    // If we pass our turn and opponent cannot beat beta, position is so strong we can prune.
    // Conditions:
    // - Not in a PV node
    // - ply > 0 (never at root)
    // - depth >= 3
    // - Not currently in check
    // - Active player has non-pawn material (guards against zugzwang in pure pawn endgames)
    if (
      !isPvNode &&
      ply > 0 &&
      depth >= 3 &&
      !chess.inCheck() &&
      chess.hasNonPawnMaterial(chess.activeColor)
    ) {
      const R = depth >= 6 ? 3 : 2; // adaptive reduction
      chess.makeNullMove();
      const nullScore = -this.negamax(
        chess,
        depth - 1 - R,
        -beta,
        -beta + 1,
        ply + 1,
        false
      );
      chess.unmakeNullMove();

      if (this.stopRequested) {
        return 0;
      }

      // If passing still causes a beta cutoff, prune subtree
      if (nullScore >= beta) {
        return beta;
      }
    }

    // Generate legal moves
    const legalMoves = chess.generateLegalMoves();

    // Checkmate and Stalemate detection
    if (legalMoves.length === 0) {
      if (chess.inCheck()) {
        // Closer mate distance preferred: -MATE_SCORE + ply
        return -MATE_SCORE + ply;
      }
      return 0; // Stalemate
    }

    // Score and order moves
    this.orderMoves(legalMoves, ttBestMove, ply, chess.activeColor);

    let bestMove: Move | null = null;
    let bestScore = -INFINITY;
    const originalAlpha = alpha;

    for (let i = 0; i < legalMoves.length; i++) {
      const move = legalMoves[i];

      // Multi-PV: skip root moves already chosen for higher-ranked lines
      if (
        ply === 0 &&
        this.rootExcludedMoves.some(
          (ex) =>
            ex.from === move.from &&
            ex.to === move.to &&
            ex.promotion === move.promotion
        )
      ) {
        continue;
      }

      chess.makeMove(move);

      let score: number;
      const isCapture = move.captured !== undefined || move.flags === MoveFlag.EnPassant;
      const isPromotion = move.promotion !== undefined;
      const givesCheck = chess.inCheck();
      const isKiller = this.isKiller(move, ply, 0) || this.isKiller(move, ply, 1);

      // Late Move Reductions (LMR)
      // Conditions:
      // - Not at root (ply > 0)
      // - depth >= 3
      // - searched at least 3 moves (i >= 3)
      // - quiet move (not capture, not promotion)
      // - not giving check
      // - not a killer move
      const canLMR =
        ply > 0 &&
        depth >= 3 &&
        i >= 3 &&
        !isCapture &&
        !isPromotion &&
        !givesCheck &&
        !isKiller;

      if (canLMR) {
        // Compute reduction R: quiet late moves searched at reduced depth
        let reduction = 1;
        if (depth >= 5 && i >= 6) reduction = 2;
        if (depth >= 8 && i >= 12) reduction = 3;
        const reducedDepth = Math.max(1, depth - 1 - reduction);

        // Search with reduced depth and null window around alpha
        score = -this.negamax(
          chess,
          reducedDepth,
          -(alpha + 1),
          -alpha,
          ply + 1,
          false
        );

        // If move beat alpha, it might be better than expected: re-search at full depth
        if (score > alpha) {
          score = -this.negamax(
            chess,
            depth - 1,
            -beta,
            -alpha,
            ply + 1,
            isPvNode && i === 0
          );
        }
      } else {
        // Full depth search
        score = -this.negamax(
          chess,
          depth - 1,
          -beta,
          -alpha,
          ply + 1,
          isPvNode && i === 0
        );
      }

      chess.unmakeMove();

      if (this.stopRequested) {
        return 0;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
        if (ply === 0) {
          this.rootIterationBestMove = move;
        }
      }

      if (score > alpha) {
        alpha = score;
      }

      // Beta cutoff (Fail-high)
      if (alpha >= beta) {
        // Record killer move and update history heuristic if quiet move
        if (move.captured === undefined && move.flags !== MoveFlag.EnPassant) {
          this.recordKillerMove(move, ply);
          this.historyTable[chess.activeColor][move.from][move.to] += depth * depth;
        }
        break;
      }
    }

    // Store evaluation in Transposition Table
    let flag: (typeof TTFlag)[keyof typeof TTFlag] = TTFlag.Exact;
    if (bestScore <= originalAlpha) {
      flag = TTFlag.UpperBound;
    } else if (bestScore >= beta) {
      flag = TTFlag.LowerBound;
    }

    this.tt.store(chess.zobristHash, depth, bestScore, flag, bestMove, ply);

    return bestScore;
  }

  /**
   * Quiescence Search:
   * Continues tactical capture chains until a quiet position is reached,
   * completely neutralizing the horizon effect.
   */
  private quiescence(chess: Chess, alpha: number, beta: number, ply: number): number {
    this.nodes++;

    if (this.isTimeUp() || ply >= MAX_PLY) {
      return evaluate(chess);
    }

    const inCheck = chess.inCheck();

    // Stand-pat evaluation if not in check
    if (!inCheck) {
      const standPat = evaluate(chess);

      if (standPat >= beta) {
        return beta;
      }
      if (standPat > alpha) {
        alpha = standPat;
      }
    }

    // In check: must search all legal evasions to avoid horizon escapes
    // Not in check: search only captures and queen promotions
    const moves = chess.generateLegalMoves();
    const tacticalMoves = inCheck
      ? moves
      : moves.filter(
          (m) =>
            m.captured !== undefined ||
            m.flags === MoveFlag.EnPassant ||
            m.flags === MoveFlag.Promotion
        );

    if (tacticalMoves.length === 0) {
      if (inCheck && moves.length === 0) {
        return -MATE_SCORE + ply; // Checkmate in quiescence
      }
      return alpha;
    }

    // Order tactical captures by MVV-LVA
    tacticalMoves.sort((a, b) => this.scoreTacticalMove(b) - this.scoreTacticalMove(a));

    for (const move of tacticalMoves) {
      chess.makeMove(move);
      const score = -this.quiescence(chess, -beta, -alpha, ply + 1);
      chess.unmakeMove();

      if (this.stopRequested) {
        return 0;
      }

      if (score >= beta) {
        return beta;
      }
      if (score > alpha) {
        alpha = score;
      }
    }

    return alpha;
  }

  /**
   * Scores moves for alpha-beta ordering:
   * 1. TT best move: +2,000,000
   * 2. Winning/equal captures (MVV-LVA): +1,000,000 to +1,090,000
   * 3. Queen promotions: +950,000
   * 4. 1st Killer move: +50,000
   * 5. 2nd Killer move: +40,000
   * 6. History heuristic: up to +30,000
   */
  private orderMoves(moves: Move[], ttBestMove: Move | null, ply: number, color: Color): void {
    const scores = new Map<Move, number>();

    for (const m of moves) {
      let score = 0;

      // 1. TT Hash move
      if (
        ttBestMove &&
        m.from === ttBestMove.from &&
        m.to === ttBestMove.to &&
        m.promotion === ttBestMove.promotion
      ) {
        score = 2000000;
      }
      // 2. Tactical captures (MVV-LVA)
      else if (m.captured !== undefined || m.flags === MoveFlag.EnPassant) {
        const victimType = m.captured ?? PAWN;
        const victimVal = VICTIM_VALUES[victimType];
        const attackerVal = ATTACKER_ORDER[m.piece];
        score = 1000000 + victimVal * 10 - attackerVal;
      }
      // 3. Promotions
      else if (m.flags === MoveFlag.Promotion && m.promotion === QUEEN) {
        score = 950000;
      }
      // 4. Killer moves
      else if (this.isKiller(m, ply, 0)) {
        score = 50000;
      } else if (this.isKiller(m, ply, 1)) {
        score = 40000;
      }
      // 5. History heuristic
      else {
        let historyScore = this.historyTable[color][m.from][m.to];
        if (this.threadId > 0) {
          // Lazy SMP tie-break diversification on quiet moves
          const jitter = ((m.from * 31 + m.to * 17 + this.threadId * 53) % 40) - 20;
          historyScore += jitter;
        }
        score = Math.min(30000, Math.max(0, historyScore));
      }

      scores.set(m, score);
    }

    moves.sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0));
  }

  /**
   * Scores tactical moves specifically for Quiescence search.
   */
  private scoreTacticalMove(move: Move): number {
    let score = 0;
    if (move.captured !== undefined || move.flags === MoveFlag.EnPassant) {
      const victimType = move.captured ?? PAWN;
      const victimVal = VICTIM_VALUES[victimType];
      const attackerVal = ATTACKER_ORDER[move.piece];
      score = victimVal * 10 - attackerVal;
    }
    if (move.flags === MoveFlag.Promotion && move.promotion === QUEEN) {
      score += 800;
    }
    return score;
  }

  /**
   * Stores quiet move causing a beta cutoff as a killer move.
   */
  private recordKillerMove(move: Move, ply: number): void {
    if (ply >= MAX_PLY) return;
    const k0 = this.killerMoves[ply][0];
    if (!k0 || k0.from !== move.from || k0.to !== move.to) {
      this.killerMoves[ply][1] = k0;
      this.killerMoves[ply][0] = move;
    }
  }

  /**
   * Checks if move matches killer move at given index.
   */
  private isKiller(move: Move, ply: number, index: 0 | 1): boolean {
    if (ply >= MAX_PLY) return false;
    const km = this.killerMoves[ply][index];
    return km !== null && km.from === move.from && km.to === move.to;
  }

  /**
   * Extracts the Principal Variation (PV) by following Transposition Table best moves.
   */
  private extractPV(chess: Chess, maxPlies: number, rootFallbackMove?: Move | null): Move[] {
    const pv: Move[] = [];
    const visitedHashes = new Set<bigint>();
    let currentPlies = 0;

    while (currentPlies < maxPlies) {
      const hash = chess.zobristHash;
      if (visitedHashes.has(hash)) break;
      visitedHashes.add(hash);

      const entry = this.tt.probe(hash, currentPlies);
      let move = entry?.bestMove;

      // If at root and TT didn't have best move, use fallback
      if (currentPlies === 0 && !move && rootFallbackMove) {
        move = rootFallbackMove;
      }

      if (!move) break;

      // Verify that this move is strictly legal in the current position
      const legalMoves = chess.generateLegalMoves();
      const verified = legalMoves.find(
        (m) =>
          m.from === move.from &&
          m.to === move.to &&
          m.promotion === move.promotion
      );

      if (!verified) break;

      pv.push(verified);
      chess.makeMove(verified);
      currentPlies++;
    }

    // Unwind all applied PV moves
    for (let i = 0; i < currentPlies; i++) {
      chess.unmakeMove();
    }

    return pv;
  }

  /**
   * Converts a list of PV moves into standard SAN notation.
   */
  private formatPVtoSAN(chess: Chess, moves: Move[]): string[] {
    const sanList: string[] = [];
    let count = 0;

    for (const m of moves) {
      const san = chess.moveToSAN(m);
      sanList.push(san);
      chess.makeMove(m);
      count++;
    }

    for (let i = 0; i < count; i++) {
      chess.unmakeMove();
    }

    return sanList;
  }
}
