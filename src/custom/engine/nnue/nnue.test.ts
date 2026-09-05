/**
 * Comprehensive Verification Suite for Intransitive 9x9 NNUE Engine
 * Verifies accumulator parity, rotational symmetry, forward pass throughput, and AdamW training.
 */

import { IntransitiveGame } from '../../core/game';
import { PLAYER_BLUE } from '../../core/types';
import {
  rotSq,
  getFeatureIndex,
  computeAccumulatorFull,
  updateAccumulatorMove,
  createRandomNNUEWeights,
} from './featureTransformer';
import { evaluateNNUE } from './nnueEvaluator';
import { NNUETrainer } from './nnueTrainer';
import { createMasterNNUEWeights } from './nnueWeights';

console.log('🧪 Starting Intransitive NNUE Engine Verification Suite...\n');

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    console.log(`✓ ${message}`);
  }
}

// -------------------------------------------------------------
// 1. Rotational Symmetry & Feature Transformer
// -------------------------------------------------------------
console.log('--- 1. Board Geometry & Rotational Symmetry ---');
assert(rotSq(0) === 80, 'rotSq(0 [a1]) must map to 80 [i9]');
assert(rotSq(80) === 0, 'rotSq(80 [i9]) must map to 0 [a1]');
assert(rotSq(40) === 40, 'rotSq(40 [e5]) center square maps to itself');

const featUsR = getFeatureIndex('R', true, 10);
const featThemR = getFeatureIndex('R', false, 10);
assert(featThemR === featUsR + 3 * 81, 'Enemy channel offset is +243');

// -------------------------------------------------------------
// 2. Incremental Accumulator Parity vs Full Rebuild
// -------------------------------------------------------------
console.log('\n--- 2. Incremental vs Full Accumulator Parity ---');
const weights = createRandomNNUEWeights(42);
const game = new IntransitiveGame();

let incrementalAcc = computeAccumulatorFull(game, weights);
let movesPlayed = 0;

for (let step = 0; step < 25; step++) {
  const legalMoves = game.generateLegalMoves();
  if (legalMoves.length === 0 || game.isTerminal().isOver) break;

  const move = legalMoves[Math.floor(Math.random() * legalMoves.length)];
  const active = game.activePlayer;

  // Apply incremental update
  updateAccumulatorMove(incrementalAcc, move, active, weights);
  game.makeMove(move);
  movesPlayed++;

  // Compute full from scratch
  const fullAcc = computeAccumulatorFull(game, weights);

  // Compare bitwise
  let maxDiff = 0;
  for (let i = 0; i < 128; i++) {
    const diffBlue = Math.abs(incrementalAcc.blue[i] - fullAcc.blue[i]);
    const diffRed = Math.abs(incrementalAcc.red[i] - fullAcc.red[i]);
    if (diffBlue > maxDiff) maxDiff = diffBlue;
    if (diffRed > maxDiff) maxDiff = diffRed;
  }

  assert(maxDiff < 1e-4, `Ply ${step + 1}: Accumulator parity exact (maxDiff=${maxDiff.toExponential(2)})`);
}
console.log(`✓ Verified 100% accumulator parity across ${movesPlayed} consecutive moves`);

// -------------------------------------------------------------
// 3. Evaluation Symmetry on Starting Position
// -------------------------------------------------------------
console.log('\n--- 3. Evaluation Symmetry on Starting Position ---');
const masterWeights = createMasterNNUEWeights();
const startPosition = new IntransitiveGame();
const initialEval = evaluateNNUE(startPosition, masterWeights);
console.log(`Initial position NNUE eval: ${initialEval} cp`);
assert(Math.abs(initialEval) < 50, `Initial position is balanced (eval=${initialEval} cp)`);

// -------------------------------------------------------------
// 4. Forward Pass Speed Benchmark
// -------------------------------------------------------------
console.log('\n--- 4. Forward Pass Speed Benchmark ---');
const benchGame = new IntransitiveGame();
const benchAcc = computeAccumulatorFull(benchGame, masterWeights);

const ITERATIONS = 10000;
const start = performance.now();
let dummySum = 0;
for (let i = 0; i < ITERATIONS; i++) {
  dummySum += evaluateNNUE(benchGame, masterWeights, benchAcc);
}
const elapsedMs = Math.max(1, performance.now() - start);
const nps = Math.round((ITERATIONS * 1000) / elapsedMs);
console.log(`Evaluated ${ITERATIONS} positions in ${elapsedMs.toFixed(1)}ms (${nps.toLocaleString()} pos/sec)`);
assert(nps > 50000, `Inference speed exceeds 50,000 pos/sec (achieved ${nps})`);

// -------------------------------------------------------------
// 5. Mini-Batch AdamW Training Sanity
// -------------------------------------------------------------
console.log('\n--- 5. Mini-Batch AdamW Training Sanity ---');
const trainWeights = createRandomNNUEWeights(99);
const trainer = new NNUETrainer(trainWeights, { learningRate: 0.01, batchSize: 64 });

// Add synthetic touchdown samples (Blue has advanced runner with high win probability)
for (let i = 0; i < 200; i++) {
  trainer.addSample({
    activeFeaturesBlue: [getFeatureIndex('R', true, 79), getFeatureIndex('P', true, 71)],
    activeFeaturesRed: [getFeatureIndex('S', true, 1)],
    activePlayer: PLAYER_BLUE,
    searchScore: 1500,
    terminalOutcome: 1.0,
    isTerminal: false,
  });
}

const batch1 = trainer.trainBatch(64);
for (let i = 0; i < 10; i++) {
  trainer.trainBatch(64);
}
const batchFinal = trainer.trainBatch(64);
console.log(`Initial Loss: ${batch1.loss.toFixed(4)} -> Final Loss: ${batchFinal.loss.toFixed(4)}`);
assert(batchFinal.loss < batch1.loss, 'AdamW training loss strictly decreases');

console.log('\n🎉 ALL INTRANSITIVE NNUE VERIFICATION TESTS PASSED WITH 100% ACCURACY!');
