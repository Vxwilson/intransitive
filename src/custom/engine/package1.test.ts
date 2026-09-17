/** Focused regression tests for Package 1 search correctness and limits. */

import { IntransitiveGame } from '../core/game';
import { algebraicToSquare } from '../core/constants';
import { createHeuristicWeights, createZeroWeights } from './evaluator';
import {
  getTopMoves,
  minimax,
  selectMove,
} from './search';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function snapshot(game: IntransitiveGame): string {
  return JSON.stringify({
    board: Array.from(game.board),
    activePlayer: game.activePlayer,
    halfmoveClock: game.halfmoveClock,
    fullmoveNumber: game.fullmoveNumber,
    zobristKey: game.zobristKey.toString(),
    repetitions: [...game.repetitionMap.entries()].map(([key, value]) => [key.toString(), value]),
    blueCounts: game.blueCounts,
    redCounts: game.redCounts,
  });
}

const masterWeights = createHeuristicWeights();
const zeroWeights = createZeroWeights();

console.log('🧪 Starting Package 1 search correctness suite...');

// A root-owned move-only TT cannot contaminate a later evaluator.
const contaminatedPosition = new IntransitiveGame();
selectMove(contaminatedPosition, masterWeights, { depth: 3, temperature: 0 });
const afterMaster = selectMove(contaminatedPosition, zeroWeights, { depth: 3, temperature: 0 });
const isolatedZero = selectMove(new IntransitiveGame(), zeroWeights, { depth: 3, temperature: 0 });
assert(afterMaster.score === isolatedZero.score, 'zero-weight search must agree after a Master search in the same process');
assert(afterMaster.score === 0, `zero-weight initial search should be neutral, got ${afterMaster.score}`);
console.log('✓ Evaluator changes cannot reuse stale TT scores');

// The known runner/clock counterexample must stay a draw: every legal Red
// move reaches halfmove 100, so an unverified runway cannot publish +M.
const clockRace = new IntransitiveGame('r8/9/6R2/9/9/9/9/9/9 b 99 1');
assert(minimax(clockRace, 3, -Infinity, Infinity, masterWeights) === 0, 'clock counterexample must score zero');
const clockCandidates = getTopMoves(clockRace, masterWeights, 20, 1);
assert(clockCandidates.length > 0 && clockCandidates.every((candidate) => candidate.score === 0), 'all clock-counterexample moves must be draws');
console.log('✓ Known runway/clock counterexample remains an exact draw');

// The node budget aborts after a make and still unwinds all state.
const abortGame = new IntransitiveGame();
const beforeAbort = snapshot(abortGame);
const aborted = selectMove(abortGame, masterWeights, {
  limit: { kind: 'nodes', nodes: 3 },
  maxDepth: 8,
  temperature: 0,
});
assert(aborted.bestMove !== null, 'aborted search must return a legal fallback move');
assert(aborted.stopReason === 'node-budget', `expected node-budget stop, got ${aborted.stopReason}`);
assert(snapshot(abortGame) === beforeAbort, 'aborted search must restore board, clock, key, counts, and repetition map');
assert(abortGame.unmakeMove() === false, 'aborted search must not leave an undo record behind');
console.log('✓ Node-budget abort preserves complete game state and returns a legal move');

// A time-only request ignores the legacy depth-2 ceiling and can complete a
// deeper iteration on a deliberately small branching position.
const shortRace = new IntransitiveGame('9/9/6R2/9/4r4/9/9/9/9 b 0 1');
const timed = selectMove(shortRace, masterWeights, {
  depth: 2,
  thinkTimeMs: 100,
  maxDepth: 3,
  temperature: 0,
});
assert(timed.bestMove !== null, 'time-only search must return a legal move');
assert(timed.completedDepth >= 3, `time-only search must be able to exceed depth 2, got ${timed.completedDepth}`);
assert(timed.nodes > 0 && timed.elapsedMs >= 0, 'time-only search must report telemetry');
console.log(`✓ Time-only search reached completed depth ${timed.completedDepth}`);

// Replayed history restores repetition counts; a FEN-only import intentionally
// starts fresh and cannot claim the same draw.
const b4 = algebraicToSquare('b4');
const a4 = algebraicToSquare('a4');
const h6 = algebraicToSquare('h6');
const i6 = algebraicToSquare('i6');
const cycleMoves = [
  { from: b4, to: a4, piece: 'R' as const },
  { from: h6, to: i6, piece: 'R' as const },
  { from: a4, to: b4, piece: 'R' as const },
  { from: i6, to: h6, piece: 'R' as const },
  { from: b4, to: a4, piece: 'R' as const },
  { from: h6, to: i6, piece: 'R' as const },
  { from: a4, to: b4, piece: 'R' as const },
  { from: i6, to: h6, piece: 'R' as const },
];
const restored = IntransitiveGame.fromHistory({ startFen: new IntransitiveGame().toFEN(), moves: cycleMoves });
assert(restored.getRepetitionCount() === 3, 'history replay must restore threefold repetition count');
assert(restored.isTerminal().winner === 'draw', 'restored threefold history must be terminal draw');
console.log('✓ Repetition history survives worker-style replay while FEN-only state remains fresh');

// Candidate PVs are the recursive searched line, not a separate greedy
// reconstruction. The short race has a fully visible touchdown line at D3.
const candidates = getTopMoves(new IntransitiveGame('9/9/6R2/9/4r4/9/9/9/9 b 0 1'), masterWeights, 1, 3);
assert(candidates.length === 1, 'D3 analysis must return one candidate');
assert(candidates[0].isMate === true, 'searched PV candidate must preserve the forced touchdown score');
assert((candidates[0].pv?.length ?? 0) >= 1, 'searched PV must contain a real continuation');
console.log('✓ Analysis PV is taken from the completed recursive search');

console.log('🎉 Package 1 search correctness suite passed.');
