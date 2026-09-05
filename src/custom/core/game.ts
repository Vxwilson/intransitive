/**
 * Intransitive (9x9 RPS Board Game) - Core Engine & Move Generator
 * Fast, allocation-conscious engine with Zobrist hashing, undo stack,
 * FEN support, and perft validation.
 */

import {
  NUM_SQUARES,
  ADJACENCY_TABLE,
  BLUE_GOAL_SQUARE,
  RED_GOAL_SQUARE,
  canCapture,
  squareToAlgebraic,
} from './constants';
import {
  PLAYER_BLUE,
  PLAYER_RED,
  EMPTY,
  decodePiece,
} from './types';
import type {
  Player,
  Move,
  GameStatus,
  UndoRecord,
} from './types';
import {
  computeZobristHash,
  ZOBRIST_PIECES,
  ZOBRIST_SIDE_TO_MOVE,
} from './zobrist';
import {
  boardToFEN,
  fenToBoard,
  INITIAL_INTRANSITIVE_FEN,
} from './fen';

export interface PieceCounts {
  R: number;
  P: number;
  S: number;
  total: number;
}

export class IntransitiveGame {
  public board: Uint8Array;
  public activePlayer: Player;
  public halfmoveClock: number;
  public fullmoveNumber: number;
  public zobristKey: bigint;

  private undoStack: UndoRecord[] = [];
  public repetitionMap: Map<bigint, number> = new Map();

  /**
   * Returns how many times a given Zobrist key (defaulting to current position) has occurred.
   */
  public getRepetitionCount(key: bigint = this.zobristKey): number {
    return this.repetitionMap.get(key) || 0;
  }

  // Instantaneous material tracking
  public blueCounts: PieceCounts = { R: 0, P: 0, S: 0, total: 0 };
  public redCounts: PieceCounts = { R: 0, P: 0, S: 0, total: 0 };

  constructor(fen: string = INITIAL_INTRANSITIVE_FEN) {
    this.board = new Uint8Array(NUM_SQUARES);
    this.activePlayer = PLAYER_BLUE;
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.zobristKey = 0n;
    this.loadFEN(fen);
  }

  /**
   * Reset game to initial starting position.
   */
  public reset(): void {
    this.loadFEN(INITIAL_INTRANSITIVE_FEN);
  }

  /**
   * Load position from FEN.
   */
  public loadFEN(fen: string): void {
    const parsed = fenToBoard(fen);
    this.board = parsed.board;
    this.activePlayer = parsed.activePlayer;
    this.halfmoveClock = parsed.halfmoveClock;
    this.fullmoveNumber = parsed.fullmoveNumber;

    this.undoStack = [];
    this.repetitionMap.clear();

    this.recomputeMaterialCounts();
    this.zobristKey = computeZobristHash(this.board, this.activePlayer);
    this.repetitionMap.set(this.zobristKey, 1);
  }

  /**
   * Serialize current position to FEN.
   */
  public toFEN(): string {
    return boardToFEN(this.board, this.activePlayer, this.halfmoveClock, this.fullmoveNumber);
  }

  private recomputeMaterialCounts(): void {
    this.blueCounts = { R: 0, P: 0, S: 0, total: 0 };
    this.redCounts = { R: 0, P: 0, S: 0, total: 0 };

    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      const code = this.board[sq];
      if (code === EMPTY) continue;
      const decoded = decodePiece(code);
      if (!decoded) continue;

      const counts = decoded.player === PLAYER_BLUE ? this.blueCounts : this.redCounts;
      counts[decoded.pieceType]++;
      counts.total++;
    }
  }

  /**
   * Generates all legal moves for the current active player.
   * In Intransitive, moves are omnidirectional 1-step King moves.
   * Target square must be either:
   *   1. Empty
   *   2. Occupied by an enemy piece that attacker counters (R>S, S>P, P>R)
   */
  public generateLegalMoves(player: Player = this.activePlayer): Move[] {
    const moves: Move[] = [];

    // If game is already terminal, no further moves are legal
    const status = this.isTerminal();
    if (status.isOver) {
      return moves;
    }

    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      const code = this.board[sq];
      if (code === EMPTY) continue;

      const piece = decodePiece(code);
      if (!piece || piece.player !== player) continue;

      const ownDefendingGoal = player === PLAYER_BLUE ? RED_GOAL_SQUARE : BLUE_GOAL_SQUARE;
      const neighbors = ADJACENCY_TABLE[sq];
      for (let i = 0; i < neighbors.length; i++) {
        const toSq = neighbors[i];
        if (toSq === ownDefendingGoal) continue; // Goal-squatting prevention
        const targetCode = this.board[toSq];

        if (targetCode === EMPTY) {
          moves.push({
            from: sq,
            to: toSq,
            piece: piece.pieceType,
          });
        } else {
          const targetPiece = decodePiece(targetCode);
          if (targetPiece && targetPiece.player !== player) {
            // Check if attacker counters defender
            if (canCapture(piece.pieceType, targetPiece.pieceType)) {
              moves.push({
                from: sq,
                to: toSq,
                piece: piece.pieceType,
                captured: targetPiece.pieceType,
              });
            }
          }
        }
      }
    }

    return moves;
  }

  /**
   * Makes a move on the board and updates all game state and Zobrist hash.
   */
  public makeMove(move: Move): boolean {
    const fromCode = this.board[move.from];
    if (fromCode === EMPTY) return false;

    const movingPiece = decodePiece(fromCode);
    if (!movingPiece || movingPiece.player !== this.activePlayer) return false;

    const toCode = this.board[move.to];
    const prevKey = this.zobristKey;
    const prevHalfmove = this.halfmoveClock;

    // Save record for unmake
    this.undoStack.push({
      move,
      capturedCode: toCode,
      halfmoveClock: prevHalfmove,
      zobristKey: prevKey,
    });

    // Update Zobrist hash incrementally
    let newKey = prevKey;
    newKey ^= ZOBRIST_PIECES[fromCode][move.from]; // Remove from source
    if (toCode !== EMPTY) {
      newKey ^= ZOBRIST_PIECES[toCode][move.to]; // Remove captured piece
      const capturedDecoded = decodePiece(toCode);
      if (capturedDecoded) {
        const counts = capturedDecoded.player === PLAYER_BLUE ? this.blueCounts : this.redCounts;
        counts[capturedDecoded.pieceType]--;
        counts.total--;
      }
    }
    newKey ^= ZOBRIST_PIECES[fromCode][move.to]; // Add to destination
    newKey ^= ZOBRIST_SIDE_TO_MOVE; // Toggle turn hash

    // Update board
    this.board[move.from] = EMPTY;
    this.board[move.to] = fromCode;

    // Update clocks
    if (toCode !== EMPTY) {
      this.halfmoveClock = 0; // Reset on capture
    } else {
      this.halfmoveClock++;
    }

    if (this.activePlayer === PLAYER_RED) {
      this.fullmoveNumber++;
    }

    // Toggle active player
    this.activePlayer = this.activePlayer === PLAYER_BLUE ? PLAYER_RED : PLAYER_BLUE;
    this.zobristKey = newKey;

    // Update repetition counter
    const currentCount = (this.repetitionMap.get(this.zobristKey) || 0) + 1;
    this.repetitionMap.set(this.zobristKey, currentCount);

    return true;
  }

  /**
   * Unmakes the last move.
   */
  public unmakeMove(): boolean {
    const record = this.undoStack.pop();
    if (!record) return false;

    // Decrement repetition map
    const count = this.repetitionMap.get(this.zobristKey);
    if (count && count > 1) {
      this.repetitionMap.set(this.zobristKey, count - 1);
    } else {
      this.repetitionMap.delete(this.zobristKey);
    }

    const { move, capturedCode, halfmoveClock, zobristKey } = record;
    const movingPieceCode = this.board[move.to];

    // Restore board
    this.board[move.from] = movingPieceCode;
    this.board[move.to] = capturedCode;

    // Restore material counts if a capture was rolled back
    if (capturedCode !== EMPTY) {
      const capturedDecoded = decodePiece(capturedCode);
      if (capturedDecoded) {
        const counts = capturedDecoded.player === PLAYER_BLUE ? this.blueCounts : this.redCounts;
        counts[capturedDecoded.pieceType]++;
        counts.total++;
      }
    }

    // Toggle active player back
    this.activePlayer = this.activePlayer === PLAYER_BLUE ? PLAYER_RED : PLAYER_BLUE;
    if (this.activePlayer === PLAYER_RED) {
      this.fullmoveNumber--;
    }

    this.halfmoveClock = halfmoveClock;
    this.zobristKey = zobristKey;

    return true;
  }

  /**
   * Checks if the game has ended and returns the status.
   * Win conditions:
   * 1. Touchdown:
   *    - Blue piece occupies I9 (square 80) -> Blue wins.
   *    - Red piece occupies A1 (square 0) -> Red wins.
   * 2. Elimination:
   *    - Blue has 0 pieces -> Red wins.
   *    - Red has 0 pieces -> Blue wins.
   * 3. Immobilization:
   *    - Active player has 0 legal moves -> Opponent wins.
   * 4. Draw conditions:
   *    - Threefold repetition.
   *    - 50-move rule (100 halfmoves without capture).
   */
  public isTerminal(): GameStatus {
    // 1. Touchdown check
    const blueGoalCode = this.board[BLUE_GOAL_SQUARE];
    if (blueGoalCode !== EMPTY) {
      const decoded = decodePiece(blueGoalCode);
      if (decoded && decoded.player === PLAYER_BLUE) {
        return { isOver: true, winner: PLAYER_BLUE, reason: 'touchdown' };
      }
    }

    const redGoalCode = this.board[RED_GOAL_SQUARE];
    if (redGoalCode !== EMPTY) {
      const decoded = decodePiece(redGoalCode);
      if (decoded && decoded.player === PLAYER_RED) {
        return { isOver: true, winner: PLAYER_RED, reason: 'touchdown' };
      }
    }

    // 2. Elimination check
    if (this.blueCounts.total === 0) {
      return { isOver: true, winner: PLAYER_RED, reason: 'elimination' };
    }
    if (this.redCounts.total === 0) {
      return { isOver: true, winner: PLAYER_BLUE, reason: 'elimination' };
    }

    // 3. Threefold repetition
    if ((this.repetitionMap.get(this.zobristKey) || 0) >= 3) {
      return { isOver: true, winner: 'draw', reason: 'repetition' };
    }

    // 4. 50-move rule (100 halfmoves without capture)
    if (this.halfmoveClock >= 100) {
      return { isOver: true, winner: 'draw', reason: '50-move' };
    }

    // 5. Immobilization check (no legal moves available for active player)
    let hasLegalMove = false;
    for (let sq = 0; sq < NUM_SQUARES; sq++) {
      const code = this.board[sq];
      if (code === EMPTY) continue;

      const piece = decodePiece(code);
      if (!piece || piece.player !== this.activePlayer) continue;

      const ownDefendingGoal = this.activePlayer === PLAYER_BLUE ? RED_GOAL_SQUARE : BLUE_GOAL_SQUARE;
      const neighbors = ADJACENCY_TABLE[sq];
      for (let i = 0; i < neighbors.length; i++) {
        const toSq = neighbors[i];
        if (toSq === ownDefendingGoal) continue;
        const targetCode = this.board[toSq];

        if (targetCode === EMPTY) {
          hasLegalMove = true;
          break;
        }
        const targetPiece = decodePiece(targetCode);
        if (targetPiece && targetPiece.player !== this.activePlayer) {
          if (canCapture(piece.pieceType, targetPiece.pieceType)) {
            hasLegalMove = true;
            break;
          }
        }
      }
      if (hasLegalMove) break;
    }

    if (!hasLegalMove) {
      // Player with no legal moves loses
      const winner = this.activePlayer === PLAYER_BLUE ? PLAYER_RED : PLAYER_BLUE;
      return { isOver: true, winner, reason: 'immobilization' };
    }

    return { isOver: false, winner: null, reason: null };
  }

  /**
   * Formats a move in Standard Algebraic Notation (SAN-style).
   * Format:
   *   Non-capture: [Piece][From]-[To] (e.g. "Rb4-c4")
   *   Capture: [Piece][From]x[CapturedPiece][To] (e.g. "Sc5xPd4")
   *   Touchdown win: Appends "#"
   */
  public formatMoveSAN(move: Move): string {
    const fromStr = squareToAlgebraic(move.from);
    const toStr = squareToAlgebraic(move.to);
    const isGoal =
      (this.activePlayer === PLAYER_BLUE && move.to === BLUE_GOAL_SQUARE) ||
      (this.activePlayer === PLAYER_RED && move.to === RED_GOAL_SQUARE);

    let san: string;
    if (move.captured) {
      san = `${move.piece}${fromStr}x${move.captured}${toStr}`;
    } else {
      san = `${move.piece}${fromStr}-${toStr}`;
    }

    if (isGoal) {
      san += '#';
    }
    return san;
  }

  /**
   * Combinatorial Perft move path enumerator.
   * Useful for validating move generator correctness and speed.
   */
  public perft(depth: number): number {
    if (depth === 0) return 1;

    const status = this.isTerminal();
    if (status.isOver) return 0;

    const moves = this.generateLegalMoves();
    if (depth === 1) return moves.length;

    let nodes = 0;
    for (let i = 0; i < moves.length; i++) {
      this.makeMove(moves[i]);
      nodes += this.perft(depth - 1);
      this.unmakeMove();
    }
    return nodes;
  }

  /**
   * Clone current game state into an independent instance.
   */
  public clone(): IntransitiveGame {
    const copy = new IntransitiveGame(this.toFEN());
    copy.undoStack = [...this.undoStack];
    copy.repetitionMap = new Map(this.repetitionMap);
    return copy;
  }
}
