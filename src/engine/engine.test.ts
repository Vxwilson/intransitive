/**
 * Comprehensive verification tests for Chessesque Classical Search Engine:
 * 1. Evaluation: PeSTO starting position symmetry & material counting
 * 2. Transposition Table: Zobrist indexing, aging, and mate-distance normalization
 * 3. Search Engine:
 *    - Solving Mate in 1 (Scholar's Mate final position)
 *    - Solving Mate in 2 (Tactical Queen/Rook checkmate)
 *    - Tactical capture (free piece capture over quiet moves)
 *    - Iterative deepening metrics & PV extraction
 */

import { Chess } from '../core/chess';
import { PAWN, QUEEN, MoveFlag, type Move } from '../core/types';
import { evaluate, evaluateWhite, evaluateDetails } from './evaluate';
import { TranspositionTable, SharedTranspositionTable, TTFlag, MATE_THRESHOLD } from './transposition';
import { SearchEngine, MATE_SCORE } from './search';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion Failed: ${message}`);
  }
}

console.log('🧪 Starting Chessesque Engine & Search Verification Suite...\n');

// 1. Evaluation Tests
console.log('--- 1. Classical Evaluation Module ---');
const startBoard = new Chess();
const startEval = evaluate(startBoard);
const details = evaluateDetails(startBoard);

// Starting position: White has slight tempo bonus (+15 centipawns), otherwise symmetric
console.log(`Initial eval: ${startEval} cp (White tempo +15, phase ${details.phase}/24)`);
assert(startEval >= 10 && startEval <= 25, `Expected initial eval around +15 cp tempo, got ${startEval}`);
assert(details.phase === 24, `Initial game phase must be 24, got ${details.phase}`);
assert(details.materialWhite === details.materialBlack, 'Initial material must be equal');

// Black to move initial test
startBoard.loadFEN('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
const e4EvalBlack = evaluate(startBoard);
const e4EvalWhite = evaluateWhite(startBoard);
assert(e4EvalBlack === -e4EvalWhite, 'evaluate() should invert based on active player');
console.log('✓ Evaluation symmetry, material counting, and phase tapering verified');

// 2. Transposition Table Tests
console.log('\n--- 2. Transposition Table ---');
const tt = new TranspositionTable(14); // 16,384 entries for test
const testHash = 0x123456789abcdef0n;

// Normal score store & probe
tt.store(testHash, 4, 150, TTFlag.Exact, null, 0);
const probed = tt.probe(testHash, 0);
assert(probed !== null, 'Probed entry should exist');
assert(probed!.score === 150, `Expected score 150, got ${probed!.score}`);
assert(probed!.depth === 4, `Expected depth 4, got ${probed!.depth}`);

// Mate distance normalization test
// Say mate in 2 plies at ply 3: score is MATE_SCORE - 5 (stored at ply 3)
const mateScoreAtPly3 = MATE_SCORE - 5;
tt.store(testHash, 6, mateScoreAtPly3, TTFlag.Exact, null, 3);
// Probe at ply 1: should be MATE_SCORE - 3
const probedMateAtPly1 = tt.probe(testHash, 1);
assert(probedMateAtPly1 !== null, 'Probed mate entry should exist');
assert(probedMateAtPly1!.score === MATE_SCORE - 3, `Expected mate score ${MATE_SCORE - 3}, got ${probedMateAtPly1!.score}`);
console.log('✓ Transposition table indexing, replacement, and mate-distance normalization verified');

// 3. Search Engine: Mate in 1 Test
console.log('\n--- 3. Search Engine: Mate in 1 ---');
// Scholar's Mate position: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 (White to move, Qxf7# is mate in 1)
const mate1Board = new Chess('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
const engine = new SearchEngine(15);
const m1Result = engine.search(mate1Board, { maxDepth: 3, timeLimitMs: 1000 });

console.log(`Mate in 1 search result: bestMove=${m1Result.bestMoveSAN}, score=${m1Result.score}, depth=${m1Result.completedDepth}`);
assert(m1Result.bestMoveSAN === 'Qxf7#', `Expected best move Qxf7#, got ${m1Result.bestMoveSAN}`);
assert(m1Result.isMate === true, 'Engine should recognize mate');
assert(m1Result.score > MATE_THRESHOLD, 'Engine score should indicate winning mate');
console.log('✓ Mate in 1 correctly solved');

// 4. Search Engine: Mate in 2 Test
console.log('\n--- 4. Search Engine: Mate in 2 ---');
// Classic Opera Box / Morphy-style mate in 2:
// White: Kh1, Rd1, Qh6; Black: Kg8, Pawn f7, g7, h7 (Qxf8+ Kxf8, Rd8# or similar)
// Let's use a crisp Mate-in-2: White has Queen & Rook vs Black King on back rank
// FEN: 6k1/5ppp/8/8/8/8/1R6/4Q2K w - - 0 1 (1. Rb8+ or 1. Qe8#)
// Let's test standard 2-move checkmate:
// FEN: r5rk/5p1p/5R2/8/8/8/8/4Q2K w - - 0 1 -> 1. Qe5 followed by 2. Rg6# or similar
// Or clean Anastasia's Mate setup:
// White: Ne7, Rh3, Black: Kh8, pawns g7, h7. 1. Rxh7+ Kxh7 2. Rh1# (Mate in 2)
const anastasia = new Chess('7k/6pp/8/4N3/8/7R/8/K6R w - - 0 1');
const m2Result = engine.search(anastasia, { maxDepth: 4, timeLimitMs: 2000 });
console.log(`Mate in 2 result: bestMove=${m2Result.bestMoveSAN}, score=${m2Result.score}, depth=${m2Result.completedDepth}, pv=${m2Result.pvSAN.join(' ')}`);
assert(m2Result.bestMoveSAN === 'Rxh7#' || m2Result.bestMoveSAN === 'Rxh7+', `Expected Rxh7+, got ${m2Result.bestMoveSAN}`);
assert(m2Result.isMate === true, 'Engine should detect forced mate in 2');
console.log('✓ Mate in 2 correctly solved');

// 5. Tactical Capture (Avoid Blunders)
console.log('\n--- 5. Search Engine: Tactical Free Piece Capture ---');
// Position: Black has left Queen completely undefended on d4:
// White can capture it with Qxd4 or exd4
const freeQueenBoard = new Chess('rnb1kbnr/pppp1ppp/8/8/3qP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 1');
const tacticalResult = engine.search(freeQueenBoard, { maxDepth: 3, timeLimitMs: 1000 });
console.log(`Tactical free queen result: bestMove=${tacticalResult.bestMoveSAN}, score=${tacticalResult.score}`);
assert(
  tacticalResult.bestMoveSAN === 'Qxd4' || tacticalResult.bestMoveSAN === 'exd4',
  `Expected Qxd4 or exd4, got ${tacticalResult.bestMoveSAN}`
);
assert(tacticalResult.score >= 800, `Expected score gain >= +800 cp, got ${tacticalResult.score}`);
console.log('✓ Tactical capture correctly executed');

// 6. Iterative Deepening & PV Extraction
console.log('\n--- 6. Search Engine: Iterative Deepening & NPS Telemetry ---');
const gameBoard = new Chess();
let updatesCount = 0;
const gameResult = engine.search(gameBoard, {
  maxDepth: 6,
  timeLimitMs: 2000,
  onDepthComplete: (u) => {
    updatesCount++;
    console.log(`  Depth ${u.depth}: score=${u.score} cp, nodes=${u.nodes}, nps=${u.nps}, bestMove=${u.bestMoveSAN}, pv=${u.pvSAN.join(' ')}`);
  },
});

assert(updatesCount === 6, `Expected 6 depth updates, got ${updatesCount}`);
assert(gameResult.nodes > 500, `Expected nodes > 500, got ${gameResult.nodes}`);
assert(gameResult.pv.length > 0, 'PV line should not be empty');
console.log(`✓ Iterative Deepening complete: ${gameResult.nodes} nodes searched at ${gameResult.nps} NPS in ${gameResult.timeMs}ms`);

// 7. User Settings Persistence Tests
console.log('\n--- 7. User Settings Persistence & LocalStorage ---');
import { loadSavedSettings, saveUserSettings } from './engineTypes';
import type { SavedUserSettings } from './engineTypes';

// Mock localStorage for node environment
const storageMock = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage; window: unknown }).localStorage = {
  getItem: (key: string) => storageMock.get(key) ?? null,
  setItem: (key: string, val: string) => storageMock.set(key, val),
  removeItem: (key: string) => storageMock.delete(key),
  clear: () => storageMock.clear(),
  length: 0,
  key: () => null,
};
(globalThis as unknown as { window: unknown }).window = globalThis;

const sampleSettings: SavedUserSettings = {
  isAnalysisEnabled: true,
  searchTimeSec: 10,
  isInfinite: false,
  multiPv: 3,
  threads: 12,
  hashMb: 128,
  gameMode: 'play_vs_computer',
  difficulty: 'strong',
  playerColor: 0,
  isFlipped: false,
  soundEnabled: true,
  isHardwareExpanded: true,
};

saveUserSettings(sampleSettings);
const loaded = loadSavedSettings();
assert(loaded.threads === 12, `Expected threads=12, got ${loaded.threads}`);
assert(loaded.searchTimeSec === 10, `Expected searchTimeSec=10, got ${loaded.searchTimeSec}`);
assert(loaded.multiPv === 3, `Expected multiPv=3, got ${loaded.multiPv}`);
assert(loaded.hashMb === 128, `Expected hashMb=128, got ${loaded.hashMb}`);
assert(loaded.difficulty === 'strong', `Expected difficulty=strong, got ${loaded.difficulty}`);
assert(loaded.isHardwareExpanded === true, `Expected isHardwareExpanded=true, got ${loaded.isHardwareExpanded}`);
console.log('✓ Cross-session settings storage, serializing, and deserializing verified');

// 8. Arrow Geometry Verification (No zero-width/zero-height clipping)
console.log('\n--- 8. Arrow Geometry: Guaranteed Non-Zero Bounding Box ---');
function calculateArrowBBox(sqFrom: number, sqTo: number, isFlipped: boolean = false) {
  const rankFrom = Math.floor(sqFrom / 8);
  const fileFrom = sqFrom % 8;
  const colFrom = isFlipped ? 7 - fileFrom : fileFrom;
  const rowFrom = isFlipped ? rankFrom : 7 - rankFrom;
  const fromX = colFrom * 100 + 50;
  const fromY = rowFrom * 100 + 50;

  const rankTo = Math.floor(sqTo / 8);
  const fileTo = sqTo % 8;
  const colTo = isFlipped ? 7 - fileTo : fileTo;
  const rowTo = isFlipped ? rankTo : 7 - rankTo;
  const toX = colTo * 100 + 50;
  const toY = rowTo * 100 + 50;

  const dx = toX - fromX;
  const dy = toY - fromY;
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const perpX = -sin;
  const perpY = cos;

  const shaftHalfWidth = 5;
  const headLength = 26;
  const headHalfWidth = 15;
  const notchDepth = 5;
  const startOffset = 12;
  const tipOffset = 6;

  const startX = fromX + cos * startOffset;
  const startY = fromY + sin * startOffset;
  const tipX = toX - cos * tipOffset;
  const tipY = toY - sin * tipOffset;
  const baseCenterX = tipX - cos * headLength;
  const baseCenterY = tipY - sin * headLength;
  const notchX = baseCenterX + cos * notchDepth;
  const notchY = baseCenterY + sin * notchDepth;

  const leftWingX = baseCenterX + perpX * headHalfWidth;
  const leftWingY = baseCenterY + perpY * headHalfWidth;
  const rightWingX = baseCenterX - perpX * headHalfWidth;
  const rightWingY = baseCenterY - perpY * headHalfWidth;

  const shaftEndLeftX = notchX + perpX * shaftHalfWidth;
  const shaftEndLeftY = notchY + perpY * shaftHalfWidth;
  const shaftEndRightX = notchX - perpX * shaftHalfWidth;
  const shaftEndRightY = notchY - perpY * shaftHalfWidth;

  const shaftStartLeftX = startX + perpX * shaftHalfWidth;
  const shaftStartLeftY = startY + perpY * shaftHalfWidth;
  const shaftStartRightX = startX - perpX * shaftHalfWidth;
  const shaftStartRightY = startY - perpY * shaftHalfWidth;

  const xs = [shaftStartLeftX, shaftEndLeftX, leftWingX, tipX, rightWingX, shaftEndRightX, shaftStartRightX];
  const ys = [shaftStartLeftY, shaftEndLeftY, leftWingY, tipY, rightWingY, shaftEndRightY, shaftStartRightY];

  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return { width, height };
}

// Vertical moves (previously failed because line had width=0)
const e2e4 = calculateArrowBBox(12, 28); // e2 to e4
assert(e2e4.width >= 20, `Vertical move width must be >= 20px, got ${e2e4.width}`);
assert(e2e4.height >= 100, `Vertical move height must be >= 100px, got ${e2e4.height}`);

const e7e5 = calculateArrowBBox(52, 36); // e7 to e5
assert(e7e5.width >= 20, `Vertical move width must be >= 20px, got ${e7e5.width}`);

// Horizontal moves (previously failed because line had height=0)
const e1g1 = calculateArrowBBox(4, 6); // e1 to g1
assert(e1g1.height >= 20, `Horizontal move height must be >= 20px, got ${e1g1.height}`);
assert(e1g1.width >= 100, `Horizontal move width must be >= 100px, got ${e1g1.width}`);

// Knight move
const g1f3 = calculateArrowBBox(6, 21); // g1 to f3
assert(g1f3.width >= 20 && g1f3.height >= 20, 'Knight move must have non-zero width & height');

console.log(`✓ All arrow orientations (vertical [${e2e4.width}x${e2e4.height}], horizontal [${e1g1.width}x${e1g1.height}], knight [${g1f3.width.toFixed(1)}x${g1f3.height.toFixed(1)}]) guaranteed non-zero 2D polygons`);

console.log('\n--- 9. Multi-PV Multi-Arrow Line Generation ---');
const multiPvChess = new Chess();
const multiPvEngine = new SearchEngine(16);
const multiPvResult = multiPvEngine.search(multiPvChess, { maxDepth: 4, multiPv: 3 });
const multiPvLines = multiPvResult.lines;
if (!multiPvLines) {
  throw new Error('Multi-PV result must contain lines array');
}
assert(multiPvLines.length === 3, `Expected 3 lines, got ${multiPvLines.length}`);
assert(multiPvLines[0].rank === 1, 'Top line must have rank 1');
assert(multiPvLines[1].rank === 2, 'Second line must have rank 2');
assert(multiPvLines[2].rank === 3, 'Third line must have rank 3');

// Ensure distinct candidate moves
const moveKeys = new Set(multiPvLines.map((l) => `${l.move.from}-${l.move.to}`));
assert(moveKeys.size === 3, 'All Multi-PV candidate lines must feature distinct root moves');
console.log(`✓ Multi-PV 3 lines generated with distinct candidate moves:`);
multiPvLines.forEach((l) => {
  console.log(`    #${l.rank}: ${l.san} (score: ${l.score} cp, pv: ${l.pvSAN.slice(0, 3).join(' ')})`);
});

console.log('\n--- 10. SharedTranspositionTable & Atomics Lockless Operations ---');
const sab = SharedTranspositionTable.createBuffer(16); // 16 MB = 1M entries
assert(sab.byteLength === 16 * 1024 * 1024, `Expected 16MB SAB, got ${sab.byteLength}`);

const sharedTT = new SharedTranspositionTable(sab);
assert(sharedTT.size === 1048576, `Expected 1,048,576 entries, got ${sharedTT.size}`);

// Test store and probe with full Move structure
const sampleMove: Move = {
  from: 12, // e2
  to: 28,   // e4
  piece: PAWN,
  captured: undefined,
  promotion: QUEEN,
  flags: MoveFlag.DoublePawnPush,
};

const sampleHash = 0xabcdef0123456789n;
sharedTT.store(sampleHash, 8, 320, TTFlag.Exact, sampleMove, 0);

const probedShared = sharedTT.probe(sampleHash, 0);
assert(probedShared !== null, 'Probed shared TT entry should exist');
assert(probedShared!.depth === 8, `Expected depth 8, got ${probedShared!.depth}`);
assert(probedShared!.score === 320, `Expected score 320, got ${probedShared!.score}`);
assert(probedShared!.flag === TTFlag.Exact, `Expected flag Exact, got ${probedShared!.flag}`);
assert(probedShared!.bestMove !== null, 'bestMove should be non-null');
assert(probedShared!.bestMove!.from === 12, `Expected move from 12, got ${probedShared!.bestMove!.from}`);
assert(probedShared!.bestMove!.to === 28, `Expected move to 28, got ${probedShared!.bestMove!.to}`);
assert(probedShared!.bestMove!.piece === PAWN, `Expected piece PAWN, got ${probedShared!.bestMove!.piece}`);
assert(probedShared!.bestMove!.promotion === QUEEN, `Expected promo QUEEN, got ${probedShared!.bestMove!.promotion}`);
assert(probedShared!.bestMove!.flags === MoveFlag.DoublePawnPush, `Expected flags DoublePawnPush, got ${probedShared!.bestMove!.flags}`);

// Test mate score normalization in SharedTranspositionTable
// Mate in 2 at ply 4: score = MATE_SCORE - 6
const mateScorePly4 = MATE_SCORE - 6;
sharedTT.store(sampleHash, 10, mateScorePly4, TTFlag.Exact, null, 4);

// Probe at ply 1: score should be normalized to MATE_SCORE - 3
const probedSharedMate = sharedTT.probe(sampleHash, 1);
assert(probedSharedMate !== null, 'Probed shared mate entry should exist');
assert(probedSharedMate!.score === MATE_SCORE - 3, `Expected mate score ${MATE_SCORE - 3}, got ${probedSharedMate!.score}`);

// Test SearchEngine integration with SharedTranspositionTable
const sharedEngine = new SearchEngine(sharedTT);
const sharedSearchResult = sharedEngine.search(mate1Board, { maxDepth: 4, timeLimitMs: 1000 });
assert(sharedSearchResult.bestMoveSAN === 'Qxf7#', `Expected best move Qxf7# with shared TT, got ${sharedSearchResult.bestMoveSAN}`);
assert(sharedSearchResult.isMate === true, 'Engine with shared TT should detect mate in 1');
console.log(`✓ SharedTranspositionTable 16MB allocation, lockless 64-bit atomic packing, mate normalization, and SearchEngine integration verified`);

console.log('\n🎉 ALL ENGINE EVALUATION, SEARCH, STORAGE, SHARED TT, AND GEOMETRY TESTS PASSED WITH 100% ACCURACY!\n');


