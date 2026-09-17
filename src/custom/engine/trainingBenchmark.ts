/**
 * Controlled training throughput benchmark.
 *
 * The benchmark compares two different learning schedules explicitly:
 * serial online TD updates after every game, and frozen-policy batches whose
 * results are committed in game-ID order. Worker count is varied only inside
 * the latter schedule, so a speed comparison never accidentally changes the
 * batch size or learning algorithm.
 */

import { runParallelSelfPlayTraining, type ParallelTrainingMetrics, type SelfPlayBatchPool } from './parallelTraining';
import { runSerialOnlineSelfPlayTraining, type SerialTrainingMetrics } from './serialTraining';
import type { SelfPlayGameJob } from './selfPlay';
import type { SelfPlayTrainer } from './trainer';

export type TrainingBenchmarkMode = 'serial-online' | 'frozen-batch';

export interface TrainingBenchmarkConfiguration {
  mode: TrainingBenchmarkMode;
  workerCount: number;
  batchGames: number;
}

export interface TrainingBenchmarkContext {
  phase: 'warmup' | 'measured' | 'cancellation-probe';
  mode: TrainingBenchmarkMode;
  workerCount: number;
  batchGames: number;
  repetition: number;
}

export interface TrainingBenchmarkSample {
  mode: TrainingBenchmarkMode;
  workerCount: number;
  batchGames: number;
  repetition: number;
  requestedGames: number;
  actualGames: number;
  terminalGames: number;
  truncatedGames: number;
  acceptedLearningGames: number;
  positions: number;
  searchNodes: number;
  startupWallMs: number;
  warmupWallMs: number;
  measuredWallMs: number;
  measuredCpuMs: number | null;
  generationWallMs: number;
  updateTimeMs: number;
  /** Residual generation time, including worker transport/scheduling. */
  coordinationOverheadMs: number;
  memoryBeforeBytes: number | null;
  memoryAfterBytes: number | null;
  peakMemoryBytes: number | null;
  cancellationLatencyMs: number | null;
  gamesPerSecond: number;
  positionsPerSecond: number;
  nodesPerSecond: number;
}

export interface TrainingBenchmarkSummary {
  mode: TrainingBenchmarkMode;
  workerCount: number;
  batchGames: number;
  samples: number;
  medianWallMs: number;
  medianCpuMs: number | null;
  medianGamesPerSecond: number;
  medianPositionsPerSecond: number;
  medianNodesPerSecond: number;
  medianGenerationWallMs: number;
  medianUpdateTimeMs: number;
  medianCoordinationOverheadMs: number;
  medianCancellationLatencyMs: number | null;
  totalActualGames: number;
  totalTerminalGames: number;
  totalTruncatedGames: number;
  totalAcceptedLearningGames: number;
  totalPositions: number;
  totalSearchNodes: number;
}

export interface TrainingBenchmarkReport {
  kind: 'intransitive-training-benchmark-report';
  schemaVersion: 1;
  engineVersion: string;
  seed: number;
  searchDepth: number;
  maxPlies: number;
  requestedGames: number;
  repetitions: number;
  warmupGames: number;
  configurations: TrainingBenchmarkConfiguration[];
  samples: TrainingBenchmarkSample[];
  summaries: TrainingBenchmarkSummary[];
}

export interface TrainingBenchmarkOptions {
  seed: number;
  searchDepth: number;
  maxPlies: number;
  requestedGames: number;
  repetitions: number;
  warmupGames: number;
  configurations: TrainingBenchmarkConfiguration[];
  createTrainer: (context: TrainingBenchmarkContext) => SelfPlayTrainer;
  createPool?: (workerCount: number) => SelfPlayBatchPool;
  /** Optional process/runtime hook. Return a cumulative CPU time in ms. */
  readCpuTimeMs?: () => number;
  /** Optional process/runtime hook. RSS is preferred for Node measurements. */
  readMemoryBytes?: () => number;
  measureCancellation?: boolean;
  engineVersion?: string;
}

type TrainingRunMetrics = SerialTrainingMetrics | ParallelTrainingMetrics;

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function medianNullable(values: Array<number | null>): number | null {
  const defined = values.filter((value): value is number => value !== null);
  return defined.length > 0 ? roundMetric(median(defined)) : null;
}

function validateOptions(options: TrainingBenchmarkOptions): void {
  if (!Number.isInteger(options.seed) || options.seed < 0) {
    throw new Error(`Benchmark seed must be a non-negative integer, got ${options.seed}`);
  }
  if (!Number.isInteger(options.searchDepth) || options.searchDepth < 1) {
    throw new Error(`Benchmark search depth must be a positive integer, got ${options.searchDepth}`);
  }
  if (!Number.isInteger(options.maxPlies) || options.maxPlies < 1) {
    throw new Error(`Benchmark ply cap must be a positive integer, got ${options.maxPlies}`);
  }
  if (!Number.isInteger(options.requestedGames) || options.requestedGames < 1) {
    throw new Error(`Benchmark game count must be a positive integer, got ${options.requestedGames}`);
  }
  if (!Number.isInteger(options.repetitions) || options.repetitions < 1) {
    throw new Error(`Benchmark repetitions must be a positive integer, got ${options.repetitions}`);
  }
  if (!Number.isInteger(options.warmupGames) || options.warmupGames < 0) {
    throw new Error(`Benchmark warmup game count must be a non-negative integer, got ${options.warmupGames}`);
  }
  if (options.configurations.length === 0) {
    throw new Error('Benchmark requires at least one configuration');
  }
  for (const configuration of options.configurations) {
    if (!Number.isInteger(configuration.workerCount) || configuration.workerCount < 0) {
      throw new Error(`Invalid benchmark worker count: ${configuration.workerCount}`);
    }
    if (configuration.mode === 'serial-online' && configuration.workerCount !== 0) {
      throw new Error('Serial benchmark configurations must use workerCount 0');
    }
    if (configuration.mode === 'frozen-batch' && configuration.workerCount < 1) {
      throw new Error('Frozen-batch benchmark configurations require a worker');
    }
    if (!Number.isInteger(configuration.batchGames) || configuration.batchGames < 1) {
      throw new Error(`Invalid benchmark batch size: ${configuration.batchGames}`);
    }
  }
  if (options.configurations.some((configuration) => configuration.mode === 'frozen-batch') && !options.createPool) {
    throw new Error('Frozen-batch benchmarks require a worker-pool factory');
  }
}

async function warmPool(
  pool: SelfPlayBatchPool,
  trainer: SelfPlayTrainer,
  games: number,
  batchGames: number
): Promise<void> {
  // Always send at least one full batch for persistent worker warm-up. This
  // separates module/JIT startup from the measured training run.
  const warmupGames = Math.max(batchGames, games);
  let completed = 0;
  let batchId = 0;
  while (completed < warmupGames) {
    const count = Math.min(batchGames, warmupGames - completed);
    const jobs: SelfPlayGameJob[] = trainer.createSelfPlayBatchJobs(batchId++, count);
    await pool.generateBatch(jobs);
    completed += count;
  }
}

async function measureCancellation(
  options: TrainingBenchmarkOptions,
  configuration: TrainingBenchmarkConfiguration,
  repetition: number
): Promise<number | null> {
  if (configuration.mode !== 'frozen-batch' || !options.measureCancellation || !options.createPool) {
    return null;
  }

  const pool = options.createPool(configuration.workerCount);
  const trainer = options.createTrainer({
    phase: 'cancellation-probe',
    ...configuration,
    repetition,
  });
  let cancellationRequestedAt: number | null = null;
  let cancelled = false;
  const timer = setTimeout(() => {
    cancellationRequestedAt = performance.now();
    cancelled = true;
  }, 0);
  try {
    await runParallelSelfPlayTraining(trainer, pool, {
      totalGames: Math.max(1, configuration.batchGames),
      batchGames: configuration.batchGames,
      workerCount: configuration.workerCount,
      shouldCancel: () => cancelled,
    });
  } finally {
    clearTimeout(timer);
    pool.close();
  }
  return cancellationRequestedAt === null
    ? null
    : roundMetric(Math.max(0, performance.now() - cancellationRequestedAt));
}

async function runMeasuredConfiguration(
  options: TrainingBenchmarkOptions,
  configuration: TrainingBenchmarkConfiguration,
  repetition: number
): Promise<TrainingBenchmarkSample> {
  let pool: SelfPlayBatchPool | undefined;
  let startupWallMs = 0;
  let warmupWallMs = 0;

  if (configuration.mode === 'frozen-batch') {
    const startupStartedAt = performance.now();
    pool = options.createPool!(configuration.workerCount);
    startupWallMs = performance.now() - startupStartedAt;

    const warmupTrainer = options.createTrainer({ phase: 'warmup', ...configuration, repetition });
    const warmupStartedAt = performance.now();
    try {
      await warmPool(pool, warmupTrainer, options.warmupGames, configuration.batchGames);
    } catch (error) {
      pool.close();
      throw error;
    }
    warmupWallMs = performance.now() - warmupStartedAt;
  } else if (options.warmupGames > 0) {
    const warmupTrainer = options.createTrainer({ phase: 'warmup', ...configuration, repetition });
    const warmupStartedAt = performance.now();
    runSerialOnlineSelfPlayTraining(warmupTrainer, { totalGames: options.warmupGames });
    warmupWallMs = performance.now() - warmupStartedAt;
  }

  const trainer = options.createTrainer({ phase: 'measured', ...configuration, repetition });
  const memoryBeforeBytes = options.readMemoryBytes?.() ?? null;
  let peakMemoryBytes = memoryBeforeBytes;
  const memoryTimer = options.readMemoryBytes
    ? setInterval(() => {
        const current = options.readMemoryBytes!();
        peakMemoryBytes = peakMemoryBytes === null ? current : Math.max(peakMemoryBytes, current);
      }, 10)
    : undefined;
  const cpuBeforeMs = options.readCpuTimeMs?.() ?? null;

  let run: { records: unknown[]; metrics: TrainingRunMetrics } | null = null;
  const measuredStartedAt = performance.now();
  let measuredWallMs: number | null = null;
  let cpuAfterMs: number | null = null;
  let memoryAfterBytes: number | null = null;
  try {
    if (configuration.mode === 'serial-online') {
      run = runSerialOnlineSelfPlayTraining(trainer, {
        totalGames: options.requestedGames,
      }) as { records: unknown[]; metrics: SerialTrainingMetrics };
    } else {
      run = await runParallelSelfPlayTraining(trainer, pool!, {
        totalGames: options.requestedGames,
        batchGames: configuration.batchGames,
        workerCount: configuration.workerCount,
      }) as { records: unknown[]; metrics: ParallelTrainingMetrics };
    }
    measuredWallMs = performance.now() - measuredStartedAt;
    cpuAfterMs = options.readCpuTimeMs?.() ?? null;
    memoryAfterBytes = options.readMemoryBytes?.() ?? null;
  } finally {
    if (memoryTimer !== undefined) clearInterval(memoryTimer);
    if (pool) pool.close();
  }
  if (!run) throw new Error('Training benchmark did not produce a run result');
  if (measuredWallMs === null) throw new Error('Training benchmark did not record elapsed time');
  if (memoryAfterBytes !== null) {
    peakMemoryBytes = peakMemoryBytes === null
      ? memoryAfterBytes
      : Math.max(peakMemoryBytes, memoryAfterBytes);
  }

  const metrics = run.metrics;
  const actualGames = run.records.length;
  const gamesPerSecond = measuredWallMs > 0 ? actualGames * 1000 / measuredWallMs : 0;
  const positionsPerSecond = measuredWallMs > 0 ? metrics.positions * 1000 / measuredWallMs : 0;
  const nodesPerSecond = measuredWallMs > 0 ? metrics.searchNodes * 1000 / measuredWallMs : 0;

  return {
    mode: configuration.mode,
    workerCount: configuration.workerCount,
    batchGames: configuration.batchGames,
    repetition,
    requestedGames: options.requestedGames,
    actualGames,
    terminalGames: metrics.terminalGames,
    truncatedGames: metrics.truncatedGames,
    acceptedLearningGames: metrics.acceptedLearningGames,
    positions: metrics.positions,
    searchNodes: metrics.searchNodes,
    startupWallMs: roundMetric(startupWallMs),
    warmupWallMs: roundMetric(warmupWallMs),
    measuredWallMs: roundMetric(measuredWallMs),
    measuredCpuMs: cpuBeforeMs === null || cpuAfterMs === null
      ? null
      : roundMetric(Math.max(0, cpuAfterMs - cpuBeforeMs)),
    generationWallMs: roundMetric(metrics.generationWallMs),
    updateTimeMs: roundMetric(metrics.updateTimeMs),
    coordinationOverheadMs: roundMetric(metrics.coordinationOverheadMs),
    memoryBeforeBytes,
    memoryAfterBytes,
    peakMemoryBytes,
    cancellationLatencyMs: await measureCancellation(options, configuration, repetition),
    gamesPerSecond: roundMetric(gamesPerSecond),
    positionsPerSecond: roundMetric(positionsPerSecond),
    nodesPerSecond: roundMetric(nodesPerSecond),
  };
}

function summarizeSamples(samples: TrainingBenchmarkSample[]): TrainingBenchmarkSummary[] {
  const groups = new Map<string, TrainingBenchmarkSample[]>();
  for (const sample of samples) {
    const key = `${sample.mode}:${sample.workerCount}:${sample.batchGames}`;
    const group = groups.get(key) ?? [];
    group.push(sample);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const first = group[0];
    return {
      mode: first.mode,
      workerCount: first.workerCount,
      batchGames: first.batchGames,
      samples: group.length,
      medianWallMs: roundMetric(median(group.map((sample) => sample.measuredWallMs))),
      medianCpuMs: medianNullable(group.map((sample) => sample.measuredCpuMs)),
      medianGamesPerSecond: roundMetric(median(group.map((sample) => sample.gamesPerSecond))),
      medianPositionsPerSecond: roundMetric(median(group.map((sample) => sample.positionsPerSecond))),
      medianNodesPerSecond: roundMetric(median(group.map((sample) => sample.nodesPerSecond))),
      medianGenerationWallMs: roundMetric(median(group.map((sample) => sample.generationWallMs))),
      medianUpdateTimeMs: roundMetric(median(group.map((sample) => sample.updateTimeMs))),
      medianCoordinationOverheadMs: roundMetric(median(group.map((sample) => sample.coordinationOverheadMs))),
      medianCancellationLatencyMs: medianNullable(group.map((sample) => sample.cancellationLatencyMs)),
      totalActualGames: group.reduce((total, sample) => total + sample.actualGames, 0),
      totalTerminalGames: group.reduce((total, sample) => total + sample.terminalGames, 0),
      totalTruncatedGames: group.reduce((total, sample) => total + sample.truncatedGames, 0),
      totalAcceptedLearningGames: group.reduce((total, sample) => total + sample.acceptedLearningGames, 0),
      totalPositions: group.reduce((total, sample) => total + sample.positions, 0),
      totalSearchNodes: group.reduce((total, sample) => total + sample.searchNodes, 0),
    };
  });
}

export async function runTrainingBenchmark(
  options: TrainingBenchmarkOptions
): Promise<TrainingBenchmarkReport> {
  validateOptions(options);
  const samples: TrainingBenchmarkSample[] = [];
  for (const configuration of options.configurations) {
    for (let repetition = 1; repetition <= options.repetitions; repetition++) {
      samples.push(await runMeasuredConfiguration(options, configuration, repetition));
    }
  }

  return {
    kind: 'intransitive-training-benchmark-report',
    schemaVersion: 1,
    engineVersion: options.engineVersion ?? 'package-4-training-benchmark-v1',
    seed: options.seed,
    searchDepth: options.searchDepth,
    maxPlies: options.maxPlies,
    requestedGames: options.requestedGames,
    repetitions: options.repetitions,
    warmupGames: options.warmupGames,
    configurations: options.configurations,
    samples,
    summaries: summarizeSamples(samples),
  };
}
