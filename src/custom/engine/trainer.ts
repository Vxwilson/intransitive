/**
 * Intransitive Custom Engine - Linear TD Self-Play & Arena Matchmaker.
 * Orchestrates the controlled linear evaluator baseline and arena games.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { GameStatus } from '../core/types';
import type { Player, Move } from '../core/types';
import type {
  EvaluationWeights,
  TrainingConfig,
  TrainingStats,
  GenerationPoint,
} from './types';
import type { NNUEWeights } from './nnue/types';
import { evaluate, extractFeatures, createHeuristicWeights, cloneWeights } from './evaluator';
import { selectMove } from './search';
import { TDLearner, type TrajectoryStep } from './tdLearner';

export interface GameRecord {
  winner: Player | 'draw' | null;
  reason: string | null;
  plies: number;
  moves: Move[];
  /** True only when the rules, rather than the safety cap, ended the game. */
  isTerminal: boolean;
  /** A capped game has no invented winner and receives no TD update. */
  isTruncated: boolean;
  /** Blue-relative terminal reward; zero for draws and truncations. */
  terminalReward: number;
  learnerColor: 'blue' | 'red';
  opponentId: string;
}

export type LearnerColorPolicy = 'alternate' | 'blue' | 'red';
export type OpponentPolicy = 'league-heuristic' | 'fixed';

export interface SelfPlayTrainerOptions {
  /** Inject a seeded source for reproducible opponent and exploration choices. */
  rng?: () => number;
  learnerColorPolicy?: LearnerColorPolicy;
  opponentPolicy?: OpponentPolicy;
  opponentWeights?: EvaluationWeights;
  opponentId?: string;
  /** Resume lifetime statistics without mutating the source checkpoint. */
  initialStats?: TrainingStats;
}

export function signedTerminalReward(status: GameStatus): number {
  if (!status.isOver) return 0;
  if (status.winner === PLAYER_BLUE) return 1000;
  if (status.winner === PLAYER_RED) return -1000;
  return 0;
}

function copyStats(stats: TrainingStats): TrainingStats {
  return JSON.parse(JSON.stringify(stats)) as TrainingStats;
}

export class SelfPlayTrainer {
  public weights: EvaluationWeights;
  public stats: TrainingStats;
  public learner: TDLearner;
  public leagueBuffer: EvaluationWeights[];
  public readonly learnerColorPolicy: LearnerColorPolicy;
  public readonly opponentPolicy: OpponentPolicy;
  private readonly rng: () => number;
  private readonly fixedOpponentWeights?: EvaluationWeights;
  private readonly fixedOpponentId: string;

  constructor(
    weights: EvaluationWeights,
    config: Partial<TrainingConfig> = {},
    options: SelfPlayTrainerOptions = {}
  ) {
    this.weights = weights;
    this.learner = new TDLearner(config);
    this.leagueBuffer = [cloneWeights(weights)];
    this.learnerColorPolicy = options.learnerColorPolicy ?? 'alternate';
    this.opponentPolicy = options.opponentPolicy ?? 'league-heuristic';
    this.rng = options.rng ?? Math.random;
    this.fixedOpponentWeights = options.opponentWeights;
    this.fixedOpponentId = options.opponentId ?? 'fixed-opponent';
    this.stats = options.initialStats ? copyStats(options.initialStats) : {
      generation: 0,
      gamesPlayed: 0,
      blueWins: 0,
      redWins: 0,
      draws: 0,
      terminalGames: 0,
      truncatedGames: 0,
      positionsSeen: 0,
      learnerBlueGames: 0,
      learnerRedGames: 0,
      opponentVersions: {},
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

  private learnerIsBlue(gameNumber: number): boolean {
    if (this.learnerColorPolicy === 'blue') return true;
    if (this.learnerColorPolicy === 'red') return false;
    return gameNumber % 2 === 0;
  }

  private chooseOpponent(): { weights: EvaluationWeights; id: string } {
    if (this.opponentPolicy === 'fixed') {
      return {
        weights: this.fixedOpponentWeights ?? createHeuristicWeights(),
        id: this.fixedOpponentId,
      };
    }

    // Keep the existing league schedule as the controlled baseline: current
    // self-play 65%, historical checkpoint 20%, and heuristic anchor 15%.
    const rOpponent = this.rng();
    if (rOpponent < 0.15) {
      return { weights: createHeuristicWeights(), id: 'heuristic-baseline' };
    }
    if (rOpponent < 0.35 && this.leagueBuffer.length > 0) {
      const index = Math.min(
        this.leagueBuffer.length - 1,
        Math.floor(this.rng() * this.leagueBuffer.length)
      );
      return { weights: this.leagueBuffer[index], id: `historical-${index + 1}` };
    }
    return { weights: this.weights, id: 'current-learner' };
  }

  /**
   * Plays a single linear TD self-play game and updates only on a
   * rules-defined terminal result. A safety-cap truncation is recorded but
   * deliberately contributes no pseudo-outcome and no TD update.
   */
  public playSelfPlayGame(startFen?: string): GameRecord {
    const game = new IntransitiveGame(startFen);
    const trajectory: TrajectoryStep[] = [];
    const moves: Move[] = [];

    const { searchDepth, maxPliesPerGame } = this.learner.config;
    const learnerIsBlue = this.learnerIsBlue(this.stats.gamesPlayed);
    const opponent = this.chooseOpponent();
    const learnerColor = learnerIsBlue ? 'blue' : 'red';
    const opponentVersions = this.stats.opponentVersions ?? (this.stats.opponentVersions = {});
    opponentVersions[opponent.id] = (opponentVersions[opponent.id] ?? 0) + 1;
    if (learnerIsBlue) {
      this.stats.learnerBlueGames = (this.stats.learnerBlueGames ?? 0) + 1;
    } else {
      this.stats.learnerRedGames = (this.stats.learnerRedGames ?? 0) + 1;
    }

    while (trajectory.length < maxPliesPerGame) {
      const status = game.isTerminal();
      if (status.isOver) break;

      const currentPly = trajectory.length;
      const isBlue = game.activePlayer === PLAYER_BLUE;
      const currentWeights = isBlue === learnerIsBlue ? this.weights : opponent.weights;

      // Keep the existing multi-stage exploration schedule for the baseline:
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
        rng: this.rng,
      });
      if (!bestMove) break;

      const features = extractFeatures(game);
      const evalScore = evaluate(game, this.weights);
      trajectory.push({ features, evalScore });

      moves.push(bestMove);
      game.makeMove(bestMove);
    }

    const finalStatus = game.isTerminal();
    const isTerminal = finalStatus.isOver;
    const isTruncated = !isTerminal;
    const terminalReward = signedTerminalReward(finalStatus);
    if (isTerminal && (finalStatus.winner === PLAYER_BLUE || finalStatus.winner === PLAYER_RED)) {
      const isBlue = finalStatus.winner === PLAYER_BLUE;
      if (isBlue) {
        this.stats.blueWins++;
      } else {
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
    } else if (isTerminal) {
      this.stats.draws++;
      if (finalStatus.reason === 'repetition') {
        this.stats.drawRepetition = (this.stats.drawRepetition || 0) + 1;
      } else if (finalStatus.reason === '50-move') {
        this.stats.draw50Move = (this.stats.draw50Move || 0) + 1;
      }
    }

    if (isTerminal) {
      // Linear TD self-play baseline: terminal wins are ±1000, draws are 0.
      this.learner.updateWeights(this.weights, trajectory, terminalReward, this.stats.generation);
      this.stats.terminalGames = (this.stats.terminalGames ?? 0) + 1;
    } else {
      this.stats.truncatedGames = (this.stats.truncatedGames ?? 0) + 1;
    }
    this.stats.positionsSeen = (this.stats.positionsSeen ?? 0) + trajectory.length;

    this.stats.gamesPlayed++;
    this.stats.generation++;
    this.stats.currentAlpha = this.learner.getEffectiveLearningRate(this.stats.generation);

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
      winner: finalStatus.winner,
      reason: finalStatus.reason ?? 'max-plies',
      plies,
      moves,
      isTerminal,
      isTruncated,
      terminalReward,
      learnerColor,
      opponentId: opponent.id,
    };
  }

  /**
   * Pits two sets of weights against each other in an exhibition tournament.
   * Alternates sides equally (Blue vs Red) to ensure fair results.
   */
  public static runArenaTournament(
    weightsA: EvaluationWeights | NNUEWeights,
    weightsB: EvaluationWeights | NNUEWeights,
    numGames: number = 20,
    searchDepthA: number = 1,
    searchDepthB?: number | ((moveData: {
      move: Move;
      san: string;
      fen: string;
      isOver: boolean;
      gameIndex: number;
      totalGames?: number;
      currentWinsA?: number;
      currentWinsB?: number;
      currentDraws?: number;
    }) => void),
    onMove?: (moveData: {
      move: Move;
      san: string;
      fen: string;
      isOver: boolean;
      gameIndex: number;
      totalGames?: number;
      currentWinsA?: number;
      currentWinsB?: number;
      currentDraws?: number;
    }) => void,
    thinkTimeSecA?: number,
    thinkTimeSecB?: number,
    isCancelled?: (() => boolean) | { isCancelled: boolean }
  ): {
    winsA: number;
    winsB: number;
    draws: number;
    winRateA: number;
    winRateB: number;
    drawRate: number;
    gamesPlayed: number;
    avgGameLength: number;
    isCancelled?: boolean;
    thinkTimeSecA?: number;
    thinkTimeSecB?: number;
  } {
    let depthB = searchDepthA;
    let onMoveFn = onMove;
    if (typeof searchDepthB === 'function') {
      onMoveFn = searchDepthB;
      depthB = searchDepthA;
    } else if (typeof searchDepthB === 'number') {
      depthB = searchDepthB;
    }

    const checkCancelled = () => {
      if (!isCancelled) return false;
      if (typeof isCancelled === 'function') return isCancelled();
      if (typeof isCancelled === 'object' && 'isCancelled' in isCancelled) return Boolean((isCancelled as any).isCancelled);
      return Boolean(isCancelled);
    };

    let winsA = 0;
    let winsB = 0;
    let draws = 0;
    let totalPlies = 0;

    for (let i = 0; i < numGames; i++) {
      if (checkCancelled()) break;

      const gameRes = SelfPlayTrainer.playArenaGame(
        i,
        numGames,
        weightsA,
        weightsB,
        searchDepthA,
        depthB,
        thinkTimeSecA,
        thinkTimeSecB,
        onMoveFn,
        undefined,
        checkCancelled
      );

      if (gameRes.winner === 'A') winsA++;
      else if (gameRes.winner === 'B') winsB++;
      else draws++;

      totalPlies += gameRes.plies;

      // Update real-time tally after game concludes
      if (onMoveFn) {
        onMoveFn({
          move: gameRes.lastMove,
          san: '',
          fen: gameRes.lastFen,
          isOver: true,
          gameIndex: i + 1,
          totalGames: numGames,
          currentWinsA: winsA,
          currentWinsB: winsB,
          currentDraws: draws,
        });
      }
    }

    const gamesPlayed = Math.max(1, winsA + winsB + draws);
    const winRateA = Math.round((winsA / gamesPlayed) * 100);
    const winRateB = Math.round((winsB / gamesPlayed) * 100);
    const drawRate = Math.round((draws / gamesPlayed) * 100);
    const avgGameLength = gamesPlayed > 0 ? Math.round(totalPlies / gamesPlayed) : 0;

    return {
      winsA,
      winsB,
      draws,
      winRateA,
      winRateB,
      drawRate,
      gamesPlayed: winsA + winsB + draws,
      avgGameLength,
      isCancelled: checkCancelled(),
      thinkTimeSecA,
      thinkTimeSecB,
    };
  }

  /**
   * Plays a single match between Fighter A and Fighter B with alternate side coloring.
   */
  public static playArenaGame(
    gameIndex: number,
    totalGames: number,
    weightsA: EvaluationWeights | NNUEWeights,
    weightsB: EvaluationWeights | NNUEWeights,
    depthA: number = 1,
    depthB: number = 1,
    thinkTimeSecA?: number,
    thinkTimeSecB?: number,
    onMove?: (moveData: any) => void,
    /** @deprecated Kept for call-site compatibility; heuristic agreement is no longer computed. */
    _legacyBenchmarkWeights?: EvaluationWeights,
    isCancelled?: (() => boolean) | { isCancelled: boolean }
  ): {
    winner: 'A' | 'B' | 'draw';
    reason: string | null;
    plies: number;
    lastMove: Move;
    lastFen: string;
    sanMoves: string[];
  } {
    const game = new IntransitiveGame();
    const aIsBlue = gameIndex % 2 === 0;
    let plies = 0;
    let lastMove: Move = { from: 0, to: 0, piece: 'P' as any };
    const sanMoves: string[] = [];

    const checkCancelled = () => {
      if (!isCancelled) return false;
      if (typeof isCancelled === 'function') return isCancelled();
      if (typeof isCancelled === 'object' && 'isCancelled' in isCancelled) return Boolean((isCancelled as any).isCancelled);
      return Boolean(isCancelled);
    };

    while (plies < 80) {
      if (checkCancelled()) break;
      const status = game.isTerminal();
      if (status.isOver) break;

      const isTurnA =
        (game.activePlayer === PLAYER_BLUE && aIsBlue) ||
        (game.activePlayer === PLAYER_RED && !aIsBlue);

      const currentWeights = isTurnA ? weightsA : weightsB;
      const currentDepth = isTurnA ? depthA : depthB;
      const currentThinkTime = isTurnA ? thinkTimeSecA : thinkTimeSecB;

      // Competitive arena play is deterministic greedy best-move mode. The
      // self-play trainer owns exploration; arena results must not mix it in.
      const { bestMove } = selectMove(game, currentWeights, {
        depth: currentDepth,
        thinkTimeSec: currentThinkTime,
        temperature: 0.0,
        rootNoise: 0.0,
        ply: plies,
        openingPlies: 0,
      });

      if (!bestMove) break;
      lastMove = bestMove;

      const san = game.formatMoveSAN(bestMove);
      sanMoves.push(san);
      game.makeMove(bestMove);
      plies++;

      if (onMove && gameIndex < Math.min(totalGames, 100)) {
        onMove({
          move: bestMove,
          san,
          fen: game.toFEN(),
          isOver: game.isTerminal().isOver,
          gameIndex: gameIndex + 1,
          totalGames,
        });
      }
    }

    let winner: 'A' | 'B' | 'draw' = 'draw';
    const status = game.isTerminal();
    if (status.isOver) {
      if (status.winner === PLAYER_BLUE) {
        winner = aIsBlue ? 'A' : 'B';
      } else if (status.winner === PLAYER_RED) {
        winner = !aIsBlue ? 'A' : 'B';
      }
    }

    return {
      winner,
      reason: status.reason,
      plies,
      lastMove,
      lastFen: game.toFEN(),
      sanMoves,
    };
  }
}
