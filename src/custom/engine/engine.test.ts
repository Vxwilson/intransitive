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
  getTopMoves,
  formatEvalScore,
  runIterativeDeepeningAnalysis,
  selectMove,
  findUnstoppableRunway,
} from './search';
import { algebraicToSquare, squareToAlgebraic, BLUE_GOAL_SQUARE, RED_GOAL_SQUARE } from '../core/constants';
import { PLAYER_BLUE } from '../core/types';
import {
  PRESET_CHECKPOINTS,
  saveCheckpoint,
  renameCheckpoint,
  getStoredCheckpoints,
  exportCheckpointsJSON,
  importCheckpointsJSON,
} from './checkpoint';

function assert(condition: boolean, message: string): asserts condition {
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
assert(zeroWeights.runnerWeight === 0, 'Initial runner weight must be 0.0');
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
assert(features.runnerAdvantage === 0, 'Initial runner advantage must be 0 due to rotational symmetry');
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
      runnerAdvantage: 1,
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
      runnerAdvantage: 6,
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
assert((weights.runnerWeight ?? 0) > 0, `Runner weight should increase, got ${weights.runnerWeight}`);
assert(weights.threatBonus > 0, `Threat bonus should increase, got ${weights.threatBonus}`);
console.log(
  `✓ TD updates verified: Paper=${weights.pieceValues.P.toFixed(2)}, GoalDist=${weights.goalDistanceWeight.toFixed(2)}, Runner=${(weights.runnerWeight ?? 0).toFixed(2)}, Threat=${weights.threatBonus.toFixed(2)}`
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

const renameOk = renameCheckpoint(saved.id, 'Renamed Master Model');
assert(renameOk === true, 'Renaming custom checkpoint must succeed');
assert(renameCheckpoint('preset-gen-0', 'Illegal Name') === false, 'Cannot rename built-in preset');

const allStored = getStoredCheckpoints();
assert(allStored.some((c) => c.id === saved.id && c.name === 'Renamed Master Model'), 'Renamed checkpoint must persist in storage');

const exported = exportCheckpointsJSON();
assert(exported.includes('Renamed Master Model'), 'Exported JSON must contain renamed checkpoint');

const imported = importCheckpointsJSON(exported);
assert(imported === true, 'JSON import must succeed');
console.log('✓ Checkpoint saving, renaming, loading, and JSON export/import verified');

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
// 9. Competitive arena greedy policy
console.log('\n--- 9. Competitive Arena Greedy Policy ---');
const openingFirstMoves = new Set<string>();
const openingGames = new Set<number>();
SelfPlayTrainer.runArenaTournament(
  heuristicWeights,
  heuristicWeights,
  20,
  1,
  (data) => {
    if (data.san && data.gameIndex && !openingGames.has(data.gameIndex)) {
      openingGames.add(data.gameIndex);
      openingFirstMoves.add(data.san);
    }
  }
);
assert(
  openingGames.size === 20,
  `All 20 arena openings must be observed, found ${openingGames.size}`
);
assert(openingFirstMoves.size === 1, `Greedy arena must use one opening for identical weights, found ${openingFirstMoves.size}`);
console.log(`✓ Verified deterministic greedy arena opening: ${Array.from(openingFirstMoves)[0]}`);

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

// Correctness-first search does not treat the runway detector as a proof
// shortcut. A normal search needs enough plies to see the touchdown.
const depth2Moves = getTopMoves(mateGame, testWeights, 3, 2);
assert(depth2Moves.length > 0, 'Must generate legal moves');
assert(depth2Moves[0].san === 'Rg7-h8', 'Best move must advance along the runway to h8');

const depth3Moves = getTopMoves(mateGame, testWeights, 3, 3);
assert(depth3Moves[0].isMate === true, 'Ordinary depth-3 search must solve the short runner win');

// At Depth 4: iterative deepening retains the searched touchdown PV.
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
// 12. Tactical Awareness & Unstoppable Runner Regression Test (Image 2 Position)
console.log('\n--- 12. Tactical Awareness & Unstoppable Runner Regression (Image 2 Position) ---');
// Position from user playtest: Blue has Paper on g7 (2 steps from i9, no red scissors can intercept)
const image2Game = new IntransitiveGame('4S4/1r7/s1s3P2/4R1p2/1R4rp1/9/3P5/3p5/4P4 b 17 9');
const image2Weights = createHeuristicWeights();

// Depth 1 check: Evaluator must immediately prefer Pg7-h8
const d1Image2Moves = getTopMoves(image2Game, image2Weights, 3, 1);
assert(d1Image2Moves.length > 0, 'Must have legal moves at Depth 1');
assert(d1Image2Moves[0].san === 'Pg7-h8', `Depth 1 must choose unstoppable runner Pg7-h8 as #1, got ${d1Image2Moves[0].san}`);
assert(d1Image2Moves[0].score > 200, `Depth 1 score for Pg7-h8 must reflect decisive runner threat (> 200), got ${d1Image2Moves[0].score}`);

// Depth 2 check: Horizon protection must keep Pg7-h8 as #1 (avoiding the -276 counter-threat trap)
const d2Image2Moves = getTopMoves(image2Game, image2Weights, 3, 2);
assert(d2Image2Moves[0].san === 'Pg7-h8', `Depth 2 must choose Pg7-h8 as #1 without falling into horizon trap, got ${d2Image2Moves[0].san}`);
assert(d2Image2Moves[0].score > 50, `Depth 2 score for Pg7-h8 must remain decisive (> 50), got ${d2Image2Moves[0].score}`);

// Depth 3 check: Must find forced win (+M2 / +9997)
const d3Image2Moves = getTopMoves(image2Game, image2Weights, 3, 3);
assert(d3Image2Moves[0].san === 'Pg7-h8', `Depth 3 must choose Pg7-h8 as #1, got ${d3Image2Moves[0].san}`);
assert(d3Image2Moves[0].isMate === true, `Depth 3 must detect forced win for Pg7-h8`);
console.log(`✓ Image 2 regression verified: Pg7-h8 selected at D1 (${d1Image2Moves[0].score} cp), D2 (${d2Image2Moves[0].score} cp), and D3 (${d3Image2Moves[0].score} cp, forced win!)`);

// 12. Asymmetric Search Depth Tournament Verification
console.log('\n--- 12. Independent Dual Fighter Search Depth Tournament ---');
const asymmResult = SelfPlayTrainer.runArenaTournament(
  heuristicWeights, // Fighter A: Depth 2
  heuristicWeights, // Fighter B: Depth 1
  10,
  2, // searchDepthA
  1  // searchDepthB
);
assert(asymmResult.gamesPlayed === 10, 'Must complete 10 games');
assert(asymmResult.winsA + asymmResult.winsB + asymmResult.draws === 10, 'Wins + draws must equal total games');
console.log(`✓ Asymmetric Depth Tournament verified (D2 vs D1): D2 wins ${asymmResult.winsA}, D1 wins ${asymmResult.winsB}, draws ${asymmResult.draws}`);

// 13. Rule-correct repetition draw scoring
console.log('\n--- 13. Rule-correct repetition draw scoring ---');
const contemptGame = new IntransitiveGame();
const b4 = algebraicToSquare('b4');
const a4 = algebraicToSquare('a4');
const h6 = algebraicToSquare('h6');
const i6 = algebraicToSquare('i6');
const blueFwd = { from: b4, to: a4, piece: 'R' as const };
const blueBck = { from: a4, to: b4, piece: 'R' as const };
const redFwd = { from: h6, to: i6, piece: 'R' as const };
const redBck = { from: i6, to: h6, piece: 'R' as const };

// Reach the position immediately before the third occurrence of S0.
contemptGame.makeMove(blueFwd);
contemptGame.makeMove(redFwd);
contemptGame.makeMove(blueBck);
contemptGame.makeMove(redBck);
contemptGame.makeMove(blueFwd);
contemptGame.makeMove(redFwd);
contemptGame.makeMove(blueBck);
const repetitionCandidates = getTopMoves(contemptGame, heuristicWeights, 20, 1);
const repetitionDraw = repetitionCandidates.find((candidate) => candidate.move.from === i6 && candidate.move.to === h6);
assert(repetitionDraw !== undefined, 'The third-occurrence move must be a legal candidate');
assert(repetitionDraw.score === 0, `A genuine repetition draw must score zero, got ${repetitionDraw.score}`);
console.log('✓ Genuine repetition draws score zero; no draw contempt or twofold penalty is applied');

// 14. Defending Goal Entry Verification (Legal Goal Defense)
console.log('\n--- 14. Defending Goal Entry Verification (Legal Goal Defense) ---');
// Blue has a Paper on b1 (adjacent to a1). Red has a piece on i9 so game is non-terminal. Red's goal is a1.
const squatGame = new IntransitiveGame('8r/9/9/9/9/9/9/9/1P7 b 0 1');
const b1 = algebraicToSquare('b1');
const a1 = RED_GOAL_SQUARE;
const blueMoves = squatGame.generateLegalMoves();
const blueMoveToA1 = blueMoves.find((m) => m.from === b1 && m.to === a1);
assert(blueMoveToA1 !== undefined, 'Blue piece MUST be allowed to enter own defending goal (a1)');

// Red has a Paper on h9 (adjacent to i9). Blue has a piece on a1. Blue's goal is i9.
const redSquatGame = new IntransitiveGame('7p1/9/9/9/9/9/9/9/R8 r 0 1');
const h9 = algebraicToSquare('h9');
const i9 = BLUE_GOAL_SQUARE;
const redMoves = redSquatGame.generateLegalMoves();
const redMoveToI9 = redMoves.find((m) => m.from === h9 && m.to === i9);
assert(redMoveToI9 !== undefined, 'Red piece MUST be allowed to enter own defending goal (i9)');
console.log('✓ Defending goal entry verified: players can legally move into their own home goal squares');

// 15. Arbitrary-Distance Runway Detection & Blunder Prevention (User Screenshot Position)
console.log('\n--- 15. Arbitrary-Distance Runway Detection & Blunder Prevention (User Position) ---');
// Reconstruct position based on user scenario:
// Blue Paper at f5, Red Paper at g6 blocking the diagonal highway to i9 (goal).
const blunderGameFEN = '3p5/5r3/4s4/2s2rpr1/1PS1SP3/1RPR3R1/9/4P4/9 r 0 1';
const blunderGame = new IntransitiveGame(blunderGameFEN);
const g6Sq = algebraicToSquare('g6');
const g5Sq = algebraicToSquare('g5');

// 1. Before Red moves: g6 is blocked by Red Paper. Blue must NOT have a runway.
const runwayBefore = findUnstoppableRunway(blunderGame, PLAYER_BLUE, false);
assert(runwayBefore === null, 'Blue should have no unstoppable runway while g6 is occupied by Red Paper');

// 2. Red Move Selection: Red must recognize that Pg6-g5 opens an unstoppable corridor for Blue, and VETO it!
const redMoveDecision = selectMove(blunderGame, heuristicWeights, { depth: 1, temperature: 0.0 });
assert(
  redMoveDecision.bestMove !== null &&
    !(redMoveDecision.bestMove.from === g6Sq && redMoveDecision.bestMove.to === g5Sq),
  `Red must veto fatal blunder Pg6-g5, chose ${redMoveDecision.bestMove?.from}->${redMoveDecision.bestMove?.to}`
);
console.log('✓ Red engine successfully identified Pg6-g5 as a fatal blunder and vetoed it even at Depth 1');

// 3. What if Red did blunder Pg6-g5?
blunderGame.makeMove({ from: g6Sq, to: g5Sq, piece: 'P' });
// Now it is Blue's turn to move.
const runwayAfter = findUnstoppableRunway(blunderGame, PLAYER_BLUE, true);
assert(runwayAfter !== null, 'Blue must have an unstoppable runway after g6 is vacated');
assert(runwayAfter.distance === 4, `Runway distance must be 4 steps (f5->g6->h7->i8->i9), got ${runwayAfter.distance}`);
assert(runwayAfter.pliesToWin === 7, `Runway pliesToWin must be 7 (4 moves), got ${runwayAfter.pliesToWin}`);
const algebraicPath = runwayAfter.path.map(squareToAlgebraic).join(' -> ');
assert(
  algebraicPath === 'f5 -> g6 -> h7 -> i8 -> i9',
  `Runway path must be f5 -> g6 -> h7 -> i8 -> i9, got ${algebraicPath}`
);
console.log(`✓ Blue unstoppable 4-move highway mathematically detected: ${algebraicPath} (7 plies to touchdown)`);

// 4. Production search must not publish the runway detector as an exact
// result. The detector remains available as a diagnostic helper.
const blueMoveDecision = selectMove(blunderGame, heuristicWeights, { depth: 1, temperature: 0.0 });
assert(blueMoveDecision.bestMove !== null, 'Blue must select a move');
assert(
  blunderGame.generateLegalMoves().some((move) =>
    move.from === blueMoveDecision.bestMove?.from && move.to === blueMoveDecision.bestMove?.to
  ),
  'Production search must return a legal move without relying on runway proof'
);
assert(
  blueMoveDecision.score < 9900,
  `Unsearched long runway must not be labeled as an exact win, got ${blueMoveDecision.score}`
);
const blueFormatted = formatEvalScore(blueMoveDecision.score);
console.log(`✓ Long runway remains a non-terminal depth-1 evaluation (${blueFormatted}) at production search depth 1`);

console.log('\n🎉 ALL INTRANSITIVE TD-LEARNING & ENGINE TESTS PASSED WITH 100% ACCURACY!');
