/**
 * StudioSettingsCard - Master configuration for Intransitive Studio
 * Centralizes coupled evaluation/analysis model selection, human play defaults,
 * tournament fast zoom options, and persistent preferences.
 */

import React, { useState } from 'react';
import {
  Settings,
  BrainCircuit,
  Gamepad2,
  Swords,
  Volume2,
  VolumeX,
  Download,
  Upload,
  RotateCcw,
  Sparkles,
  Zap,
  Trash2,
  Cpu,
  Edit3,
  Check,
  X,
} from 'lucide-react';
import type { Checkpoint } from '../engine/types';

interface StudioSettingsCardProps {
  evalModelId: string;
  onChangeEvalModelId: (id: string) => void;
  checkpoints: Checkpoint[];
  currentGeneration: number;
  humanColor: 'blue' | 'red';
  onChangeHumanColor: (color: 'blue' | 'red') => void;
  selectedOpponentId: string;
  onChangeOpponentId: (id: string) => void;
  isAnalysisEnabled: boolean;
  onToggleAnalysis: () => void;
  analysisMaxRows: number;
  onChangeMaxRows: (rows: number) => void;
  tournamentZoomEnabled: boolean;
  onToggleTournamentZoom: () => void;
  searchDepth: number;
  onChangeSearchDepth: (depth: number) => void;
  trainingSearchDepth?: number;
  onChangeTrainingSearchDepth?: (depth: number) => void;
  learningRateAnnealing: boolean;
  onToggleAnnealing: () => void;
  delayMs: number;
  onChangeDelayMs: (ms: number) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onExportJSON: () => void;
  onImportJSON: (json: string) => void;
  onResetSettings: () => void;
  onDeleteCheckpoint?: (id: string) => void;
  onRenameCheckpoint?: (id: string, newName: string) => void;
  onClearAllCheckpoints?: () => void;
}

export const StudioSettingsCard: React.FC<StudioSettingsCardProps> = ({
  evalModelId,
  onChangeEvalModelId,
  checkpoints,
  currentGeneration,
  humanColor,
  onChangeHumanColor,
  selectedOpponentId,
  onChangeOpponentId,
  isAnalysisEnabled,
  onToggleAnalysis,
  analysisMaxRows,
  onChangeMaxRows,
  tournamentZoomEnabled,
  onToggleTournamentZoom,
  searchDepth,
  onChangeSearchDepth,
  trainingSearchDepth = 1,
  onChangeTrainingSearchDepth,
  learningRateAnnealing,
  onToggleAnnealing,
  delayMs,
  onChangeDelayMs,
  soundEnabled,
  onToggleSound,
  onExportJSON,
  onImportJSON,
  onResetSettings,
  onDeleteCheckpoint,
  onRenameCheckpoint,
  onClearAllCheckpoints,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');

  const handleStartRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditingName(currentName);
  };

  const handleSaveRename = (id: string) => {
    const trimmed = editingName.trim();
    if (trimmed && onRenameCheckpoint) {
      onRenameCheckpoint(id, trimmed);
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) onImportJSON(content);
    };
    reader.readAsText(file);
  };

  return (
    <div className="intransitive-editorial-card" style={{ maxWidth: '960px', margin: '0 auto', width: '100%' }}>
      {/* Header */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-card-heading">
          <div className="intransitive-card-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed', borderColor: '#ddd6fe' }}>
            <Settings size={20} />
          </div>
          <div className="intransitive-card-text">
            <h3>Studio Settings & Preferences</h3>
            <p>Coupled evaluation engine, simulation display, and persistent configuration</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onResetSettings}
          title="Reset all settings to default values"
          className="intransitive-icon-btn"
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', padding: '0.45rem 0.75rem', fontSize: '0.75rem', width: 'auto' }}
        >
          <RotateCcw size={14} />
          <span>Reset Defaults</span>
        </button>
      </div>

      {/* Grid Settings Layout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
        {/* Section 1: Coupled Master Model Picker */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <BrainCircuit size={16} color="#7c3aed" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Master Evaluation Engine
              </h4>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#7c3aed', fontWeight: 600, background: '#f5f3ff', padding: '0.15rem 0.45rem', borderRadius: '4px', border: '1px solid #ddd6fe' }}>
              Coupled System
            </span>
          </div>

          <p style={{ fontSize: '0.74rem', color: '#6b635b', margin: '0.4rem 0 0.75rem 0', lineHeight: 1.4 }}>
            Selects the active AI checkpoint used for <strong>live board centipawn evaluation</strong>, <strong>evaluation bar advantage</strong>, and <strong>Human Play tactical candidate move generation</strong>.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <select
              value={evalModelId}
              onChange={(e) => onChangeEvalModelId(e.target.value)}
              className="intransitive-dropdown"
              style={{ minWidth: '240px', fontWeight: 600 }}
            >
              <optgroup label="Trained AI Models">
                <option value="preset-master">🥇 Master (TD-Leaf Trained)</option>
                <option value="preset-intermediate">🥈 Intermediate (TD-Leaf Trained)</option>
                <option value="preset-novice">🥉 Novice (TD-Leaf Trained)</option>
              </optgroup>
              <optgroup label="Benchmarks & Baselines">
                <option value="preset-heuristic-master">🏆 Heuristic Master (Baseline Handcrafted)</option>
                <option value="current">🤖 Current In-Memory Model (Gen {currentGeneration})</option>
                <option value="preset-gen-0">👶 Gen 0 Tabula Rasa (Untrained Zeros)</option>
              </optgroup>
              {checkpoints.some((c) => !c.id.startsWith('preset-')) && (
                <optgroup label="Saved Checkpoints">
                  {checkpoints
                    .filter((c) => !c.id.startsWith('preset-'))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        💾 {c.name}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>

            <span style={{ fontSize: '0.72rem', color: '#059669', fontWeight: 600 }}>
              ✓ Actively evaluating
            </span>
          </div>
        </div>

        {/* Section 2: Visual Arena & Engine Defaults */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Swords size={16} color="#ea580c" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Visual Arena & Engine Lookahead
              </h4>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginTop: '0.6rem' }}>
            {/* Search Depth Selector */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b2520', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <BrainCircuit size={14} color="#7c3aed" /> Engine Search Depth
                </span>
                <p style={{ fontSize: '0.7rem', color: '#786f66', margin: '0.15rem 0 0 0' }}>
                  Minimax lookahead for Visual Arena live matches and tournament simulations
                </p>
              </div>
              <div className="intransitive-mini-btn-group">
                {[
                  { d: 1, label: 'Depth 1 (Fast)' },
                  { d: 2, label: 'Depth 2 (Tactical)' },
                  { d: 3, label: 'Depth 3 (Deep)' },
                ].map(({ d, label }) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => onChangeSearchDepth(d)}
                    className={`intransitive-mini-btn ${searchDepth === d ? 'active' : ''}`}
                    style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Self-Play Training Depth Selector */}
            {onChangeTrainingSearchDepth && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b2520', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                    <Cpu size={14} color="#ea580c" /> Self-Play Training Depth
                  </span>
                  <p style={{ fontSize: '0.7rem', color: '#786f66', margin: '0.15rem 0 0 0' }}>
                    Minimax lookahead used during autonomous self-play model training
                  </p>
                </div>
                <div className="intransitive-mini-btn-group">
                  {[
                    { d: 1, label: 'Depth 1 (Turbo)' },
                    { d: 2, label: 'Depth 2 (Tactical)' },
                  ].map(({ d, label }) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => onChangeTrainingSearchDepth(d)}
                      className={`intransitive-mini-btn ${trainingSearchDepth === d ? 'active' : ''}`}
                      style={{ padding: '0.25rem 0.55rem', fontSize: '0.7rem' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Fast Board Zoom Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b2520', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Zap size={14} color="#ea580c" /> Fast Board Zoom (5ms/move)
                </span>
                <p style={{ fontSize: '0.7rem', color: '#786f66', margin: '0.15rem 0 0 0' }}>
                  Quickly animates tournament games on the left board during simulation
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleTournamentZoom}
                className={`intransitive-mini-btn ${tournamentZoomEnabled ? 'active' : ''}`}
                style={{ padding: '0.35rem 0.75rem', fontWeight: 700 }}
              >
                {tournamentZoomEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>

            {/* Learning Rate Annealing Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b2520', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <Sparkles size={14} color="#2563eb" /> Adaptive LR Annealing
                </span>
                <p style={{ fontSize: '0.7rem', color: '#786f66', margin: '0.15rem 0 0 0' }}>
                  Decays step size smoothly as generations advance to stabilize mature models against swings
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleAnnealing}
                className={`intransitive-mini-btn ${learningRateAnnealing ? 'active' : ''}`}
                style={{ padding: '0.35rem 0.75rem', fontWeight: 700 }}
              >
                {learningRateAnnealing ? 'Adaptive Schedule' : 'Fixed (0.015)'}
              </button>
            </div>

            {/* Live Match Step Delay */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', fontWeight: 600, color: '#4a4239', marginBottom: '0.25rem' }}>
                <span>Live Match Step Delay</span>
                <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#ea580c', fontWeight: 700 }}>
                  {delayMs} ms
                </span>
              </div>
              <input
                type="range"
                min="50"
                max="1000"
                step="25"
                value={delayMs}
                onChange={(e) => onChangeDelayMs(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#ea580c' }}
              />
            </div>
          </div>
        </div>

        {/* Section 3: Human Play Defaults */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Gamepad2 size={16} color="#059669" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Human Play Defaults
              </h4>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.6rem' }}>
            {/* Preferred Side */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#322a24' }}>Default Human Color:</span>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <button
                  type="button"
                  onClick={() => onChangeHumanColor('blue')}
                  className={`intransitive-mini-btn blue ${humanColor === 'blue' ? 'active' : ''}`}
                >
                  🔵 Blue (1st)
                </button>
                <button
                  type="button"
                  onClick={() => onChangeHumanColor('red')}
                  className={`intransitive-mini-btn red ${humanColor === 'red' ? 'active' : ''}`}
                >
                  🔴 Red (2nd)
                </button>
              </div>
            </div>

            {/* Default Opponent */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#322a24' }}>Default Opponent:</span>
              <select
                value={selectedOpponentId}
                onChange={(e) => onChangeOpponentId(e.target.value)}
                className="intransitive-dropdown mini"
                style={{ maxWidth: '200px' }}
              >
                <optgroup label="Trained AI Models">
                  <option value="preset-master">🥇 Master</option>
                  <option value="preset-intermediate">🥈 Intermediate</option>
                  <option value="preset-novice">🥉 Novice</option>
                </optgroup>
                <optgroup label="Benchmarks & Baselines">
                  <option value="preset-heuristic-master">🏆 Heuristic Master</option>
                  <option value="current">🤖 Current Model</option>
                  <option value="preset-gen-0">👶 Gen 0 Tabula Rasa</option>
                </optgroup>
                {checkpoints.some((c) => !c.id.startsWith('preset-')) && (
                  <optgroup label="Saved Checkpoints">
                    {checkpoints
                      .filter((c) => !c.id.startsWith('preset-'))
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          💾 {c.name}
                        </option>
                      ))}
                  </optgroup>
                )}
              </select>
            </div>

            {/* Analysis Candidate Lines */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#322a24' }}>Candidate Move Lines:</span>
                <p style={{ fontSize: '0.68rem', color: '#786f66', margin: 0 }}>Top candidate moves displayed</p>
              </div>
              <div className="intransitive-mini-btn-group">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChangeMaxRows(n)}
                    className={`intransitive-mini-btn ${analysisMaxRows === n ? 'active' : ''}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Analysis On/Off */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#322a24' }}>Board Vector Arrows:</span>
              <button
                type="button"
                onClick={onToggleAnalysis}
                className={`intransitive-mini-btn ${isAnalysisEnabled ? 'active' : ''}`}
              >
                {isAnalysisEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>

        {/* Section 4: Audio & Checkpoint Management */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Sparkles size={16} color="#d97706" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Audio & Checkpoint Storage
              </h4>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.6rem' }}>
            {/* Audio Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#2b2520', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  {soundEnabled ? <Volume2 size={14} color="#ea580c" /> : <VolumeX size={14} />} Studio Sound Effects
                </span>
                <p style={{ fontSize: '0.7rem', color: '#786f66', margin: '0.15rem 0 0 0' }}>
                  Audio cues for moves, captures, and checkmate/touchdown
                </p>
              </div>
              <button
                type="button"
                onClick={onToggleSound}
                className={`intransitive-mini-btn ${soundEnabled ? 'active' : ''}`}
                style={{ padding: '0.35rem 0.75rem', fontWeight: 700 }}
              >
                {soundEnabled ? 'Sound On' : 'Muted'}
              </button>
            </div>

            {/* Import / Export Checkpoints */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.3rem', borderTop: '1px solid #eee8de' }}>
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2b2520' }}>Checkpoints Backup:</span>
                <p style={{ fontSize: '0.68rem', color: '#786f66', margin: 0 }}>Export or import learned weights</p>
              </div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button
                  type="button"
                  onClick={onExportJSON}
                  className="intransitive-btn-secondary mini"
                  title="Export All Checkpoints to JSON"
                >
                  <Download size={12} /> Export
                </button>
                <label className="intransitive-btn-secondary mini" style={{ cursor: 'pointer' }}>
                  <Upload size={12} /> Import
                  <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
                </label>
              </div>
            </div>

            {/* Custom User Models Management & Cleaner */}
            <div style={{ paddingTop: '0.65rem', borderTop: '1px solid #eee8de', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#2b2520' }}>
                    Saved Models ({checkpoints.filter((c) => !c.id.startsWith('preset-')).length}):
                  </span>
                  <p style={{ fontSize: '0.68rem', color: '#786f66', margin: 0 }}>
                    Stored in browser local storage
                  </p>
                </div>
                {checkpoints.some((c) => !c.id.startsWith('preset-')) && onClearAllCheckpoints && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Delete all custom user checkpoints? This cannot be undone.')) {
                        onClearAllCheckpoints();
                      }
                    }}
                    className="intransitive-mini-btn"
                    style={{ color: '#b91c1c', borderColor: '#fca5a5', background: '#fef2f2', padding: '0.2rem 0.6rem', fontSize: '0.7rem' }}
                    title="Delete all user checkpoints"
                  >
                    <Trash2 size={11} /> Clear All Models
                  </button>
                )}
              </div>

              {checkpoints.filter((c) => !c.id.startsWith('preset-')).length === 0 ? (
                <div style={{ fontSize: '0.72rem', color: '#8c827a', fontStyle: 'italic', padding: '0.4rem 0.6rem', background: '#faf8f5', borderRadius: '6px' }}>
                  No custom models saved yet. Built-in presets (Gen 0 and Heuristic Master) are permanently available.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '180px', overflowY: 'auto', paddingRight: '0.2rem' }}>
                  {checkpoints
                    .filter((c) => !c.id.startsWith('preset-'))
                    .map((cp) => (
                      <div
                        key={cp.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '0.35rem 0.6rem',
                          background: '#faf8f5',
                          borderRadius: '6px',
                          border: '1px solid #eee8de',
                          fontSize: '0.72rem',
                          gap: '0.4rem',
                        }}
                      >
                        {editingId === cp.id ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flex: 1 }}>
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(cp.id);
                                if (e.key === 'Escape') handleCancelRename();
                              }}
                              autoFocus
                              className="intransitive-header-snapshot-input"
                              style={{ height: '26px', fontSize: '0.72rem', padding: '0.1rem 0.45rem', flex: 1 }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(cp.id)}
                              className="intransitive-icon-btn"
                              style={{ color: '#059669', width: '22px', height: '22px' }}
                              title="Save name"
                            >
                              <Check size={12} />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelRename}
                              className="intransitive-icon-btn"
                              style={{ color: '#6b635b', width: '22px', height: '22px' }}
                              title="Cancel"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', overflow: 'hidden', flex: 1 }}>
                              <span style={{ fontWeight: 700, color: '#2b2520', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                                💾 {cp.name}
                              </span>
                              <span style={{ color: '#8c827a', fontSize: '0.68rem', flexShrink: 0 }}>
                                (Gen {cp.generation})
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
                              {onRenameCheckpoint && (
                                <button
                                  type="button"
                                  onClick={() => handleStartRename(cp.id, cp.name)}
                                  className="intransitive-icon-btn"
                                  style={{ color: '#4f46e5', width: '22px', height: '22px' }}
                                  title={`Rename ${cp.name}`}
                                >
                                  <Edit3 size={12} />
                                </button>
                              )}
                              {onDeleteCheckpoint && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(`Delete checkpoint "${cp.name}"?`)) {
                                      onDeleteCheckpoint(cp.id);
                                    }
                                  }}
                                  className="intransitive-icon-btn"
                                  style={{ color: '#b91c1c', width: '22px', height: '22px' }}
                                  title={`Delete ${cp.name}`}
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
