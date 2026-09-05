/**
 * Intransitive Studio - Post-Game Accuracy & Evaluation Analysis Module
 * Computes ply-by-ply evaluations, Centipawn Loss (CPL), move classifications,
 * Average Centipawn Loss (ACPL), and Lichess-style Accuracy percentages.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move, Player } from '../core/types';
import type { EvaluationWeights } from './types';
import { evaluate } from './evaluator';

export type MoveClassification = 'best' | 'inaccuracy' | 'mistake' | 'blunder';

export interface PlyEvaluation {
  ply: number;            // 1-indexed ply number (0 = initial position)
  turnNumber: number;     // e.g. Turn 1, Turn 2
  player: Player;         // 'blue' | 'red'
  move: Move;
  san: string;
  fen: string;
  evalRaw: number;        // Centipawns (from Blue perspective)
  evalClamped: number;    // Clamped between -1000 and +1000
  evalDisplay: string;    // Formatted display (e.g. "+1.8", "-0.5", "+M1")
  cpl: number;            // Centipawn loss on this move
  classification: MoveClassification;
  phase: 'Opening' | 'Middlegame' | 'Endgame';
}

export interface PlayerAccuracyStats {
  accuracy: number;        // 0 to 100 (%)
  acpl: number;            // Average Centipawn Loss (cp)
  bestMoves: number;
  inaccuracies: number;
  mistakes: number;
  blunders: number;
  totalMoves: number;
}

export interface GameAnalysisResult {
  evalPoints: Array<{
    ply: number;
    eval: number;          // Clamped centipawns
    san?: string;
  }>;
  plies: PlyEvaluation[];
  blueStats: PlayerAccuracyStats;
  redStats: PlayerAccuracyStats;
  turningPoints: PlyEvaluation[]; // Top blunders / turning points in the match
  summary: {
    winner: Player | 'draw' | null;
    reason: string | null;
    totalPlies: number;
    leadChanges: number;
  };
}

export interface HistoryItem {
  move: Move;
  san: string;
  fen: string;
}

/**
 * Maps Average Centipawn Loss (ACPL) to an Accuracy percentage (0..100%)
 * using the standard Lichess win-probability curve.
 */
export function calculateAccuracyFromACPL(acpl: number): number {
  if (acpl <= 0) return 100;
  // Smooth exponential accuracy curve:
  // 0 ACPL -> 100%, 10 ACPL -> 95%, 20 ACPL -> 90%, 50 ACPL -> 78%, 100 ACPL -> 61%, 150 ACPL -> 47%
  const acc = 100 * Math.exp(-0.005 * acpl);
  return Math.round(Math.max(0, Math.min(100, acc)));
}

/**
 * Classifies a move based on centipawn loss.
 */
export function classifyMove(cpl: number): MoveClassification {
  if (cpl <= 20) return 'best';
  if (cpl <= 60) return 'inaccuracy';
  if (cpl <= 150) return 'mistake';
  return 'blunder';
}

/**
 * Analyzes a completed game's moves to produce Lichess-style accuracy metrics
 * and evaluation curve data using the provided evaluation weights.
 */
export function analyzeGameAccuracy(
  moves: HistoryItem[],
  weights: EvaluationWeights,
  winner?: Player | 'draw' | null,
  reason?: string | null
): GameAnalysisResult {
  const plies: PlyEvaluation[] = [];
  const evalPoints: Array<{ ply: number; eval: number; san?: string }> = [];

  // Evaluate initial position (Ply 0)
  const initialGame = new IntransitiveGame();
  const initialEval = evaluate(initialGame, weights);
  const clampedInitial = Math.max(-1000, Math.min(1000, initialEval));
  evalPoints.push({ ply: 0, eval: clampedInitial });

  let prevEval = clampedInitial;
  let blueLossSum = 0;
  let blueMoveCount = 0;
  let redLossSum = 0;
  let redMoveCount = 0;

  let blueBest = 0, blueInacc = 0, blueMistakes = 0, blueBlunders = 0;
  let redBest = 0, redInacc = 0, redMistakes = 0, redBlunders = 0;

  let leadChanges = 0;
  let lastLeadSide: 'blue' | 'red' | 'equal' =
    clampedInitial > 30 ? 'blue' : clampedInitial < -30 ? 'red' : 'equal';

  const N = moves.length;

  for (let i = 0; i < N; i++) {
    const item = moves[i];
    const ply = i + 1;
    const isBlue = i % 2 === 0;
    const player: Player = isBlue ? PLAYER_BLUE : PLAYER_RED;
    const turnNumber = Math.floor(i / 2) + 1;

    // Determine game phase
    let phase: 'Opening' | 'Middlegame' | 'Endgame' = 'Opening';
    if (ply > 24) phase = 'Endgame';
    else if (ply > 8) phase = 'Middlegame';

    // Evaluate position after move
    const g = new IntransitiveGame(item.fen);
    let evalRaw = evaluate(g, weights);

    // If final terminal ply, reflect decisive terminal score
    const isLastPly = i === N - 1;
    if (isLastPly && winner !== undefined && winner !== null) {
      if (winner === PLAYER_BLUE) evalRaw = 10000;
      else if (winner === PLAYER_RED) evalRaw = -10000;
      else if (winner === 'draw') evalRaw = 0;
    }

    const evalClamped = Math.max(-1000, Math.min(1000, evalRaw));

    // Centipawn loss from active player's perspective:
    // CPL = Max(0, Expected_Advantage_Before - Advantage_After)
    let cpl = 0;
    if (isBlue) {
      cpl = Math.max(0, prevEval - evalClamped);
      blueLossSum += cpl;
      blueMoveCount++;
    } else {
      cpl = Math.max(0, evalClamped - prevEval);
      redLossSum += cpl;
      redMoveCount++;
    }

    const classification = classifyMove(cpl);
    if (isBlue) {
      if (classification === 'best') blueBest++;
      else if (classification === 'inaccuracy') blueInacc++;
      else if (classification === 'mistake') blueMistakes++;
      else blueBlunders++;
    } else {
      if (classification === 'best') redBest++;
      else if (classification === 'inaccuracy') redInacc++;
      else if (classification === 'mistake') redMistakes++;
      else redBlunders++;
    }

    // Format display string (e.g. "+2.4", "-1.1")
    let evalDisplay: string;
    if (Math.abs(evalRaw) >= 9000) {
      evalDisplay = evalRaw > 0 ? '+M' : '-M';
    } else {
      const pawnVal = (evalClamped / 100).toFixed(1);
      evalDisplay = evalClamped > 0 ? `+${pawnVal}` : `${pawnVal}`;
    }

    // Track lead changes
    const currentLead: 'blue' | 'red' | 'equal' =
      evalClamped > 50 ? 'blue' : evalClamped < -50 ? 'red' : 'equal';
    if (currentLead !== 'equal' && currentLead !== lastLeadSide && lastLeadSide !== 'equal') {
      leadChanges++;
    }
    if (currentLead !== 'equal') {
      lastLeadSide = currentLead;
    }

    plies.push({
      ply,
      turnNumber,
      player,
      move: item.move,
      san: item.san,
      fen: item.fen,
      evalRaw,
      evalClamped,
      evalDisplay,
      cpl,
      classification,
      phase,
    });

    evalPoints.push({
      ply,
      eval: evalClamped,
      san: item.san,
    });

    prevEval = evalClamped;
  }

  const blueACPL = blueMoveCount > 0 ? Math.round(blueLossSum / blueMoveCount) : 0;
  const redACPL = redMoveCount > 0 ? Math.round(redLossSum / redMoveCount) : 0;

  const blueAccuracy = calculateAccuracyFromACPL(blueACPL);
  const redAccuracy = calculateAccuracyFromACPL(redACPL);

  // Identify top turning points (blunders and big mistakes with highest CPL)
  const turningPoints = [...plies]
    .filter((p) => p.classification === 'blunder' || p.classification === 'mistake')
    .sort((a, b) => b.cpl - a.cpl)
    .slice(0, 5);

  return {
    evalPoints,
    plies,
    blueStats: {
      accuracy: blueAccuracy,
      acpl: blueACPL,
      bestMoves: blueBest,
      inaccuracies: blueInacc,
      mistakes: blueMistakes,
      blunders: blueBlunders,
      totalMoves: blueMoveCount,
    },
    redStats: {
      accuracy: redAccuracy,
      acpl: redACPL,
      bestMoves: redBest,
      inaccuracies: redInacc,
      mistakes: redMistakes,
      blunders: redBlunders,
      totalMoves: redMoveCount,
    },
    turningPoints,
    summary: {
      winner: winner ?? null,
      reason: reason ?? null,
      totalPlies: N,
      leadChanges,
    },
  };
}
