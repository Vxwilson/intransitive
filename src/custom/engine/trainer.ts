/**
 * Intransitive Custom Engine - Linear TD Self-Play & Arena Matchmaker.
 * Orchestrates the controlled linear evaluator baseline and arena games.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Player, Move } from '../core/types';
import type {
  EvaluationWeights,
  TrainingConfig,
  TrainingStats,
  GenerationPoint,
  ParallelTrainingState,
} from './types';
import type { NNUEWeights } from './nnue/types';
import { createHeuristicWeights, cloneWeights } from './evaluator';
import { TDLearner } from './tdLearner';
import { selectMove } from './search';
import {
  deriveSelfPlaySeed,
  createSelfPlayRng,
  evaluationWeightsVersionId,
  generateSelfPlayGame as generateSelfPlayGameJob,
  makeSelfPlayJobId,
  SELF_PLAY_JOB_SCHEMA_VERSION,
  SELF_PLAY_POLICY_VERSION,
  type SelfPlayGameJob,
  type SelfPlayGameResult,
  type SelfPlayOpening,
  type SelfPlayRngDerivation,
} from './selfPlay';

export { signedTerminalReward } from './selfPlay';

export interface GameRecord {
  jobId: string;
  seed: number;
  rngDerivation: SelfPlayRngDerivation;
  learnerVersion: number;
  opponentVersionId: string;
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
  /** Stable run identity used to reject stale/out-of-run results. */
  runId?: string;
  /** Run seed used to derive reproducible per-game job seeds. */
  runSeed?: number;
  /** Resume lifetime statistics without mutating the source checkpoint. */
  initialStats?: TrainingStats;
  /** Resume the frozen-batch league without sharing mutable snapshots. */
  leagueBuffer?: EvaluationWeights[];
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
  private readonly runId: string;
  private readonly runSeed: number;
  private readonly rngDerivation: SelfPlayRngDerivation;
  private readonly fixedOpponentWeights?: EvaluationWeights;
  private readonly fixedOpponentId: string;

  constructor(
    weights: EvaluationWeights,
    config: Partial<TrainingConfig> = {},
    options: SelfPlayTrainerOptions = {}
  ) {
    this.weights = weights;
    this.learner = new TDLearner(config);
    this.leagueBuffer = options.leagueBuffer?.map((snapshot) => cloneWeights(snapshot)) ?? [cloneWeights(weights)];
    this.learnerColorPolicy = options.learnerColorPolicy ?? 'alternate';
    this.opponentPolicy = options.opponentPolicy ?? 'league-heuristic';
    this.rng = options.rng ?? Math.random;
    this.rngDerivation = options.rng ? 'legacy-serial-v1' : 'per-game-v1';
    this.runId = options.runId ?? 'serial-linear-td';
    this.runSeed = options.runSeed ?? (
      this.rngDerivation === 'per-game-v1'
        ? Math.floor(Math.random() * 0x100000000)
        : 0
    );
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

  private chooseOpponent(rng: () => number = this.rng): { weights: EvaluationWeights; id: string; versionId: string } {
    if (this.opponentPolicy === 'fixed') {
      const weights = this.fixedOpponentWeights ?? createHeuristicWeights();
      return {
        weights,
        id: this.fixedOpponentId,
        versionId: evaluationWeightsVersionId(this.fixedOpponentId, weights),
      };
    }

    // Keep the existing league schedule as the controlled baseline: current
    // self-play 65%, historical checkpoint 20%, and heuristic anchor 15%.
    const rOpponent = rng();
    if (rOpponent < 0.15) {
      const weights = createHeuristicWeights();
      return {
        weights,
        id: 'heuristic-baseline',
        versionId: evaluationWeightsVersionId('heuristic-baseline', weights),
      };
    }
    if (rOpponent < 0.35 && this.leagueBuffer.length > 0) {
      const index = Math.min(
        this.leagueBuffer.length - 1,
        Math.floor(rng() * this.leagueBuffer.length)
      );
      const id = `historical-${index + 1}`;
      return {
        weights: this.leagueBuffer[index],
        id,
        versionId: evaluationWeightsVersionId(id, this.leagueBuffer[index]),
      };
    }
    return {
      weights: this.weights,
      id: 'current-learner',
      versionId: evaluationWeightsVersionId('current-learner', this.weights, this.stats.generation),
    };
  }

  /**
   * Creates a serializable, frozen-snapshot job. Creating a job does not
   * mutate canonical weights, statistics, or league state.
   */
  public createSelfPlayGameJob(
    startFen?: string,
    options: { batchId?: number; gameId?: number; opening?: SelfPlayOpening } = {}
  ): SelfPlayGameJob {
    if (startFen !== undefined && options.opening !== undefined) {
      throw new Error('A self-play job cannot specify both a starting FEN and replay history');
    }
    const gameId = options.gameId ?? this.stats.gamesPlayed;
    const learnerIsBlue = this.learnerIsBlue(gameId);
    const opponentRng = this.rngDerivation === 'per-game-v1'
      ? createSelfPlayRng(deriveSelfPlaySeed(this.runSeed, gameId, 0x4f50504f))
      : this.rng;
    const opponent = this.chooseOpponent(opponentRng);
    const learnerWeights = cloneWeights(this.weights);
    const opponentWeights = cloneWeights(opponent.weights);
    const batchId = options.batchId ?? 0;
    return {
      schemaVersion: SELF_PLAY_JOB_SCHEMA_VERSION,
      jobId: makeSelfPlayJobId(this.runId, batchId, gameId),
      runId: this.runId,
      batchId,
      gameId,
      learnerVersion: this.stats.generation,
      seed: deriveSelfPlaySeed(this.runSeed, gameId),
      rngDerivation: this.rngDerivation,
      learnerColor: learnerIsBlue ? 'blue' : 'red',
      learner: {
        modelId: 'current-learner',
        versionId: evaluationWeightsVersionId('current-learner', learnerWeights, this.stats.generation),
        weights: learnerWeights,
      },
      opponent: {
        modelId: opponent.id,
        versionId: opponent.versionId,
        weights: opponentWeights,
      },
      search: {
        depth: this.learner.config.searchDepth,
        maxPlies: this.learner.config.maxPliesPerGame,
        policy: SELF_PLAY_POLICY_VERSION,
      },
      ...(startFen !== undefined ? { startFen } : {}),
      ...(options.opening ? { opening: options.opening } : {}),
    };
  }

  /**
   * Creates a complete frozen-policy batch before any result is committed.
   * Game IDs are allocated from the coordinator's next committed ID, so the
   * same batch is independent of worker count and completion order.
   */
  public createSelfPlayBatchJobs(batchId: number, count: number): SelfPlayGameJob[] {
    if (!Number.isInteger(batchId) || batchId < 0) {
      throw new Error(`Self-play batch ID must be a non-negative integer, got ${batchId}`);
    }
    if (!Number.isInteger(count) || count < 1) {
      throw new Error(`Self-play batch size must be a positive integer, got ${count}`);
    }
    const firstGameId = this.stats.gamesPlayed;
    return Array.from({ length: count }, (_, offset) =>
      this.createSelfPlayGameJob(undefined, {
        batchId,
        gameId: firstGameId + offset,
      })
    );
  }

  /** Serialize coordinator state required for exact new-format resume. */
  public getParallelTrainingState(nextBatchId: number): ParallelTrainingState {
    if (!Number.isInteger(nextBatchId) || nextBatchId < 0) {
      throw new Error(`Next self-play batch ID must be a non-negative integer, got ${nextBatchId}`);
    }
    if (this.rngDerivation !== 'per-game-v1') {
      throw new Error('Exact parallel resume requires per-game-v1 RNG derivation');
    }
    return {
      schemaVersion: 1,
      runId: this.runId,
      runSeed: this.runSeed,
      rngDerivation: this.rngDerivation,
      nextBatchId,
      nextGameId: this.stats.gamesPlayed,
      learnerVersion: this.stats.generation,
      leagueBuffer: this.leagueBuffer.map((snapshot) => cloneWeights(snapshot)),
    };
  }

  /** Generate a job result without mutating coordinator-owned state. */
  public generateSelfPlayGame(job: SelfPlayGameJob): SelfPlayGameResult {
    const rng = job.rngDerivation === 'per-game-v1'
      ? createSelfPlayRng(job.seed)
      : this.rng;
    return generateSelfPlayGameJob(job, rng);
  }

  /**
   * Applies one result in deterministic game-ID order. Only this coordinator
   * method mutates canonical weights, statistics, or the league buffer.
   */
  public applySelfPlayGameResult(result: SelfPlayGameResult): GameRecord {
    if (result.schemaVersion !== SELF_PLAY_JOB_SCHEMA_VERSION) {
      throw new Error(`Unsupported self-play result schema: ${result.schemaVersion}`);
    }
    if (result.runId !== this.runId) {
      throw new Error(`Stale self-play result run: expected ${this.runId}, got ${result.runId}`);
    }
    if (result.gameId !== this.stats.gamesPlayed) {
      throw new Error(
        `Out-of-order self-play result: expected game ${this.stats.gamesPlayed}, got ${result.gameId}`
      );
    }
    const expectedJobId = makeSelfPlayJobId(result.runId, result.batchId, result.gameId);
    if (result.jobId !== expectedJobId) {
      throw new Error(`Self-play result job ID mismatch: expected ${expectedJobId}, got ${result.jobId}`);
    }

    const outcome = result.outcome;
    const opponentVersions = this.stats.opponentVersions ?? (this.stats.opponentVersions = {});
    opponentVersions[result.opponentVersionId] =
      (opponentVersions[result.opponentVersionId] ?? 0) + 1;
    if (result.learnerColor === 'blue') {
      this.stats.learnerBlueGames = (this.stats.learnerBlueGames ?? 0) + 1;
    } else {
      this.stats.learnerRedGames = (this.stats.learnerRedGames ?? 0) + 1;
    }

    if (outcome.isTerminal && (outcome.winner === PLAYER_BLUE || outcome.winner === PLAYER_RED)) {
      const isBlue = outcome.winner === PLAYER_BLUE;
      if (isBlue) this.stats.blueWins++;
      else this.stats.redWins++;

      this.stats.touchdownWins ??= { blue: 0, red: 0 };
      this.stats.eliminationWins ??= { blue: 0, red: 0 };
      if (outcome.reason === 'touchdown') {
        if (isBlue) this.stats.touchdownWins.blue++;
        else this.stats.touchdownWins.red++;
      } else if (outcome.reason === 'elimination') {
        if (isBlue) this.stats.eliminationWins.blue++;
        else this.stats.eliminationWins.red++;
      } else if (outcome.reason === 'immobilization') {
        this.stats.immobilizations = (this.stats.immobilizations ?? 0) + 1;
      }
    } else if (outcome.isTerminal) {
      this.stats.draws++;
      if (outcome.reason === 'repetition') {
        this.stats.drawRepetition = (this.stats.drawRepetition ?? 0) + 1;
      } else if (outcome.reason === '50-move') {
        this.stats.draw50Move = (this.stats.draw50Move ?? 0) + 1;
      }
    }

    if (outcome.isTerminal) {
      this.learner.updateWeights(
        this.weights,
        result.trajectory,
        outcome.terminalReward,
        this.stats.generation
      );
      this.stats.terminalGames = (this.stats.terminalGames ?? 0) + 1;
    } else {
      this.stats.truncatedGames = (this.stats.truncatedGames ?? 0) + 1;
    }
    this.stats.positionsSeen = (this.stats.positionsSeen ?? 0) + result.trajectory.length;

    this.stats.gamesPlayed++;
    this.stats.generation++;
    this.stats.currentAlpha = this.learner.getEffectiveLearningRate(this.stats.generation);

    const plies = result.moves.length;
    if (!this.stats.shortestGamePlies || plies < this.stats.shortestGamePlies) {
      this.stats.shortestGamePlies = plies;
    }
    if (!this.stats.longestGamePlies || plies > this.stats.longestGamePlies) {
      this.stats.longestGamePlies = plies;
    }
    this.stats.avgGameLength = Math.round(
      (this.stats.avgGameLength * (this.stats.gamesPlayed - 1) + plies) /
        this.stats.gamesPlayed
    );

    if (this.stats.generation % 10 === 0 || this.stats.generation <= 10) {
      const totalDecisive = this.stats.blueWins + this.stats.redWins;
      const blueWinRate = totalDecisive > 0
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

    if (this.stats.generation % 50 === 0) {
      this.leagueBuffer.push(cloneWeights(this.weights));
      if (this.leagueBuffer.length > 12) this.leagueBuffer.shift();
    }

    return {
      jobId: result.jobId,
      seed: result.seed,
      rngDerivation: result.rngDerivation,
      learnerVersion: result.learnerVersion,
      opponentVersionId: result.opponentVersionId,
      winner: outcome.winner,
      reason: outcome.reason,
      plies,
      moves: result.moves,
      isTerminal: outcome.isTerminal,
      isTruncated: outcome.isTruncated,
      terminalReward: outcome.terminalReward,
      learnerColor: result.learnerColor,
      opponentId: result.opponentId,
    };
  }

  /**
   * Serial compatibility wrapper: generate one job, generate its trajectory,
   * then apply exactly one result. This preserves the original online TD
   * update order while exposing the new pure job boundary.
   */
  public playSelfPlayGame(startFen?: string): GameRecord {
    const job = this.createSelfPlayGameJob(startFen);
    const result = this.generateSelfPlayGame(job);
    return this.applySelfPlayGameResult(result);
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
