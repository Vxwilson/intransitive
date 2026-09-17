/** Step 4 benchmark tests: aligned configurations and honest measurements. */

import { createHeuristicWeights, createZeroWeights } from './evaluator';
import { generateSelfPlayGame } from './selfPlay';
import { runTrainingBenchmark, type TrainingBenchmarkConfiguration } from './trainingBenchmark';
import type { SelfPlayBatchPool } from './parallelTraining';
import { SelfPlayTrainer } from './trainer';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`Training benchmark assertion failed: ${message}`);
}

class SynchronousPool implements SelfPlayBatchPool {
  public readonly workerCount: number;

  public constructor(workerCount: number) {
    this.workerCount = workerCount;
  }

  public async generateBatch(jobs: Parameters<SelfPlayBatchPool['generateBatch']>[0]) {
    // Return out of order to exercise the same coordinator ordering guarantee
    // used by the real Node and browser adapters.
    return jobs.slice().reverse().map((job) => generateSelfPlayGame(job));
  }

  public close(): void {
    // No resources to release in the test transport.
  }
}

const configurations: TrainingBenchmarkConfiguration[] = [
  { mode: 'serial-online', workerCount: 0, batchGames: 1 },
  { mode: 'frozen-batch', workerCount: 1, batchGames: 4 },
  { mode: 'frozen-batch', workerCount: 2, batchGames: 4 },
  { mode: 'frozen-batch', workerCount: 4, batchGames: 4 },
];

const report = await runTrainingBenchmark({
  seed: 20260917,
  searchDepth: 1,
  maxPlies: 4,
  requestedGames: 4,
  repetitions: 1,
  warmupGames: 0,
  configurations,
  measureCancellation: false,
  createPool: (workerCount) => new SynchronousPool(workerCount),
  createTrainer: (context) => new SelfPlayTrainer(
    createZeroWeights(),
    { searchDepth: 1, maxPliesPerGame: 4, learningRate: 0.015 },
    {
      runId: `benchmark-test-${context.mode}-${context.workerCount}-${context.phase}`,
      runSeed: 20260917,
      learnerColorPolicy: 'alternate',
      opponentPolicy: 'fixed',
      opponentWeights: createHeuristicWeights(),
      opponentId: 'heuristic-baseline',
    }
  ),
});

assert(report.samples.length === configurations.length, 'Every configuration must produce one sample');
assert(report.summaries.length === configurations.length, 'Every configuration must produce one summary');
const frozenSamples = report.samples.filter((sample) => sample.mode === 'frozen-batch');
assert(frozenSamples.every((sample) => sample.actualGames === 4), 'All worker counts must process the same game count');
assert(new Set(frozenSamples.map((sample) => sample.searchNodes)).size === 1, 'Worker count must not change search work');
assert(report.samples.find((sample) => sample.mode === 'serial-online')?.startupWallMs === 0, 'Serial mode has no worker startup');
assert(report.samples.every((sample) => sample.measuredWallMs >= 0), 'Measured wall times must be non-negative');
console.log('✅ Step 4 training benchmark verification passed.');
