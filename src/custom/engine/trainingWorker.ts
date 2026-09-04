/**
 * Intransitive Custom Engine - Training & Arena Web Worker
 * Runs headless self-play training batches and live-step evaluation without blocking the main UI thread.
 */

import { IntransitiveGame } from '../core/game';
import { createZeroWeights } from './evaluator';
import { selectMove } from './search';
import { SelfPlayTrainer } from './trainer';
import type {
  WorkerRequest,
  WorkerResponse,
  EvaluationWeights,
  TrainingConfig,
} from './types';

// Worker state
let currentWeights: EvaluationWeights = createZeroWeights();
let trainer = new SelfPlayTrainer(currentWeights);
let isTurboRunning = false;
let turboCancelled = false;

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
      const chunkSize = Math.min(25, totalGames);

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
      const searchDepth = req.config?.searchDepth ?? 2;
      const epsilon = req.config?.epsilon ?? 0.02;
      const weightsToUse = req.customWeights ?? trainer.weights;

      const { bestMove, score } = selectMove(game, weightsToUse, searchDepth, epsilon);


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
      const result = SelfPlayTrainer.runArenaTournament(
        req.checkpointA.weights,
        req.checkpointB.weights,
        req.numGames,
        1,
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
