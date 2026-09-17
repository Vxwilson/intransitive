/**
 * Runtime-neutral persistent pool for self-play generation.
 *
 * The transport adapters only need to translate their runtime's worker API to
 * SelfPlayWorkerPort. Scheduling, retries, cancellation, and exactly-once
 * delivery live here so browser and Node runs use the same semantics.
 */

import type {
  SelfPlayGameJob,
  SelfPlayGameResult,
} from './selfPlay';

export type SelfPlayWorkerRequest = {
  type: 'GENERATE_SELF_PLAY';
  job: SelfPlayGameJob;
};

export type SelfPlayWorkerResponse =
  | {
      type: 'SELF_PLAY_RESULT';
      result: SelfPlayGameResult;
    }
  | {
      type: 'SELF_PLAY_ERROR';
      jobId: string;
      message: string;
    };

export interface SelfPlayWorkerPort {
  setHandlers(
    onMessage: (message: SelfPlayWorkerResponse) => void,
    onError: (error: unknown) => void
  ): void;
  postMessage(message: SelfPlayWorkerRequest): void;
  terminate(): void | Promise<void>;
}

export type SelfPlayWorkerFactory = () => SelfPlayWorkerPort;

export class SelfPlayPoolCancelledError extends Error {
  public constructor() {
    super('Self-play pool cancelled');
    this.name = 'SelfPlayPoolCancelledError';
  }
}

export class SelfPlayPoolProtocolError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'SelfPlayPoolProtocolError';
  }
}

interface AssignedJob {
  job: SelfPlayGameJob;
  attempts: number;
}

/**
 * A persistent worker pool. A pool can process many sequential batches; a
 * second batch is never dispatched until the first batch has been completely
 * collected by the coordinator.
 */
export class SelfPlayWorkerPool {
  private readonly factory: SelfPlayWorkerFactory;
  private readonly maxRetries: number;
  private ports: SelfPlayWorkerPort[];
  private closed = false;
  private activeBatch = false;

  public constructor(
    factory: SelfPlayWorkerFactory,
    workerCount: number,
    maxRetries = 1
  ) {
    if (!Number.isInteger(workerCount) || workerCount < 1) {
      throw new Error(`Self-play worker count must be a positive integer, got ${workerCount}`);
    }
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new Error(`Self-play retry count must be a non-negative integer, got ${maxRetries}`);
    }
    this.factory = factory;
    this.maxRetries = maxRetries;
    this.ports = Array.from({ length: workerCount }, () => factory());
  }

  public get workerCount(): number {
    return this.ports.length;
  }

  /**
   * Generate exactly one complete batch. Results are returned in arrival
   * order; the shared training coordinator sorts and validates them by ID.
   */
  public generateBatch(
    jobs: SelfPlayGameJob[],
    shouldCancel: () => boolean = () => false
  ): Promise<SelfPlayGameResult[]> {
    if (this.closed) return Promise.reject(new Error('Self-play worker pool is closed'));
    if (this.activeBatch) return Promise.reject(new Error('Self-play worker pool already has an active batch'));
    if (jobs.length === 0) return Promise.resolve([]);
    if (new Set(jobs.map((job) => job.jobId)).size !== jobs.length) {
      return Promise.reject(new SelfPlayPoolProtocolError('Self-play batch contains duplicate job IDs'));
    }

    this.activeBatch = true;
    return new Promise<SelfPlayGameResult[]>((resolve, reject) => {
      const queue = jobs.map((job) => ({ job, attempts: 0 } satisfies AssignedJob));
      const assigned: Array<AssignedJob | null> = Array.from(
        { length: this.ports.length },
        () => null
      );
      const results = new Map<string, SelfPlayGameResult>();
      const acceptedJobIds = new Set<string>();
      let completed = 0;
      let settled = false;
      let cancellationTimer: ReturnType<typeof setInterval> | undefined;

      const clearHandlers = () => {
        for (const port of this.ports) port.setHandlers(() => undefined, () => undefined);
      };

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        this.activeBatch = false;
        if (cancellationTimer !== undefined) clearInterval(cancellationTimer);
        clearHandlers();

        if (error) {
          this.close();
          reject(error);
        } else {
          resolve([...results.values()]);
        }
      };

      const cancel = () => {
        if (!settled && shouldCancel()) {
          // Cancellation is intentionally terminal for a pool. The caller can
          // create a fresh pool for the next run, avoiding a worker that may be
          // stuck inside a long search.
          finish(new SelfPlayPoolCancelledError());
          this.close();
        }
      };

      const fail = (message: string) => {
        finish(new SelfPlayPoolProtocolError(message));
      };

      const replacePort = (index: number, oldPort: SelfPlayWorkerPort) => {
        if (this.ports[index] !== oldPort || this.closed) return;
        try {
          oldPort.setHandlers(() => undefined, () => undefined);
          void oldPort.terminate();
          const newPort = this.factory();
          this.ports[index] = newPort;
          attach(index, newPort);
        } catch (error) {
          fail(`Unable to replace self-play worker ${index}: ${error instanceof Error ? error.message : String(error)}`);
        }
      };

      const retryOrFail = (index: number, errorMessage: string) => {
        const assignment = assigned[index];
        assigned[index] = null;
        if (!assignment) {
          if (queue.length > 0) {
            replacePort(index, this.ports[index]);
            dispatch();
          }
          return;
        }
        if (assignment.attempts >= this.maxRetries) {
          fail(`Self-play job ${assignment.job.gameId} failed after ${assignment.attempts + 1} attempts: ${errorMessage}`);
          return;
        }
        queue.unshift({ job: assignment.job, attempts: assignment.attempts + 1 });
        replacePort(index, this.ports[index]);
        dispatch();
      };

      const handleMessage = (
        index: number,
        port: SelfPlayWorkerPort,
        message: SelfPlayWorkerResponse
      ) => {
        if (settled || this.ports[index] !== port) return;
        const assignment = assigned[index];

        if (message.type === 'SELF_PLAY_ERROR') {
          if (assignment && assignment.job.jobId !== message.jobId) {
            fail(`Worker ${index} reported ${message.jobId} while running ${assignment.job.jobId}`);
            return;
          }
          retryOrFail(index, message.message);
          return;
        }

        if (!assignment) {
          fail(`Worker ${index} returned an unassigned self-play result ${message.result.jobId}`);
          return;
        }
        if (message.result.jobId !== assignment.job.jobId) {
          fail(
            `Worker ${index} returned ${message.result.jobId}; expected ${assignment.job.jobId}`
          );
          return;
        }
        if (acceptedJobIds.has(message.result.jobId) || results.has(message.result.jobId)) {
          fail(`Duplicate self-play result received for ${message.result.jobId}`);
          return;
        }

        assigned[index] = null;
        acceptedJobIds.add(message.result.jobId);
        results.set(message.result.jobId, message.result);
        completed++;
        if (completed === jobs.length) {
          finish();
          return;
        }
        dispatch();
      };

      const attach = (index: number, port: SelfPlayWorkerPort): void => {
        port.setHandlers(
          (message) => handleMessage(index, port, message),
          (error) => {
            if (settled || this.ports[index] !== port) return;
            retryOrFail(index, error instanceof Error ? error.message : String(error));
          }
        );
      };

      const dispatch = (): void => {
        if (settled) return;
        cancel();
        if (settled) return;

        for (let index = 0; index < assigned.length && queue.length > 0; index++) {
          if (assigned[index]) continue;
          const assignment = queue.shift();
          if (!assignment) break;
          assigned[index] = assignment;
          try {
            this.ports[index].postMessage({ type: 'GENERATE_SELF_PLAY', job: assignment.job });
          } catch (error) {
            retryOrFail(index, error instanceof Error ? error.message : String(error));
          }
        }
      };

      for (let index = 0; index < this.ports.length; index++) {
        attach(index, this.ports[index]);
      }
      cancellationTimer = setInterval(cancel, 10);
      dispatch();
    });
  }

  /** Terminate all workers and make this pool unusable. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const port of this.ports) {
      port.setHandlers(() => undefined, () => undefined);
      void port.terminate();
    }
    this.ports = [];
  }
}
