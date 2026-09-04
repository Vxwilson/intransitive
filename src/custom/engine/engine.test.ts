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
const arenaGames = 6;
const arenaResult = SelfPlayTrainer.runArenaTournament(
  heuristicWeights, // Player A (Hand-tuned heuristic)
  createZeroWeights(), // Player B (Untrained zero weights)
  arenaGames,
  1
);

console.log(
  `Arena result (Heuristic Master vs Untrained Gen 0): Heuristic wins ${arenaResult.winsA}/${arenaGames} (${arenaResult.winRateA}%), Gen 0 wins ${arenaResult.winsB}/${arenaGames}`
);
assert(arenaResult.winsA >= arenaResult.winsB, 'Heuristic master should outperform untrained Gen 0 in arena');
console.log('✓ Checkpoint Arena tournament simulation verified');

console.log('\n🎉 ALL INTRANSITIVE TD-LEARNING & ENGINE TESTS PASSED WITH 100% ACCURACY!');
