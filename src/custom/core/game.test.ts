/**
 * Intransitive (9x9 RPS Board Game) - Comprehensive Engine Verification Suite
 */

import { IntransitiveGame } from './game';
import {
  BOARD_SIZE,
  NUM_SQUARES,
  ADJACENCY_TABLE,
  BLUE_GOAL_SQUARE,
  algebraicToSquare,
  squareToAlgebraic,
  canCapture,
} from './constants';
import {
  PLAYER_BLUE,
  ROCK,
  PAPER,
  SCISSORS,
  BLUE_ROCK,
  BLUE_PAPER,
  BLUE_SCISSORS,
  RED_ROCK,
  RED_PAPER,
  RED_SCISSORS,
} from './types';
import type { Move } from './types';
import { fenToBoard, boardToFEN } from './fen';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('🧪 Starting Intransitive (9x9 RPS) Core Engine Verification Suite...\n');

// 1. Board Geometry and Coordinates
console.log('--- 1. Board Geometry & Adjacency ---');
assert(NUM_SQUARES === 81, 'Board must have 81 squares');
assert(algebraicToSquare('a1') === 0, 'a1 must be index 0');
assert(algebraicToSquare('i9') === 80, 'i9 must be index 80');
assert(squareToAlgebraic(0) === 'a1', 'Index 0 must map to a1');
assert(squareToAlgebraic(80) === 'i9', 'Index 80 must map to i9');

// Corners must have 3 neighbors
assert(ADJACENCY_TABLE[0].length === 3, 'Corner a1 must have 3 neighbors');
assert(ADJACENCY_TABLE[80].length === 3, 'Corner i9 must have 3 neighbors');

// Edges must have 5 neighbors
const e1Sq = algebraicToSquare('e1');
assert(ADJACENCY_TABLE[e1Sq].length === 5, 'Edge e1 must have 5 neighbors');

// Center must have 8 neighbors
const e5Sq = algebraicToSquare('e5');
assert(ADJACENCY_TABLE[e5Sq].length === 8, 'Center e5 must have 8 neighbors');
console.log('✓ Coordinates and 8-neighbor adjacency tables verified');

// 2. Initial Board Setup & Symmetry
console.log('\n--- 2. Initial Setup & Rotational Symmetry ---');
const game = new IntransitiveGame();

assert(game.blueCounts.R === 3, 'Blue must have 3 Rocks');
assert(game.blueCounts.P === 4, 'Blue must have 4 Papers');
assert(game.blueCounts.S === 3, 'Blue must have 3 Scissors');
assert(game.blueCounts.total === 10, 'Blue must have 10 total pieces');

assert(game.redCounts.R === 3, 'Red must have 3 Rocks');
assert(game.redCounts.P === 4, 'Red must have 4 Papers');
assert(game.redCounts.S === 3, 'Red must have 3 Scissors');
assert(game.redCounts.total === 10, 'Red must have 10 total pieces');

// Check exact positions
assert(game.board[algebraicToSquare('b4')] === BLUE_ROCK, 'b4 must be Blue Rock');
assert(game.board[algebraicToSquare('b5')] === BLUE_PAPER, 'b5 must be Blue Paper');
assert(game.board[algebraicToSquare('c5')] === BLUE_SCISSORS, 'c5 must be Blue Scissors');

assert(game.board[algebraicToSquare('e7')] === RED_SCISSORS, 'e7 must be Red Scissors');
assert(game.board[algebraicToSquare('e8')] === RED_PAPER, 'e8 must be Red Paper');
assert(game.board[algebraicToSquare('f8')] === RED_ROCK, 'f8 must be Red Rock');

// Verify 180° rotational symmetry around e5
for (let sq = 0; sq < NUM_SQUARES; sq++) {
  const code = game.board[sq];
  if (code !== 0) {
    const file = sq % BOARD_SIZE;
    const rank = Math.floor(sq / BOARD_SIZE);
    const rotSq = (8 - rank) * BOARD_SIZE + (8 - file);
    const rotCode = game.board[rotSq];

    if (code >= BLUE_ROCK && code <= BLUE_SCISSORS) {
      assert(
        rotCode === code + 3,
        `Square ${squareToAlgebraic(sq)} (${code}) must rotate to ${squareToAlgebraic(rotSq)} (${code + 3})`
      );
    }
  }
}
console.log('✓ Initial setup and exact 180° rotational symmetry verified');

// 3. RPS Counter Rules & Capture Logic
console.log('\n--- 3. RPS Counter Rules & Capture Mechanics ---');
assert(canCapture(ROCK, SCISSORS) === true, 'Rock must capture Scissors');
assert(canCapture(SCISSORS, PAPER) === true, 'Scissors must capture Paper');
assert(canCapture(PAPER, ROCK) === true, 'Paper must capture Rock');

assert(canCapture(ROCK, ROCK) === false, 'Rock cannot capture Rock');
assert(canCapture(PAPER, PAPER) === false, 'Paper cannot capture Paper');
assert(canCapture(SCISSORS, SCISSORS) === false, 'Scissors cannot capture Scissors');

assert(canCapture(ROCK, PAPER) === false, 'Rock cannot capture Paper');
assert(canCapture(PAPER, SCISSORS) === false, 'Paper cannot capture Scissors');
assert(canCapture(SCISSORS, ROCK) === false, 'Scissors cannot capture Rock');
console.log('✓ Intransitive counter matrix verified');

// 4. Move Generation & Initial Opening Moves
console.log('\n--- 4. Legal Move Generation ---');
const initialMoves = game.generateLegalMoves();
console.log(`Initial position legal moves for Blue: ${initialMoves.length}`);
assert(initialMoves.length > 0, 'Blue must have legal moves on turn 1');

// No captures should be possible on turn 1 in standard setup
const initialCaptures = initialMoves.filter((m) => m.captured !== undefined);
assert(initialCaptures.length === 0, 'No captures should be possible on move 1');

// Friendly pieces should block each other
for (const move of initialMoves) {
  const targetCode = game.board[move.to];
  assert(targetCode === 0, 'Initial moves must only land on empty squares');
}
console.log('✓ Initial move generation and friendly collision blocking verified');

// 5. Tactical Capture Execution & State Updates
console.log('\n--- 5. Tactical Capture & Material Tracking ---');
// Set up a custom position where Blue Rock at d4 can capture Red Scissors at d5
const testFen = '9/9/9/9/3s5/3R5/9/9/9 b 0 1';
const captureGame = new IntransitiveGame(testFen);
const d4 = algebraicToSquare('d4');
const d5 = algebraicToSquare('d5');

const moves = captureGame.generateLegalMoves();
const captureMove = moves.find((m) => m.from === d4 && m.to === d5);
assert(captureMove !== undefined, 'Blue Rock must be able to capture Red Scissors');
assert(captureMove?.captured === SCISSORS, 'Captured piece type must be Scissors');

// Execute capture
const initialRedTotal = captureGame.redCounts.total;
captureGame.makeMove(captureMove!);
assert(captureGame.board[d4] === 0, 'd4 must be empty after move');
assert(captureGame.board[d5] === BLUE_ROCK, 'd5 must have Blue Rock');
assert(captureGame.redCounts.total === initialRedTotal - 1, 'Red total pieces must decrease by 1');
assert(captureGame.redCounts.S === 0, 'Red Scissors count must be 0');

// Unmake capture
captureGame.unmakeMove();
assert(captureGame.board[d4] === BLUE_ROCK, 'd4 must have Blue Rock restored');
assert(captureGame.board[d5] === RED_SCISSORS, 'd5 must have Red Scissors restored');
assert(captureGame.redCounts.total === initialRedTotal, 'Red total pieces restored');
assert(captureGame.redCounts.S === 1, 'Red Scissors count restored');
console.log('✓ Tactical capture makeMove & unmakeMove verified with material rollback');

// 6. Win Conditions: Touchdown, Elimination, Immobilization
console.log('\n--- 6. Win Conditions ---');

// 6A: Touchdown
const blueNearGoalFen = '7R1/9/9/9/4r4/9/9/9/9 b 0 1'; // Blue Rock at h9, Red Rock at e5
const touchdownGame = new IntransitiveGame(blueNearGoalFen);
const h9 = algebraicToSquare('h9');
const i9 = BLUE_GOAL_SQUARE;

const tdMove = touchdownGame.generateLegalMoves().find((m) => m.from === h9 && m.to === i9);
assert(tdMove !== undefined, 'Blue Rock must be able to step onto i9');
touchdownGame.makeMove(tdMove!);

const tdStatus = touchdownGame.isTerminal();
assert(tdStatus.isOver === true, 'Game must end on touchdown');
assert(tdStatus.winner === PLAYER_BLUE, 'Blue must be the winner');
assert(tdStatus.reason === 'touchdown', 'Reason must be touchdown');
console.log('✓ Touchdown victory detection verified');

// 6B: Elimination
const onePieceEachFen = '9/9/9/9/3p5/3S5/9/9/9 b 0 1'; // Blue S at d4, Red P at d5
const elimGame = new IntransitiveGame(onePieceEachFen);
const elimMove = elimGame.generateLegalMoves().find((m) => m.captured === PAPER);
assert(elimMove !== undefined, 'Blue Scissors can capture last Red Paper');
elimGame.makeMove(elimMove!);

const elimStatus = elimGame.isTerminal();
assert(elimStatus.isOver === true, 'Game must end on complete elimination');
assert(elimStatus.winner === PLAYER_BLUE, 'Blue must win by elimination');
assert(elimStatus.reason === 'elimination', 'Reason must be elimination');
console.log('✓ Material elimination victory detection verified');

// 6C: Threefold Repetition
console.log('\n--- 7. Threefold Repetition Detection ---');
const repGame = new IntransitiveGame();
const b4 = algebraicToSquare('b4');
const a4 = algebraicToSquare('a4');
const h6 = algebraicToSquare('h6');
const i6 = algebraicToSquare('i6');

const blueForward: Move = { from: b4, to: a4, piece: ROCK };
const blueBack: Move = { from: a4, to: b4, piece: ROCK };
const redForward: Move = { from: h6, to: i6, piece: ROCK };
const redBack: Move = { from: i6, to: h6, piece: ROCK };

// Cycle twice back to initial state (1 + 2 = 3 occurrences)
for (let cycle = 0; cycle < 2; cycle++) {
  repGame.makeMove(blueForward);
  repGame.makeMove(redForward);
  repGame.makeMove(blueBack);
  repGame.makeMove(redBack);
}

const repStatus = repGame.isTerminal();
assert(repStatus.isOver === true && repStatus.reason === 'repetition', 'Threefold repetition must trigger draw');
console.log('✓ Threefold repetition draw verified via Zobrist hashing');

// 8. FEN Parser & Serializer Round-trip
console.log('\n--- 8. FEN Serialization Round-trip ---');
const fenGame = new IntransitiveGame();
const initialFEN = fenGame.toFEN();
const roundTripBoard = fenToBoard(initialFEN);
const roundTripFEN = boardToFEN(
  roundTripBoard.board,
  roundTripBoard.activePlayer,
  roundTripBoard.halfmoveClock,
  roundTripBoard.fullmoveNumber
);
assert(initialFEN === roundTripFEN, `FEN roundtrip must match: "${initialFEN}" vs "${roundTripFEN}"`);
console.log(`✓ FEN round-trip verified: ${initialFEN}`);

// 9. Perft Benchmark & Combinatorial Verification
console.log('\n--- 9. Perft Benchmarks ---');
const perftGame = new IntransitiveGame();

const t0 = performance.now();
const p1 = perftGame.perft(1);
const t1 = performance.now();
console.log(`Perft(1): ${p1} nodes (${(t1 - t0).toFixed(2)}ms)`);

const t2 = performance.now();
const p2 = perftGame.perft(2);
const t3 = performance.now();
console.log(`Perft(2): ${p2} nodes (${(t3 - t2).toFixed(2)}ms)`);

const t4 = performance.now();
const p3 = perftGame.perft(3);
const t5 = performance.now();
console.log(`Perft(3): ${p3} nodes (${(t5 - t4).toFixed(2)}ms)`);

assert(p1 > 0 && p2 > 0 && p3 > 0, 'Perft counts must be positive');
console.log('✓ Perft depth 1-3 completed with high-speed node traversal');

// 10. SAN Notation & Formatting
console.log('\n--- 10. SAN Move Formatting ---');
const sanGame = new IntransitiveGame();
const move1: Move = { from: algebraicToSquare('b4'), to: algebraicToSquare('a4'), piece: ROCK };
assert(sanGame.formatMoveSAN(move1) === 'Rb4-a4', 'Standard move should be formatted as Rb4-a4');

const moveCapture: Move = {
  from: algebraicToSquare('b4'),
  to: algebraicToSquare('c5'),
  piece: ROCK,
  captured: SCISSORS,
};
assert(sanGame.formatMoveSAN(moveCapture) === 'Rb4xSc5', 'Capture should be formatted as Rb4xSc5');

const moveGoal: Move = { from: algebraicToSquare('h9'), to: BLUE_GOAL_SQUARE, piece: ROCK };
assert(sanGame.formatMoveSAN(moveGoal) === 'Rh9-i9#', 'Touchdown move should append #');
console.log('✓ SAN formatting for regular, capture, and touchdown moves verified');

// 11. Immobilization Win Detection
console.log('\n--- 11. Immobilization Detection ---');
// Trap a Red Rock at a9 surrounded by 3 Blue Papers (b9, a8, b8).
// Since Paper beats Rock, Red Rock cannot capture any of them and has 0 legal moves.
const trappedFen = 'rP7/PP7/9/9/9/9/9/9/9 r 0 1';
const trappedGame = new IntransitiveGame(trappedFen);
const trappedStatus = trappedGame.isTerminal();
assert(trappedStatus.isOver === true, 'Trapped player with no legal moves must lose');
assert(trappedStatus.winner === PLAYER_BLUE, 'Opponent Blue must win');
assert(trappedStatus.reason === 'immobilization', 'Reason must be immobilization');
console.log('✓ Immobilization detection verified');

// 12. Random Walk Undo Integrity
console.log('\n--- 12. Deep Random-Walk Make/Unmake Invariant Integrity ---');
const walkGame = new IntransitiveGame();
const initialWalkFEN = walkGame.toFEN();
const initialWalkKey = walkGame.zobristKey;
const playedMoves: Move[] = [];

for (let step = 0; step < 20; step++) {
  const legal = walkGame.generateLegalMoves();
  if (legal.length === 0 || walkGame.isTerminal().isOver) break;
  const picked = legal[Math.floor(Math.random() * legal.length)];
  walkGame.makeMove(picked);
  playedMoves.push(picked);
}

// Now unmake every move in reverse order
while (playedMoves.length > 0) {
  walkGame.unmakeMove();
  playedMoves.pop();
}

assert(walkGame.toFEN() === initialWalkFEN, 'FEN must be completely restored after unmaking all moves');
assert(walkGame.zobristKey === initialWalkKey, 'Zobrist key must be identical after unmaking all moves');
assert(walkGame.blueCounts.total === 10, 'Blue total pieces must be 10 after rollback');
assert(walkGame.redCounts.total === 10, 'Red total pieces must be 10 after rollback');
console.log('✓ 20-ply random-walk complete undo restoration verified');

console.log('\n🎉 ALL INTRANSITIVE CORE ENGINE TESTS PASSED WITH 100% ACCURACY!');
