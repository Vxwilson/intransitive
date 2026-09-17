import { Worker } from 'node:worker_threads';
import {
  SelfPlayWorkerPool,
  type SelfPlayWorkerPort,
  type SelfPlayWorkerRequest,
  type SelfPlayWorkerResponse,
} from '../src/custom/engine/selfPlayPool.ts';

class NodeSelfPlayWorkerPort implements SelfPlayWorkerPort {
  private readonly worker: Worker;
  private onMessageHandler: (message: SelfPlayWorkerResponse) => void = () => undefined;
  private onErrorHandler: (error: unknown) => void = () => undefined;

  public constructor() {
    this.worker = new Worker(new URL('./nodeSelfPlayWorker.ts', import.meta.url), {
      // tsx/Node loader flags are inherited by child workers in normal CLI
      // runs. The explicit loader URL is needed when this adapter is invoked
      // from an ESM entry point: Node's native type stripping does not resolve
      // the extensionless imports used by the browser build.
      execArgv: [
        ...process.execArgv,
        '--import',
        new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url).href,
      ],
    });
    // Install listeners immediately so a module-load failure cannot become an
    // unhandled EventEmitter error before the first batch is dispatched.
    this.worker.on('message', (message: SelfPlayWorkerResponse) => this.onMessageHandler(message));
    this.worker.on('error', (error) => this.onErrorHandler(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.onErrorHandler(new Error(`Node self-play worker exited with code ${code}`));
    });
  }

  public setHandlers(
    onMessage: (message: SelfPlayWorkerResponse) => void,
    onError: (error: unknown) => void
  ): void {
    this.onMessageHandler = onMessage;
    this.onErrorHandler = onError;
  }

  public postMessage(message: SelfPlayWorkerRequest): void {
    this.worker.postMessage(message);
  }

  public async terminate(): Promise<void> {
    await this.worker.terminate();
  }
}

export function createNodeSelfPlayPool(workerCount: number): SelfPlayWorkerPool {
  return new SelfPlayWorkerPool(
    () => new NodeSelfPlayWorkerPort(),
    workerCount
  );
}
