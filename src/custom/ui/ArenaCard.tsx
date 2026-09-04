/**
 * ArenaCard - Visual Arena Tournament Simulation & Benchmarking Card
 * Provides multi-game simulations with win rates, average plies, and tactical move accuracy.
 */

import React, { useState } from 'react';
import { Trophy, Download, Upload, Dices, Target, Activity, Zap } from 'lucide-react';
import type { Checkpoint } from '../engine/types';

interface ArenaCardProps {
  checkpoints: Checkpoint[];
  currentGeneration: number;
  fighterAId: string;
  fighterBId: string;
  onChangeFighterA?: (id: string) => void;
  onChangeFighterB?: (id: string) => void;
  onRunTournament: (cpA: Checkpoint, cpB: Checkpoint, games: number) => void;
  onExportJSON: () => void;
  onImportJSON: (json: string) => void;
  tournamentResult: {
    winsA: number;
    winsB: number;
    draws: number;
    winRateA: number;
    winRateB: number;
    drawRate: number;
    gamesPlayed: number;
    avgGameLength?: number;
    accuracyA?: number;
    accuracyB?: number;
  } | null;
  isSimulating?: boolean;
  isZoomEnabled?: boolean;
  onToggleZoom?: () => void;
}

export const ArenaCard: React.FC<ArenaCardProps> = ({
  checkpoints,
  fighterAId,
  fighterBId,
  onRunTournament,
  onExportJSON,
  onImportJSON,
  tournamentResult,
  isSimulating = false,
  isZoomEnabled = true,
  onToggleZoom,
}) => {
  const [customGames, setCustomGames] = useState<number>(20);

  const checkpointA = checkpoints.find((c) => c.id === fighterAId) || checkpoints[0];
  const checkpointB = checkpoints.find((c) => c.id === fighterBId) || checkpoints[1] || checkpoints[0];

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

  const handleSimulate = () => {
    const games = Math.max(1, Math.min(2000, Number(customGames) || 20));
    onRunTournament(checkpointA, checkpointB, games);
  };

  return (
    <div className="intransitive-editorial-card">
      {/* Header */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-card-heading">
          <div className="intransitive-card-icon-wrap" style={{ background: '#f5f3ff', color: '#7c3aed', borderColor: '#ddd6fe' }}>
            <Trophy size={18} />
          </div>
          <div className="intransitive-card-text">
            <h3>Tournament Simulation Arena</h3>
            <p>Head-to-head benchmarking & tactical accuracy scoring</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <button
            type="button"
            onClick={onExportJSON}
            title="Export Checkpoints JSON"
            className="intransitive-icon-btn"
          >
            <Download size={14} />
          </button>
          <label
            title="Import Checkpoints JSON"
            className="intransitive-icon-btn"
          >
            <Upload size={14} />
            <input type="file" accept=".json" onChange={handleFileUpload} style={{ display: 'none' }} />
          </label>
        </div>
      </div>

      {/* Simulation Controls Section */}
      <div className="intransitive-simulate-section">
        {/* Fast Board Zoom Toggle Row */}
        {onToggleZoom && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.4rem 0.65rem', background: '#faf8f5', borderRadius: '8px', border: '1px solid #eee8de', fontSize: '0.74rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600, color: '#4a4239' }}>
              <Zap size={13} color="#ea580c" /> Fast Board Zoom (5ms/move):
            </span>
            <button
              type="button"
              onClick={onToggleZoom}
              className={`intransitive-mini-btn ${isZoomEnabled ? 'active' : ''}`}
              style={{ padding: '0.2rem 0.55rem', fontSize: '0.7rem' }}
            >
              {isZoomEnabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        )}

        <div className="intransitive-simulate-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flex: 1 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#4a4239' }}>Simulate:</span>
            <input
              type="number"
              min="1"
              max="2000"
              value={customGames}
              onChange={(e) => setCustomGames(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="intransitive-input-number warm"
              style={{ width: '68px' }}
            />
            <span style={{ fontSize: '0.74rem', color: '#6b635b' }}>games</span>
          </div>

          {/* Quick preset chips */}
          <div className="intransitive-mini-btn-group">
            {[10, 20, 50, 100].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCustomGames(preset)}
                className={`intransitive-mini-btn ${customGames === preset ? 'active' : ''}`}
              >
                {preset}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleSimulate}
            disabled={isSimulating}
            className="intransitive-btn-primary"
            style={{ padding: '0.45rem 0.95rem', fontSize: '0.76rem' }}
          >
            <Dices size={14} /> Run Tournament
          </button>
        </div>

        {/* Tournament Result Telemetry */}
        {tournamentResult && (
          <div className="intransitive-tournament-result-box">
            {/* Wins Summary */}
            <div className="intransitive-tournament-scores">
              <span style={{ color: '#2563eb', fontWeight: 700 }}>
                {checkpointA?.name?.split(' ')[0] || 'Fighter A'}: {tournamentResult.winsA} ({tournamentResult.winRateA}%)
              </span>
              <span style={{ color: '#786f66' }}>
                {tournamentResult.draws} draws ({tournamentResult.drawRate}%)
              </span>
              <span style={{ color: '#ea580c', fontWeight: 700 }}>
                {checkpointB?.name?.split(' ')[0] || 'Fighter B'}: {tournamentResult.winsB} ({tournamentResult.winRateB}%)
              </span>
            </div>

            {/* Win Distribution Bar */}
            <div className="intransitive-win-bar">
              <div
                className="intransitive-win-seg-a"
                style={{ width: `${tournamentResult.winRateA}%` }}
                title={`${checkpointA?.name}: ${tournamentResult.winRateA}%`}
              />
              <div
                className="intransitive-win-seg-draw"
                style={{ width: `${tournamentResult.drawRate}%` }}
                title={`Draws: ${tournamentResult.drawRate}%`}
              />
              <div
                className="intransitive-win-seg-b"
                style={{ width: `${tournamentResult.winRateB}%` }}
                title={`${checkpointB?.name}: ${tournamentResult.winRateB}%`}
              />
            </div>

            {/* Extended Match Stats: Average Moves & Tactical Accuracy */}
            <div className="intransitive-tournament-submetrics">
              <div className="intransitive-submetric-cell">
                <Activity size={12} color="#786f66" />
                <span>Avg Length:</span>
                <strong>{tournamentResult.avgGameLength ?? 0} plies</strong>
              </div>

              <div className="intransitive-submetric-cell">
                <Target size={12} color="#059669" />
                <span>Tactical Accuracy:</span>
                <strong>
                  <span style={{ color: '#2563eb' }}>{tournamentResult.accuracyA ?? 50}%</span>
                  {' / '}
                  <span style={{ color: '#ea580c' }}>{tournamentResult.accuracyB ?? 50}%</span>
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
