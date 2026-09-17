/**
 * Intransitive Custom Engine - Training & Arena Web Worker
 * Runs headless self-play training batches and live-step evaluation without blocking the main UI thread.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import { createZeroWeights } from './evaluator';
import { selectMove, getTopMoves, isSearchAbort, MAX_SEARCH_DEPTH } from './search';
import { SelfPlayTrainer } from './trainer';
import { NNUETrainer } from './nnue/nnueTrainer';
import { deserializeWeights, serializeWeights, getActiveFeatures } from './nnue/featureTransformer';
import { createMasterNNUEWeights } from './nnue/nnueWeights';
import {
  createPairedMatchOpening,
  runMatchGame,
  summarizePairedMatchGames,
  DEFAULT_MATCH_OPENING_PLIES,
  DEFAULT_MATCH_SAFETY_CAP,
} from '../harness/harness';
import type { MatchAgent, MatchGameLog, SearchLimit } from '../harness/types';
import type { NNUEWeights, TrainingSample } from './nnue/types';
import type {
  WorkerRequest,
  WorkerResponse,
  EvaluationWeights,
  TrainingConfig,
  RankedMove,
} from './types';

// Worker state
let currentWeights: EvaluationWeights = createZeroWeights();
let trainer = new SelfPlayTrainer(currentWeights);
let currentNNUEWeights: NNUEWeights = createMasterNNUEWeights();
let nnueTrainer = new NNUETrainer(currentNNUEWeights, { batchSize: 128, learningRate: 0.001 });
let isNNUETraining = false;
let nnueCancelled = false;

let isTurboRunning = false;
let turboCancelled = false;
let isArenaRunning = false;
let isArenaPaused = false;
let arenaCancelled = false;
let resumeArenaFn: (() => void) | null = null;
let currentAnalysisId = 0;

function post(response: WorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;

    switch (req.type) {
    case 'START_TURBO': {
      if (isTurboRunning) return;
      isTurboRunning = true;
      turboCancelled = false;

      const totalGames = req.totalGames;
      if (req.config) {
        Object.assign(trainer.learner.config, req.config);
      }

      let completed = 0;
      const startTime = performance.now();
      const chunkSize = Math.min(trainer.learner.config.searchDepth > 1 ? 5 : 25, totalGames);

      function runChunk() {
        if (turboCancelled) {
          isTurboRunning = false;
          post({
            type: 'TURBO_COMPLETE',
            stats: trainer.stats,
            weights: trainer.weights,
          });
          return;
        }

        const chunkEnd = Math.min(totalGames, completed + chunkSize);
        while (completed < chunkEnd && !turboCancelled) {
          trainer.playSelfPlayGame();
          completed++;
        }

        const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
        const nps = Math.round((completed * trainer.stats.avgGameLength) / elapsedSec);

        post({
          type: 'TURBO_PROGRESS',
          completed,
          total: totalGames,
          nps,
          stats: trainer.stats,
          weights: trainer.weights,
        });

        if (completed < totalGames && !turboCancelled) {
          setTimeout(runChunk, 0);
        } else {
          isTurboRunning = false;
          post({
            type: 'TURBO_COMPLETE',
            stats: trainer.stats,
            weights: trainer.weights,
          });
        }
      }

      runChunk();
      break;
    }

    case 'STOP_TURBO': {
      turboCancelled = true;
      isTurboRunning = false;
      break;
    }

    case 'START_NNUE_TRAIN': {
      if (isNNUETraining) return;
      isNNUETraining = true;
      nnueCancelled = false;

      const totalGames = req.totalGames;
      const searchDepth = req.searchDepth ?? 1;
      const batchSize = req.batchSize ?? 128;
      if (req.learningRate) nnueTrainer.config.learningRate = req.learningRate;

      let completed = 0;
      const startTime = performance.now();
      const chunkSize = Math.min(searchDepth > 1 ? 2 : 10, totalGames);

      function runNNUEChunk() {
        if (nnueCancelled) {
          isNNUETraining = false;
          post({
            type: 'NNUE_TRAIN_COMPLETE',
            stats: trainer.stats,
            nnueWeights: serializeWeights(currentNNUEWeights),
          });
          return;
        }

        const chunkEnd = Math.min(totalGames, completed + chunkSize);
        while (completed < chunkEnd && !nnueCancelled) {
          // Play one self-play game
          const game = new IntransitiveGame();
          const samples: TrainingSample[] = [];

          let plies = 0;
          while (plies < 80) {
            const status = game.isTerminal();
            if (status.isOver) break;

            const temp = plies < 4 ? 20.0 : plies < 8 ? 8.0 : 0.0;
            const noise = plies < 4 ? 0.25 : 0.0;

            const res = selectMove(game, currentNNUEWeights, {
              depth: searchDepth,
              temperature: temp,
              rootNoise: noise,
              ply: plies,
              openingPlies: 6,
            });

            if (!res.bestMove) break;

            const activeFeaturesBlue = getActiveFeatures(game, PLAYER_BLUE);
            const activeFeaturesRed = getActiveFeatures(game, PLAYER_RED);

            samples.push({
              activeFeaturesBlue,
              activeFeaturesRed,
              activePlayer: game.activePlayer,
              searchScore: res.score,
              terminalOutcome: 0,
              isTerminal: false,
            });

            game.makeMove(res.bestMove);
            plies++;
          }

          const finalStatus = game.isTerminal();
          let termOutcome = 0;
          if (finalStatus.isOver) {
            trainer.stats.terminalGames = (trainer.stats.terminalGames ?? 0) + 1;
            const isBlueWin = finalStatus.winner === PLAYER_BLUE;
            const isRedWin = finalStatus.winner === PLAYER_RED;

            if (isBlueWin) {
              termOutcome = 1.0;
              trainer.stats.blueWins++;
            } else if (isRedWin) {
              termOutcome = -1.0;
              trainer.stats.redWins++;
            } else {
              trainer.stats.draws++;
            }

            // Track specific terminal win reasons
            if (!trainer.stats.touchdownWins) trainer.stats.touchdownWins = { blue: 0, red: 0 };
            if (!trainer.stats.eliminationWins) trainer.stats.eliminationWins = { blue: 0, red: 0 };

            if (finalStatus.reason === 'touchdown') {
              if (isBlueWin) trainer.stats.touchdownWins.blue++;
              else if (isRedWin) trainer.stats.touchdownWins.red++;
            } else if (finalStatus.reason === 'elimination') {
              if (isBlueWin) trainer.stats.eliminationWins.blue++;
              else if (isRedWin) trainer.stats.eliminationWins.red++;
            } else if (finalStatus.reason === 'repetition') {
              trainer.stats.drawRepetition = (trainer.stats.drawRepetition || 0) + 1;
            } else if (finalStatus.reason === '50-move') {
              trainer.stats.draw50Move = (trainer.stats.draw50Move || 0) + 1;
            }
          } else {
            trainer.stats.truncatedGames = (trainer.stats.truncatedGames ?? 0) + 1;
          }

          trainer.stats.positionsSeen = (trainer.stats.positionsSeen ?? 0) + samples.length;

          for (let s = 0; s < samples.length; s++) {
            samples[s].terminalOutcome = termOutcome;
            nnueTrainer.addSample(samples[s]);
          }

          completed++;
          trainer.stats.gamesPlayed++;
          trainer.stats.generation++;

          // Track game plies and average length
          if (!trainer.stats.shortestGamePlies || plies < trainer.stats.shortestGamePlies) {
            trainer.stats.shortestGamePlies = plies;
          }
          if (!trainer.stats.longestGamePlies || plies > trainer.stats.longestGamePlies) {
            trainer.stats.longestGamePlies = plies;
          }
          trainer.stats.avgGameLength = Math.round(
            (trainer.stats.avgGameLength * (trainer.stats.gamesPlayed - 1) + plies) /
              Math.max(1, trainer.stats.gamesPlayed)
          );
        }

        // Train mini-batches
        let lastLoss = 0;
        for (let b = 0; b < 2; b++) {
          const res = nnueTrainer.trainBatch(batchSize);
          lastLoss = res.loss;
        }

        trainer.stats.currentLoss = lastLoss;

        // Record history snapshot for training dynamics chart
        if (!trainer.stats.history) trainer.stats.history = [];
        trainer.stats.history.push({
          generation: trainer.stats.generation,
          R: 0,
          P: 0,
          S: 0,
          blueWinRate: Math.round((trainer.stats.blueWins / Math.max(1, trainer.stats.gamesPlayed)) * 100),
          loss: lastLoss,
        });

        const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
        const nps = Math.round((completed * 28) / elapsedSec);

        post({
          type: 'NNUE_TRAIN_PROGRESS',
          completed,
          total: totalGames,
          loss: lastLoss,
          nps,
          bufferSize: nnueTrainer.replayBuffer.length,
          stats: trainer.stats,
          nnueWeights: serializeWeights(currentNNUEWeights),
        });

        if (completed < totalGames && !nnueCancelled) {
          setTimeout(runNNUEChunk, 0);
        } else {
          isNNUETraining = false;
          post({
            type: 'NNUE_TRAIN_COMPLETE',
            stats: trainer.stats,
            nnueWeights: serializeWeights(currentNNUEWeights),
          });
        }
      }

      runNNUEChunk();
      break;
    }

    case 'STOP_NNUE_TRAIN': {
      nnueCancelled = true;
      isNNUETraining = false;
      break;
    }

    case 'STEP_LIVE': {
      const game = req.history
        ? IntransitiveGame.fromHistory(req.history, req.currentFen)
        : new IntransitiveGame(req.currentFen);
      const searchDepth = req.searchDepth ?? req.config?.searchDepth ?? 2;
      const weightsToUse = req.customNNUEWeights
        ? deserializeWeights(req.customNNUEWeights)
        : (req.customWeights ?? trainer.weights);

      const movePolicy = req.movePolicy ?? 'casual-opening';
      const activePly = req.ply ?? 0;
      const isTrainingPolicy = movePolicy === 'training';
      const isCasualOpening = movePolicy === 'casual-opening';
      const temperature = movePolicy === 'competitive'
        ? 0
        : isTrainingPolicy
          ? activePly < 5 ? 24 : activePly < 9 ? 10 : 0
          : 15;
      const rootNoise = isTrainingPolicy
        ? activePly < 5 ? 0.25 : activePly < 9 ? 0.08 : 0
        : 0;
      const openingPlies = movePolicy === 'competitive' ? 0 : isCasualOpening ? 4 : 9;

      const { bestMove, score } = selectMove(game, weightsToUse, {
        depth: searchDepth,
        thinkTimeSec: req.thinkTimeSec,
        temperature,
        rootNoise,
        ply: activePly,
        openingPlies,
      });

      if (!bestMove) {
        const term = game.isTerminal();
        post({
          type: 'LIVE_STEP',
          move: { from: 0, to: 0, piece: 'P' as any },
          san: '',
          fenAfter: game.toFEN(),
          evalScore: score,
          isOver: term.isOver,
          winner: term.winner,
        });
        return;
      }

      const san = game.formatMoveSAN(bestMove);
      game.makeMove(bestMove);
      const fenAfter = game.toFEN();
      const term = game.isTerminal();

      post({
        type: 'LIVE_STEP',
        move: bestMove,
        san,
        fenAfter,
        evalScore: score,
        isOver: term.isOver,
        winner: term.winner,
      });
      break;
    }

    case 'ARENA_RUN': {
      if (isArenaRunning) return;
      isArenaRunning = true;
      isArenaPaused = false;
      arenaCancelled = false;

      const depthA = req.searchDepthA ?? req.searchDepth ?? 1;
      const depthB = req.searchDepthB ?? req.searchDepth ?? 1;
      const timeSecA = req.thinkTimeSecA;
      const timeSecB = req.thinkTimeSecB;
      const requestedGames = req.numGames;
      const totalGames = Math.floor(requestedGames);
      const seed = req.seed ?? 1;
      const openingPlies = Math.max(0, Math.floor(req.openingPlies ?? DEFAULT_MATCH_OPENING_PLIES));
      const safetyCap = Math.max(openingPlies, Math.floor(req.safetyCap ?? DEFAULT_MATCH_SAFETY_CAP));
      const startFen = req.startFen;
      const streamMoves = Boolean(req.streamMoves);
      const games: MatchGameLog[] = [];

      const weightsForCheckpoint = (checkpoint: typeof req.checkpointA) =>
        checkpoint.modelType === 'nnue' && checkpoint.nnueWeights
          ? deserializeWeights(checkpoint.nnueWeights)
          : (checkpoint.weights ?? createZeroWeights());

      const createAgent = (
        checkpoint: typeof req.checkpointA,
        depth: number,
        thinkTimeSec?: number
      ): MatchAgent => {
        const limit: SearchLimit = thinkTimeSec !== undefined && thinkTimeSec > 0
          ? { kind: 'time', valueMs: Math.max(1, Math.round(thinkTimeSec * 1000)) }
          : { kind: 'depth', value: Math.max(1, Math.floor(depth)) };
        return {
          modelId: checkpoint.id,
          modelName: checkpoint.name,
          kind: 'search',
          weights: weightsForCheckpoint(checkpoint),
          search: {
            engine: 'production',
            limit,
            maxDepth: MAX_SEARCH_DEPTH,
            count: 1,
            rootMode: 'greedy',
          },
        };
      };

      const agentA = createAgent(req.checkpointA, depthA, timeSecA);
      const agentB = createAgent(req.checkpointB, depthB, timeSecB);

      const currentSummary = () => summarizePairedMatchGames(games, {
        requestedGames: totalGames,
        pairCount: totalGames / 2,
        seed,
        openingPlies,
        safetyCap,
      });

      const sendArenaResults = (isCancelled: boolean) => {
        const summary = summarizePairedMatchGames(games, {
          requestedGames: totalGames,
          pairCount: totalGames / 2,
          seed,
          openingPlies,
          safetyCap,
        });
        const denominator = Math.max(1, summary.resolvedGames);
        post({
          type: 'ARENA_RESULT',
          winsA: summary.winsA,
          winsB: summary.winsB,
          draws: summary.draws,
          truncations: summary.truncations,
          cancelledGames: summary.cancelledGames,
          errors: summary.errors,
          winRateA: Math.round((summary.winsA / denominator) * 100),
          winRateB: Math.round((summary.winsB / denominator) * 100),
          drawRate: Math.round((summary.draws / denominator) * 100),
          gamesPlayed: summary.gamesPlayed,
          resolvedGames: summary.resolvedGames,
          requestedGames: totalGames,
          avgGameLength: summary.averagePlies,
          depthA,
          depthB,
          thinkTimeSecA: timeSecA,
          thinkTimeSecB: timeSecB,
          seed,
          pairCount: totalGames / 2,
          openingPlies,
          safetyCap,
          uniqueOpeningCount: summary.uniqueOpeningCount,
          duplicateOpeningCount: summary.duplicateOpeningCount,
          isCancelled,
          gameLogs: games,
          completedGames: games.map((game) => ({
            gameNumber: game.gameIndex + 1,
            fighterAIsBlue: game.aIsBlue,
            result: game.outcome === 'A'
              ? (game.aIsBlue ? '1-0' : '0-1')
              : game.outcome === 'B'
                ? (game.aIsBlue ? '0-1' : '1-0')
                : game.outcome === 'draw'
                  ? '1/2-1/2'
                  : '*',
            termination: game.reason ? `${game.outcome} (${game.reason})` : game.outcome,
            moves: game.moves.map((move) => ({ san: move.san })),
          })),
        });
      };

      if (!Number.isInteger(requestedGames) || requestedGames < 2 || requestedGames % 2 !== 0) {
        isArenaRunning = false;
        post({
          type: 'ARENA_RESULT',
          winsA: 0,
          winsB: 0,
          draws: 0,
          truncations: 0,
          cancelledGames: 0,
          errors: 1,
          winRateA: 0,
          winRateB: 0,
          drawRate: 0,
          gamesPlayed: 0,
          resolvedGames: 0,
          requestedGames: totalGames,
          seed,
          pairCount: 0,
          openingPlies,
          safetyCap,
          uniqueOpeningCount: 0,
          duplicateOpeningCount: 0,
          isCancelled: false,
          error: `Paired tournaments require an even integer game count of at least 2; received ${requestedGames}`,
          gameLogs: [],
          completedGames: [],
        });
        break;
      }

      let gameIdx = 0;

      function runNextGame() {
        if (arenaCancelled) {
          isArenaRunning = false;
          isArenaPaused = false;
          resumeArenaFn = null;
          sendArenaResults(true);
          return;
        }

        if (isArenaPaused) {
          resumeArenaFn = runNextGame;
          return;
        }

        if (gameIdx >= totalGames) {
          isArenaRunning = false;
          isArenaPaused = false;
          resumeArenaFn = null;
          sendArenaResults(false);
          return;
        }

        const pairIndex = Math.floor(gameIdx / 2);
        const aIsBlue = gameIdx % 2 === 0;
        const opening = createPairedMatchOpening(seed, pairIndex, startFen, openingPlies);
        const gameLog = runMatchGame({
          pairIndex,
          gameIndex: gameIdx,
          totalGames,
          seed,
          opening,
          agentA,
          agentB,
          aIsBlue,
          safetyCap,
          shouldCancel: () => arenaCancelled,
          onMove: (event) => {
            if (!streamMoves) return;
            const summary = currentSummary();
            post({
              type: 'ARENA_STREAM_MOVE',
              move: event.move.move,
              san: event.move.san,
              fen: event.move.fen,
              isOver: event.isOver,
              gameIndex: event.gameIndex + 1,
              totalGames,
              currentWinsA: summary.winsA,
              currentWinsB: summary.winsB,
              currentDraws: summary.draws,
              truncations: summary.truncations,
              cancelledGames: summary.cancelledGames,
              errors: summary.errors,
              fighterAIsBlue: event.aIsBlue,
            });
          },
        });
        games.push(gameLog);
        gameIdx++;

        const summary = summarizePairedMatchGames(games, {
          requestedGames: totalGames,
          pairCount: totalGames / 2,
          seed,
          openingPlies,
          safetyCap,
        });
        const lastMove = gameLog.moves[gameLog.moves.length - 1];

        // Send real-time game conclusion notification
        post({
          type: 'ARENA_STREAM_MOVE',
          move: lastMove?.move ?? { from: 0, to: 0, piece: 'P' as const },
          san: '',
          fen: lastMove?.fen ?? opening.startFen,
          isOver: true,
          gameIndex: gameIdx,
          totalGames,
          currentWinsA: summary.winsA,
          currentWinsB: summary.winsB,
          currentDraws: summary.draws,
          truncations: summary.truncations,
          cancelledGames: summary.cancelledGames,
          errors: summary.errors,
          fighterAIsBlue: aIsBlue,
        });

        if (gameIdx < totalGames && !arenaCancelled && gameLog.outcome !== 'cancelled') {
          if (isArenaPaused) {
            resumeArenaFn = runNextGame;
          } else {
            setTimeout(runNextGame, 0);
          }
        } else {
          isArenaRunning = false;
          resumeArenaFn = null;
          sendArenaResults(arenaCancelled || gameLog.outcome === 'cancelled');
        }
      }

      runNextGame();
      break;
    }

    case 'ARENA_PAUSE': {
      if (isArenaRunning) {
        isArenaPaused = true;
      }
      break;
    }

    case 'ARENA_RESUME': {
      if (isArenaRunning && isArenaPaused) {
        isArenaPaused = false;
        if (resumeArenaFn) {
          const fn = resumeArenaFn;
          resumeArenaFn = null;
          setTimeout(fn, 0);
        }
      }
      break;
    }

    case 'ARENA_STOP': {
      if (isArenaRunning) {
        arenaCancelled = true;
        isArenaPaused = false;
        resumeArenaFn = null;
      }
      break;
    }

    case 'START_ANALYSIS': {
      currentAnalysisId++;
      const thisId = currentAnalysisId;
      const targetFen = req.currentFen;
      const game = req.history
        ? IntransitiveGame.fromHistory(req.history, targetFen)
        : new IntransitiveGame(targetFen);
      const weights = req.weights ?? trainer.weights;
      const isInfinite = (req.maxDepth ?? 6) >= 99;
      // Iterative analysis yields between completed depths. This explicit
      // safety ceiling prevents an unbounded request from monopolizing the
      // worker while allowing ordinary requests above the old depth-6 cap.
      const maxDepth = isInfinite
        ? MAX_SEARCH_DEPTH
        : Math.min(MAX_SEARCH_DEPTH, Math.max(1, req.maxDepth ?? 6));
      const count = req.count ?? 5;
      const startTime = performance.now();
      const context = { nodes: 0 };
      let currentDepth = 1;
      let lastResult: RankedMove[] = [];

      function stepDepth() {
        if (thisId !== currentAnalysisId) return;

        let moves: RankedMove[];
        try {
          moves = getTopMoves(game, weights, count, currentDepth, context, () => thisId !== currentAnalysisId);
        } catch (error) {
          if (isSearchAbort(error)) return;
          throw error;
        }
        if (thisId !== currentAnalysisId) return;
        lastResult = moves;

        const elapsedMs = Math.max(1, performance.now() - startTime);
        const nps = Math.round((context.nodes * 1000) / elapsedMs);
        const isDone = !isInfinite && currentDepth >= maxDepth;

        post({
          type: isDone ? 'ANALYSIS_COMPLETE' : 'ANALYSIS_PROGRESS',
          depth: currentDepth,
          maxDepth,
          nodes: context.nodes,
          nps,
          timeMs: Math.round(elapsedMs),
          candidateMoves: lastResult,
          currentFen: targetFen,
        });

        // Early termination if top candidate move is a forced mate / touchdown fully resolved
        if (lastResult.length > 0 && lastResult[0].isMate) {
          const pliesNeeded = lastResult[0].mateInPlies ?? 99;
          if (pliesNeeded <= currentDepth) {
            if (!isDone) {
              post({
                type: 'ANALYSIS_COMPLETE',
                depth: currentDepth,
                maxDepth,
                nodes: context.nodes,
                nps,
                timeMs: Math.round(elapsedMs),
                candidateMoves: lastResult,
                currentFen: targetFen,
              });
            }
            return;
          }
        }

        currentDepth++;
        if (currentDepth <= maxDepth) {
          setTimeout(stepDepth, 0);
        } else if (isInfinite) {
          post({
            type: 'ANALYSIS_COMPLETE',
            depth: currentDepth - 1,
            maxDepth,
            nodes: context.nodes,
            nps,
            timeMs: Math.round(elapsedMs),
            candidateMoves: lastResult,
            currentFen: targetFen,
          });
        }
      }

      stepDepth();
      break;
    }

    case 'STOP_ANALYSIS': {
      currentAnalysisId++;
      break;
    }

    case 'SYNC_WEIGHTS':
    case 'SET_WEIGHTS': {
      currentWeights = req.weights;
      const prevConfig: Partial<TrainingConfig> = { ...trainer.learner.config };
      trainer = new SelfPlayTrainer(currentWeights, prevConfig);
      if (req.stats) {
        trainer.stats = req.stats;
      }
      post({
        type: 'CURRENT_STATE',
        weights: trainer.weights,
        stats: trainer.stats,
      });
      break;
    }

    case 'RESET_TRAINING': {
      currentWeights = createZeroWeights();
      trainer = new SelfPlayTrainer(currentWeights);
      post({
        type: 'CURRENT_STATE',
        weights: trainer.weights,
        stats: trainer.stats,
      });
      break;
    }
  }
} catch (err) {
  console.error('[trainingWorker Error]', err);
}
};
