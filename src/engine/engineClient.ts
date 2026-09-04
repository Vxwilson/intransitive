/**
 * Engine Client - Main Thread Interface for Web Worker
 * Manages asynchronous search, worker communication, fallback support,
 * and live depth/score subscriptions.
 */

import type { SearchUpdate, SearchResult, SearchOptions } from './search';
import type { WorkerInMessage, WorkerOutMessage } from './worker';
import { SearchEngine } from './search';
import { Chess } from '../core/chess';

import { SharedTranspositionTable } from './transposition';

export type SearchUpdateListener = (update: SearchUpdate) => void;
export type StatusListener = (searching: boolean) => void;

export class EngineClient {
  private workers: Worker[] = [];
  private fallbackEngine: SearchEngine | null = null;
  private listeners: Set<SearchUpdateListener> = new Set();
  private statusListeners: Set<StatusListener> = new Set();
  private activeResolve: ((result: SearchResult) => void) | null = null;
  private isSearching: boolean = false;
  private currentSearchId: number = 0;
  private currentHashMb: number = 32;
  private numThreads: number = 1;
  private sab: SharedArrayBuffer | null = null;
  private threadNodes: number[] = [];
  private searchStartTime: number = 0;

  constructor() {
    this.initWorkers();
  }

  private isSharedSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof SharedArrayBuffer !== 'undefined' &&
      (typeof crossOriginIsolated === 'undefined' || crossOriginIsolated)
    );
  }

  private initWorkers(): void {
    // Terminate and clean up any existing active workers
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];

    if (typeof window === 'undefined' || typeof Worker === 'undefined') {
      return;
    }

    const threadCount = Math.max(1, Math.min(16, this.numThreads));
    this.threadNodes = new Array(threadCount).fill(0);

    // Allocate SharedArrayBuffer if supported and not yet allocated
    if (this.isSharedSupported() && !this.sab) {
      try {
        this.sab = SharedTranspositionTable.createBuffer(this.currentHashMb);
      } catch (e) {
        console.warn('SharedArrayBuffer allocation failed, falling back to local memory:', e);
        this.sab = null;
      }
    }

    // Spawn managed pool of Web Workers
    for (let i = 0; i < threadCount; i++) {
      try {
        const w = new Worker(new URL('./worker.ts', import.meta.url), {
          type: 'module',
        });

        const threadId = i;

        // Configure worker with thread parameters and shared memory buffer
        w.postMessage({
          type: 'SET_CONFIG',
          threadId,
          numThreads: threadCount,
          hashMb: this.currentHashMb,
          sab: this.sab ?? undefined,
        } as WorkerInMessage);

        w.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
          const msg = e.data;

          // Strictly drop stale updates from previous or aborted searches
          if (msg.searchId !== this.currentSearchId) {
            return;
          }

          if (msg.type === 'NODES_UPDATE') {
            this.threadNodes[msg.threadId] = msg.nodes;
          } else if (msg.type === 'SEARCH_UPDATE') {
            // Master thread (0) emits live depth & PV; aggregate nodes across all active threads
            const totalNodes = this.threadNodes.reduce((acc, n) => acc + n, 0);
            const elapsedMs = Math.max(1, Math.round(performance.now() - this.searchStartTime));
            const aggregatedNps = Math.round((totalNodes * 1000) / elapsedMs);

            this.notifyListeners({
              ...msg.data,
              nodes: totalNodes,
              nps: aggregatedNps,
            });
          } else if (msg.type === 'SEARCH_COMPLETE') {
            // When master thread (0) completes search
            if (msg.threadId === 0 || this.workers.length === 1) {
              this.setSearching(false);
              const totalNodes = this.threadNodes.reduce((acc, n) => acc + n, 0);
              const totalElapsedMs = Math.max(1, Math.round(performance.now() - this.searchStartTime));
              const aggregatedNps = Math.round((totalNodes * 1000) / totalElapsedMs);

              const aggregatedResult: SearchResult = {
                ...msg.data,
                nodes: totalNodes,
                nps: aggregatedNps,
              };

              this.notifyListeners(aggregatedResult);

              if (this.activeResolve) {
                const resolve = this.activeResolve;
                this.activeResolve = null;
                resolve(aggregatedResult);
              }

              // Halt helper threads that are still running
              for (let h = 1; h < this.workers.length; h++) {
                this.workers[h].postMessage({ type: 'STOP_SEARCH' } as WorkerInMessage);
              }
            }
          }
        };

        w.onerror = (err) => {
          console.warn(`Worker [Thread ${threadId}] error:`, err);
        };

        this.workers.push(w);
      } catch (err) {
        console.warn(`Failed to spawn worker thread ${i}:`, err);
      }
    }
  }

  /**
   * Subscribe to live search progress updates (depth, NPS, PV, score).
   */
  public subscribe(listener: SearchUpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Subscribe to search status changes (true = searching, false = idle).
   */
  public onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.isSearching);
    return () => this.statusListeners.delete(listener);
  }

  private notifyListeners(update: SearchUpdate): void {
    for (const listener of this.listeners) {
      listener(update);
    }
  }

  private setSearching(searching: boolean): void {
    if (this.isSearching !== searching) {
      this.isSearching = searching;
      for (const listener of this.statusListeners) {
        listener(searching);
      }
    }
  }

  /**
   * Starts searching the given FEN position.
   * Cancels any currently active search before starting.
   */
  public search(
    fen: string,
    options: { maxDepth?: number; timeLimitMs?: number; multiPv?: number } = {}
  ): Promise<SearchResult> {
    this.stop();
    this.setSearching(true);
    const searchId = ++this.currentSearchId;
    this.searchStartTime = performance.now();
    this.threadNodes.fill(0);

    return new Promise<SearchResult>((resolve) => {
      this.activeResolve = resolve;

      if (this.workers.length > 0) {
        const msg: WorkerInMessage = {
          type: 'START_SEARCH',
          searchId,
          fen,
          maxDepth: options.maxDepth ?? 8,
          timeLimitMs: options.timeLimitMs ?? 1000,
          multiPv: options.multiPv ?? 1,
          numThreads: this.workers.length,
        };

        // Broadcast parallel search across worker pool
        for (let i = 0; i < this.workers.length; i++) {
          this.workers[i].postMessage({
            ...msg,
            threadId: i,
          } as WorkerInMessage);
        }
      } else {
        // Synchronous / microtask fallback
        if (!this.fallbackEngine) {
          this.fallbackEngine = new SearchEngine(15);
        }

        setTimeout(() => {
          if (!this.isSearching || searchId !== this.currentSearchId) return;
          try {
            const chess = new Chess(fen);
            const searchOpts: SearchOptions = {
              maxDepth: options.maxDepth ?? 8,
              timeLimitMs: options.timeLimitMs ?? 1000,
              multiPv: options.multiPv ?? 1,
              onDepthComplete: (u) => {
                if (searchId === this.currentSearchId) {
                  this.notifyListeners(u);
                }
              },
            };
            const res = this.fallbackEngine!.search(chess, searchOpts);
            if (searchId === this.currentSearchId) {
              this.setSearching(false);
              resolve(res);
            }
          } catch (err) {
            console.error('Fallback search error:', err);
            this.setSearching(false);
          }
        }, 0);
      }
    });
  }

  /**
   * Halts any active background search immediately.
   * Kills running workers to abort synchronous search loops instantly.
   */
  public stop(): void {
    if (this.isSearching) {
      this.setSearching(false);
      this.currentSearchId++; // Invalidate pending search results
      this.activeResolve = null;

      if (this.workers.length > 0) {
        // Instant 0ms synchronous abort of all active worker threads
        this.initWorkers();
      } else if (this.fallbackEngine) {
        this.fallbackEngine.stop();
      }
    }
  }

  /**
   * Dynamically adjusts number of CPU threads (1 to 16).
   */
  public setThreads(threads: number): void {
    const clamped = Math.max(1, Math.min(16, threads));
    if (this.numThreads !== clamped) {
      this.numThreads = clamped;
      this.initWorkers();
    }
  }

  /**
   * Terminates all workers on app teardown.
   */
  public terminate(): void {
    this.stop();
    for (const w of this.workers) {
      w.terminate();
    }
    this.workers = [];
    this.sab = null;
    this.listeners.clear();
    this.statusListeners.clear();
  }

  public setHashSize(mb: number): void {
    this.currentHashMb = mb;
    if (this.isSharedSupported()) {
      try {
        this.sab = SharedTranspositionTable.createBuffer(mb);
      } catch (e) {
        console.warn('Reallocating SharedArrayBuffer failed:', e);
        this.sab = null;
      }
    }
    this.initWorkers();
  }

  public get searching(): boolean {
    return this.isSearching;
  }
}

// Export singleton instance for app-wide engine analysis
export const engineClient = new EngineClient();
