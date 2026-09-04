/**
 * Chessesque Core Rule Engine
 * 100% rule-complete chess engine with bitboards, Zobrist hashing,
 * full castling/en-passant validation, draw checks, and make/unmake move stack.
 */

import type {
  Color,
  PieceType,
  Square,
  Move,
  Piece,
  StateRecord,
  GameStatus,
} from './types';
import {
  MoveFlag,
  WHITE,
  BLACK,
  PAWN,
  KNIGHT,
  BISHOP,
  ROOK,
  QUEEN,
  KING,
  SQUARES,
  CASTLE_WK,
  CASTLE_WQ,
  CASTLE_BK,
  CASTLE_BQ,
} from './types';
import {
  squareBB,
  popcount,
  bitScanForward,
  KNIGHT_ATTACKS,
  KING_ATTACKS,
  PAWN_ATTACKS,
  getRookAttacks,
  getBishopAttacks,
  getQueenAttacks,
} from './bitboard';
import {
  getPieceZobrist,
  getCastlingZobrist,
  getEpZobrist,
  ZOBRIST_BLACK_TURN,
} from './zobrist';

export class Chess {
  // Bitboards: [color][pieceType - 1]
  public pieceBB: [bigint[], bigint[]];
  public occupied: [bigint, bigint]; // [WHITE, BLACK]
  public occupiedAll: bigint;

  // Mailbox 64-element array for O(1) piece lookup
  public mailbox: (Piece | null)[];

  // Game state
  public activeColor: Color;
  public castlingRights: number; // 4-bit mask: WK(1), WQ(2), BK(4), BQ(8)
  public epSquare: Square | null; // en-passant target square
  public halfmoveClock: number; // for 50-move rule
  public fullmoveNumber: number;
  public zobristHash: bigint;

  // Undo history stack
  private history: StateRecord[] = [];
  // Hash history for repetition tracking
  private hashHistory: bigint[] = [];
  // Null-move state stack for Null Move Pruning (NMP)
  private nullMoveHistory: {
    epSquare: Square | null;
    halfmoveClock: number;
    zobristHash: bigint;
  }[] = [];

  constructor(fen?: string) {
    this.pieceBB = [
      [0n, 0n, 0n, 0n, 0n, 0n],
      [0n, 0n, 0n, 0n, 0n, 0n],
    ];
    this.occupied = [0n, 0n];
    this.occupiedAll = 0n;
    this.mailbox = new Array(64).fill(null);
    this.activeColor = WHITE;
    this.castlingRights = 0;
    this.epSquare = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.zobristHash = 0n;

    if (fen) {
      this.loadFEN(fen);
    } else {
      this.reset();
    }
  }

  /**
   * Resets the board to the standard starting position.
   */
  public reset(): void {
    this.loadFEN('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  /**
   * Clears the board completely.
   */
  public clear(): void {
    for (let c = 0; c < 2; c++) {
      for (let pt = 0; pt < 6; pt++) {
        this.pieceBB[c][pt] = 0n;
      }
      this.occupied[c] = 0n;
    }
    this.occupiedAll = 0n;
    this.mailbox.fill(null);
    this.activeColor = WHITE;
    this.castlingRights = 0;
    this.epSquare = null;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.zobristHash = 0n;
    this.history = [];
    this.hashHistory = [];
    this.nullMoveHistory = [];
  }

  /**
   * Places a piece on a square.
   */
  public putPiece(color: Color, type: PieceType, sq: Square): void {
    if (this.mailbox[sq] !== null) {
      this.removePiece(sq);
    }
    const bb = squareBB(sq);
    this.pieceBB[color][type - 1] |= bb;
    this.occupied[color] |= bb;
    this.occupiedAll |= bb;
    this.mailbox[sq] = { color, type };
    this.zobristHash ^= getPieceZobrist(color, type, sq);
  }

  /**
   * Removes whatever piece is on the given square.
   */
  public removePiece(sq: Square): Piece | null {
    const p = this.mailbox[sq];
    if (!p) return null;

    const bb = squareBB(sq);
    this.pieceBB[p.color][p.type - 1] &= ~bb;
    this.occupied[p.color] &= ~bb;
    this.occupiedAll &= ~bb;
    this.mailbox[sq] = null;
    this.zobristHash ^= getPieceZobrist(p.color, p.type, sq);
    return p;
  }

  /**
   * Recalculates the full Zobrist hash from scratch.
   */
  public computeHash(): bigint {
    let hash = 0n;
    for (let sq = 0; sq < 64; sq++) {
      const p = this.mailbox[sq];
      if (p) {
        hash ^= getPieceZobrist(p.color, p.type, sq);
      }
    }
    if (this.activeColor === BLACK) {
      hash ^= ZOBRIST_BLACK_TURN;
    }
    hash ^= getCastlingZobrist(this.castlingRights);
    hash ^= getEpZobrist(this.epSquare);
    return hash;
  }

  /**
   * Checks whether a specific square is attacked by a given color.
   */
  public isSquareAttacked(sq: Square, byColor: Color): boolean {
    const opp = byColor;
    const occ = this.occupiedAll;

    // Attacked by opposing pawns
    // If we want to know if sq is attacked by 'opp', check if pawn attacks from sq hit opp pawns
    const oppPawns = this.pieceBB[opp][PAWN - 1];
    const pawnHits = PAWN_ATTACKS[opp === WHITE ? BLACK : WHITE][sq] & oppPawns;
    if (pawnHits !== 0n) return true;

    // Attacked by knights
    const oppKnights = this.pieceBB[opp][KNIGHT - 1];
    if ((KNIGHT_ATTACKS[sq] & oppKnights) !== 0n) return true;

    // Attacked by kings
    const oppKing = this.pieceBB[opp][KING - 1];
    if ((KING_ATTACKS[sq] & oppKing) !== 0n) return true;

    // Attacked by bishops or queens (diagonal)
    const oppBishopsQueens = this.pieceBB[opp][BISHOP - 1] | this.pieceBB[opp][QUEEN - 1];
    if (oppBishopsQueens !== 0n) {
      const bAttacks = getBishopAttacks(sq, occ);
      if ((bAttacks & oppBishopsQueens) !== 0n) return true;
    }

    // Attacked by rooks or queens (orthogonal)
    const oppRooksQueens = this.pieceBB[opp][ROOK - 1] | this.pieceBB[opp][QUEEN - 1];
    if (oppRooksQueens !== 0n) {
      const rAttacks = getRookAttacks(sq, occ);
      if ((rAttacks & oppRooksQueens) !== 0n) return true;
    }

    return false;
  }

  /**
   * Returns true if the active player's King is in check.
   */
  public inCheck(color: Color = this.activeColor): boolean {
    const kingBB = this.pieceBB[color][KING - 1];
    if (kingBB === 0n) return false;
    const kingSq = bitScanForward(kingBB);
    return this.isSquareAttacked(kingSq, color === WHITE ? BLACK : WHITE);
  }

  /**
   * Generates all pseudo-legal moves for the active color.
   */
  public generatePseudoLegalMoves(): Move[] {
    const moves: Move[] = [];
    const us = this.activeColor;
    const them = us === WHITE ? BLACK : WHITE;
    const friendlyOcc = this.occupied[us];
    const enemyOcc = this.occupied[them];
    const allOcc = this.occupiedAll;
    const empty = ~allOcc;

    // --- PAWNS ---
    const pawns = this.pieceBB[us][PAWN - 1];
    let pBits = pawns;
    while (pBits > 0n) {
      const from = bitScanForward(pBits);
      pBits &= pBits - 1n;

      const rank = Math.floor(from / 8);
      const isWhite = us === WHITE;

      // Single push
      const singleTarget = isWhite ? from + 8 : from - 8;
      const isPromotionRank = isWhite ? rank === 6 : rank === 1;

      if ((empty & squareBB(singleTarget)) !== 0n) {
        if (isPromotionRank) {
          moves.push({ from, to: singleTarget, piece: PAWN, promotion: QUEEN, flags: MoveFlag.Promotion });
          moves.push({ from, to: singleTarget, piece: PAWN, promotion: ROOK, flags: MoveFlag.Promotion });
          moves.push({ from, to: singleTarget, piece: PAWN, promotion: BISHOP, flags: MoveFlag.Promotion });
          moves.push({ from, to: singleTarget, piece: PAWN, promotion: KNIGHT, flags: MoveFlag.Promotion });
        } else {
          moves.push({ from, to: singleTarget, piece: PAWN, flags: MoveFlag.Quiet });

          // Double push (from starting rank)
          const isStartRank = isWhite ? rank === 1 : rank === 6;
          if (isStartRank) {
            const doubleTarget = isWhite ? from + 16 : from - 16;
            if ((empty & squareBB(doubleTarget)) !== 0n) {
              moves.push({ from, to: doubleTarget, piece: PAWN, flags: MoveFlag.DoublePawnPush });
            }
          }
        }
      }

      // Captures
      const attacks = PAWN_ATTACKS[us][from];
      let captureTargets = attacks & enemyOcc;
      while (captureTargets > 0n) {
        const to = bitScanForward(captureTargets);
        captureTargets &= captureTargets - 1n;
        const captured = this.mailbox[to]?.type;

        if (isPromotionRank) {
          moves.push({ from, to, piece: PAWN, captured, promotion: QUEEN, flags: MoveFlag.Promotion });
          moves.push({ from, to, piece: PAWN, captured, promotion: ROOK, flags: MoveFlag.Promotion });
          moves.push({ from, to, piece: PAWN, captured, promotion: BISHOP, flags: MoveFlag.Promotion });
          moves.push({ from, to, piece: PAWN, captured, promotion: KNIGHT, flags: MoveFlag.Promotion });
        } else {
          moves.push({ from, to, piece: PAWN, captured, flags: MoveFlag.Quiet });
        }
      }

      // En Passant
      if (this.epSquare !== null && (attacks & squareBB(this.epSquare)) !== 0n) {
        moves.push({ from, to: this.epSquare, piece: PAWN, captured: PAWN, flags: MoveFlag.EnPassant });
      }
    }

    // --- KNIGHTS ---
    let nBits = this.pieceBB[us][KNIGHT - 1];
    while (nBits > 0n) {
      const from = bitScanForward(nBits);
      nBits &= nBits - 1n;
      const targets = KNIGHT_ATTACKS[from] & ~friendlyOcc;
      let tBits = targets;
      while (tBits > 0n) {
        const to = bitScanForward(tBits);
        tBits &= tBits - 1n;
        const captured = this.mailbox[to]?.type;
        moves.push({ from, to, piece: KNIGHT, captured, flags: MoveFlag.Quiet });
      }
    }

    // --- BISHOPS ---
    let bBits = this.pieceBB[us][BISHOP - 1];
    while (bBits > 0n) {
      const from = bitScanForward(bBits);
      bBits &= bBits - 1n;
      const targets = getBishopAttacks(from, allOcc) & ~friendlyOcc;
      let tBits = targets;
      while (tBits > 0n) {
        const to = bitScanForward(tBits);
        tBits &= tBits - 1n;
        const captured = this.mailbox[to]?.type;
        moves.push({ from, to, piece: BISHOP, captured, flags: MoveFlag.Quiet });
      }
    }

    // --- ROOKS ---
    let rBits = this.pieceBB[us][ROOK - 1];
    while (rBits > 0n) {
      const from = bitScanForward(rBits);
      rBits &= rBits - 1n;
      const targets = getRookAttacks(from, allOcc) & ~friendlyOcc;
      let tBits = targets;
      while (tBits > 0n) {
        const to = bitScanForward(tBits);
        tBits &= tBits - 1n;
        const captured = this.mailbox[to]?.type;
        moves.push({ from, to, piece: ROOK, captured, flags: MoveFlag.Quiet });
      }
    }

    // --- QUEENS ---
    let qBits = this.pieceBB[us][QUEEN - 1];
    while (qBits > 0n) {
      const from = bitScanForward(qBits);
      qBits &= qBits - 1n;
      const targets = getQueenAttacks(from, allOcc) & ~friendlyOcc;
      let tBits = targets;
      while (tBits > 0n) {
        const to = bitScanForward(tBits);
        tBits &= tBits - 1n;
        const captured = this.mailbox[to]?.type;
        moves.push({ from, to, piece: QUEEN, captured, flags: MoveFlag.Quiet });
      }
    }

    // --- KING ---
    const kingBB = this.pieceBB[us][KING - 1];
    if (kingBB > 0n) {
      const from = bitScanForward(kingBB);
      let kTargets = KING_ATTACKS[from] & ~friendlyOcc;
      while (kTargets > 0n) {
        const to = bitScanForward(kTargets);
        kTargets &= kTargets - 1n;
        const captured = this.mailbox[to]?.type;
        moves.push({ from, to, piece: KING, captured, flags: MoveFlag.Quiet });
      }

      // Castling
      if (us === WHITE) {
        // White Kingside: e1 (4) -> g1 (6)
        if ((this.castlingRights & CASTLE_WK) !== 0) {
          const f1 = SQUARES.f1;
          const g1 = SQUARES.g1;
          if (this.mailbox[f1] === null && this.mailbox[g1] === null) {
            if (
              !this.isSquareAttacked(SQUARES.e1, BLACK) &&
              !this.isSquareAttacked(f1, BLACK) &&
              !this.isSquareAttacked(g1, BLACK)
            ) {
              moves.push({ from, to: g1, piece: KING, flags: MoveFlag.CastleKingside });
            }
          }
        }
        // White Queenside: e1 (4) -> c1 (2)
        if ((this.castlingRights & CASTLE_WQ) !== 0) {
          const d1 = SQUARES.d1;
          const c1 = SQUARES.c1;
          const b1 = SQUARES.b1;
          if (this.mailbox[d1] === null && this.mailbox[c1] === null && this.mailbox[b1] === null) {
            if (
              !this.isSquareAttacked(SQUARES.e1, BLACK) &&
              !this.isSquareAttacked(d1, BLACK) &&
              !this.isSquareAttacked(c1, BLACK)
            ) {
              moves.push({ from, to: c1, piece: KING, flags: MoveFlag.CastleQueenside });
            }
          }
        }
      } else {
        // Black Kingside: e8 (60) -> g8 (62)
        if ((this.castlingRights & CASTLE_BK) !== 0) {
          const f8 = SQUARES.f8;
          const g8 = SQUARES.g8;
          if (this.mailbox[f8] === null && this.mailbox[g8] === null) {
            if (
              !this.isSquareAttacked(SQUARES.e8, WHITE) &&
              !this.isSquareAttacked(f8, WHITE) &&
              !this.isSquareAttacked(g8, WHITE)
            ) {
              moves.push({ from, to: g8, piece: KING, flags: MoveFlag.CastleKingside });
            }
          }
        }
        // Black Queenside: e8 (60) -> c8 (58)
        if ((this.castlingRights & CASTLE_BQ) !== 0) {
          const d8 = SQUARES.d8;
          const c8 = SQUARES.c8;
          const b8 = SQUARES.b8;
          if (this.mailbox[d8] === null && this.mailbox[c8] === null && this.mailbox[b8] === null) {
            if (
              !this.isSquareAttacked(SQUARES.e8, WHITE) &&
              !this.isSquareAttacked(d8, WHITE) &&
              !this.isSquareAttacked(c8, WHITE)
            ) {
              moves.push({ from, to: c8, piece: KING, flags: MoveFlag.CastleQueenside });
            }
          }
        }
      }
    }

    return moves;
  }

  /**
   * Generates all strictly legal moves for the active side.
   */
  public generateLegalMoves(): Move[] {
    const pseudo = this.generatePseudoLegalMoves();
    const legal: Move[] = [];
    const us = this.activeColor;

    for (const m of pseudo) {
      this.makeMove(m);
      if (!this.inCheck(us)) {
        legal.push(m);
      }
      this.unmakeMove();
    }

    return legal;
  }

  /**
   * Makes a move on the board and updates all state, bitboards, and Zobrist hash.
   */
  public makeMove(move: Move): void {
    const us = this.activeColor;
    const them = us === WHITE ? BLACK : WHITE;

    // Save record for unmake
    const record: StateRecord = {
      move,
      castlingRights: this.castlingRights,
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      zobristHash: this.zobristHash,
      capturedPiece: move.captured ?? null,
    };
    this.history.push(record);

    // Remove old ep square from hash
    if (this.epSquare !== null) {
      this.zobristHash ^= getEpZobrist(this.epSquare);
      this.epSquare = null;
    }

    // Move piece on mailbox and bitboards
    const movingPieceType = move.piece;
    const fromBB = squareBB(move.from);
    const toBB = squareBB(move.to);

    // Remove piece from source
    this.pieceBB[us][movingPieceType - 1] &= ~fromBB;
    this.occupied[us] &= ~fromBB;
    this.occupiedAll &= ~fromBB;
    this.mailbox[move.from] = null;
    this.zobristHash ^= getPieceZobrist(us, movingPieceType, move.from);

    // Handle captures
    if (move.flags === MoveFlag.EnPassant) {
      const capSq = us === WHITE ? move.to - 8 : move.to + 8;
      const capBB = squareBB(capSq);
      this.pieceBB[them][PAWN - 1] &= ~capBB;
      this.occupied[them] &= ~capBB;
      this.occupiedAll &= ~capBB;
      this.mailbox[capSq] = null;
      this.zobristHash ^= getPieceZobrist(them, PAWN, capSq);
    } else if (move.captured !== undefined) {
      // Normal capture on destination square
      this.pieceBB[them][move.captured - 1] &= ~toBB;
      this.occupied[them] &= ~toBB;
      this.occupiedAll &= ~toBB;
      this.mailbox[move.to] = null;
      this.zobristHash ^= getPieceZobrist(them, move.captured, move.to);
    }

    // Place piece on destination
    const finalPieceType = move.promotion !== undefined ? move.promotion : movingPieceType;
    this.pieceBB[us][finalPieceType - 1] |= toBB;
    this.occupied[us] |= toBB;
    this.occupiedAll |= toBB;
    this.mailbox[move.to] = { color: us, type: finalPieceType };
    this.zobristHash ^= getPieceZobrist(us, finalPieceType, move.to);

    // Handle castling rook moves
    if (move.flags === MoveFlag.CastleKingside) {
      if (us === WHITE) {
        // Move rook h1 (7) -> f1 (5)
        this.moveRookInternal(WHITE, SQUARES.h1, SQUARES.f1);
      } else {
        // Move rook h8 (63) -> f8 (61)
        this.moveRookInternal(BLACK, SQUARES.h8, SQUARES.f8);
      }
    } else if (move.flags === MoveFlag.CastleQueenside) {
      if (us === WHITE) {
        // Move rook a1 (0) -> d1 (3)
        this.moveRookInternal(WHITE, SQUARES.a1, SQUARES.d1);
      } else {
        // Move rook a8 (56) -> d8 (59)
        this.moveRookInternal(BLACK, SQUARES.a8, SQUARES.d8);
      }
    }

    // Update castling rights
    const oldCastle = this.castlingRights;
    if (movingPieceType === KING) {
      if (us === WHITE) {
        this.castlingRights &= ~(CASTLE_WK | CASTLE_WQ);
      } else {
        this.castlingRights &= ~(CASTLE_BK | CASTLE_BQ);
      }
    } else if (movingPieceType === ROOK) {
      if (move.from === SQUARES.a1) this.castlingRights &= ~CASTLE_WQ;
      else if (move.from === SQUARES.h1) this.castlingRights &= ~CASTLE_WK;
      else if (move.from === SQUARES.a8) this.castlingRights &= ~CASTLE_BQ;
      else if (move.from === SQUARES.h8) this.castlingRights &= ~CASTLE_BK;
    }

    // If a corner rook was captured, revoke opposing castling right
    if (move.to === SQUARES.a1) this.castlingRights &= ~CASTLE_WQ;
    else if (move.to === SQUARES.h1) this.castlingRights &= ~CASTLE_WK;
    else if (move.to === SQUARES.a8) this.castlingRights &= ~CASTLE_BQ;
    else if (move.to === SQUARES.h8) this.castlingRights &= ~CASTLE_BK;

    if (oldCastle !== this.castlingRights) {
      this.zobristHash ^= getCastlingZobrist(oldCastle);
      this.zobristHash ^= getCastlingZobrist(this.castlingRights);
    }

    // Set En Passant target square on double pawn push
    if (move.flags === MoveFlag.DoublePawnPush) {
      this.epSquare = us === WHITE ? move.from + 8 : move.from - 8;
      this.zobristHash ^= getEpZobrist(this.epSquare);
    }

    // Update halfmove clock (50-move rule)
    if (movingPieceType === PAWN || move.captured !== undefined) {
      this.halfmoveClock = 0;
    } else {
      this.halfmoveClock++;
    }

    // Update fullmove number
    if (us === BLACK) {
      this.fullmoveNumber++;
    }

    // Switch turn
    this.activeColor = them;
    this.zobristHash ^= ZOBRIST_BLACK_TURN;
    this.hashHistory.push(this.zobristHash);
  }

  /**
   * Internal helper to move a rook during castling.
   */
  private moveRookInternal(color: Color, from: Square, to: Square): void {
    const fromBB = squareBB(from);
    const toBB = squareBB(to);
    this.pieceBB[color][ROOK - 1] &= ~fromBB;
    this.pieceBB[color][ROOK - 1] |= toBB;
    this.occupied[color] &= ~fromBB;
    this.occupied[color] |= toBB;
    this.occupiedAll &= ~fromBB;
    this.occupiedAll |= toBB;
    this.mailbox[from] = null;
    this.mailbox[to] = { color, type: ROOK };
    this.zobristHash ^= getPieceZobrist(color, ROOK, from);
    this.zobristHash ^= getPieceZobrist(color, ROOK, to);
  }

  /**
   * Reverts the most recent move.
   */
  public unmakeMove(): void {
    const record = this.history.pop();
    if (!record) return;

    this.hashHistory.pop();

    const move = record.move;
    const them = this.activeColor; // activeColor was switched after move, so 'them' is the player who made the move
    const us = them === WHITE ? BLACK : WHITE; // the one whose turn it was when move was made

    // Restore simple scalars
    this.castlingRights = record.castlingRights;
    this.epSquare = record.epSquare;
    this.halfmoveClock = record.halfmoveClock;
    this.zobristHash = record.zobristHash;
    if (us === BLACK) {
      this.fullmoveNumber--;
    }
    this.activeColor = us;

    const fromBB = squareBB(move.from);
    const toBB = squareBB(move.to);

    // Remove moved piece from destination
    const placedType = move.promotion !== undefined ? move.promotion : move.piece;
    this.pieceBB[us][placedType - 1] &= ~toBB;
    this.occupied[us] &= ~toBB;
    this.occupiedAll &= ~toBB;
    this.mailbox[move.to] = null;

    // Restore original moving piece to source
    this.pieceBB[us][move.piece - 1] |= fromBB;
    this.occupied[us] |= fromBB;
    this.occupiedAll |= fromBB;
    this.mailbox[move.from] = { color: us, type: move.piece };

    // Restore captured piece if any
    if (move.flags === MoveFlag.EnPassant) {
      const capSq = us === WHITE ? move.to - 8 : move.to + 8;
      const capBB = squareBB(capSq);
      this.pieceBB[them][PAWN - 1] |= capBB;
      this.occupied[them] |= capBB;
      this.occupiedAll |= capBB;
      this.mailbox[capSq] = { color: them, type: PAWN };
    } else if (record.capturedPiece !== null) {
      this.pieceBB[them][record.capturedPiece - 1] |= toBB;
      this.occupied[them] |= toBB;
      this.occupiedAll |= toBB;
      this.mailbox[move.to] = { color: them, type: record.capturedPiece };
    }

    // Undo castling rook moves
    if (move.flags === MoveFlag.CastleKingside) {
      if (us === WHITE) {
        this.moveRookInternal(WHITE, SQUARES.f1, SQUARES.h1);
      } else {
        this.moveRookInternal(BLACK, SQUARES.f8, SQUARES.h8);
      }
    } else if (move.flags === MoveFlag.CastleQueenside) {
      if (us === WHITE) {
        this.moveRookInternal(WHITE, SQUARES.d1, SQUARES.a1);
      } else {
        this.moveRookInternal(BLACK, SQUARES.d8, SQUARES.a8);
      }
    }
  }

  /**
   * Executes a null move (passes turn to opponent) for Null Move Pruning.
   */
  public makeNullMove(): void {
    this.nullMoveHistory.push({
      epSquare: this.epSquare,
      halfmoveClock: this.halfmoveClock,
      zobristHash: this.zobristHash,
    });

    if (this.epSquare !== null) {
      this.zobristHash ^= getEpZobrist(this.epSquare);
      this.epSquare = null;
    }

    this.activeColor = this.activeColor === WHITE ? BLACK : WHITE;
    this.zobristHash ^= ZOBRIST_BLACK_TURN;
    this.halfmoveClock++;
    this.hashHistory.push(this.zobristHash);
  }

  /**
   * Reverts a null move.
   */
  public unmakeNullMove(): void {
    const record = this.nullMoveHistory.pop();
    if (!record) return;

    this.hashHistory.pop();
    this.epSquare = record.epSquare;
    this.halfmoveClock = record.halfmoveClock;
    this.zobristHash = record.zobristHash;
    this.activeColor = this.activeColor === WHITE ? BLACK : WHITE;
  }

  /**
   * Checks if a player has any non-pawn material (Knights, Bishops, Rooks, Queens).
   * Essential for Null Move Pruning to prevent zugzwang mis-evaluations in pawn endgames.
   */
  public hasNonPawnMaterial(color: Color): boolean {
    return (
      (this.pieceBB[color][KNIGHT - 1] |
        this.pieceBB[color][BISHOP - 1] |
        this.pieceBB[color][ROOK - 1] |
        this.pieceBB[color][QUEEN - 1]) !== 0n
    );
  }

  /**
   * Detects current game status (in progress, checkmate, stalemate, draws).
   */
  public getStatus(): GameStatus {
    const legalMoves = this.generateLegalMoves();

    if (legalMoves.length === 0) {
      if (this.inCheck()) {
        return 'checkmate';
      }
      return 'stalemate';
    }

    // 50-move rule
    if (this.halfmoveClock >= 100) {
      return 'draw_50move';
    }

    // Threefold repetition
    const currentHash = this.zobristHash;
    let occurrences = 0;
    for (const h of this.hashHistory) {
      if (h === currentHash) occurrences++;
    }
    if (occurrences >= 3) {
      return 'draw_threefold';
    }

    // Insufficient material
    if (this.isInsufficientMaterial()) {
      return 'draw_insufficient_material';
    }

    return 'in_progress';
  }

  /**
   * Checks for insufficient mating material according to FIDE rules.
   */
  public isInsufficientMaterial(): boolean {
    const pawns = this.pieceBB[WHITE][PAWN - 1] | this.pieceBB[BLACK][PAWN - 1];
    const rooks = this.pieceBB[WHITE][ROOK - 1] | this.pieceBB[BLACK][ROOK - 1];
    const queens = this.pieceBB[WHITE][QUEEN - 1] | this.pieceBB[BLACK][QUEEN - 1];

    if (pawns !== 0n || rooks !== 0n || queens !== 0n) {
      return false;
    }

    const wKnights = popcount(this.pieceBB[WHITE][KNIGHT - 1]);
    const bKnights = popcount(this.pieceBB[BLACK][KNIGHT - 1]);
    const wBishops = popcount(this.pieceBB[WHITE][BISHOP - 1]);
    const bBishops = popcount(this.pieceBB[BLACK][BISHOP - 1]);

    const totalMinors = wKnights + bKnights + wBishops + bBishops;

    // King vs King
    if (totalMinors === 0) return true;

    // King + minor vs King
    if (totalMinors === 1) return true;

    // King + Bishop vs King + Bishop of same square color
    if (totalMinors === 2 && wBishops === 1 && bBishops === 1 && wKnights === 0 && bKnights === 0) {
      const wBishopSq = bitScanForward(this.pieceBB[WHITE][BISHOP - 1]);
      const bBishopSq = bitScanForward(this.pieceBB[BLACK][BISHOP - 1]);
      const wColor = (Math.floor(wBishopSq / 8) + (wBishopSq % 8)) % 2;
      const bColor = (Math.floor(bBishopSq / 8) + (bBishopSq % 8)) % 2;
      return wColor === bColor;
    }

    return false;
  }

  /**
   * Formats a move into Standard Algebraic Notation (SAN), e.g. "Nf3", "exd5", "O-O", "Qh4#".
   */
  public moveToSAN(move: Move): string {
    if (move.flags === MoveFlag.CastleKingside) return 'O-O';
    if (move.flags === MoveFlag.CastleQueenside) return 'O-O-O';

    const p = move.piece;
    let san = '';

    if (p === PAWN) {
      if (move.captured !== undefined || move.flags === MoveFlag.EnPassant) {
        const fromFile = String.fromCharCode('a'.charCodeAt(0) + (move.from % 8));
        san += `${fromFile}x`;
      }
    } else {
      const pieceSymbols = ['', '', 'N', 'B', 'R', 'Q', 'K'];
      san += pieceSymbols[p];

      // Disambiguation if another piece of same type can also legally move to destination
      const candidates = this.generateLegalMoves().filter(
        (m) => m.piece === p && m.to === move.to && m.from !== move.from
      );

      if (candidates.length > 0) {
        const sameFile = candidates.some((m) => m.from % 8 === move.from % 8);
        const sameRank = candidates.some((m) => Math.floor(m.from / 8) === Math.floor(move.from / 8));

        if (!sameFile) {
          san += String.fromCharCode('a'.charCodeAt(0) + (move.from % 8));
        } else if (!sameRank) {
          san += String(Math.floor(move.from / 8) + 1);
        } else {
          san += String.fromCharCode('a'.charCodeAt(0) + (move.from % 8));
          san += String(Math.floor(move.from / 8) + 1);
        }
      }

      if (move.captured !== undefined) {
        san += 'x';
      }
    }

    // Destination square
    const toFile = String.fromCharCode('a'.charCodeAt(0) + (move.to % 8));
    const toRank = Math.floor(move.to / 8) + 1;
    san += `${toFile}${toRank}`;

    // Promotion
    if (move.promotion !== undefined) {
      const promoSymbols = ['', '', 'N', 'B', 'R', 'Q'];
      san += `=${promoSymbols[move.promotion]}`;
    }

    // Check / Checkmate indicator
    this.makeMove(move);
    const oppInCheck = this.inCheck();
    const legalMovesLeft = this.generateLegalMoves().length;
    this.unmakeMove();

    if (oppInCheck) {
      if (legalMovesLeft === 0) {
        san += '#';
      } else {
        san += '+';
      }
    }

    return san;
  }

  /**
   * Parses and loads a standard FEN string.
   */
  public loadFEN(fen: string): void {
    this.clear();
    const tokens = fen.trim().split(/\s+/);
    if (tokens.length < 4) throw new Error(`Invalid FEN: ${fen}`);

    const [placement, active, castling, ep, halfmove, fullmove] = tokens;

    // Piece placement
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new Error(`Invalid FEN placement: ${placement}`);

    for (let r = 7; r >= 0; r--) {
      const rankStr = ranks[7 - r];
      let f = 0;
      for (const char of rankStr) {
        if (char >= '1' && char <= '8') {
          f += parseInt(char, 10);
        } else {
          const sq = r * 8 + f;
          const isUpper = char === char.toUpperCase();
          const color = isUpper ? WHITE : BLACK;
          const lower = char.toLowerCase();
          let type: PieceType;
          switch (lower) {
            case 'p': type = PAWN; break;
            case 'n': type = KNIGHT; break;
            case 'b': type = BISHOP; break;
            case 'r': type = ROOK; break;
            case 'q': type = QUEEN; break;
            case 'k': type = KING; break;
            default: throw new Error(`Unknown piece symbol: ${char}`);
          }
          this.putPiece(color, type, sq);
          f++;
        }
      }
    }

    // Active color
    this.activeColor = active.toLowerCase() === 'b' ? BLACK : WHITE;

    // Castling rights
    this.castlingRights = 0;
    if (castling !== '-') {
      if (castling.includes('K')) this.castlingRights |= CASTLE_WK;
      if (castling.includes('Q')) this.castlingRights |= CASTLE_WQ;
      if (castling.includes('k')) this.castlingRights |= CASTLE_BK;
      if (castling.includes('q')) this.castlingRights |= CASTLE_BQ;
    }

    // En passant square
    if (ep !== '-') {
      const f = ep.charCodeAt(0) - 'a'.charCodeAt(0);
      const r = parseInt(ep[1], 10) - 1;
      this.epSquare = r * 8 + f;
    } else {
      this.epSquare = null;
    }

    // Clocks
    this.halfmoveClock = halfmove ? parseInt(halfmove, 10) : 0;
    this.fullmoveNumber = fullmove ? parseInt(fullmove, 10) : 1;

    this.zobristHash = this.computeHash();
    this.hashHistory = [this.zobristHash];
  }

  /**
   * Generates a standard FEN string from current state.
   */
  public toFEN(): string {
    let fen = '';

    // Piece placement
    for (let r = 7; r >= 0; r--) {
      let emptyCount = 0;
      for (let f = 0; f < 8; f++) {
        const sq = r * 8 + f;
        const p = this.mailbox[sq];
        if (!p) {
          emptyCount++;
        } else {
          if (emptyCount > 0) {
            fen += emptyCount;
            emptyCount = 0;
          }
          const symbols = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
          const sym = symbols[p.type];
          fen += p.color === WHITE ? sym.toUpperCase() : sym;
        }
      }
      if (emptyCount > 0) {
        fen += emptyCount;
      }
      if (r > 0) fen += '/';
    }

    // Active color
    fen += ` ${this.activeColor === WHITE ? 'w' : 'b'} `;

    // Castling
    let cStr = '';
    if (this.castlingRights & CASTLE_WK) cStr += 'K';
    if (this.castlingRights & CASTLE_WQ) cStr += 'Q';
    if (this.castlingRights & CASTLE_BK) cStr += 'k';
    if (this.castlingRights & CASTLE_BQ) cStr += 'q';
    fen += cStr.length > 0 ? cStr : '-';

    // En passant
    if (this.epSquare !== null) {
      const f = String.fromCharCode('a'.charCodeAt(0) + (this.epSquare % 8));
      const r = Math.floor(this.epSquare / 8) + 1;
      fen += ` ${f}${r} `;
    } else {
      fen += ' - ';
    }

    // Clocks
    fen += `${this.halfmoveClock} ${this.fullmoveNumber}`;

    return fen;
  }
}
