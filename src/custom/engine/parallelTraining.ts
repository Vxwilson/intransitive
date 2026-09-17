/**
 * Synchronous frozen-policy batch training coordinator.
 *
 * A batch is generated entirely from one learner/opponent snapshot. Once all
 * jobs are back, results are validated, ordered by game ID, and applied by the
 * canonical SelfPlayTrainer. No worker ever receives mutable trainer state.
 */

import { SelfPlayTrainer, type GameRecord } from './trainer';
import { SelfPlayPoolCancelledError } from './selfPlayPool';
import { makeSelfPlayJobId } from './selfPlay';
import type {
  SelfPlayGameResult,
  SelfPlayGameJob,
} from './selfPlay';
import type { EvaluationWeights, TrainingStats } from './types';

export interface ParallelTrainingMetrics {
  requestedGames: number;
  /** Jobs whose complete batch was committed to the learner. */
  gamesGenerated: number;
  jobsDispatched: number;
  terminalGames: number;
  truncatedGames: number;
  acceptedLearningGames: number;
  positions: number;
  searchNodes: number;
  workerTimeMs: number;
  searchTimeMs: number;
  /** Wall time spent waiting for workers to produce the current batches. */
  generationWallMs: number;
  /** Time spent applying terminal TD updates in the coordinator. */
  updateTimeMs: number;
  /** Residual batch time after worker execution; includes transport/scheduling. */
  coordinationOverheadMs: number;
  elapsedWallMs: number;
  workerCount: number;
  batchGames: number;
  batchesStarted: number;
  batchesCompleted: number;
  nextBatchId: number;
  cancelled: boolean;
  /** Runtime adapter metadata; browser workers populate these when available. */
  startupWallMs?: number;
  cancellationLatencyMs?: number | null;
}

export interface ParallelTrainingProgress {
  completed: number;
  total: number;
  stats: TrainingStats;
  weights: EvaluationWeights;
  metrics: ParallelTrainingMetrics;
}

export interface ParallelTrainingRun {
  records: GameRecord[];
  metrics: ParallelTrainingMetrics;
}

export interface ParallelTrainingOptions {
  totalGames: number;
  batchGames: number;
  workerCount: number;
  initialBatchId?: number;
  shouldCancel?: () => boolean;
  onProgress?: (progress: ParallelTrainingProgress) => void;
}

/** Minimal pool contract used by the coordinator and easy to fake in tests. */
export interface SelfPlayBatchPool {
  readonly workerCount: number;
  generateBatch(
    jobs: SelfPlayGameJob[],
    shouldCancel?: () => boolean
  ): Promise<SelfPlayGameResult[]>;
  close(): void;
}

function emptyMetrics(options: ParallelTrainingOptions): ParallelTrainingMetrics {
  return {
    requestedGames: options.totalGames,
    gamesGenerated: 0,
    jobsDispatched: 0,
    terminalGames: 0,
    truncatedGames: 0,
    acceptedLearningGames: 0,
    positions: 0,
    searchNodes: 0,
    workerTimeMs: 0,
    searchTimeMs: 0,
    generationWallMs: 0,
    updateTimeMs: 0,
    coordinationOverheadMs: 0,
    elapsedWallMs: 0,
    workerCount: options.workerCount,
    batchGames: options.batchGames,
    batchesStarted: 0,
    batchesCompleted: 0,
    nextBatchId: options.initialBatchId ?? 0,
    cancelled: false,
  };
}

function validateBatch(
  jobs: SelfPlayGameJob[],
  results: SelfPlayGameResult[],
  trainer: SelfPlayTrainer
): SelfPlayGameResult[] {
  const expected = new Map(jobs.map((job) => [job.jobId, job]));
  if (expected.size !== jobs.length) {
    throw new Error('Coordinator generated duplicate self-play job IDs');
  }
  const received = new Map<string, SelfPlayGameResult>();

  for (const result of results) {
    const job = expected.get(result.jobId);
    if (!job) throw new Error(`Stale self-play result received for ${result.jobId}`);
    if (received.has(result.jobId)) {
      throw new Error(`Duplicate self-play result received for ${result.jobId}`);
    }
    if (result.runId !== job.runId || result.batchId !== job.batchId || result.gameId !== job.gameId) {
      throw new Error(`Self-play result identity mismatch for ${result.jobId}`);
    }
    if (result.seed !== job.seed || result.learnerVersion !== job.learnerVersion) {
      throw new Error(`Self-play result snapshot mismatch for ${result.jobId}`);
    }
    if (result.learnerColor !== job.learnerColor || result.opponentVersionId !== job.opponent.versionId) {
      throw new Error(`Self-play result model mismatch for ${result.jobId}`);
    }
    received.set(result.jobId, result);
  }

  if (received.size !== jobs.length) {
    throw new Error(`Incomplete self-play batch: received ${received.size} of ${jobs.length} results`);
  }

  // The trainer also validates the next game ID. This explicit check makes a
  // stale result fail before any result in this batch can mutate the learner.
  const expectedFirstGame = trainer.stats.gamesPlayed;
  if (jobs[0]?.gameId !== expectedFirstGame) {
    throw new Error(`Self-play batch starts at game ${jobs[0]?.gameId}; expected ${expectedFirstGame}`);
  }
  for (let index = 1; index < jobs.length; index++) {
    if (jobs[index].gameId !== expectedFirstGame + index) {
      throw new Error(`Self-play batch game IDs are not contiguous at index ${index}`);
    }
  }

  return jobs.map((job) => {
    const result = received.get(job.jobId);
    if (!result) throw new Error(`Missing self-play result for ${job.jobId}`);
    return result;
  });
}

/**
 * Run frozen-policy batches through a persistent worker pool.
 *
 * `batchGames` is deliberately independent of `workerCount`: changing worker
 * parallelism changes scheduling speed, not which snapshot each game sees or
 * the order in which learning updates are committed.
 */
export async function runParallelSelfPlayTraining(
  trainer: SelfPlayTrainer,
  pool: SelfPlayBatchPool,
  options: ParallelTrainingOptions
): Promise<ParallelTrainingRun> {
  if (!Number.isInteger(options.totalGames) || options.totalGames < 0) {
    throw new Error(`Training game count must be a non-negative integer, got ${options.totalGames}`);
  }
  if (!Number.isInteger(options.batchGames) || options.batchGames < 1) {
    throw new Error(`Training batch size must be a positive integer, got ${options.batchGames}`);
  }
  if (!Number.isInteger(options.workerCount) || options.workerCount < 1) {
    throw new Error(`Training worker count must be a positive integer, got ${options.workerCount}`);
  }
  if (options.initialBatchId !== undefined && (!Number.isInteger(options.initialBatchId) || options.initialBatchId < 0)) {
    throw new Error(`Initial training batch ID must be a non-negative integer, got ${options.initialBatchId}`);
  }
  if (pool.workerCount !== options.workerCount) {
    throw new Error(
      `Training pool has ${pool.workerCount} workers; configuration requested ${options.workerCount}`
    );
  }

  const shouldCancel = options.shouldCancel ?? (() => false);
  const metrics = emptyMetrics(options);
  const records: GameRecord[] = [];
  const startedAt = performance.now();

  while (records.length < options.totalGames) {
    if (shouldCancel()) {
      pool.close();
      metrics.cancelled = true;
      break;
    }

    const count = Math.min(options.batchGames, options.totalGames - records.length);
    const batchId = metrics.nextBatchId;
    const jobs = trainer.createSelfPlayBatchJobs(batchId, count);
    if (jobs.length !== count || jobs.some((job) => job.jobId !== makeSelfPlayJobId(job.runId, batchId, job.gameId))) {
      throw new Error(`Coordinator generated an invalid self-play batch ${batchId}`);
    }
    metrics.batchesStarted++;
    metrics.jobsDispatched += jobs.length;

    let results: SelfPlayGameResult[];
    const generationStartedAt = performance.now();
    try {
      results = await pool.generateBatch(jobs, shouldCancel);
    } catch (error) {
      if (error instanceof SelfPlayPoolCancelledError || shouldCancel()) {
        metrics.cancelled = true;
        break;
      }
      throw error;
    }

    // A stop received just after the final worker response still discards this
    // batch. This is the checkpoint boundary promised by the run contract.
    if (shouldCancel()) {
      pool.close();
      metrics.cancelled = true;
      break;
    }
    const generationWallMs = performance.now() - generationStartedAt;
    metrics.generationWallMs += generationWallMs;
    const longestWorkerMs = results.reduce(
      (longest, result) => Math.max(longest, result.telemetry.totalTimeMs),
      0
    );
    metrics.coordinationOverheadMs += Math.max(0, generationWallMs - longestWorkerMs);

    const orderedResults = validateBatch(jobs, results, trainer);
    const updateStartedAt = performance.now();
    for (const result of orderedResults) {
      const record = trainer.applySelfPlayGameResult(result);
      records.push(record);
      metrics.gamesGenerated++;
      metrics.terminalGames += result.outcome.isTerminal ? 1 : 0;
      metrics.truncatedGames += result.outcome.isTruncated ? 1 : 0;
      metrics.acceptedLearningGames += result.outcome.isTerminal ? 1 : 0;
      metrics.positions += result.telemetry.generatedPositions;
      metrics.searchNodes += result.telemetry.searchNodes;
      metrics.workerTimeMs += result.telemetry.totalTimeMs;
      metrics.searchTimeMs += result.telemetry.searchTimeMs;
    }
    metrics.updateTimeMs += performance.now() - updateStartedAt;
    metrics.batchesCompleted++;
    metrics.nextBatchId = batchId + 1;
    metrics.elapsedWallMs = performance.now() - startedAt;

    options.onProgress?.({
      completed: records.length,
      total: options.totalGames,
      stats: trainer.stats,
      weights: trainer.weights,
      metrics: { ...metrics },
    });
  }

  metrics.elapsedWallMs = performance.now() - startedAt;
  return { records, metrics: { ...metrics } };
}
