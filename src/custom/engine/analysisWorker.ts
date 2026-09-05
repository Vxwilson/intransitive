/**
 * Intransitive Custom Engine - Dedicated Analysis Web Worker
 * Runs continuous iterative deepening candidate move generation isolated from gameplay and training loops.
 */

import { IntransitiveGame } from '../core/game';
import { getTopMoves } from './search';
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
        const game = new IntransitiveGame(targetFen);
        const activeWeights: EvaluationWeights | NNUEWeights = req.nnueWeights
          ? deserializeWeights(req.nnueWeights)
          : (req.weights ?? createHeuristicWeights());

        const isInfinite = (req.maxDepth ?? 6) >= 99;
        // Cap deep infinite analysis at Depth 6 (~45s limit) to ensure responsive worker turnaround
        const maxDepth = isInfinite ? 6 : Math.min(6, req.maxDepth ?? 6);
        const count = req.count ?? 5;
        const startTime = performance.now();
        const context = { nodes: 0 };
        let currentDepth = 1;
        let lastResult: RankedMove[] = [];

        function stepDepth() {
          if (thisId !== currentAnalysisId) return;

          const isAborted = () => thisId !== currentAnalysisId;
          const moves = getTopMoves(game, activeWeights, count, currentDepth, context, isAborted);
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

          // Early termination if top candidate move is a forced touchdown / decisive win resolved within this depth
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
            // Yield to allow message queue events (like STOP_ANALYSIS) to be processed
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
    }
  } catch (err) {
    console.error('[analysisWorker Error]', err);
  }
};
