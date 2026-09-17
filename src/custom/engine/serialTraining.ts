/**
 * Serial online TD training over the versioned self-play job boundary.
 *
 * This is intentionally separate from `runParallelSelfPlayTraining`: the
 * learner is updated after every generated game here, while the parallel
 * coordinator freezes one learner snapshot for a whole batch. Keeping both
 * paths explicit makes benchmark comparisons honest and keeps the serial
 * reference useful after the worker pool evolves.
 */

import { SelfPlayTrainer, type GameRecord } from './trainer';

export interface SerialTrainingMetrics {
  requestedGames: number;
  gamesGenerated: number;
  terminalGames: number;
  truncatedGames: number;
  acceptedLearningGames: number;
  positions: number;
  searchNodes: number;
  workerTimeMs: number;
  searchTimeMs: number;
  generationWallMs: number;
  updateTimeMs: number;
  coordinationOverheadMs: number;
  elapsedWallMs: number;
  cancelled: boolean;
}

export interface SerialTrainingRun {
  records: GameRecord[];
  metrics: SerialTrainingMetrics;
}

export interface SerialTrainingOptions {
  totalGames: number;
  shouldCancel?: () => boolean;
  onProgress?: (completed: number, total: number, metrics: SerialTrainingMetrics) => void;
}

function createMetrics(totalGames: number): SerialTrainingMetrics {
  return {
    requestedGames: totalGames,
    gamesGenerated: 0,
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
    cancelled: false,
  };
}

/**
 * Run online TD with one generation/update cycle per game.
 *
 * The trainer is expected to use the per-game-v1 job RNG (the default when no
 * legacy RNG is injected), so this runner is directly comparable with a
 * frozen-batch trial at the same run seed and starting checkpoint.
 */
export function runSerialOnlineSelfPlayTraining(
  trainer: SelfPlayTrainer,
  options: SerialTrainingOptions
): SerialTrainingRun {
  if (!Number.isInteger(options.totalGames) || options.totalGames < 0) {
    throw new Error(`Training game count must be a non-negative integer, got ${options.totalGames}`);
  }

  const shouldCancel = options.shouldCancel ?? (() => false);
  const metrics = createMetrics(options.totalGames);
  const records: GameRecord[] = [];
  const startedAt = performance.now();

  while (records.length < options.totalGames) {
    if (shouldCancel()) {
      metrics.cancelled = true;
      break;
    }

    const generationStartedAt = performance.now();
    const job = trainer.createSelfPlayGameJob();
    const result = trainer.generateSelfPlayGame(job);
    const generationWallMs = performance.now() - generationStartedAt;
    metrics.generationWallMs += generationWallMs;
    metrics.workerTimeMs += result.telemetry.totalTimeMs;
    metrics.searchTimeMs += result.telemetry.searchTimeMs;
    // In the serial path this residual is the local job-boundary overhead.
    metrics.coordinationOverheadMs += Math.max(0, generationWallMs - result.telemetry.totalTimeMs);

    const updateStartedAt = performance.now();
    const record = trainer.applySelfPlayGameResult(result);
    metrics.updateTimeMs += performance.now() - updateStartedAt;
    records.push(record);

    metrics.gamesGenerated++;
    metrics.terminalGames += result.outcome.isTerminal ? 1 : 0;
    metrics.truncatedGames += result.outcome.isTruncated ? 1 : 0;
    metrics.acceptedLearningGames += result.outcome.isTerminal ? 1 : 0;
    metrics.positions += result.telemetry.generatedPositions;
    metrics.searchNodes += result.telemetry.searchNodes;
    metrics.elapsedWallMs = performance.now() - startedAt;

    options.onProgress?.(records.length, options.totalGames, { ...metrics });
  }

  metrics.elapsedWallMs = performance.now() - startedAt;
  return { records, metrics: { ...metrics } };
}
