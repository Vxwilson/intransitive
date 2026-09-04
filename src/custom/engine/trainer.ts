/**
 * Intransitive Custom Engine - Self-Play Game Simulator & Arena Matchmaker
 * Orchestrates Tabula Rasa self-play training games and generation milestones.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Player, Move } from '../core/types';
import type {
  EvaluationWeights,
  TrainingConfig,
  TrainingStats,
  GenerationPoint,
} from './types';
import { evaluate, extractFeatures, createHeuristicWeights, cloneWeights } from './evaluator';
import { selectMove } from './search';
import { TDLearner, type TrajectoryStep } from './tdLearner';

export interface GameRecord {
  winner: Player | 'draw' | null;
  reason: string | null;
  plies: number;
  moves: Move[];
}

export class SelfPlayTrainer {
  public weights: EvaluationWeights;
  public stats: TrainingStats;
  public learner: TDLearner;
  public leagueBuffer: EvaluationWeights[];

  constructor(weights: EvaluationWeights, config: Partial<TrainingConfig> = {}) {
    this.weights = weights;
    this.learner = new TDLearner(config);
    this.leagueBuffer = [cloneWeights(weights)];
    this.stats = {
      generation: 0,
      gamesPlayed: 0,
      blueWins: 0,
      redWins: 0,
      draws: 0,
      avgGameLength: 0,
      touchdownWins: { blue: 0, red: 0 },
      eliminationWins: { blue: 0, red: 0 },
      drawRepetition: 0,
      draw50Move: 0,
      immobilizations: 0,
      shortestGamePlies: 0,
      longestGamePlies: 0,
      history: [
        {
          generation: 0,
          R: weights.pieceValues.R,
          P: weights.pieceValues.P,
          S: weights.pieceValues.S,
          blueWinRate: 50,
        },
      ],
    };
  }

  /**
   * Plays a single self-play game and performs TD update on the weights.
   * Incorporates AlphaZero-style Softmax temperature + Dirichlet root noise,
   * TD-Leaf lookahead targets, and Anti-Cycle Historical League opponent mixing.
   */
  public playSelfPlayGame(): GameRecord {
    const game = new IntransitiveGame();
    const trajectory: TrajectoryStep[] = [];
    const moves: Move[] = [];

    const { searchDepth, maxPliesPerGame } = this.learner.config;

    // League Opponent Mixing (Anti-Cycle Buffer):
    // In cyclic games (R > S > P > R), naive self-play oscillates in limit cycles.
    // We mix:
    // - 65% Pure self-play against latest model (this.weights)
    // - 20% Sampled historical past checkpoint from the league buffer
    // - 15% Heuristic benchmark anchor (prevents tactical drift)
    let opponentWeights = this.weights;
    const rOpponent = Math.random();
    if (rOpponent < 0.15) {
      opponentWeights = createHeuristicWeights();
    } else if (rOpponent < 0.35 && this.leagueBuffer.length > 0) {
      const idx = Math.floor(Math.random() * this.leagueBuffer.length);
      opponentWeights = this.leagueBuffer[idx];
    }

    while (trajectory.length < maxPliesPerGame) {
      const status = game.isTerminal();
      if (status.isOver) break;

      const currentPly = trajectory.length;
      const isBlue = game.activePlayer === PLAYER_BLUE;
      const currentWeights = isBlue ? this.weights : opponentWeights;

      // Multi-stage AlphaZero exploration schedule:
      // - Plies 0..4 (Opening): T = 24 cp, Dirichlet noise = 0.25 (escape certainty, branch opening tree)
      // - Plies 5..8 (Midgame transition): T = 10 cp, Dirichlet noise = 0.08
      // - Plies 9+ (Tactical conversion & endgame): T = 0 cp, Dirichlet noise = 0.0 (greedy argmax)
      let temp = 0.0;
      let noise = 0.0;
      if (currentPly < 5) {
        temp = 24.0;
        noise = 0.25;
      } else if (currentPly < 9) {
        temp = 10.0;
        noise = 0.08;
      }

      const { bestMove } = selectMove(game, currentWeights, {
        depth: searchDepth,
        temperature: temp,
        rootNoise: noise,
        ply: currentPly,
      });
      if (!bestMove) break;

      const features = extractFeatures(game);
      const evalScore = evaluate(game, this.weights);
      trajectory.push({ features, evalScore });

      moves.push(bestMove);
      game.makeMove(bestMove);
    }

    const finalStatus = game.isTerminal();
    let terminalReward = 0;
    if (finalStatus.isOver && (finalStatus.winner === PLAYER_BLUE || finalStatus.winner === PLAYER_RED)) {
      const isBlue = finalStatus.winner === PLAYER_BLUE;
      if (isBlue) {
        terminalReward = 1000;
        this.stats.blueWins++;
      } else {
        terminalReward = -1000;
        this.stats.redWins++;
      }

      // Track specific terminal win reasons
      if (this.stats.touchdownWins && this.stats.eliminationWins) {
        if (finalStatus.reason === 'touchdown') {
          if (isBlue) this.stats.touchdownWins.blue++;
          else this.stats.touchdownWins.red++;
        } else if (finalStatus.reason === 'elimination') {
          if (isBlue) this.stats.eliminationWins.blue++;
          else this.stats.eliminationWins.red++;
        } else if (finalStatus.reason === 'immobilization') {
          this.stats.immobilizations = (this.stats.immobilizations || 0) + 1;
        }
      }
    } else {
      // Adjudicate unfinished or draw games using material and goal proximity advantage
      const finalFeats = extractFeatures(game);
      const matAdv =
        finalFeats.materialR * 100 +
        finalFeats.materialP * 100 +
        finalFeats.materialS * 100;
      const posAdv =
        finalFeats.goalDistanceAdvantage * 10 +
        finalFeats.threatAdvantage * 10;
      const totalAdv = matAdv + posAdv;

      if (totalAdv > 20) {
        terminalReward = Math.min(800, totalAdv);
        this.stats.blueWins++;
      } else if (totalAdv < -20) {
        terminalReward = Math.max(-800, totalAdv);
        this.stats.redWins++;
      } else {
        terminalReward = 0;
        this.stats.draws++;
        if (finalStatus.reason === 'repetition') {
          this.stats.drawRepetition = (this.stats.drawRepetition || 0) + 1;
        } else if (finalStatus.reason === '50-move') {
          this.stats.draw50Move = (this.stats.draw50Move || 0) + 1;
        }
      }
    }

    // Apply TD-Leaf update
    this.learner.updateWeights(this.weights, trajectory, terminalReward);

    this.stats.gamesPlayed++;
    this.stats.generation++;

    // Update game length tracking
    const plies = moves.length;
    if (!this.stats.shortestGamePlies || plies < this.stats.shortestGamePlies) {
      this.stats.shortestGamePlies = plies;
    }
    if (!this.stats.longestGamePlies || plies > this.stats.longestGamePlies) {
      this.stats.longestGamePlies = plies;
    }

    // Update average game length running average
    this.stats.avgGameLength = Math.round(
      (this.stats.avgGameLength * (this.stats.gamesPlayed - 1) + plies) /
        this.stats.gamesPlayed
    );

    // Record history snapshot every milestone
    if (this.stats.generation % 10 === 0 || this.stats.generation <= 10) {
      const totalDecisive = this.stats.blueWins + this.stats.redWins;
      const blueWinRate =
        totalDecisive > 0
          ? Math.round((this.stats.blueWins / totalDecisive) * 100)
          : 50;

      const point: GenerationPoint = {
        generation: this.stats.generation,
        R: Math.round(this.weights.pieceValues.R * 10) / 10,
        P: Math.round(this.weights.pieceValues.P * 10) / 10,
        S: Math.round(this.weights.pieceValues.S * 10) / 10,
        blueWinRate,
      };
      this.stats.history.push(point);
    }

    // Save snapshot to rolling historical league buffer every 50 generations (up to 12 models)
    if (this.stats.generation % 50 === 0) {
      this.leagueBuffer.push(cloneWeights(this.weights));
      if (this.leagueBuffer.length > 12) {
        this.leagueBuffer.shift();
      }
    }

    return {
      winner: finalStatus.winner ?? 'draw',
      reason: finalStatus.reason ?? 'max-plies',
      plies,
      moves,
    };
  }

  /**
   * Pits two sets of weights against each other in an exhibition tournament.
   * Alternates sides equally (Blue vs Red) to ensure fair results.
   */
  public static runArenaTournament(
    weightsA: EvaluationWeights,
    weightsB: EvaluationWeights,
    numGames: number = 20,
    searchDepth: number = 1,
    onMove?: (moveData: { move: Move; san: string; fen: string; isOver: boolean; gameIndex: number }) => void
  ): {
    winsA: number;
    winsB: number;
    draws: number;
    winRateA: number;
    winRateB: number;
    drawRate: number;
    gamesPlayed: number;
    avgGameLength: number;
    accuracyA: number;
    accuracyB: number;
  } {
    const benchmarkWeights = createHeuristicWeights();
    let winsA = 0;
    let winsB = 0;
    let draws = 0;
    let totalPlies = 0;
    let movesA = 0;
    let accurateMovesA = 0;
    let movesB = 0;
    let accurateMovesB = 0;

    for (let i = 0; i < numGames; i++) {
      const game = new IntransitiveGame();
      const aIsBlue = i % 2 === 0;
      let plies = 0;

      while (plies < 80) {
        const status = game.isTerminal();
        if (status.isOver) break;

        const isTurnA = (game.activePlayer === PLAYER_BLUE && aIsBlue) ||
                        (game.activePlayer === PLAYER_RED && !aIsBlue);

        const currentWeights = isTurnA ? weightsA : weightsB;
        // AlphaZero Tournament schedule: T = 15 cp for first 4 plies (tactical opening branching), then T = 0 greedy
        const { bestMove } = selectMove(game, currentWeights, {
          depth: searchDepth,
          temperature: 15.0,
          rootNoise: 0.0,
          ply: plies,
          openingPlies: 4,
        });
        if (!bestMove) break;

        // Evaluate move agreement against benchmark
        const benchmark = selectMove(game, benchmarkWeights, 1, 0.0);
        const isAccurate = benchmark.bestMove !== null &&
          bestMove.from === benchmark.bestMove.from &&
          bestMove.to === benchmark.bestMove.to;

        if (isTurnA) {
          movesA++;
          if (isAccurate) accurateMovesA++;
        } else {
          movesB++;
          if (isAccurate) accurateMovesB++;
        }

        const san = onMove ? game.formatMoveSAN(bestMove) : '';
        game.makeMove(bestMove);
        plies++;

        if (onMove && i < Math.min(numGames, 100)) {
          onMove({
            move: bestMove,
            san,
            fen: game.toFEN(),
            isOver: game.isTerminal().isOver,
            gameIndex: i + 1,
          });
        }
      }

      totalPlies += plies;
      const status = game.isTerminal();
      if (status.isOver) {
        if (status.winner === PLAYER_BLUE) {
          if (aIsBlue) winsA++;
          else winsB++;
        } else if (status.winner === PLAYER_RED) {
          if (!aIsBlue) winsA++;
          else winsB++;
        } else {
          draws++;
        }
      } else {
        draws++;
      }
    }

    const winRateA = Math.round((winsA / numGames) * 100);
    const winRateB = Math.round((winsB / numGames) * 100);
    const drawRate = Math.round((draws / numGames) * 100);
    const avgGameLength = numGames > 0 ? Math.round(totalPlies / numGames) : 0;
    const accuracyA = movesA > 0 ? Math.round((accurateMovesA / movesA) * 100) : 50;
    const accuracyB = movesB > 0 ? Math.round((accurateMovesB / movesB) * 100) : 50;

    return {
      winsA,
      winsB,
      draws,
      winRateA,
      winRateB,
      drawRate,
      gamesPlayed: numGames,
      avgGameLength,
      accuracyA,
      accuracyB,
    };
  }
}
