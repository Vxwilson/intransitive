import React, { useState } from 'react';
import { X, Play, CheckCircle2, AlertTriangle, ListFilter } from 'lucide-react';
import { Chess } from '../core/chess';
import type { PerftResult, DivideEntry } from '../core/perft';
import { PERFT_TEST_SUITES, perftDivide, runPerftBenchmark } from '../core/perft';

interface PerftModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentBoardFEN: string;
}

export const PerftModal: React.FC<PerftModalProps> = ({
  isOpen,
  onClose,
  currentBoardFEN,
}) => {
  const [selectedSuiteIndex, setSelectedSuiteIndex] = useState<number>(0);
  const [depth, setDepth] = useState<number>(3);
  const [useCurrentBoard, setUseCurrentBoard] = useState<boolean>(false);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [result, setResult] = useState<PerftResult | null>(null);
  const [divideEntries, setDivideEntries] = useState<DivideEntry[] | null>(null);

  if (!isOpen) return null;

  const currentSuite = PERFT_TEST_SUITES[selectedSuiteIndex];
  const activeFEN = useCurrentBoard ? currentBoardFEN : currentSuite.fen;
  const expectedNodes = !useCurrentBoard && currentSuite.expected[depth] !== undefined
    ? currentSuite.expected[depth]
    : undefined;

  const handleRun = () => {
    setIsRunning(true);
    setResult(null);
    setDivideEntries(null);

    // Run asynchronously so UI doesn't freeze
    setTimeout(() => {
      try {
        const benchmark = runPerftBenchmark(activeFEN, depth, expectedNodes);
        setResult(benchmark);

        // Compute divide
        const chess = new Chess(activeFEN);
        const { entries } = perftDivide(chess, depth);
        setDivideEntries(entries);
      } catch (err) {
        console.error('Perft error:', err);
      } finally {
        setIsRunning(false);
      }
    }, 20);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="perft-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <h3 className="modal-title">Rule Verification Suite (Perft)</h3>
            <p className="modal-desc">
              Verify move generation correctness against standard chess engine benchmarks.
            </p>
          </div>
          <button className="modal-close-btn" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="perft-body">
          {/* Preset Position Selector */}
          <div className="perft-field-group">
            <label className="perft-label">Test Position</label>
            <div className="perft-presets">
              {PERFT_TEST_SUITES.map((suite, idx) => (
                <button
                  key={suite.name}
                  className={`preset-btn ${!useCurrentBoard && selectedSuiteIndex === idx ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSuiteIndex(idx);
                    setUseCurrentBoard(false);
                    setResult(null);
                  }}
                >
                  {suite.name}
                </button>
              ))}
              <button
                className={`preset-btn ${useCurrentBoard ? 'active' : ''}`}
                onClick={() => {
                  setUseCurrentBoard(true);
                  setResult(null);
                }}
              >
                Current Game Board
              </button>
            </div>
          </div>

          <div className="fen-display-box">
            <span className="fen-code-title">FEN:</span>
            <code className="fen-code-text">{activeFEN}</code>
          </div>

          {/* Depth Selector */}
          <div className="perft-controls-row">
            <div className="perft-field-group">
              <label className="perft-label">Search Depth (1 to 5)</label>
              <div className="depth-selector">
                {[1, 2, 3, 4, 5].map((d) => (
                  <button
                    key={d}
                    className={`depth-btn ${depth === d ? 'active' : ''}`}
                    onClick={() => {
                      setDepth(d);
                      setResult(null);
                    }}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <button
              className="run-perft-btn"
              onClick={handleRun}
              disabled={isRunning}
            >
              <Play size={16} fill="currentColor" />
              <span>{isRunning ? 'Computing...' : `Run Perft (Depth ${depth})`}</span>
            </button>
          </div>

          {/* Results Display */}
          {result && (
            <div className="perft-results-card">
              <div className="results-header">
                <div className="results-badge-group">
                  {result.matchesExpected === true && (
                    <span className="badge badge-success">
                      <CheckCircle2 size={15} />
                      <span>100% Rule Match (Stockfish Benchmark)</span>
                    </span>
                  )}
                  {result.matchesExpected === false && (
                    <span className="badge badge-error">
                      <AlertTriangle size={15} />
                      <span>Mismatch: Expected {result.expectedNodes?.toLocaleString()}</span>
                    </span>
                  )}
                  {result.matchesExpected === undefined && (
                    <span className="badge badge-neutral">
                      <span>Custom Position Completed</span>
                    </span>
                  )}
                </div>

                <div className="results-stats">
                  <span className="stat-item">
                    Nodes: <strong>{result.nodes.toLocaleString()}</strong>
                  </span>
                  <span className="stat-item">
                    Time: <strong>{result.timeMs} ms</strong>
                  </span>
                  <span className="stat-item">
                    Speed: <strong>{result.nps.toLocaleString()} NPS</strong>
                  </span>
                </div>
              </div>

              {/* Move Divide List */}
              {divideEntries && divideEntries.length > 0 && (
                <div className="divide-section">
                  <div className="divide-header">
                    <ListFilter size={14} />
                    <span>Move Divide Breakdown ({divideEntries.length} legal branches)</span>
                  </div>
                  <div className="divide-grid">
                    {divideEntries.map((e) => (
                      <div key={e.moveSan} className="divide-item">
                        <span className="divide-san">{e.moveSan}</span>
                        <span className="divide-nodes">{e.nodes.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
