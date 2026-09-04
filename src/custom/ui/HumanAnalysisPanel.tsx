/**
 * HumanAnalysisPanel - Real-time candidate move analysis for Human Play mode
 * Provides engine recommendations, top 1-5 move rankings, scores, and toggleable on-board arrows.
 */

import React from 'react';
import { BrainCircuit, Eye, EyeOff, Sparkles, ChevronRight } from 'lucide-react';
import type { RankedMove } from '../engine/types';
import type { Move } from '../core/types';
import { formatEvalScore } from '../engine/search';

interface HumanAnalysisPanelProps {
  isEnabled: boolean;
  onToggleEnabled: () => void;
  selectedModelName: string;
  maxRows: number; // 1 to 5
  onChangeMaxRows: (rows: number) => void;
  candidateMoves: RankedMove[];
  onApplyMove?: (move: Move) => void;
  isHumanTurn: boolean;
}

const RANK_BADGE_COLORS: Record<number, { bg: string; text: string; border: string }> = {
  1: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }, // Emerald
  2: { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' }, // Blue
  3: { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' }, // Purple
  4: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' }, // Amber
  5: { bg: '#f8fafc', text: '#64748b', border: '#e2e8f0' }, // Slate
};

export const HumanAnalysisPanel: React.FC<HumanAnalysisPanelProps> = ({
  isEnabled,
  onToggleEnabled,
  selectedModelName,
  maxRows,
  onChangeMaxRows,
  candidateMoves,
  onApplyMove,
  isHumanTurn,
}) => {
  return (
    <div className="intransitive-editorial-card">
      {/* Title & Enable Toggle */}
      <div className="intransitive-card-title-row">
        <div className="intransitive-card-heading">
          <div
            className="intransitive-card-icon-wrap"
            style={{
              background: isEnabled ? '#ecfdf5' : '#f5f0e8',
              color: isEnabled ? '#059669' : '#8c827a',
              borderColor: isEnabled ? '#a7f3d0' : '#e0d8cc',
            }}
          >
            <BrainCircuit size={18} />
          </div>
          <div className="intransitive-card-text">
            <h3>Engine Move Analysis</h3>
            <p>Next best moves & graduated board arrows</p>
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleEnabled}
          className={`intransitive-toggle-btn ${isEnabled ? 'active' : ''}`}
          title={isEnabled ? 'Turn Off Analysis' : 'Turn On Analysis'}
        >
          {isEnabled ? (
            <>
              <Eye size={13} /> Analysis ON
            </>
          ) : (
            <>
              <EyeOff size={13} /> Analysis OFF
            </>
          )}
        </button>
      </div>

      {isEnabled ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          {/* Configuration Bar: Model Badge + Rows Selector */}
          <div className="intransitive-analysis-config-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: 1 }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b635b' }}>Model:</span>
              <span
                style={{
                  fontSize: '0.74rem',
                  fontWeight: 700,
                  color: '#2b2520',
                  background: '#f4ede4',
                  padding: '0.25rem 0.6rem',
                  borderRadius: '8px',
                  border: '1px solid #ded5c8',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                }}
                title="Active evaluation engine model. Configure in Settings tab."
              >
                <Sparkles size={12} color="#c2410c" />
                {selectedModelName}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6b635b' }}>Lines:</span>
              <div className="intransitive-mini-btn-group">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChangeMaxRows(n)}
                    className={`intransitive-mini-btn ${maxRows === n ? 'active' : ''}`}
                    style={{ padding: '0.25rem 0.5rem', minWidth: '22px' }}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Candidate Moves List */}
          <div className="intransitive-candidate-list">
            {candidateMoves.length === 0 ? (
              <div style={{ padding: '0.75rem', textAlign: 'center', fontSize: '0.75rem', color: '#8c827a' }}>
                No candidate moves available in this position.
              </div>
            ) : (
              candidateMoves.slice(0, maxRows).map((cand) => {
                const style = RANK_BADGE_COLORS[cand.rank] || RANK_BADGE_COLORS[5];
                const scoreDisplay = formatEvalScore(cand.score, cand.isMate, cand.mateInPlies);
                return (
                  <button
                    key={`${cand.move.from}-${cand.move.to}-${cand.rank}`}
                    type="button"
                    onClick={() => onApplyMove && isHumanTurn && onApplyMove(cand.move)}
                    disabled={!isHumanTurn}
                    className="intransitive-candidate-row"
                    title={isHumanTurn ? `Click to play ${cand.san}` : cand.san}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span
                          className="intransitive-rank-badge"
                          style={{
                            background: style.bg,
                            color: style.text,
                            borderColor: style.border,
                          }}
                        >
                          #{cand.rank}
                        </span>
                        <span className="intransitive-candidate-san">
                          {cand.san}
                        </span>
                        {cand.threat && (
                          <span className="intransitive-candidate-tag">
                            {cand.threat}
                          </span>
                        )}
                      </div>

                      {/* Continuation PV line up to 5 subsequent moves */}
                      {cand.pv && cand.pv.length > 0 && (
                        <div className="intransitive-candidate-pv" title={`Continuation: ${cand.pv.join(' ')}`}>
                          <span className="intransitive-pv-label">Line:</span>
                          {cand.pv.map((m, idx) => (
                            <span key={idx} className="intransitive-pv-move">
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginLeft: '0.5rem' }}>
                      <span
                        className="intransitive-candidate-score"
                        style={{
                          color: cand.isMate
                            ? (cand.score > 0 ? '#059669' : '#dc2626')
                            : cand.score > 50
                            ? '#059669'
                            : cand.score < -50
                            ? '#dc2626'
                            : '#6b635b',
                          fontWeight: cand.isMate ? 800 : 700,
                        }}
                      >
                        {scoreDisplay}
                      </span>
                      {isHumanTurn && <ChevronRight size={14} color="#a8a095" />}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: '0.8rem', background: '#faf8f5', border: '1px dashed #ded7cb', borderRadius: '10px', textAlign: 'center' }}>
          <p style={{ fontSize: '0.75rem', color: '#8c827a', margin: 0 }}>
            <Sparkles size={12} style={{ display: 'inline', marginRight: '4px', verticalAlign: '-1px' }} />
            Engine analysis is hidden. Toggle <strong>Analysis ON</strong> to display candidate moves and on-board vector arrows.
          </p>
        </div>
      )}
    </div>
  );
};
