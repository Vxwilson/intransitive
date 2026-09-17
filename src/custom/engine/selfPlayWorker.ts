/** Browser worker entry point for one frozen self-play job at a time. */

import { generateSelfPlayGame } from './selfPlay';
import type {
  SelfPlayWorkerRequest,
  SelfPlayWorkerResponse,
} from './selfPlayPool';

self.onmessage = (event: MessageEvent<SelfPlayWorkerRequest>) => {
  const request = event.data;
  if (request.type !== 'GENERATE_SELF_PLAY') return;

  try {
    const response: SelfPlayWorkerResponse = {
      type: 'SELF_PLAY_RESULT',
      result: generateSelfPlayGame(request.job),
    };
    self.postMessage(response);
  } catch (error) {
    const response: SelfPlayWorkerResponse = {
      type: 'SELF_PLAY_ERROR',
      jobId: request.job.jobId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
