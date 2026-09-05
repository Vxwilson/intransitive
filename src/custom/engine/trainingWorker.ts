/**
 * Intransitive Custom Engine - Training & Arena Web Worker
 * Runs headless self-play training batches and live-step evaluation without blocking the main UI thread.
 */

import { IntransitiveGame } from '../core/game';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import { createZeroWeights, createHeuristicWeights } from './evaluator';
import { selectMove, getTopMoves } from './search';
import { SelfPlayTrainer } from './trainer';
import { NNUETrainer } from './nnue/nnueTrainer';
import { deserializeWeights, serializeWeights, getActiveFeatures } from './nnue/featureTransformer';
import { createMasterNNUEWeights } from './nnue/nnueWeights';
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
          }

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
      const game = new IntransitiveGame(req.currentFen);
      const searchDepth = req.searchDepth ?? req.config?.searchDepth ?? 2;
      const weightsToUse = req.customNNUEWeights
        ? deserializeWeights(req.customNNUEWeights)
        : (req.customWeights ?? trainer.weights);

      // AlphaZero dynamic live play: Use Softmax temperature (T = 15 cp) for opening plies (0..3)
      // to ensure rich branching and avoid deterministic repetition across matches,
      // then greedy argmax for tactically sound midgame/endgame conversion.
      const { bestMove, score } = selectMove(game, weightsToUse, {
        depth: searchDepth,
        thinkTimeSec: req.thinkTimeSec,
        temperature: 15.0,
        rootNoise: 0.0,
        ply: game.halfmoveClock,
        openingPlies: 4,
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
      const totalGames = req.numGames;

      const weightsA = req.checkpointA.modelType === 'nnue' && req.checkpointA.nnueWeights
        ? deserializeWeights(req.checkpointA.nnueWeights)
        : (req.checkpointA.weights ?? createZeroWeights());

      const weightsB = req.checkpointB.modelType === 'nnue' && req.checkpointB.nnueWeights
        ? deserializeWeights(req.checkpointB.nnueWeights)
        : (req.checkpointB.weights ?? createZeroWeights());

      const streamMoves = Boolean(req.streamMoves);
      let gameIdx = 0;
      let winsA = 0;
      let winsB = 0;
      let draws = 0;
      let totalPlies = 0;
      let movesA = 0;
      let accurateMovesA = 0;
      let movesB = 0;
      let accurateMovesB = 0;
      const benchmarkWeights = createHeuristicWeights();
      const completedGames: {
        gameNumber: number;
        fighterAIsBlue: boolean;
        result: string;
        termination: string;
        moves: { san: string }[];
      }[] = [];

      function sendArenaResults(isCancelled: boolean) {
        const gamesPlayed = Math.max(1, winsA + winsB + draws);
        const winRateA = Math.round((winsA / gamesPlayed) * 100);
        const winRateB = Math.round((winsB / gamesPlayed) * 100);
        const drawRate = Math.round((draws / gamesPlayed) * 100);
        const avgGameLength = gamesPlayed > 0 ? Math.round(totalPlies / gamesPlayed) : 0;
        const accuracyA = movesA > 0 ? Math.round((accurateMovesA / movesA) * 100) : 50;
        const accuracyB = movesB > 0 ? Math.round((accurateMovesB / movesB) * 100) : 50;

        post({
          type: 'ARENA_RESULT',
          winsA,
          winsB,
          draws,
          winRateA,
          winRateB,
          drawRate,
          gamesPlayed: winsA + winsB + draws,
          avgGameLength,
          accuracyA,
          accuracyB,
          depthA,
          depthB,
          thinkTimeSecA: timeSecA,
          thinkTimeSecB: timeSecB,
          isCancelled,
          completedGames,
        });
      }

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

        const aIsBlue = gameIdx % 2 === 0;
        const gameRes = SelfPlayTrainer.playArenaGame(
          gameIdx,
          totalGames,
          weightsA,
          weightsB,
          depthA,
          depthB,
          timeSecA,
          timeSecB,
          (moveData) => {
            if (streamMoves || moveData.isOver) {
              post({
                type: 'ARENA_STREAM_MOVE',
                ...moveData,
                gameIndex: gameIdx + 1,
                totalGames,
                currentWinsA: winsA,
                currentWinsB: winsB,
                currentDraws: draws,
                fighterAIsBlue: aIsBlue,
              });
            }
          },
          benchmarkWeights,
          () => arenaCancelled
        );

        if (gameRes.winner === 'A') winsA++;
        else if (gameRes.winner === 'B') winsB++;
        else draws++;

        totalPlies += gameRes.plies;
        movesA += gameRes.movesA;
        accurateMovesA += gameRes.accurateMovesA;
        movesB += gameRes.movesB;
        accurateMovesB += gameRes.accurateMovesB;
        gameIdx++;

        const pgnResult = gameRes.winner === 'A' ? (aIsBlue ? '1-0' : '0-1') : gameRes.winner === 'B' ? (aIsBlue ? '0-1' : '1-0') : '1/2-1/2';
        const termWinner = gameRes.winner === 'draw' ? 'Draw' : gameRes.winner === 'A' ? (aIsBlue ? 'Blue won' : 'Red won') : (aIsBlue ? 'Red won' : 'Blue won');
        const termReason = gameRes.reason ? `${termWinner} (${gameRes.reason})` : termWinner;
        completedGames.push({
          gameNumber: gameIdx,
          fighterAIsBlue: aIsBlue,
          result: pgnResult,
          termination: termReason,
          moves: (gameRes.sanMoves || []).map((san) => ({ san })),
        });

        // Send real-time game conclusion notification
        post({
          type: 'ARENA_STREAM_MOVE',
          move: gameRes.lastMove,
          san: '',
          fen: gameRes.lastFen,
          isOver: true,
          gameIndex: gameIdx,
          totalGames,
          currentWinsA: winsA,
          currentWinsB: winsB,
          currentDraws: draws,
          fighterAIsBlue: aIsBlue,
        });

        if (gameIdx < totalGames && !arenaCancelled) {
          if (isArenaPaused) {
            resumeArenaFn = runNextGame;
          } else {
            setTimeout(runNextGame, 0);
          }
        } else {
          isArenaRunning = false;
          resumeArenaFn = null;
          sendArenaResults(arenaCancelled);
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
      const game = new IntransitiveGame(targetFen);
      const weights = req.weights ?? trainer.weights;
      const isInfinite = (req.maxDepth ?? 6) >= 99;
      const maxDepth = isInfinite ? 16 : (req.maxDepth ?? 6);
      const count = req.count ?? 5;
      const startTime = performance.now();
      const context = { nodes: 0 };
      let currentDepth = 1;
      let lastResult: RankedMove[] = [];

      function stepDepth() {
        if (thisId !== currentAnalysisId) return;

        const moves = getTopMoves(game, weights, count, currentDepth, context);
        if (thisId !== currentAnalysisId) return;
        lastResult = moves;

        const elapsedMs = Math.max(1, performance.now() - startTime);
        const nps = Math.round((context.nodes * 1000) / elapsedMs);
        const isDone = !isInfinite && currentDepth >= maxDepth;

        post({
          type: isDone ? 'ANALYSIS_COMPLETE' : 'ANALYSIS_PROGRESS',
          depth: currentDepth,
          maxDepth: isInfinite ? 99 : maxDepth,
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
                maxDepth: isInfinite ? 99 : maxDepth,
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
            maxDepth: 99,
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
