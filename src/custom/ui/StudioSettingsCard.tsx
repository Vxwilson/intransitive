/**
 * StudioSettingsCard - Master configuration for Intransitive Studio
 * Centralizes coupled evaluation/analysis model selection, human play defaults,
 * tournament fast zoom options, and persistent preferences.
 */

import React from 'react';
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
  delayMs: number;
  onChangeDelayMs: (ms: number) => void;
  soundEnabled: boolean;
  onToggleSound: () => void;
  onExportJSON: () => void;
  onImportJSON: (json: string) => void;
  onResetSettings: () => void;
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
  delayMs,
  onChangeDelayMs,
  soundEnabled,
  onToggleSound,
  onExportJSON,
  onImportJSON,
  onResetSettings,
}) => {
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
          className="intransitive-btn-secondary mini"
          title="Reset all settings to factory defaults"
        >
          <RotateCcw size={12} /> Reset Defaults
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '1.25rem', marginTop: '0.75rem' }}>
        {/* Section 1: Coupled Evaluation & Engine Analysis Model */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <BrainCircuit size={16} color="#c2410c" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Coupled Evaluator & Analysis Model
              </h4>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#c2410c', fontWeight: 700, background: '#ffedd5', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
              Master Engine
            </span>
          </div>

          <p style={{ fontSize: '0.74rem', color: '#786f66', lineHeight: 1.4, margin: '0.4rem 0 0.75rem 0' }}>
            This single model dictates both <strong>board live evaluations</strong> (+/- cp) across all tabs and the <strong>candidate move arrows</strong> in Human Play.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label htmlFor="settings-eval-model" style={{ fontSize: '0.72rem', fontWeight: 700, color: '#4a4239' }}>
              Active Model:
            </label>
            <select
              id="settings-eval-model"
              value={evalModelId}
              onChange={(e) => onChangeEvalModelId(e.target.value)}
              className="intransitive-dropdown"
              style={{ width: '100%', padding: '0.45rem 0.75rem', fontSize: '0.8rem', fontWeight: 600 }}
            >
              <option value="preset-heuristic-master">🏆 Heuristic Master (Boss / Expert)</option>
              <option value="current">🤖 Current Training Model (Gen {currentGeneration})</option>
              <option value="preset-gen-0">👶 Gen 0 Tabula Rasa (Untrained / Zero)</option>
              {checkpoints
                .filter((c) => !c.id.startsWith('preset-'))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    💾 {c.name} (Gen {c.generation})
                  </option>
                ))}
            </select>
          </div>
        </div>

        {/* Section 2: Visual Arena & Tournament Zoom */}
        <div className="intransitive-settings-box">
          <div className="intransitive-settings-box-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
              <Swords size={16} color="#7c3aed" />
              <h4 style={{ margin: 0, fontSize: '0.85rem', fontWeight: 700, color: '#2b2520' }}>
                Visual Arena & Simulation
              </h4>
            </div>
            <span style={{ fontSize: '0.68rem', color: '#7c3aed', fontWeight: 700, background: '#f5f3ff', padding: '0.2rem 0.5rem', borderRadius: '6px' }}>
              Tournament Mode
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.6rem' }}>
            {/* Live Board Zoom Toggle */}
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
                <option value="preset-heuristic-master">🏆 Heuristic Master</option>
                <option value="current">🤖 Current Model</option>
                <option value="preset-gen-0">👶 Gen 0 Tabula Rasa</option>
                {checkpoints
                  .filter((c) => !c.id.startsWith('preset-'))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      💾 {c.name}
                    </option>
                  ))}
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
          </div>
        </div>
      </div>
    </div>
  );
};
