/**
 * Intransitive Custom Engine - Checkpoint Manager
 * Handles local persistence, preset generations, and JSON import/export.
 */

import { createZeroWeights, createHeuristicWeights } from './evaluator';
import type { Checkpoint, EvaluationWeights, TrainingStats } from './types';

const STORAGE_KEY = 'chessesque_intransitive_checkpoints';

export function createInitialStats(generation: number = 0): TrainingStats {
  return {
    generation,
    gamesPlayed: 0,
    blueWins: 0,
    redWins: 0,
    draws: 0,
    avgGameLength: 0,
    history: [
      {
        generation: 0,
        R: 0,
        P: 0,
        S: 0,
        blueWinRate: 50,
      },
    ],
  };
}

export const PRESET_CHECKPOINTS: Checkpoint[] = [
  {
    id: 'preset-gen-0',
    name: 'Gen 0 (Tabula Rasa / 0-Knowledge)',
    generation: 0,
    timestamp: 1700000000000,
    weights: createZeroWeights(),
    stats: createInitialStats(0),
  },
  {
    id: 'preset-heuristic-master',
    name: 'Heuristic Benchmark (Hand-Tuned Master)',
    generation: 1000,
    timestamp: 1700000000001,
    weights: createHeuristicWeights(),
    stats: {
      generation: 1000,
      gamesPlayed: 1000,
      blueWins: 450,
      redWins: 450,
      draws: 100,
      avgGameLength: 28,
      history: [
        { generation: 0, R: 0, P: 0, S: 0, blueWinRate: 50 },
        { generation: 1000, R: 100, P: 100, S: 100, blueWinRate: 50 },
      ],
    },
  },
];

class MemoryStorage {
  private data: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const memoryStorage = new MemoryStorage();

function getStorage() {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  return memoryStorage;
}

export function getStoredCheckpoints(): Checkpoint[] {
  const storage = getStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return [...PRESET_CHECKPOINTS];
    }
    const userCheckpoints: Checkpoint[] = JSON.parse(raw);
    return [...PRESET_CHECKPOINTS, ...userCheckpoints];
  } catch (err) {
    console.error('Failed to parse checkpoints from storage:', err);
    return [...PRESET_CHECKPOINTS];
  }
}

export function saveCheckpoint(
  name: string,
  generation: number,
  weights: EvaluationWeights,
  stats: TrainingStats
): Checkpoint {
  const newCheckpoint: Checkpoint = {
    id: `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name,
    generation,
    timestamp: Date.now(),
    weights: JSON.parse(JSON.stringify(weights)),
    stats: JSON.parse(JSON.stringify(stats)),
  };

  const storage = getStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const userList: Checkpoint[] = raw ? JSON.parse(raw) : [];
    userList.push(newCheckpoint);
    storage.setItem(STORAGE_KEY, JSON.stringify(userList));
  } catch (err) {
    console.error('Failed to save checkpoint to storage:', err);
  }

  return newCheckpoint;
}

export function deleteCheckpoint(id: string): boolean {
  if (id.startsWith('preset-')) return false; // Prevent deleting built-in presets
  const storage = getStorage();

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const userList: Checkpoint[] = JSON.parse(raw);
    const filtered = userList.filter((c) => c.id !== id);
    storage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (err) {
    console.error('Failed to delete checkpoint:', err);
    return false;
  }
}

export function exportCheckpointsJSON(): string {
  const checkpoints = getStoredCheckpoints();
  return JSON.stringify(checkpoints, null, 2);
}

export function importCheckpointsJSON(jsonStr: string): boolean {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return false;

    const storage = getStorage();
    const raw = storage.getItem(STORAGE_KEY);
    const currentList: Checkpoint[] = raw ? JSON.parse(raw) : [];

    for (const item of parsed) {
      if (item.id && !item.id.startsWith('preset-') && item.weights) {
        if (!currentList.some((c) => c.id === item.id)) {
          currentList.push(item);
        }
      }
    }
    storage.setItem(STORAGE_KEY, JSON.stringify(currentList));
    return true;
  } catch (err) {
    console.error('Failed to import checkpoints JSON:', err);
  }
  return false;
}
