/** Browser transport adapter for the runtime-neutral self-play pool. */

import {
  SelfPlayWorkerPool,
  type SelfPlayWorkerPort,
  type SelfPlayWorkerResponse,
} from './selfPlayPool';

class BrowserSelfPlayWorkerPort implements SelfPlayWorkerPort {
  private readonly worker: Worker;
  private onMessageHandler: (message: SelfPlayWorkerResponse) => void = () => undefined;
  private onErrorHandler: (error: unknown) => void = () => undefined;

  public constructor() {
    this.worker = new Worker(
      new URL('./selfPlayWorker.ts', import.meta.url),
      { type: 'module' }
    );
    this.worker.onmessage = (event: MessageEvent<SelfPlayWorkerResponse>) => {
      this.onMessageHandler(event.data);
    };
    this.worker.onerror = (event) => {
      this.onErrorHandler(new Error(event.message || 'Browser self-play worker failed'));
    };
    this.worker.onmessageerror = () => {
      this.onErrorHandler(new Error('Browser self-play worker returned an unserializable message'));
    };
  }

  public setHandlers(
    onMessage: (message: SelfPlayWorkerResponse) => void,
    onError: (error: unknown) => void
  ): void {
    this.onMessageHandler = onMessage;
    this.onErrorHandler = onError;
  }

  public postMessage(message: Parameters<Worker['postMessage']>[0]): void {
    this.worker.postMessage(message);
  }

  public terminate(): void {
    this.worker.terminate();
  }
}

export function createBrowserSelfPlayPool(workerCount: number): SelfPlayWorkerPool {
  return new SelfPlayWorkerPool(
    () => new BrowserSelfPlayWorkerPort(),
    workerCount
  );
}
