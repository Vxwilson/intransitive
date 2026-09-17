/** Focused regression and comparison tests for Package 2 root search. */

import { IntransitiveGame } from '../core/game';
import {
  createHeuristicWeights,
  createZeroWeights,
} from './evaluator';
import {
  createSearchContext,
  evaluateAny,
  getTopMoves,
  orderMovesTactically,
  selectMove,
} from './search';
import { runReferenceSearch, snapshotGame } from '../harness/referenceMinimax';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function sameMove(a: { from: number; to: number; piece: string; captured?: string }, b: typeof a): boolean {
  return a.from === b.from && a.to === b.to && a.piece === b.piece && a.captured === b.captured;
}

function replayPV(fen: string, pv: ReturnType<typeof selectMove>['pv']): void {
  const game = new IntransitiveGame(fen);
  for (const requested of pv) {
    const legal = game.generateLegalMoves().find((move) => sameMove(move, requested));
    assert(Boolean(legal), 'search PV must contain only legal moves');
    assert(game.makeMove(legal!), 'search PV must replay successfully');
  }
}

function compareGreedyAndFull(fen: string, depth: number): void {
  const weights = createHeuristicWeights();
  const greedyGame = new IntransitiveGame(fen);
  const beforeGreedy = snapshotGame(greedyGame);
  const greedy = selectMove(greedyGame, weights, {
    depth,
    temperature: 0,
    rootNoise: 0,
    openingPlies: 0,
  });
  assert(snapshotGame(greedyGame) === beforeGreedy, 'greedy root search must restore the complete position');
  assert(greedy.bestMove !== null, 'greedy root search must return a legal move');
  replayPV(fen, greedy.pv);

  const fullGame = new IntransitiveGame(fen);
  const beforeFull = snapshotGame(fullGame);
  const fullContext = createSearchContext();
  const full = getTopMoves(fullGame, weights, 100, depth, fullContext);
  assert(snapshotGame(fullGame) === beforeFull, 'full-window root search must restore the complete position');
  assert(full.length > 0, 'full-window root search must return candidates');
  assert(greedy.score === full[0].score, 'greedy and full-window root scores must agree');
  assert(
    full.some((candidate) => sameMove(candidate.move, greedy.bestMove!) && candidate.score === greedy.score),
    'greedy move must be one of the exact full-window best-score alternatives'
  );
  assert(greedy.nodes <= fullContext.nodes, 'shared root bounds must not visit more nodes than full-window scoring');
}

console.log('🧪 Starting Package 2 root-search and truthful-analysis suite...');

compareGreedyAndFull(new IntransitiveGame().toFEN(), 3);
compareGreedyAndFull('9/9/9/9/4pR3/9/9/3S5/9 r 12 9', 3);
console.log('✓ Greedy best-move scores agree with exact full-window scoring for both colors');

const orderingGame = new IntransitiveGame();
const orderingMoves = orderingGame.generateLegalMoves();
const preferred = orderingMoves[orderingMoves.length - 1];
orderMovesTactically(orderingMoves, orderingGame.activePlayer, null, preferred);
assert(sameMove(orderingMoves[0], preferred), 'last completed root move must be ordered before tactical fallbacks');
console.log('✓ Completed root move is preferred before TT/tactical fallback ordering');

const explorationGame = new IntransitiveGame();
const exploration = selectMove(explorationGame, createHeuristicWeights(), {
  depth: 2,
  temperature: 15,
  openingPlies: 8,
  rng: () => 0.999999,
});
assert(exploration.bestMove !== null, 'exploration search must return a legal move');
const exactCandidates = getTopMoves(new IntransitiveGame(), createHeuristicWeights(), 100, 2);
const selectedCandidate = exactCandidates.find((candidate) => sameMove(candidate.move, exploration.bestMove!));
assert(Boolean(selectedCandidate), 'exploration-selected move must be present in exact candidate scores');
assert(exploration.score === selectedCandidate!.score, 'softmax must consume exact full-window scores, not bounds');
console.log('✓ Exploration policy consumes exact candidate scores');

const analysisGame = new IntransitiveGame('9/7P1/9/9/9/9/9/r8/9 b 0 1');
const analysisCandidates = getTopMoves(analysisGame, createZeroWeights(), 100, 2);
const reference = runReferenceSearch(
  new IntransitiveGame('9/7P1/9/9/9/9/9/r8/9 b 0 1'),
  createZeroWeights(),
  { kind: 'depth', value: 2 }
);
for (const candidate of analysisCandidates) {
  const referenceCandidate = reference.candidates.find((item) => sameMove(item.move, candidate.move));
  assert(Boolean(referenceCandidate), 'analysis candidate must be present in the reference root set');
  assert(candidate.score === referenceCandidate!.score, 'MultiPV score must be from the requested completed depth');
  assert(candidate.score !== evaluateAny(analysisGame, createZeroWeights()) || candidate.isMate === true,
    'analysis must not replace a remaining candidate with a static fallback after a mate');
}
console.log('✓ MultiPV candidates retain completed-depth scores and searched lines');

console.log('🎉 Package 2 root-search suite passed.');
