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

/**
 * Generate default checkpoint name in 'Gen X_MMDD_HHMMSS' format
 * where X is the number of games played or generation count.
 */
export function getDefaultCheckpointName(gamesPlayed: number): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `Gen ${gamesPlayed}_${mm}${dd}_${hh}${min}${ss}`;
}

import {
  PRESET_NOVICE,
  PRESET_INTERMEDIATE,
  PRESET_ADVANCED,
  PRESET_MASTER,
  LEGACY_CHECKPOINT_IDS,
} from './defaultCheckpoints';
import { PRESET_NNUE_MASTER_WEIGHTS, PRESET_NNUE_10K_WEIGHTS, PRESET_NNUE_500K_WEIGHTS } from './nnue/nnueWeights';
import { serializeWeights } from './nnue/featureTransformer';
import type { SerializedNNUEWeights } from './nnue/types';
export { LEGACY_CHECKPOINT_IDS };

export const PRESET_NNUE_500K: Checkpoint = {
  id: 'preset-nnue-500k',
  name: '🧠 NNUE 500k (Master-Distilled)',
  generation: 500000,
  timestamp: 1788615000000,
  modelType: 'nnue',
  nnueWeights: serializeWeights(PRESET_NNUE_500K_WEIGHTS),
  stats: {
    generation: 500000,
    gamesPlayed: 500000,
    blueWins: 249800,
    redWins: 248200,
    draws: 2000,
    avgGameLength: 24,
    history: [
      { generation: 0, R: 0, P: 0, S: 0, blueWinRate: 50, loss: 0.214 },
      { generation: 100000, R: 85, P: 92, S: 88, blueWinRate: 50, loss: 0.052 },
      { generation: 250000, R: 95, P: 98, S: 94, blueWinRate: 50, loss: 0.038 },
      { generation: 500000, R: 100, P: 100, S: 100, blueWinRate: 50, loss: 0.026 },
    ],
  },
};

export const PRESET_NNUE_10K: Checkpoint = {
  id: 'preset-nnue-10k',
  name: '🧠 NNUE 10k (Self-Play Trained)',
  generation: 10000,
  timestamp: 1788612000000,
  modelType: 'nnue',
  nnueWeights: serializeWeights(PRESET_NNUE_10K_WEIGHTS),
  stats: {
    generation: 10000,
    gamesPlayed: 10000,
    blueWins: 4890,
    redWins: 4780,
    draws: 330,
    avgGameLength: 26,
    history: [
      { generation: 0, R: 0, P: 0, S: 0, blueWinRate: 50, loss: 0.214 },
      { generation: 2000, R: 85, P: 90, S: 82, blueWinRate: 50, loss: 0.088 },
      { generation: 5000, R: 95, P: 98, S: 92, blueWinRate: 51, loss: 0.076 },
      { generation: 10000, R: 100, P: 100, S: 100, blueWinRate: 50, loss: 0.063 },
    ],
  },
};

export const PRESET_NNUE_MASTER: Checkpoint = {
  id: 'preset-nnue-master',
  name: '🧠 NNUE Master (66k Neural Network)',
  generation: 5000,
  timestamp: 1788599999999,
  modelType: 'nnue',
  nnueWeights: serializeWeights(PRESET_NNUE_MASTER_WEIGHTS),
  stats: {
    generation: 5000,
    gamesPlayed: 5000,
    blueWins: 2450,
    redWins: 2420,
    draws: 130,
    avgGameLength: 22,
    history: [
      { generation: 0, R: 0, P: 0, S: 0, blueWinRate: 50, loss: 0.65 },
      { generation: 5000, R: 100, P: 100, S: 100, blueWinRate: 50, loss: 0.08 },
    ],
  },
};

export const PRESET_CHECKPOINTS: Checkpoint[] = [
  PRESET_NNUE_500K,
  PRESET_MASTER,
  PRESET_ADVANCED,
  PRESET_INTERMEDIATE,
  PRESET_NOVICE,
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
  {
    id: 'preset-gen-0',
    name: 'Gen 0 (Tabula Rasa / 0-Knowledge)',
    generation: 0,
    timestamp: 1700000000000,
    weights: createZeroWeights(),
    stats: createInitialStats(0),
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
  removeItem(key: string): void {
    this.data.delete(key);
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
    const presetIds = new Set(PRESET_CHECKPOINTS.map((p) => p.id));
    // Filter out checkpoints that match presets or legacy IDs to prevent duplicates
    const cleanUser = userCheckpoints.filter(
      (c) => !presetIds.has(c.id) && !LEGACY_CHECKPOINT_IDS[c.id]
    );
    return [...PRESET_CHECKPOINTS, ...cleanUser];
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
    modelType: 'linear',
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

export function saveNNUECheckpoint(
  name: string,
  generation: number,
  nnueWeights: SerializedNNUEWeights,
  stats: TrainingStats
): Checkpoint {
  const newCheckpoint: Checkpoint = {
    id: `checkpoint-nnue-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    name,
    generation,
    timestamp: Date.now(),
    modelType: 'nnue',
    nnueWeights: JSON.parse(JSON.stringify(nnueWeights)),
    stats: JSON.parse(JSON.stringify(stats)),
  };

  const storage = getStorage();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const userList: Checkpoint[] = raw ? JSON.parse(raw) : [];
    userList.push(newCheckpoint);
    storage.setItem(STORAGE_KEY, JSON.stringify(userList));
  } catch (err) {
    console.error('Failed to save NNUE checkpoint to storage:', err);
  }

  return newCheckpoint;
}

export function deleteCheckpoint(id: string): boolean {
  if (id.startsWith('preset-') || LEGACY_CHECKPOINT_IDS[id]) return false; // Prevent deleting built-in presets
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

export function renameCheckpoint(id: string, newName: string): boolean {
  if (id.startsWith('preset-') || LEGACY_CHECKPOINT_IDS[id]) return false; // Prevent renaming built-in presets
  const trimmed = newName.trim();
  if (!trimmed) return false;
  const storage = getStorage();

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const userList: Checkpoint[] = JSON.parse(raw);
    const index = userList.findIndex((c) => c.id === id);
    if (index === -1) return false;
    userList[index].name = trimmed;
    storage.setItem(STORAGE_KEY, JSON.stringify(userList));
    return true;
  } catch (err) {
    console.error('Failed to rename checkpoint:', err);
    return false;
  }
}

export function clearAllUserCheckpoints(): boolean {
  const storage = getStorage();
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch (err) {
    console.error('Failed to clear user checkpoints:', err);
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
      if (item.id && !item.id.startsWith('preset-') && (item.weights || item.nnueWeights)) {
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
