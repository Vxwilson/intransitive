/**
 * Transposition Table (TT) for Chessesque Search Engine
 * Uses 64-bit Zobrist hash keys with depth-preferred replacement,
 * age tracking, and mate-distance normalization.
 */

import type { Move, MoveFlag } from '../core/types';

export const TTFlag = {
  Exact: 0,
  LowerBound: 1, // Fail-high / Beta cutoff (score >= beta)
  UpperBound: 2, // Fail-low / All-node (score <= alpha)
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

export const MATE_THRESHOLD = 29000;
export const INFINITE_SCORE = 100000;

export interface ITranspositionTable {
  age: number;
  capacity: number;
  incrementAge(): void;
  clear(): void;
  probe(hash: bigint, ply: number): TTEntry | null;
  store(
    hash: bigint,
    depth: number,
    score: number,
    flag: TTFlag,
    bestMove: Move | null,
    ply: number
  ): void;
  getFillPercentage(): number;
}

export class TranspositionTable implements ITranspositionTable {
  private size: number;
  private mask: bigint;
  private entries: (TTEntry | null)[];
  public age: number = 0;

  constructor(sizeBits: number = 18) {
    // Default 18 = 262,144 entries (~16MB in V8)
    this.size = 1 << sizeBits;
    this.mask = BigInt(this.size - 1);
    this.entries = new Array(this.size).fill(null);
  }

  /**
   * Resizes the transposition table given memory in Megabytes.
   * e.g. 16MB -> 262,144 entries
   *      64MB -> 1,048,576 entries
   *     128MB -> 2,097,152 entries
   *     256MB -> 4,194,304 entries
   */
  public resize(mb: number): void {
    const clampedMb = Math.max(8, Math.min(512, mb));
    let bits = Math.floor(Math.log2((clampedMb * 1024 * 1024) / 64));
    bits = Math.max(16, Math.min(23, bits));
    this.size = 1 << bits;
    this.mask = BigInt(this.size - 1);
    this.entries = new Array(this.size).fill(null);
  }

  public get capacity(): number {
    return this.size;
  }

  /**
   * Resets all table entries and age counter.
   */
  public clear(): void {
    this.entries.fill(null);
    this.age = 0;
  }

  /**
   * Increments current search generation for aging out stale positions.
   */
  public incrementAge(): void {
    this.age++;
  }

  /**
   * Probes the transposition table for an existing entry matching the Zobrist hash.
   * Adjusts mate distance relative to current root ply.
   */
  public probe(hash: bigint, ply: number): TTEntry | null {
    const idx = Number(hash & this.mask);
    const entry = this.entries[idx];

    if (!entry || entry.hash !== hash) {
      return null;
    }

    // Normalize mate score back to the current search tree ply
    let adjustedScore = entry.score;
    if (adjustedScore > MATE_THRESHOLD) {
      adjustedScore -= ply;
    } else if (adjustedScore < -MATE_THRESHOLD) {
      adjustedScore += ply;
    }

    return {
      ...entry,
      score: adjustedScore,
    };
  }

  /**
   * Stores or replaces an evaluation entry in the transposition table.
   * Adjusts mate distance to be ply-independent.
   */
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

    // Normalize mate score to be distance-from-current-node independent
    let storedScore = score;
    if (storedScore > MATE_THRESHOLD) {
      storedScore += ply;
    } else if (storedScore < -MATE_THRESHOLD) {
      storedScore -= ply;
    }

    // Replacement scheme:
    // 1. Empty slot
    // 2. Exact match on hash
    // 3. Deeper search depth
    // 4. Stale age entry
    if (
      !existing ||
      existing.hash === hash ||
      existing.age !== this.age ||
      depth >= existing.depth
    ) {
      this.entries[idx] = {
        hash,
        depth,
        score: storedScore,
        flag,
        bestMove: bestMove ?? existing?.bestMove ?? null,
        age: this.age,
      };
    }
  }

  /**
   * Returns table fill percentage (0 to 100).
   */
  public getFillPercentage(): number {
    let count = 0;
    const sampleSize = 1000;
    for (let i = 0; i < sampleSize; i++) {
      if (this.entries[i] !== null) count++;
    }
    return Math.round((count / sampleSize) * 100);
  }
}

/**
 * SharedTranspositionTable - High-Performance Binary Transposition Table
 * Backed by a single SharedArrayBuffer with 64-bit lockless atomic reads and writes.
 * Shared across multiple Web Worker threads for Lazy SMP parallel search.
 * Each entry is 16 bytes:
 * - Word 0 (BigUint64): 64-bit Zobrist hash key
 * - Word 1 (BigUint64): 64-bit packed payload (Score, Depth, Flag, Age, Move)
 */
export class SharedTranspositionTable implements ITranspositionTable {
  public buffer: SharedArrayBuffer;
  private u64: BigUint64Array;
  public readonly size: number;
  private mask: bigint;
  public age: number = 0;

  constructor(buffer: SharedArrayBuffer) {
    this.buffer = buffer;
    this.u64 = new BigUint64Array(buffer);
    // 16 bytes per entry = 2 x 64-bit words
    this.size = this.u64.length / 2;
    this.mask = BigInt(this.size - 1);
  }

  /**
   * Allocates a new SharedArrayBuffer sized for the given MB (power of 2 entries).
   */
  public static createBuffer(mb: number): SharedArrayBuffer {
    const clampedMb = Math.max(8, Math.min(512, mb));
    const bits = Math.floor(Math.log2((clampedMb * 1024 * 1024) / 16));
    const entriesCount = 1 << bits;
    return new SharedArrayBuffer(entriesCount * 16);
  }

  public get capacity(): number {
    return this.size;
  }

  public clear(): void {
    this.u64.fill(0n);
    this.age = 0;
  }

  public incrementAge(): void {
    this.age = (this.age + 1) & 63;
  }

  public probe(hash: bigint, ply: number): TTEntry | null {
    const idx = Number(hash & this.mask);
    const hashIdx = idx * 2;
    const dataIdx = hashIdx + 1;

    // First atomic read of hash key
    const storedHash = Atomics.load(this.u64, hashIdx);
    if (storedHash !== hash) {
      return null;
    }

    // Atomic read of 64-bit packed payload
    const payload = Atomics.load(this.u64, dataIdx);

    // Guard against race condition where another thread overwrote entry mid-read
    if (Atomics.load(this.u64, hashIdx) !== hash) {
      return null;
    }

    const { score, depth, flag, age, move } = this.unpackPayload(payload);

    let adjustedScore = score;
    if (adjustedScore > MATE_THRESHOLD) {
      adjustedScore -= ply;
    } else if (adjustedScore < -MATE_THRESHOLD) {
      adjustedScore += ply;
    }

    return {
      hash,
      depth,
      score: adjustedScore,
      flag,
      bestMove: move,
      age,
    };
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
    const hashIdx = idx * 2;
    const dataIdx = hashIdx + 1;

    const existingHash = Atomics.load(this.u64, hashIdx);
    let shouldReplace = true;

    if (existingHash === hash) {
      const existingPayload = Atomics.load(this.u64, dataIdx);
      const existingDepth = Number((existingPayload >> 16n) & 0xffn);
      const existingAge = Number((existingPayload >> 26n) & 63n);

      // Keep deeper entry from current search age
      if (existingAge === this.age && depth < existingDepth) {
        shouldReplace = false;
      }
      if (!bestMove) {
        const { move: existingMove } = this.unpackPayload(existingPayload);
        bestMove = existingMove;
      }
    }

    if (!shouldReplace) return;

    let storedScore = score;
    if (storedScore > MATE_THRESHOLD) {
      storedScore += ply;
    } else if (storedScore < -MATE_THRESHOLD) {
      storedScore -= ply;
    }

    const payload = this.packPayload(storedScore, depth, flag, this.age, bestMove);

    // Lockless write: store payload first, then atomic store hash key
    Atomics.store(this.u64, dataIdx, payload);
    Atomics.store(this.u64, hashIdx, hash);
  }

  public getFillPercentage(): number {
    let count = 0;
    const sampleSize = 1000;
    const step = Math.max(1, Math.floor(this.size / sampleSize));
    for (let i = 0; i < this.size && count < sampleSize; i += step) {
      if (Atomics.load(this.u64, i * 2) !== 0n) count++;
    }
    return Math.round((count / sampleSize) * 100);
  }

  private packPayload(
    score: number,
    depth: number,
    flag: TTFlag,
    age: number,
    move: Move | null
  ): bigint {
    const normScore = BigInt((score + 32768) & 0xffff);
    const d = BigInt(Math.max(0, Math.min(255, depth))) << 16n;
    const f = BigInt(flag & 3) << 24n;
    const a = BigInt(age & 63) << 26n;

    if (!move) {
      return normScore | d | f | a;
    }

    const hasMove = 1n << 32n;
    const from = BigInt(move.from & 63) << 33n;
    const to = BigInt(move.to & 63) << 39n;
    const piece = BigInt(move.piece & 7) << 45n;
    const captured = BigInt((move.captured ?? 0) & 7) << 48n;
    const promo = BigInt((move.promotion ?? 0) & 7) << 51n;
    const flags = BigInt((move.flags ?? 0) & 15) << 54n;

    return normScore | d | f | a | hasMove | from | to | piece | captured | promo | flags;
  }

  private unpackPayload(payload: bigint): {
    score: number;
    depth: number;
    flag: TTFlag;
    age: number;
    move: Move | null;
  } {
    const normScore = Number(payload & 0xffffn);
    const score = normScore - 32768;
    const depth = Number((payload >> 16n) & 0xffn);
    const flag = Number((payload >> 24n) & 3n) as TTFlag;
    const age = Number((payload >> 26n) & 63n);

    const hasMove = Number((payload >> 32n) & 1n) === 1;
    let move: Move | null = null;

    if (hasMove) {
      const from = Number((payload >> 33n) & 63n);
      const to = Number((payload >> 39n) & 63n);
      const piece = Number((payload >> 45n) & 7n);
      const capNum = Number((payload >> 48n) & 7n);
      const promoNum = Number((payload >> 51n) & 7n);
      const flags = Number((payload >> 54n) & 15n);

      move = {
        from,
        to,
        piece: piece as any,
        captured: capNum > 0 ? (capNum as any) : undefined,
        promotion: promoNum > 0 ? (promoNum as any) : undefined,
        flags: flags as MoveFlag,
      };
    }

    return { score, depth, flag, age, move };
  }
}
