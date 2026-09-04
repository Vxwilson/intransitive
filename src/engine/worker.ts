/**
 * Dedicated Web Worker for Chessesque Search Engine
 * Runs Negamax alpha-beta search off the main thread to ensure 60fps UI responsiveness.
 */

import { Chess } from '../core/chess';
import { SearchEngine } from './search';
import { SharedTranspositionTable } from './transposition';
import type { SearchUpdate, SearchResult } from './search';

export interface WorkerInMessage {
  type: 'START_SEARCH' | 'STOP_SEARCH' | 'SET_CONFIG';
  searchId?: number;
  fen?: string;
  maxDepth?: number;
  timeLimitMs?: number;
  multiPv?: number;
  hashMb?: number;
  sab?: SharedArrayBuffer;
  threadId?: number;
  numThreads?: number;
}

export type WorkerOutMessage =
  | { type: 'SEARCH_UPDATE'; searchId: number; threadId: number; data: SearchUpdate }
  | { type: 'SEARCH_COMPLETE'; searchId: number; threadId: number; data: SearchResult }
  | { type: 'NODES_UPDATE'; searchId: number; threadId: number; nodes: number };

let engine = new SearchEngine(18); // Default 18 bits = 262,144 entries (~16MB)
let currentThreadId = 0;
let currentNumThreads = 1;

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'SET_CONFIG') {
    if (msg.threadId !== undefined) {
      currentThreadId = msg.threadId;
    }
    if (msg.numThreads !== undefined) {
      currentNumThreads = msg.numThreads;
    }
    if (msg.sab) {
      engine = new SearchEngine(new SharedTranspositionTable(msg.sab));
    } else if (msg.hashMb) {
      engine.setHashSize(msg.hashMb);
    }
    return;
  }

  if (msg.type === 'STOP_SEARCH') {
    engine.stop();
    return;
  }

  if (msg.type === 'START_SEARCH' && msg.fen) {
    const searchId = msg.searchId ?? 0;
    const threadId = msg.threadId ?? currentThreadId;
    const numThreads = msg.numThreads ?? currentNumThreads;

    try {
      const chess = new Chess(msg.fen);

      const result = engine.search(chess, {
        maxDepth: msg.maxDepth ?? 8,
        timeLimitMs: msg.timeLimitMs ?? 1000,
        multiPv: msg.multiPv ?? 1,
        threadId,
        numThreads,
        onNodesUpdate: (nodes: number) => {
          self.postMessage({
            type: 'NODES_UPDATE',
            searchId,
            threadId,
            nodes,
          } as WorkerOutMessage);
        },
        onDepthComplete: (update: SearchUpdate) => {
          // Master thread (0) emits live depth/score updates to UI
          if (threadId === 0) {
            self.postMessage({
              type: 'SEARCH_UPDATE',
              searchId,
              threadId,
              data: update,
            } as WorkerOutMessage);
          }
        },
      });

      self.postMessage({
        type: 'SEARCH_COMPLETE',
        searchId,
        threadId,
        data: result,
      } as WorkerOutMessage);
    } catch (err) {
      console.error(`Worker [Thread ${threadId}] search error:`, err);
    }
  }
};
