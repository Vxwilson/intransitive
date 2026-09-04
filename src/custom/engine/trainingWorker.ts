/**
 * Intransitive Custom Engine - Training & Arena Web Worker
 * Runs headless self-play training batches and live-step evaluation without blocking the main UI thread.
 */

import { IntransitiveGame } from '../core/game';
import { createZeroWeights } from './evaluator';
import { selectMove, getTopMoves } from './search';
import { SelfPlayTrainer } from './trainer';
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
let isTurboRunning = false;
let turboCancelled = false;
let currentAnalysisId = 0;

function post(response: WorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
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

    case 'STEP_LIVE': {
      const game = new IntransitiveGame(req.currentFen);
      const searchDepth = req.searchDepth ?? req.config?.searchDepth ?? 2;
      const weightsToUse = req.customWeights ?? trainer.weights;

      // AlphaZero dynamic live play: Use Softmax temperature (T = 15 cp) for opening plies (0..3)
      // to ensure rich branching and avoid deterministic repetition across matches,
      // then greedy argmax for tactically sound midgame/endgame conversion.
      const { bestMove, score } = selectMove(game, weightsToUse, {
        depth: searchDepth,
        temperature: 15.0,
        rootNoise: 0.0,
        ply: game.halfmoveClock,
        openingPlies: 4,
      });


      if (!bestMove) {
        const term = game.isTerminal();
        post({
          type: 'LIVE_STEP',
          move: { from: 0, to: 0, piece: 'R' },
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
      const depth = req.searchDepth ?? 1;
      const result = SelfPlayTrainer.runArenaTournament(
        req.checkpointA.weights,
        req.checkpointB.weights,
        req.numGames,
        depth,
        req.streamMoves
          ? (moveData) => {
              post({
                type: 'ARENA_STREAM_MOVE',
                ...moveData,
              });
            }
          : undefined
      );
      post({
        type: 'ARENA_RESULT',
        ...result,
      });
      break;
    }

    case 'START_ANALYSIS': {
      currentAnalysisId++;
      const thisId = currentAnalysisId;
      const targetFen = req.currentFen;
      const game = new IntransitiveGame(targetFen);
      const weights = req.weights ?? trainer.weights;
      const maxDepth = req.maxDepth ?? 6;
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
        const isDone = currentDepth >= maxDepth;

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
};
