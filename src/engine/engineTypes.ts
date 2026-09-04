/**
 * Engine and AI configuration types for Chessesque
 */

import type { Move } from '../core/types';

export type GameMode = 'human_vs_human' | 'play_vs_computer';
export type DifficultyLevel = 'casual' | 'intermediate' | 'strong';

export interface DifficultyConfig {
  label: string;
  depth: number;
  timeLimitMs: number;
}

export const DIFFICULTY_PRESETS: Record<DifficultyLevel, DifficultyConfig> = {
  casual: { label: 'Casual (D3)', depth: 3, timeLimitMs: 200 },
  intermediate: { label: 'Club (D5)', depth: 5, timeLimitMs: 600 },
  strong: { label: 'Master (D8)', depth: 8, timeLimitMs: 1500 },
};

export interface SearchLine {
  rank: number; // 1 to 5
  move: Move;
  san: string;
  score: number; // relative to active player
  scoreWhite: number; // relative to White (+ = White advantage)
  pv: Move[];
  pvSAN: string[];
  isMate: boolean;
  mateInPlies: number | null;
}

export interface EngineSettings {
  multiPv: number; // 1 to 5 candidate lines
  isInfinite: boolean; // Continuous infinite analysis
  hashMb: number; // 16, 32, 64, 128, 256 MB
  threads: number; // 1 to detected CPU cores
}

export const HASH_PRESETS: number[] = [16, 32, 64, 128, 256];

export interface SavedUserSettings {
  isAnalysisEnabled: boolean;
  searchTimeSec: number;
  isInfinite: boolean;
  multiPv: number;
  threads: number;
  hashMb: number;
  gameMode: GameMode;
  difficulty: DifficultyLevel;
  playerColor: number;
  isFlipped?: boolean;
  soundEnabled?: boolean;
  isHardwareExpanded?: boolean;
}

export const SETTINGS_STORAGE_KEY = 'chessesque_user_settings_v1';

export function loadSavedSettings(): Partial<SavedUserSettings> {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Failed to load saved settings from localStorage:', e);
  }
  return {};
}

export function saveUserSettings(settings: SavedUserSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.warn('Failed to save settings to localStorage:', e);
  }
}

