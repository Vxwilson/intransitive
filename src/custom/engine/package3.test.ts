/**
 * Package 3 - linear TD self-play correctness and reproducibility checks.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import { createSeededRng } from '../harness/harness';
import { createHeuristicWeights, createZeroWeights } from './evaluator';
import { getCheckpointDisplayName, PRESET_CHECKPOINTS } from './checkpoint';
import {
  SelfPlayTrainer,
  signedTerminalReward,
} from './trainer';
import { generateSelfPlayGame } from './selfPlay';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Package 3 assertion failed: ${message}`);
}

function assertThrows(action: () => void, message: string): void {
  let didThrow = false;
  try {
    action();
  } catch {
    didThrow = true;
  }
  assert(didThrow, message);
}

function weightsSnapshot(trainer: SelfPlayTrainer): string {
  return JSON.stringify(trainer.weights);
}

console.log('🧪 Starting Package 3 linear TD self-play verification...');

const blueWin = new IntransitiveGame('8R/9/9/9/9/9/9/9/9 b 0 1');
const redWin = new IntransitiveGame('9/9/9/9/4R4/9/9/9/r8 b 0 1');
assert(blueWin.isTerminal().winner === PLAYER_BLUE, 'Blue touchdown fixture must be terminal');
assert(redWin.isTerminal().winner === PLAYER_RED, 'Red touchdown fixture must be terminal');
assert(signedTerminalReward(blueWin.isTerminal()) === 1000, 'Blue terminal reward must be +1000');
assert(signedTerminalReward(redWin.isTerminal()) === -1000, 'Red terminal reward must be -1000');
assert(signedTerminalReward({ isOver: true, winner: 'draw', reason: '50-move' }) === 0, 'Draw terminal reward must be zero');
console.log('✓ Terminal reward signs are consistently Blue-relative');

const bundledMaster = PRESET_CHECKPOINTS.find((checkpoint) => checkpoint.id === 'preset-master');
assert(bundledMaster !== undefined, 'Bundled linear Master checkpoint must exist');
assert(bundledMaster.name.includes('TD-Leaf'), 'Bundled checkpoint payload/name must remain unchanged');
assert(getCheckpointDisplayName(bundledMaster).includes('Linear TD'), 'Legacy linear checkpoint labels must use the Package 3 name in the UI');
console.log('✓ Legacy linear checkpoint payloads stay intact while UI labels use Linear TD self-play');

const drawTrainer = new SelfPlayTrainer(createZeroWeights(), { maxPliesPerGame: 0 });
const drawRecord = drawTrainer.playSelfPlayGame('9/9/9/9/4R4/9/9/3rP4/9 b 100 1');
assert(drawRecord.isTerminal && !drawRecord.isTruncated, '50-move position must be a terminal game');
assert(drawRecord.winner === 'draw' && drawRecord.reason === '50-move', 'Unequal-material 50-move game must remain a draw');
assert(drawRecord.terminalReward === 0, 'Unequal-material draw must receive zero reward');
assert(drawTrainer.stats.draws === 1 && drawTrainer.stats.blueWins === 0 && drawTrainer.stats.redWins === 0, 'Draw must increment only draw counters');
assert(drawTrainer.stats.terminalGames === 1 && drawTrainer.stats.truncatedGames === 0, 'Draw must increment terminal, not truncation, counters');
console.log('✓ Rule-defined draw is counted as a draw with zero terminal reward');

const truncatedTrainer = new SelfPlayTrainer(createZeroWeights(), { maxPliesPerGame: 0 });
const beforeTruncation = weightsSnapshot(truncatedTrainer);
const truncatedRecord = truncatedTrainer.playSelfPlayGame();
assert(truncatedRecord.isTruncated && !truncatedRecord.isTerminal, 'Safety cap must produce an explicit truncation');
assert(truncatedRecord.winner === null && truncatedRecord.reason === 'max-plies', 'Truncation must not invent a draw or winner');
assert(truncatedRecord.terminalReward === 0, 'Truncation must have zero reward');
assert(truncatedTrainer.stats.truncatedGames === 1 && truncatedTrainer.stats.draws === 0, 'Truncation must increment only truncation counters');
assert(weightsSnapshot(truncatedTrainer) === beforeTruncation, 'Truncated game must skip the entire TD update');
console.log('✓ Safety-cap games are separate from terminal games and receive no TD update');

function seededRun() {
  const trainer = new SelfPlayTrainer(
    createZeroWeights(),
    { searchDepth: 1, maxPliesPerGame: 3 },
    {
      rng: createSeededRng(20260917),
      learnerColorPolicy: 'alternate',
      opponentPolicy: 'fixed',
      opponentWeights: createHeuristicWeights(),
      opponentId: 'heuristic-baseline',
    }
  );
  const records = [trainer.playSelfPlayGame(), trainer.playSelfPlayGame()];
  return { trainer, records };
}

const firstRun = seededRun();
const secondRun = seededRun();
assert(firstRun.records[0].learnerColor === 'blue' && firstRun.records[1].learnerColor === 'red', 'Learner color must alternate Blue then Red');
assert(firstRun.records.every((record) => record.opponentId === 'heuristic-baseline'), 'Configured opponent version must be recorded');
assert(firstRun.trainer.stats.learnerBlueGames === 1 && firstRun.trainer.stats.learnerRedGames === 1, 'Learner color counters must be recorded');
assert(JSON.stringify(firstRun.records) === JSON.stringify(secondRun.records), 'Seeded training records must reproduce exactly');
assert(weightsSnapshot(firstRun.trainer) === weightsSnapshot(secondRun.trainer), 'Seeded training weights must reproduce exactly');
assert(Number.isFinite(firstRun.trainer.weights.pieceValues.R), 'Seeded training weights must remain finite');
console.log('✓ Seeded opponent/exploration choices and alternating learner colors reproduce');

const pureTrainer = new SelfPlayTrainer(
  createZeroWeights(),
  { searchDepth: 1, maxPliesPerGame: 3 },
  {
    opponentPolicy: 'fixed',
    opponentWeights: createHeuristicWeights(),
    opponentId: 'heuristic-baseline',
    runId: 'pure-generation-test',
    runSeed: 17,
  }
);
const weightsBeforePureGeneration = JSON.stringify(pureTrainer.weights);
const statsBeforePureGeneration = JSON.stringify(pureTrainer.stats);
const pureJob = pureTrainer.createSelfPlayGameJob();
const pureJobWeights = JSON.stringify(pureJob.learner.weights);
const pureResultA = generateSelfPlayGame(pureJob);
const pureResultB = generateSelfPlayGame(pureJob);
assert(JSON.stringify(pureResultA.moves) === JSON.stringify(pureResultB.moves), 'A job must replay identical moves from its seed');
assert(JSON.stringify(pureResultA.trajectory) === JSON.stringify(pureResultB.trajectory), 'A job must replay identical trajectory features');
assert(JSON.stringify(pureResultA.outcome) === JSON.stringify(pureResultB.outcome), 'A job must replay identical outcome');
assert(pureResultA.seed === pureJob.seed, 'Result must retain the dispatched per-game seed');
assert(pureResultA.telemetry.searchNodes === pureResultB.telemetry.searchNodes, 'Deterministic search nodes must reproduce');
assert(JSON.stringify(pureJob.learner.weights) === pureJobWeights, 'Generation must not mutate learner snapshots');
assert(JSON.stringify(pureTrainer.weights) === weightsBeforePureGeneration, 'Generation must not mutate canonical weights');
assert(JSON.stringify(pureTrainer.stats) === statsBeforePureGeneration, 'Generation must not mutate coordinator statistics');
console.log('✓ Pure seeded job generation is reproducible and does not mutate coordinator state');

const commitTrainer = new SelfPlayTrainer(
  createZeroWeights(),
  { searchDepth: 1, maxPliesPerGame: 0 },
  {
    opponentPolicy: 'fixed',
    opponentWeights: createHeuristicWeights(),
    opponentId: 'heuristic-baseline',
    runId: 'ordered-commit-test',
    runSeed: 19,
  }
);
const job0 = commitTrainer.createSelfPlayGameJob(undefined, { batchId: 4, gameId: 0 });
const job1 = commitTrainer.createSelfPlayGameJob(undefined, { batchId: 4, gameId: 1 });
assert(job0.seed !== job1.seed, 'Independent game IDs must receive independent seeds');
const result0 = generateSelfPlayGame(job0);
const result1 = generateSelfPlayGame(job1);
assertThrows(() => commitTrainer.applySelfPlayGameResult(result1), 'Out-of-order results must be rejected');
commitTrainer.applySelfPlayGameResult(result0);
commitTrainer.applySelfPlayGameResult(result1);
assert(commitTrainer.stats.gamesPlayed === 2, 'Ordered results must both commit exactly once');
assert(commitTrainer.stats.truncatedGames === 2, 'Truncated results must remain separate from draws');
assertThrows(() => commitTrainer.applySelfPlayGameResult(result1), 'Duplicate results must be rejected');
console.log('✓ Coordinator commits results exactly once and rejects stale completion order');

const openingGame = new IntransitiveGame();
const openingMove = openingGame.generateLegalMoves()[0];
assert(openingMove !== undefined, 'Initial position must have a legal opening move');
const openingTrainer = new SelfPlayTrainer(
  createZeroWeights(),
  { searchDepth: 1, maxPliesPerGame: 2 },
  {
    opponentPolicy: 'fixed',
    opponentWeights: createHeuristicWeights(),
    opponentId: 'heuristic-baseline',
    runId: 'opening-history-test',
    runSeed: 23,
  }
);
const openingJob = openingTrainer.createSelfPlayGameJob(undefined, {
  opening: {
    history: { startFen: openingGame.toFEN(), moves: [openingMove] },
    identity: 'test-opening',
  },
});
const openingResult = generateSelfPlayGame(openingJob);
assert(openingResult.moves[0].from === openingMove.from && openingResult.moves[0].to === openingMove.to, 'Opening jobs must replay supplied history');
assert(openingResult.telemetry.generatedMoves === 1, 'Opening plies must count toward the total safety cap');
console.log('✓ Optional training openings replay history while default jobs retain the initial position');

console.log('✅ Package 3 linear TD self-play verification passed.');
