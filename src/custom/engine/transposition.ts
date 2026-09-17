/**
 * Transposition Table (TT) for Intransitive 9x9 Engine
 * Uses 64-bit Zobrist hash keys with depth-preferred replacement and age
 * tracking. Package 1 search contexts use this table for move ordering only.
 */

import type { Move } from '../core/types';
import { WIN_SCORE } from './evaluator';

export const TTFlag = {
  Exact: 0,
  LowerBound: 1, // Beta cutoff (score >= beta)
  UpperBound: 2, // Alpha fail-low (score <= alpha)
} as const;

export type TTFlag = (typeof TTFlag)[keyof typeof TTFlag];

export interface TTEntry {
  hash: bigint;
  depth: number;
  score: number;
  flag: TTFlag;
  bestMove: Move | null;
  age: number;
}

const MATE_THRESHOLD = WIN_SCORE - 200;

export class IntransitiveTT {
  private size: number;
  private mask: bigint;
  private entries: (TTEntry | null)[];
  public age: number = 0;

  constructor(sizeBits: number = 16) {
    // 16 bits = 65,536 entries (~4MB in V8)
    this.size = 1 << sizeBits;
    this.mask = BigInt(this.size - 1);
    this.entries = new Array(this.size).fill(null);
  }

  public incrementAge(): void {
    this.age = (this.age + 1) & 0xff;
  }

  public clear(): void {
    this.entries.fill(null);
    this.age = 0;
  }

  public probe(hash: bigint, ply: number): TTEntry | null {
    const idx = Number(hash & this.mask);
    const entry = this.entries[idx];

    if (!entry || entry.hash !== hash) {
      return null;
    }

    // Mate score normalization
    let score = entry.score;
    if (score >= MATE_THRESHOLD) {
      score -= ply;
    } else if (score <= -MATE_THRESHOLD) {
      score += ply;
    }

    return {
      ...entry,
      score,
    };
  }

  /**
   * Store only a move-ordering hint. Search deliberately does not reuse the
   * score, bound, or depth from this table: the board key does not encode the
   * complete repetition path or every search extension context.
   */
  public storeMove(hash: bigint, depth: number, bestMove: Move | null): void {
    if (!bestMove) return;

    const idx = Number(hash & this.mask);
    const existing = this.entries[idx];
    if (
      !existing ||
      existing.age !== this.age ||
      depth >= existing.depth
    ) {
      this.entries[idx] = {
        hash,
        depth,
        score: 0,
        flag: TTFlag.Exact,
        bestMove,
        age: this.age,
      };
    }
  }

  public store(
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Move | null,
    ply: number
  ): void {
    const idx = Number(hash & this.mask);
    const existing = this.entries[idx];

    // Normalize mate score to distance from root
    let adjustedScore = score;
    if (score >= MATE_THRESHOLD) {
      adjustedScore += ply;
    } else if (score <= -MATE_THRESHOLD) {
      adjustedScore -= ply;
    }

    // Replacement strategy: replace if empty, from older search, or shallower depth
    if (
      !existing ||
      existing.age !== this.age ||
      depth >= existing.depth ||
      flag === TTFlag.Exact
    ) {
      this.entries[idx] = {
        hash,
        depth,
        score: adjustedScore,
        flag,
        bestMove: bestMove ?? (existing ? existing.bestMove : null),
        age: this.age,
      };
    }
  }
}

// Global shared instance for single-threaded searches/workers
export const globalIntransitiveTT = new IntransitiveTT(16);
