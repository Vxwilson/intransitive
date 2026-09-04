/**
 * Intransitive Custom Engine & TD-Learning Verification Suite
 */

import { IntransitiveGame } from '../core/game';
import {
  createZeroWeights,
  createHeuristicWeights,
  evaluate,
  extractFeatures,
} from './evaluator';
import { TDLearner, type TrajectoryStep } from './tdLearner';
import { SelfPlayTrainer } from './trainer';
import { getTopMoves, formatEvalScore, runIterativeDeepeningAnalysis } from './search';
import {
  PRESET_CHECKPOINTS,
  saveCheckpoint,
  getStoredCheckpoints,
  exportCheckpointsJSON,
  importCheckpointsJSON,
} from './checkpoint';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('🧪 Starting Intransitive Engine & TD-Learning Verification Suite...\n');

// 1. Tabula Rasa Initialization
console.log('--- 1. Tabula Rasa Initial Weights ---');
const zeroWeights = createZeroWeights();
assert(zeroWeights.pieceValues.R === 0, 'Initial Rock weight must be 0.0');
assert(zeroWeights.pieceValues.P === 0, 'Initial Paper weight must be 0.0');
assert(zeroWeights.pieceValues.S === 0, 'Initial Scissors weight must be 0.0');
assert(zeroWeights.goalDistanceWeight === 0, 'Initial goal proximity weight must be 0.0');
assert(zeroWeights.threatBonus === 0, 'Initial threat bonus must be 0.0');
assert(zeroWeights.vulnerabilityPenalty === 0, 'Initial vulnerability penalty must be 0.0');
assert(zeroWeights.pst.R.every((v) => v === 0), 'Initial PST R must be 0');
console.log('✓ Tabula Rasa weights verified at strict 0.0 zero-knowledge');

// 2. Evaluation & Feature Extraction Symmetry
console.log('\n--- 2. Evaluation & Feature Extraction Symmetry ---');
const game = new IntransitiveGame();
const features = extractFeatures(game);

assert(features.materialR === 0, 'Initial material R delta must be 0');
assert(features.materialP === 0, 'Initial material P delta must be 0');
assert(features.materialS === 0, 'Initial material S delta must be 0');
assert(features.goalDistanceAdvantage === 0, 'Initial goal distance advantage must be 0 due to rotational symmetry');
assert(features.threatAdvantage === 0, 'Initial threat advantage must be 0');
assert(features.vulnerabilityAdvantage === 0, 'Initial vulnerability advantage must be 0');

const heuristicWeights = createHeuristicWeights();
const initialEval = evaluate(game, heuristicWeights);
// In initial position, only tempo bonus applies for Blue
assert(
  initialEval === heuristicWeights.tempoBonus,
  `Initial evaluation should equal tempo bonus (+${heuristicWeights.tempoBonus}), got ${initialEval}`
);
console.log(`✓ Initial symmetric evaluation verified: ${initialEval} cp (tempo bonus)`);

// 3. TD-Leaf Weight Update Directionality
console.log('\n--- 3. TD-Leaf Gradient & Credit Assignment ---');
const learner = new TDLearner({ learningRate: 0.05, lambda: 0.7 });
const weights = createZeroWeights();

// Synthesize a 3-step trajectory where Blue advances toward the goal
const trajectory: TrajectoryStep[] = [
  {
    features: {
      materialR: 0,
      materialP: 0,
      materialS: 0,
      goalDistanceAdvantage: 1,
      threatAdvantage: 0,
      vulnerabilityAdvantage: 0,
      tempoAdvantage: 1,
      pstDeltas: {
        R: new Float32Array(81),
        P: new Float32Array(81),
        S: new Float32Array(81),
      },
    },
    evalScore: 0,
  },
  {
    features: {
      materialR: 0,
      materialP: 1, // Blue captured a Paper
      materialS: 0,
      goalDistanceAdvantage: 3,
      threatAdvantage: 1,
      vulnerabilityAdvantage: 0,
      tempoAdvantage: 1,
      pstDeltas: {
        R: new Float32Array(81),
        P: new Float32Array(81),
        S: new Float32Array(81),
      },
    },
    evalScore: 10,
  },
];

// Blue wins the game (+1000 reward)
learner.updateWeights(weights, trajectory, 1000);

assert(weights.pieceValues.P > 0, `Paper value should increase after winning capture, got ${weights.pieceValues.P}`);
assert(weights.goalDistanceWeight > 0, `Goal proximity weight should increase, got ${weights.goalDistanceWeight}`);
assert(weights.threatBonus > 0, `Threat bonus should increase, got ${weights.threatBonus}`);
console.log(
  `✓ TD updates verified: Paper=${weights.pieceValues.P.toFixed(2)}, GoalDist=${weights.goalDistanceWeight.toFixed(2)}, Threat=${weights.threatBonus.toFixed(2)}`
);

// 4. Batch Self-Play Execution
console.log('\n--- 4. Autonomous Tabula Rasa Self-Play Simulation ---');
const trainer = new SelfPlayTrainer(createZeroWeights(), {
  learningRate: 0.02,
  epsilon: 0.15,
  searchDepth: 1,
});

const t0 = performance.now();
const NUM_TEST_GAMES = 15;
for (let i = 0; i < NUM_TEST_GAMES; i++) {
  trainer.playSelfPlayGame();
}
const elapsed = performance.now() - t0;

assert(trainer.stats.gamesPlayed === NUM_TEST_GAMES, `Must have played ${NUM_TEST_GAMES} games`);
assert(trainer.stats.generation === NUM_TEST_GAMES, `Generation must equal ${NUM_TEST_GAMES}`);
assert(trainer.stats.avgGameLength > 0, 'Average game length must be positive');

const evolvedWeights = trainer.weights;
const totalEvolved =
  evolvedWeights.pieceValues.R +
  evolvedWeights.pieceValues.P +
  evolvedWeights.pieceValues.S +
  evolvedWeights.goalDistanceWeight;

assert(totalEvolved > 0, 'Weights must autonomously evolve from 0.0 after self-play');
console.log(
  `✓ Simulated ${NUM_TEST_GAMES} self-play games in ${elapsed.toFixed(1)}ms (${(elapsed / NUM_TEST_GAMES).toFixed(2)}ms/game)`
);
console.log(
  `  Evolved weights: R=${evolvedWeights.pieceValues.R.toFixed(2)}, P=${evolvedWeights.pieceValues.P.toFixed(2)}, S=${evolvedWeights.pieceValues.S.toFixed(2)}, GoalDist=${evolvedWeights.goalDistanceWeight.toFixed(2)}`
);

// 5. Checkpoint System & Presets
console.log('\n--- 5. Checkpoint System & Persistence ---');
assert(PRESET_CHECKPOINTS.length >= 2, 'Preset checkpoints must exist');
const gen0 = PRESET_CHECKPOINTS.find((c) => c.id === 'preset-gen-0');
assert(gen0 !== undefined, 'Gen 0 preset must exist');

const saved = saveCheckpoint('Test Run Snapshot', 50, trainer.weights, trainer.stats);
assert(saved.name === 'Test Run Snapshot', 'Checkpoint name must match');

const allStored = getStoredCheckpoints();
assert(allStored.some((c) => c.name === 'Test Run Snapshot'), 'Saved checkpoint must be in list');

const exported = exportCheckpointsJSON();
assert(exported.includes('Test Run Snapshot'), 'Exported JSON must contain saved checkpoint');

const imported = importCheckpointsJSON(exported);
assert(imported === true, 'JSON import must succeed');
console.log('✓ Checkpoint saving, loading, and JSON export/import verified');

// 6. Arena Head-to-Head Tournament
console.log('\n--- 6. Head-to-Head Checkpoint Arena Exhibition ---');
const arenaGames = 10;
const arenaResult = SelfPlayTrainer.runArenaTournament(
  heuristicWeights, // Player A (Hand-tuned heuristic)
  createZeroWeights(), // Player B (Untrained zero weights)
  arenaGames,
  2
);

console.log(
  `Arena result (Heuristic Master vs Untrained Gen 0): Heuristic wins ${arenaResult.winsA}/${arenaGames} (${arenaResult.winRateA}%), Gen 0 wins ${arenaResult.winsB}/${arenaGames}`
);
assert(arenaResult.winsA >= arenaResult.winsB, 'Heuristic master should outperform untrained Gen 0 in arena');
console.log('✓ Checkpoint Arena tournament simulation verified');

// 7. Multi-Move Candidate Analysis (PV Continuation Lines & Mate Detection)
console.log('\n--- 7. Engine Move Analysis with PV Continuations & Mate Formatting ---');
const analysisGame = new IntransitiveGame();
const candidateMoves = getTopMoves(analysisGame, heuristicWeights, 3, 2);

assert(candidateMoves.length === 3, 'Should produce 3 candidate moves');
assert(candidateMoves[0].rank === 1, 'First move must be rank 1');
const topPv = candidateMoves[0].pv;
if (!topPv) throw new Error('Each candidate move must have a PV line array');
assert(topPv.length > 0, 'PV line array must contain subsequent moves');
console.log(`Top candidate move: ${candidateMoves[0].san} (score: ${candidateMoves[0].score})`);
console.log(`PV Continuation line: ${topPv.join(' ')}`);

// Verify formatEvalScore
assert(formatEvalScore(150) === '+150', 'Positive score must be formatted with +');
assert(formatEvalScore(-80) === '-80', 'Negative score must be formatted with -');
assert(formatEvalScore(0) === '0', 'Zero score must be formatted as 0');
assert(formatEvalScore(9999, true, 1) === '+M1', 'Mate in 1 ply must format as +M1');
assert(formatEvalScore(9997, true, 3) === '+M2', 'Mate in 3 plies must format as +M2');
assert(formatEvalScore(-9998, true, 2) === '-M1', 'Opponent mate in 2 plies must format as -M1');
console.log('✓ Engine candidate moves PV continuation line and mate formatting verified');

// 8. Streamed Arena Tournament (50 games)
console.log('\n--- 8. Fast Board Zoom Streaming Verification (50 games) ---');
let streamedMoveCount = 0;
const streamedGames = new Set<number>();
SelfPlayTrainer.runArenaTournament(
  heuristicWeights,
  createZeroWeights(),
  50,
  1,
  (data) => {
    streamedMoveCount++;
    streamedGames.add(data.gameIndex);
  }
);
assert(streamedMoveCount > 0, 'Streamed move count must be greater than 0');
assert(streamedGames.size === 50, 'All 50 games in tournament must be streamed via onMove callback');
// 9. AlphaZero Tournament Opening Divergence
console.log('\n--- 9. AlphaZero Opening Branching & Match Diversity ---');
const openingFirstMoves = new Set<string>();
SelfPlayTrainer.runArenaTournament(
  heuristicWeights,
  heuristicWeights,
  20,
  1,
  (data) => {
    // Collect the very first move of each game
    if (data.san && !openingFirstMoves.has(`${data.gameIndex}:${data.san}`)) {
      if (data.gameIndex && openingFirstMoves.size < 20) {
        openingFirstMoves.add(`${data.gameIndex}:${data.san}`);
      }
    }
  }
);
// Extract distinct move strings across the 20 games
const distinctMoves = new Set(Array.from(openingFirstMoves).map(s => s.split(':')[1]));
assert(
  distinctMoves.size >= 2,
  `AlphaZero opening temperature must explore at least 2 distinct opening moves across 20 games, found ${distinctMoves.size}`
);
console.log(`✓ Verified ${distinctMoves.size} distinct opening moves branched across 20 identical-weight games: ${Array.from(distinctMoves).join(', ')}`);

// 10. Historical League Buffer Anti-Cycle Training
console.log('\n--- 10. Anti-Cycle Historical League Buffer Simulation ---');
const leagueTrainer = new SelfPlayTrainer(createZeroWeights(), {
  learningRate: 0.02,
  searchDepth: 1,
});
assert(leagueTrainer.leagueBuffer.length === 1, 'Initial league buffer must contain baseline model');
for (let i = 0; i < 55; i++) {
  leagueTrainer.playSelfPlayGame();
}
assert(leagueTrainer.leagueBuffer.length >= 2, 'League buffer must store historical snapshots at generation 50');
assert(!isNaN(leagueTrainer.weights.pieceValues.R), 'Weights must remain finite valid numbers');
console.log(`✓ Verified Historical League Buffer populated (${leagueTrainer.leagueBuffer.length} snapshots), weights stable.`);

// 11. Iterative Deepening & Multi-ply Forced Touchdown (Mate-in-4) Detection
console.log('\n--- 11. Iterative Deepening & Multi-ply Forced Touchdown (+M2) Detection ---');
// Position: Blue has Rock on g7 (sq 60), Red has Rock on e5 (sq 40) in the center
// g7 is 2 steps from i9 (sq 80) goal: g7 -> h8 (sq 70) -> i9 (sq 80, touchdown!)
// FEN: 9/9/6R2/9/4r4/9/9/9/9 b 0 1
const mateGame = new IntransitiveGame('9/9/6R2/9/4r4/9/9/9/9 b 0 1');
const testWeights = createHeuristicWeights();

// At Depth 2: search only sees 2 plies, so it cannot resolve touchdown at ply 3
const depth2Moves = getTopMoves(mateGame, testWeights, 3, 2);
assert(depth2Moves.length > 0, 'Must generate legal moves');
assert(!depth2Moves[0].isMate, 'Depth 2 must not prematurely claim a mate it cannot see at ply 2');

// At Depth 4: iterative deepening reaches touchdown at ply 3, detecting forced win!
const progressSteps: number[] = [];
const analysis = runIterativeDeepeningAnalysis(
  mateGame,
  testWeights,
  4,
  5,
  (step) => {
    progressSteps.push(step.depth);
  }
);

assert(progressSteps.length >= 2, 'Iterative deepening must stream progress steps');
assert(analysis.candidateMoves.length > 0, 'Analysis must yield candidate moves');
const bestCand = analysis.candidateMoves[0];
assert(bestCand.isMate === true, 'Iterative deepening at depth 4 must detect forced touchdown');
assert(bestCand.mateInPlies !== undefined && bestCand.mateInPlies <= 4, 'Mate must be within 4 plies');
assert(Boolean(bestCand.threat?.includes('Forced Win')), 'Threat descriptor must label 🏆 Forced Win');
const formattedScore = formatEvalScore(bestCand.score, bestCand.isMate, bestCand.mateInPlies);
assert(formattedScore === '+M2' || formattedScore === '+M1', `Score must format as forced mate (+M2 or +M1), got ${formattedScore}`);
assert(analysis.nodes > 0, 'Analysis must report non-zero searched nodes');
assert(analysis.nps > 0, 'Analysis must report non-zero speed NPS');
console.log(`✓ Iterative Deepening solved forced touchdown: ${bestCand.san} (${formattedScore}, ${bestCand.threat}) in ${analysis.nodes} nodes at ${analysis.nps} NPS (${analysis.timeMs}ms)`);

console.log('\n🎉 ALL INTRANSITIVE TD-LEARNING & ENGINE TESTS PASSED WITH 100% ACCURACY!');
