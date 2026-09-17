import { parentPort } from 'node:worker_threads';
import type {
  SelfPlayWorkerRequest,
  SelfPlayWorkerResponse,
} from '../src/custom/engine/selfPlayPool.ts';

const workerPort = parentPort;
if (!workerPort) {
  throw new Error('Node self-play worker must be started with worker_threads');
}

const { tsImport } = await import('tsx/esm/api');
const { generateSelfPlayGame } = await tsImport(
  '../src/custom/engine/selfPlay.ts',
  import.meta.url
) as typeof import('../src/custom/engine/selfPlay.ts');

workerPort.on('message', (request: SelfPlayWorkerRequest) => {
  if (request.type !== 'GENERATE_SELF_PLAY') return;

  try {
    const response: SelfPlayWorkerResponse = {
      type: 'SELF_PLAY_RESULT',
      result: generateSelfPlayGame(request.job),
    };
    workerPort.postMessage(response);
  } catch (error) {
    const response: SelfPlayWorkerResponse = {
      type: 'SELF_PLAY_ERROR',
      jobId: request.job.jobId,
      message: error instanceof Error ? error.message : String(error),
    };
    workerPort.postMessage(response);
  }
});
