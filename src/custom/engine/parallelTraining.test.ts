/** Step 3 coordinator tests: frozen batches, ordering, and cancellation. */

import { createZeroWeights, createHeuristicWeights } from './evaluator';
import { generateSelfPlayGame } from './selfPlay';
import { runParallelSelfPlayTraining, type SelfPlayBatchPool } from './parallelTraining';
import type { SelfPlayGameJob, SelfPlayGameResult } from './selfPlay';
import { SelfPlayTrainer } from './trainer';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Parallel training assertion failed: ${message}`);
}

class DeterministicPool implements SelfPlayBatchPool {
  public readonly workerCount: number;
  public closed = false;

  public constructor(workerCount: number) {
    this.workerCount = workerCount;
  }

  public async generateBatch(
    jobs: SelfPlayGameJob[],
    shouldCancel: () => boolean = () => false
  ): Promise<SelfPlayGameResult[]> {
    if (shouldCancel()) throw new Error('cancelled');
    // Reverse completion order to ensure the coordinator, rather than the
    // pool, owns deterministic learning order.
    return jobs.slice().reverse().map((job) => generateSelfPlayGame(job));
  }

  public close(): void {
    this.closed = true;
  }
}

function createTrainer(): SelfPlayTrainer {
  return new SelfPlayTrainer(createZeroWeights(), {
    searchDepth: 1,
    maxPliesPerGame: 4,
    learningRate: 0.015,
  }, {
    runId: 'parallel-coordinator-test',
    runSeed: 20260917,
    opponentPolicy: 'fixed',
    opponentWeights: createHeuristicWeights(),
    opponentId: 'heuristic-baseline',
  });
}

async function run(workerCount: number) {
  const trainer = createTrainer();
  const pool = new DeterministicPool(workerCount);
  const result = await runParallelSelfPlayTraining(trainer, pool, {
    totalGames: 4,
    batchGames: 4,
    workerCount,
  });
  return { trainer, pool, result };
}

console.log('🧪 Starting Step 3 parallel coordinator verification...');
const oneWorker = await run(1);
const fourWorkers = await run(4);
assert(JSON.stringify(oneWorker.result.records) === JSON.stringify(fourWorkers.result.records), 'Worker count must not change game records');
assert(JSON.stringify(oneWorker.trainer.weights) === JSON.stringify(fourWorkers.trainer.weights), 'Worker count must not change committed weights');
assert(JSON.stringify(oneWorker.trainer.stats) === JSON.stringify(fourWorkers.trainer.stats), 'Worker count must not change committed stats');
assert(oneWorker.result.metrics.searchNodes === fourWorkers.result.metrics.searchNodes, 'Worker count must not change search work');
assert(oneWorker.result.metrics.gamesGenerated === 4 && oneWorker.result.metrics.batchesCompleted === 1, 'Complete batches must commit exactly once');
assert(oneWorker.result.metrics.truncatedGames === 4, 'Safety-cap outcomes must remain truncations');
console.log('✓ Frozen batch results are deterministic across worker counts and arrival order');

const cancelledTrainer = createTrainer();
const cancelledPool = new DeterministicPool(2);
const cancelled = await runParallelSelfPlayTraining(cancelledTrainer, cancelledPool, {
  totalGames: 4,
  batchGames: 4,
  workerCount: 2,
  shouldCancel: () => true,
});
assert(cancelled.metrics.cancelled, 'Cancellation must be reported');
assert(cancelled.records.length === 0 && cancelledTrainer.stats.gamesPlayed === 0, 'Incomplete batches must not commit');
assert(cancelledPool.closed, 'Cancellation must close the pool');
console.log('✓ Cancellation discards the active batch and preserves the last committed state');

console.log('✅ Step 3 parallel coordinator verification passed.');
