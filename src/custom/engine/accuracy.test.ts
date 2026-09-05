/**
 * Intransitive Studio - Accuracy & Post-Game Analysis Unit Tests
 */

import {
  calculateAccuracyFromACPL,
  classifyMove,
  analyzeGameAccuracy,
  type HistoryItem,
} from './accuracy';
import { createHeuristicWeights } from './evaluator';
import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE } from '../core/types';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('🧪 Starting Intransitive Accuracy & Analysis Verification Suite...\n');

// 1. ACPL to Accuracy Formula Tests
console.log('--- 1. Accuracy Curve Verification ---');
assert(calculateAccuracyFromACPL(0) === 100, '0 ACPL must yield 100% accuracy');
const acc20 = calculateAccuracyFromACPL(20);
assert(acc20 >= 90 && acc20 <= 99, `20 ACPL should yield ~90-99% accuracy, got ${acc20}%`);
const acc50 = calculateAccuracyFromACPL(50);
assert(acc50 >= 70 && acc50 <= 85, `50 ACPL should yield ~70-85% accuracy, got ${acc50}%`);
const acc150 = calculateAccuracyFromACPL(150);
assert(acc150 < 50 && acc150 >= 0, `150 ACPL should yield < 50% accuracy, got ${acc150}%`);
console.log(`✓ Accuracy curve verified: 0 ACPL=100%, 20 ACPL=${acc20}%, 50 ACPL=${acc50}%, 150 ACPL=${acc150}%`);

// 2. Move Classification Thresholds
console.log('\n--- 2. Move Classification Thresholds ---');
assert(classifyMove(10) === 'best', '10 CPL must be "best"');
assert(classifyMove(35) === 'inaccuracy', '35 CPL must be "inaccuracy"');
assert(classifyMove(90) === 'mistake', '90 CPL must be "mistake"');
assert(classifyMove(220) === 'blunder', '220 CPL must be "blunder"');
console.log('✓ Classifications verified: best, inaccuracy, mistake, blunder');

// 3. Full Game Analysis on 4-ply Trajectory
console.log('\n--- 3. Full Game Trajectory Analysis ---');
const game = new IntransitiveGame();
const weights = createHeuristicWeights();
const moves: HistoryItem[] = [];

// Simulate 4 moves
for (let p = 0; p < 4; p++) {
  const legal = game.generateLegalMoves();
  const m = legal[0];
  const san = game.formatMoveSAN(m);
  game.makeMove(m);
  moves.push({ move: m, san, fen: game.toFEN() });
}

const analysis = analyzeGameAccuracy(moves, weights, PLAYER_BLUE, 'touchdown');
assert(analysis.plies.length === 4, 'Must analyze 4 plies');
assert(analysis.evalPoints.length === 5, 'Eval points must include ply 0 + 4 moves');
assert(analysis.blueStats.totalMoves === 2, 'Blue must have 2 moves');
assert(analysis.redStats.totalMoves === 2, 'Red must have 2 moves');
assert(analysis.blueStats.accuracy >= 0 && analysis.blueStats.accuracy <= 100, 'Accuracy must be in [0, 100]');
assert(analysis.redStats.accuracy >= 0 && analysis.redStats.accuracy <= 100, 'Accuracy must be in [0, 100]');
assert(analysis.summary.winner === PLAYER_BLUE, 'Winner must be blue');
assert(analysis.summary.reason === 'touchdown', 'Reason must be touchdown');
console.log(`✓ Trajectory analyzed: Blue Acc=${analysis.blueStats.accuracy}%, Red Acc=${analysis.redStats.accuracy}%`);

console.log('\n🎉 ALL ACCURACY & ANALYSIS TESTS PASSED WITH 100% ACCURACY!\n');
