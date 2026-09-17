import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE } from '../core/types';
import { createHeuristicWeights, createZeroWeights } from '../engine/evaluator';
import { INTRANSITIVE_FIXTURES, loadFixture } from './fixtures';
import {
  createSeededRng,
  runPairedMatch,
  runSearchBenchmark,
  searchPosition,
} from './harness';
import { runReferenceSearch, snapshotGame } from './referenceMinimax';
import type { MatchGameLog } from './types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Harness assertion failed: ${message}`);
}

function withoutTiming(report: { games?: MatchGameLog[] }) {
  return report.games?.map((game) => ({
    ...game,
    elapsedMs: 0,
    moves: game.moves.map((move) => ({ ...move, elapsedMs: 0 })),
  }));
}

console.log('🧪 Starting Package 0 reproducible harness verification...');

assert(INTRANSITIVE_FIXTURES.length >= 12, 'fixture suite should contain at least 12 positions');
for (const fixture of INTRANSITIVE_FIXTURES) {
  const game = loadFixture(fixture);
  assert(game.toFEN() === fixture.fen, `${fixture.id} must replay to its checked-in FEN`);
}
assert(loadFixture(INTRANSITIVE_FIXTURES.find((fixture) => fixture.id === 'repetition-threefold')!).getRepetitionCount() === 3, 'history fixture must restore threefold count');
console.log(`✓ Loaded and validated ${INTRANSITIVE_FIXTURES.length} fixtures, including replayed history`);

const referenceGame = loadFixture(INTRANSITIVE_FIXTURES.find((fixture) => fixture.id === 'developed-center')!);
const beforeReference = snapshotGame(referenceGame);
const referenceResult = runReferenceSearch(referenceGame, createHeuristicWeights(), { kind: 'depth', value: 2 });
assert(referenceResult.completedDepth === 2, 'reference depth search must report completed depth');
assert(referenceResult.nodes > 0, 'reference depth search must count nodes');
assert(snapshotGame(referenceGame) === beforeReference, 'reference search must restore complete game state');

const abortGame = loadFixture(INTRANSITIVE_FIXTURES.find((fixture) => fixture.id === 'developed-center')!);
const beforeAbort = snapshotGame(abortGame);
const aborted = runReferenceSearch(abortGame, createZeroWeights(), { kind: 'nodes', value: 1 }, 4);
assert(aborted.stopped, 'node-limited reference search must report a stop');
assert(snapshotGame(abortGame) === beforeAbort, 'aborted reference search must restore complete game state');
console.log('✓ Reference minimax restores board, clocks, hash, counts, and repetition map after search and abort');

const unequalMaterialDraw = new IntransitiveGame('9/9/9/9/4R4/9/9/3rP4/9 b 0 1');
const cycle = [
  { from: 40, to: 39, piece: 'R' as const },
  { from: 12, to: 11, piece: 'R' as const },
  { from: 39, to: 40, piece: 'R' as const },
  { from: 11, to: 12, piece: 'R' as const },
  { from: 40, to: 39, piece: 'R' as const },
  { from: 12, to: 11, piece: 'R' as const },
  { from: 39, to: 40, piece: 'R' as const },
  { from: 11, to: 12, piece: 'R' as const },
];
for (const move of cycle) unequalMaterialDraw.makeMove(move);
assert(unequalMaterialDraw.isTerminal().winner === 'draw', 'threefold repetition should be a real draw');
assert(runReferenceSearch(unequalMaterialDraw, createHeuristicWeights(), { kind: 'depth', value: 2 }).score === 0, 'terminal draws must score zero despite unequal material');
console.log('✓ Terminal draw oracle returns zero without material adjudication');

const forcedWin = loadFixture(INTRANSITIVE_FIXTURES.find((fixture) => fixture.id === 'blue-goal-attack')!);
const forcedWinResult = runReferenceSearch(forcedWin, createZeroWeights(), { kind: 'depth', value: 1 });
assert(forcedWinResult.score === 9999, 'reference search must score an immediate touchdown as a forced win');
assert(forcedWinResult.bestMove !== null && forcedWin.formatMoveSAN(forcedWinResult.bestMove) === 'Ph8-i9#', 'reference search must select the legal immediate touchdown');
console.log('✓ Immediate legal touchdown remains an exact forced-win result');

const randomizedGame = new IntransitiveGame();
const randomizedRng = createSeededRng(4242);
for (let sample = 0; sample < 5; sample++) {
  const reference = searchPosition(randomizedGame, createZeroWeights(), {
    engine: 'reference',
    limit: { kind: 'depth', value: 1 },
    count: 100,
  });
  const production = searchPosition(randomizedGame, createZeroWeights(), {
    engine: 'production',
    limit: { kind: 'depth', value: 1 },
    count: 1,
  });
  assert(reference.score === production.score, `shallow production/reference score mismatch at randomized sample ${sample}`);
  assert(reference.candidates.some((candidate) => candidate.score === reference.score && candidate.san === production.candidates[0]?.san), `production move was not an equal-score reference alternative at randomized sample ${sample}`);
  const legalMoves = randomizedGame.generateLegalMoves();
  const nextMove = legalMoves[Math.floor(randomizedRng() * legalMoves.length)];
  randomizedGame.makeMove(nextMove);
}
console.log('✓ Production and no-shortcut reference searches agree on seeded shallow reachable positions');

const benchmark = runSearchBenchmark({
  fixtures: INTRANSITIVE_FIXTURES.slice(0, 2),
  modelId: 'fixture-test',
  weights: createZeroWeights(),
  engine: 'reference',
  limit: { kind: 'depth', value: 1 },
  warmupRuns: 1,
  measuredRuns: 2,
});
assert(benchmark.overall.medianMs >= 0, 'benchmark must report median latency');
assert(benchmark.overall.p95Ms >= benchmark.overall.medianMs, 'benchmark must report a tail latency');
assert(benchmark.rawSamples.length === 4, 'benchmark must omit warmups from measured samples');
console.log('✓ Benchmark reports warm-up exclusion, repeated samples, nodes, median, and p95 latency');

const deterministicOptions = {
  agentA: {
    modelId: 'zero',
    modelName: 'Zero',
    kind: 'search' as const,
    weights: createZeroWeights(),
    search: { engine: 'production' as const, limit: { kind: 'depth' as const, value: 1 }, count: 1 },
  },
  agentB: {
    modelId: 'heuristic',
    modelName: 'Heuristic',
    kind: 'search' as const,
    weights: createHeuristicWeights(),
    search: { engine: 'production' as const, limit: { kind: 'depth' as const, value: 1 }, count: 1 },
  },
  pairCount: 1,
  seed: 12345,
  openingPlies: 4,
  safetyCap: 20,
};
const firstMatch = runPairedMatch(deterministicOptions);
const secondMatch = runPairedMatch(deterministicOptions);
assert(JSON.stringify(withoutTiming(firstMatch)) === JSON.stringify(withoutTiming(secondMatch)), 'same seed and fixed depth must reproduce logs apart from timing');
assert(Boolean(firstMatch.games?.[0].aIsBlue === true && firstMatch.games?.[1].aIsBlue === false), 'paired games must swap fighter colors');
assert(Boolean(JSON.stringify(firstMatch.games?.[0].moves.slice(0, 4).map((move) => move.move)) === JSON.stringify(firstMatch.games?.[1].moves.slice(0, 4).map((move) => move.move))), 'paired games must replay identical opening moves');
assert(Boolean(firstMatch.games?.[0].modelIds.blue === firstMatch.games?.[1].modelIds.red), 'paired game model assignments must swap');
console.log('✓ Seeded paired games reproduce and replay one opening with assignments swapped');

const randomMatch = runPairedMatch({
  agentA: { modelId: 'random-baseline', modelName: 'Random', kind: 'random' },
  agentB: { modelId: 'random-baseline', modelName: 'Random', kind: 'random' },
  pairCount: 1,
  seed: 7,
  openingPlies: 0,
  safetyCap: 4,
});
assert(randomMatch.truncations === 2 && randomMatch.winsA === 0 && randomMatch.winsB === 0, 'safety-cap games must remain truncations, never invented wins');
assert(Boolean(randomMatch.games?.every((game) => game.outcome === 'truncated' && game.capHit)), 'cap hits must be logged as truncations');
assert(Boolean(randomMatch.games?.every((game) => game.moves.every((move) => move.source === 'random'))), 'random baseline must select legal moves without search');
console.log('✓ Random legal-move baseline and explicit truncation accounting verified');

const redToMove = new IntransitiveGame('9/9/9/9/4pR3/9/9/3S5/9 r 12 9');
assert(redToMove.activePlayer !== PLAYER_BLUE, 'fixture coverage includes Red-to-move positions');
const productionBefore = snapshotGame(redToMove);
searchPosition(redToMove, createHeuristicWeights(), { engine: 'production', limit: { kind: 'depth', value: 1 }, count: 1 });
assert(snapshotGame(redToMove) === productionBefore, 'production benchmark adapter must restore state');
console.log('✓ Production adapter clears per-run TT state and restores the fixture position');

const contaminationGame = loadFixture(INTRANSITIVE_FIXTURES.find((fixture) => fixture.id === 'start')!);
const isolatedZero = searchPosition(contaminationGame, createZeroWeights(), {
  engine: 'production',
  limit: { kind: 'depth', value: 3 },
  count: 1,
});
searchPosition(contaminationGame, createHeuristicWeights(), {
  engine: 'production',
  limit: { kind: 'depth', value: 3 },
  count: 1,
});
const zeroAfterOtherModel = searchPosition(contaminationGame, createZeroWeights(), {
  engine: 'production',
  limit: { kind: 'depth', value: 3 },
  count: 1,
});
assert(isolatedZero.score === zeroAfterOtherModel.score, 'benchmark runs must isolate evaluator scores from other model runs');
assert(isolatedZero.candidates[0]?.san === zeroAfterOtherModel.candidates[0]?.san, 'benchmark runs must isolate selected moves from other model runs');
console.log('✓ Per-run TT clearing prevents cross-model score and move contamination');

console.log('✅ Package 0 harness verification passed.');
