/**
 * ArenaRealtimeResultsCard - Live Tournament Standings & Progress Dashboard
 * Displays real-time game progress, win/draw counters, and proportional distribution
 * while tournament simulations are executing in Visual Arena.
 */

import React from 'react';
import { Activity, ScrollText, Trophy, Pause, Play, Square } from 'lucide-react';

interface ArenaRealtimeResultsCardProps {
  isSimulating: boolean;
  isPaused?: boolean;
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
  gameIndex: number;
  totalGames: number;
  winsA: number;
  winsB: number;
  draws: number;
  fighterAName: string;
  fighterBName: string;
  fighterADepth: number;
  fighterBDepth: number;
  fighterAMode?: 'depth' | 'time';
  fighterBMode?: 'depth' | 'time';
  fighterATimeSec?: number;
  fighterBTimeSec?: number;
  currentPly?: number;
  lastSan?: string;
  onToggleView?: () => void;
}

export const ArenaRealtimeResultsCard: React.FC<ArenaRealtimeResultsCardProps> = ({
  isSimulating,
  isPaused = false,
  onPause,
  onResume,
  onStop,
  gameIndex,
  totalGames,
  winsA,
  winsB,
  draws,
  fighterAName,
  fighterBName,
  fighterADepth,
  fighterBDepth,
  fighterAMode = 'depth',
  fighterBMode = 'depth',
  fighterATimeSec = 1.0,
  fighterBTimeSec = 1.0,
  currentPly = 0,
  lastSan = '',
  onToggleView,
}) => {
  const gamesCompleted = winsA + winsB + draws;
  const progressGames = Math.min(totalGames, Math.max(gamesCompleted, gameIndex));
  const progressPercent = totalGames > 0 ? Math.min(100, Math.round((progressGames / totalGames) * 100)) : 0;

  const winRateA = gamesCompleted > 0 ? Math.round((winsA / gamesCompleted) * 100) : 0;
  const winRateB = gamesCompleted > 0 ? Math.round((winsB / gamesCompleted) * 100) : 0;
  const drawRate = gamesCompleted > 0 ? Math.round((draws / gamesCompleted) * 100) : 0;

  const displayNameA = fighterAName.split(' ')[0] || 'Fighter A';
  const displayNameB = fighterBName.split(' ')[0] || 'Fighter B';

  const labelA = fighterAMode === 'time' ? `${fighterATimeSec}s` : `D${fighterADepth}`;
  const labelB = fighterBMode === 'time' ? `${fighterBTimeSec}s` : `D${fighterBDepth}`;

  return (
    <div className="intransitive-movelist-card" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
      {/* Header */}
      <div className="intransitive-movelist-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
          <div
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '6px',
              background: '#fff7ed',
              border: '1px solid #fed7aa',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Activity size={14} color="#ea580c" />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#322a24' }}>
                Real-Time Results
              </span>
              {isSimulating && (
                isPaused ? (
                  <span className="intransitive-badge-paused">
                    <Pause size={9} /> PAUSED
                  </span>
                ) : (
                  <span className="intransitive-badge-live">
                    <span className="intransitive-live-dot" /> LIVE
                  </span>
                )
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {/* Pause / Resume & Stop Quick Actions */}
          {isSimulating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
              {isPaused ? (
                <button
                  type="button"
                  onClick={onResume}
                  className="intransitive-mini-btn success"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', fontSize: '0.67rem' }}
                  title="Resume simulation"
                >
                  <Play size={10} /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPause}
                  className="intransitive-mini-btn warn"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.45rem', fontSize: '0.67rem' }}
                  title="Pause simulation"
                >
                  <Pause size={10} /> Pause
                </button>
              )}
              <button
                type="button"
                onClick={onStop}
                className="intransitive-mini-btn danger"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', padding: '0.15rem 0.4rem', fontSize: '0.67rem' }}
                title="Stop simulation early"
              >
                <Square size={9} fill="currentColor" /> Stop
              </button>
            </div>
          )}

          {onToggleView && (
            <button
              type="button"
              onClick={onToggleView}
              className="intransitive-mini-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                fontSize: '0.68rem',
                padding: '0.2rem 0.5rem',
              }}
              title="Switch view to Move Notation"
            >
              <ScrollText size={12} /> Move Notation
            </button>
          )}
        </div>
      </div>

      {/* Card Content Body */}
      <div style={{ padding: '0.8rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {/* Progress Bar & Status */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.74rem' }}>
            <span style={{ color: '#4a4239', fontWeight: 600 }}>
              {isSimulating ? (
                isPaused ? (
                  <>⏸ Paused at Game <strong>{progressGames}</strong> of <strong>{totalGames}</strong></>
                ) : (
                  <>Simulating Game <strong>{progressGames}</strong> of <strong>{totalGames}</strong></>
                )
              ) : (
                <>Completed <strong>{totalGames}</strong> games</>
              )}
            </span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: isPaused ? '#b45309' : '#c2410c' }}>
              {progressPercent}%
            </span>
          </div>

          <div
            style={{
              width: '100%',
              height: '6px',
              borderRadius: '999px',
              background: '#e8e2d8',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: isPaused
                  ? 'linear-gradient(90deg, #d97706, #f59e0b)'
                  : 'linear-gradient(90deg, #ea580c, #f97316)',
                borderRadius: '999px',
                transition: 'width 0.2s ease',
              }}
            />
          </div>
        </div>

        {/* Head-to-Head Live Scorecard */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '0.5rem',
            background: '#ffffff',
            borderRadius: '8px',
            border: '1px solid #eee8de',
            padding: '0.65rem 0.5rem',
            textAlign: 'center',
          }}
        >
          {/* Fighter A */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#2563eb',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${fighterAName} (${labelA})`}
            >
              🔵 {displayNameA} ({labelA})
            </span>
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#1e3a8a',
              }}
            >
              {winsA}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#64748b', fontWeight: 600 }}>
              {winRateA}%
            </span>
          </div>

          {/* Draws */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.15rem',
              borderLeft: '1px solid #f1ece1',
              borderRight: '1px solid #f1ece1',
            }}
          >
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#786f66' }}>
              🤝 Draws
            </span>
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#44403c',
              }}
            >
              {draws}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#786f66', fontWeight: 600 }}>
              {drawRate}%
            </span>
          </div>

          {/* Fighter B */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            <span
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#ea580c',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={`${fighterBName} (${labelB})`}
            >
              🔴 {displayNameB} ({labelB})
            </span>
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#9a3412',
              }}
            >
              {winsB}
            </span>
            <span style={{ fontSize: '0.68rem', color: '#9a3412', fontWeight: 600 }}>
              {winRateB}%
            </span>
          </div>
        </div>

        {/* Dynamic Proportional Distribution Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <div className="intransitive-win-bar" style={{ height: '8px', borderRadius: '4px' }}>
            <div
              className="intransitive-win-seg-a"
              style={{ width: `${winRateA}%`, transition: 'width 0.25s ease' }}
              title={`${displayNameA}: ${winRateA}%`}
            />
            <div
              className="intransitive-win-seg-draw"
              style={{ width: `${drawRate}%`, transition: 'width 0.25s ease' }}
              title={`Draws: ${drawRate}%`}
            />
            <div
              className="intransitive-win-seg-b"
              style={{ width: `${winRateB}%`, transition: 'width 0.25s ease' }}
              title={`${displayNameB}: ${winRateB}%`}
            />
          </div>
        </div>

        {/* Live Match Submetric Footnote */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.7rem',
            color: '#786f66',
            paddingTop: '0.15rem',
          }}
        >
          <span>
            {currentPly > 0 ? (
              <>Current Ply: <strong style={{ color: '#2b2520' }}>{currentPly}</strong></>
            ) : (
              <>Games concluded: <strong style={{ color: '#2b2520' }}>{gamesCompleted}</strong></>
            )}
            {lastSan && (
              <span style={{ marginLeft: '0.4rem', fontFamily: "'JetBrains Mono', monospace", color: '#ea580c' }}>
                ({lastSan})
              </span>
            )}
          </span>

          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: '#a8a29e' }}>
            <Trophy size={11} /> Real-time Telemetry
          </span>
        </div>
      </div>
    </div>
  );
};

