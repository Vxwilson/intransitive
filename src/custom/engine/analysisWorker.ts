/**
 * Intransitive Custom Engine - Dedicated Analysis Web Worker
 * Runs continuous iterative deepening candidate move generation isolated from gameplay and training loops.
 */

import { IntransitiveGame } from '../core/game';
import { getTopMoves, isSearchAbort, MAX_SEARCH_DEPTH } from './search';
import { deserializeWeights } from './nnue/featureTransformer';
import { createHeuristicWeights } from './evaluator';
import type { NNUEWeights } from './nnue/types';
import type {
  WorkerRequest,
  WorkerResponse,
  RankedMove,
  EvaluationWeights,
} from './types';

let currentAnalysisId = 0;

function post(response: WorkerResponse): void {
  self.postMessage(response);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;

    switch (req.type) {
      case 'START_ANALYSIS': {
        currentAnalysisId++;
        const thisId = currentAnalysisId;
        const targetFen = req.currentFen;
        const game = req.history
          ? IntransitiveGame.fromHistory(req.history, targetFen)
          : new IntransitiveGame(targetFen);
        const activeWeights: EvaluationWeights | NNUEWeights = req.nnueWeights
          ? deserializeWeights(req.nnueWeights)
          : (req.weights ?? createHeuristicWeights());

        const isInfinite = (req.maxDepth ?? 6) >= 99;
        // Infinite mode is iterative and yields between completed depths. The
        // ceiling is a safety bound, not a claim that the requested depth was
        // reached; STOP_ANALYSIS still terminates/recreates this worker in the UI.
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

          const isAborted = () => thisId !== currentAnalysisId;
          let moves: RankedMove[];
          try {
            moves = getTopMoves(game, activeWeights, count, currentDepth, context, isAborted);
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

          // Early termination if top candidate move is a forced touchdown / decisive win resolved within this depth
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
            // Yield to allow message queue events (like STOP_ANALYSIS) to be processed
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
    }
  } catch (err) {
    console.error('[analysisWorker Error]', err);
  }
};
