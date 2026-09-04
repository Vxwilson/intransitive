# Chessesque: Handover — Custom 9x9 Intransitive Game & Tabula Rasa RL Studio

> **Notice for Incoming LLM / Developer**:
> This document is the primary handover for the **Chessesque** custom game engine and reinforcement learning studio.
> - **Phase 1 & Phase 2 (Standard 8x8 Chess)**: 100% complete, verified, and passing all tests.
> - **Phase 3 (Intransitive 9x9 Cyclic RPS Game & Studio)**: **100% complete, fully implemented, verified, and passing all tests**.
> - All tests pass (`npm test`), linter reports 0 warnings (`npm run lint`), and production build compiles cleanly (`npm run build`).

---

## 1. Executive Summary & Current Status

Chessesque now contains two complete, top-tier game systems accessible via the top navigation switcher:
1. **♞ Standard Chess (8x8)**: Bitboard engine, Negamax search, Quiescence, MVV-LVA, Killer/History heuristics, NMP, LMR, Multi-PV gradient arrows, SharedArrayBuffer Lazy SMP multithreading, and luxury Obsidian glass studio.
2. **⚔️ Intransitive (9x9 Studio)**: Original cyclic strategy board game ($R > S > P > R$), King-like omnidirectional 1-step movement, dual terminal win conditions (Touchdown and Elimination), and an autonomous **Tabula Rasa Reinforcement Learning Engine** powered by Temporal Difference Leaf ($\text{TD-Leaf}(\lambda)$) backpropagation running at **20,000+ plies/sec** in background Web Workers.

---

## 2. Directory Structure & Key Files

All custom game modules are completely isolated inside `src/custom/` to ensure zero regression on the standard chess engine:

```
src/custom/
├── core/                                # Game Rules & State Engine
│   ├── game.ts                          # IntransitiveGame 9x9 state, movegen, captures, Zobrist hash
│   ├── types.ts                         # Coordinates, Move, PieceType, WinReason, SerializedGame
│   └── game.test.ts                     # Comprehensive rule verification suite (Perft, Zobrist, undo)
│
├── engine/                              # AI, TD-Learning & Web Worker
│   ├── eval.ts                          # Linear evaluation, Heuristic Master, and Tabula Rasa weights
│   ├── learner.ts                       # TD-Leaf(λ) backpropagation, gradient traces, limit-cycle damping
│   ├── trainer.ts                       # Headless self-play loops, checkpoint tournaments, NPS tracking
│   ├── trainingWorker.ts                # Multithreaded Web Worker (moves streaming, turbo batching)
│   ├── types.ts                         # Worker protocol, TrainingStats, Checkpoint, EvaluationWeights
│   └── engine.test.ts                   # Self-play simulation, weight evolution, and arena tests
│
└── ui/                                  # Luxury Studio Interface (Vanilla CSS, Claude Palette)
    ├── IntransitiveStudio.tsx           # Master container, state manager, audio, settings persistence
    ├── IntransitiveBoard.tsx            # 9x9 interactive board, click-to-move, animations, vector arrows
    ├── IntransitiveArrowOverlay.tsx     # Graduated multi-color vector arrows for top candidate moves
    ├── ArenaCard.tsx                    # Visual Arena controls, simulation setup, live zoom toggle
    ├── TurboTrainerCard.tsx             # Turbo training controls, custom batch input, outcome telemetry
    ├── HumanAnalysisPanel.tsx           # Human Play candidate move analysis & depth/line evaluation
    ├── MoveListSection.tsx              # Paired-turn move history, ply selection, time-travel controls
    ├── InterpretabilityCard.tsx         # SVG weight evolution chart, 9x9 positional heatmap, metrics
    ├── StudioSettingsCard.tsx           # Settings tab: coupled master model, preferences, JSON export/import
    └── intransitive.css                 # 100% Vanilla CSS design system (warm ivory, ceramic tokens)
```

---

## 3. Game Mechanics & Rules Summary

- **Board**: $9 \times 9$ grid (files `a`–`i`, ranks `1`–`9`).
- **Armies**: 10 pieces per player arranged in $180^\circ$ rotational echelon symmetry:
  - **Blue (P1)**: 3 Rocks, 4 Papers, 3 Scissors clustered near home corner `a1`.
  - **Red (P2)**: 3 Scissors, 4 Papers, 3 Rocks clustered near home corner `i9`.
- **Movement**: Exactly 1 step in any of the 8 compass directions (orthogonal and diagonal).
- **Cyclic Captures**:
  - **Rock** ($R$) captures **Scissors** ($S$)
  - **Scissors** ($S$) captures **Paper** ($P$)
  - **Paper** ($P$) captures **Rock** ($R$)
- **Obstacles & Blockades**: Moving onto a square occupied by a friendly piece or an uncapturable enemy piece (equal piece or predator) is illegal. They act as impenetrable physical barriers.
- **Victory Conditions**:
  1. **Touchdown**: Moving any piece into the opponent's home goal square (`i9` for Blue, `a1` for Red).
  2. **Elimination**: Capturing all opposing pieces.
  3. **Immobilization**: Opponent has zero legal moves available.
  4. **Draw**: Threefold repetition (Zobrist hash) or 80-ply move limit.

---

## 4. Reinforcement Learning Architecture

- **Tabula Rasa**: Starts with all weights at 0.0 ($w_R = 0.0, w_P = 0.0, w_S = 0.0, w_{\text{goal}} = 0.0$).
- **State Value Function**:
  $$V(s) = \sum_{p \in \{R,P,S\}} w_p \cdot \Delta p + w_{\text{goal}} \cdot \Delta \text{Goal} + w_{\text{threat}} \cdot \Delta \text{Threat} + w_{\text{vuln}} \cdot \Delta \text{Vuln} + \sum_{sq} \Delta \text{PST}(sq)$$
- **TD-Leaf($\lambda$)**:
  $$\delta_t = V(s_{t+1}) - V(s_t), \quad \delta_{T-1} = z - V(s_{T-1})$$
  $$E_t = \delta_t + \lambda \cdot E_{t+1}, \quad \Delta w_k = \frac{\alpha}{\sqrt{T}} \sum_{t=0}^{T-1} E_t \cdot f_k(s_t)$$
- **Stabilizing Limit Cycles**:
  - **Minimum Piece Floor ($\ge 1.0$)**: In analogy to chess pawns, prevents material value collapse during cyclic downturns.
  - **Mean-Centering Regularization**: Keeps predator-prey dynamics stable and prevents weight divergence.

---

## 5. Studio Interface & Tabs

The studio features 4 dedicated operational tabs:

### Tab 1: Visual Arena (`visual-arena`)
- **Fighter Selection**: Header controls allow selecting `🔵 Fighter A` vs `🔴 Fighter B` (Heuristic Master, Current Model, Gen 0, or any saved checkpoint).
- **Left 9x9 Board**: Live board playback with play/pause, step forward/back, restart, and speed slider (50ms–2000ms).
- **Interactive Board Zoom**: Real-time ~5ms per ply board animation during tournament simulation runs.
- **Right Column**:
  - **Simulation Arena Card**: Custom games input, quick presets (10, 20, 50, 100), win/loss/draw results, tactical accuracy percentages, and average game length.
  - **Fast Board Zoom Toggle**: Switch between live animated board zoom and instant headless tournament execution.
  - **Move History List (`MoveListSection`)**: Paired turns (`1. Ra2-b3 Sb8-c7`), active ply highlighting, and click-to-ply time travel.

### Tab 2: Turbo Trainer (`turbo-train`)
- **Full-Width Layout**:
  - **Top Card (`TurboTrainerCard`)**:
    - Lifetime training metrics: Generation count, total games played, Blue/Red win ratio, average game length.
    - Custom games input (warm ivory styled, dark-mode protected) with quick batch presets (100, 300, 500, 2500) and Train button.
    - Rich game outcome telemetry: Touchdowns (Blue vs Red), Eliminations (Blue army vs Red army wiped), Draws (repetition vs 80-ply limit), and ply extremes (shortest vs longest decisive games).
    - Checkpoint snapshot manager: Save snapshot with timestamped naming (`Gen X_MMDD_HHMMSS`), restore baseline, and view saved checkpoints.
  - **Bottom Card (`InterpretabilityCard`)**:
    - **Piece Value Dynamics**: Real-time SVG line graph tracking $w_R$, $w_P$, and $w_S$ over training generations.
    - **9x9 Positional Heatmap**: Visualizes the AI's learned tactical preferences for board squares and goal proximity.
    - **Tabula Rasa Parameter Grid**: Live numerical readouts of all learned model weights.

### Tab 3: Human Play (`human-play`)
- **Header Controls**: Opponent picker (`🏆 Heuristic Master`, `🤖 Current In-Memory Weights`, `👶 Gen 0 Tabula Rasa`, or saved checkpoints), side picker (`🔵 Blue` vs `🔴 Red`), and `▶ Start Game` button.
- **Board Interaction**: Click piece to select, click legal destination to move. Friendly move indicators and capture highlights. Procedural sound synthesis.
- **Right Column**:
  - **Human Analysis Panel**: On/off toggle, 1–5 candidate lines, coupled model badge, centipawn evaluation, and tactical move descriptors.
  - **Dynamic Multi-Colored Arrows**: Graduated vector arrows on the 9x9 board (Emerald/Cyan for #1, Royal Blue for #2, Violet for #3, Amber for #4, Slate for #5).
  - **Move List**: Paired-turn move history with time travel.

### Tab 4: Settings (`settings`)
- **Coupled Master Evaluation Model**: Model selection for **Board Evaluation** and **Human Play Move Analysis** is coupled into a single master dropdown (`evalModelId`).
- **Fast Tournament Zoom**: Global toggle for fast board zoom during arena simulations.
- **Visual Arena Playback Speed**: Default delay (ms).
- **Human Play Defaults**: Default player side (`blue` or `red`) and default AI opponent.
- **Audio Sound Effects**: Audio mute/enable toggle.
- **Persistence & Backup**: Export all checkpoints and weights to JSON, import checkpoints from JSON, or reset all settings to defaults.
- **LocalStorage**: All settings are automatically saved under `chessesque_intransitive_settings_v1`.

---

## 6. Verification & Test Commands

Run these commands from the repository root to verify system health:

```bash
# 1. Run all 4 test suites (Standard Chess Core, Search Engine, Intransitive Core, Intransitive Engine)
npm test

# 2. Run static analysis and linter (zero warnings or errors expected)
npm run lint

# 3. Compile full production bundle with TypeScript check
npm run build

# 4. Start local development server
npm run dev
```

---

## 7. High-Value Roadmap Ideas for Future Iterations

For the next developer or LLM continuing work on Chessesque:
1. **PGN/Replay Export for Intransitive**: Export games in a standardized custom PGN format, with copy-to-clipboard or file download.
2. **Round-Robin Tournament Mode**: An automated tournament manager that pits all saved checkpoints against each other in a round-robin league table with live Elo calculation.
3. **MCTS / Policy Network Comparison**: Implement a simple neural network or Monte Carlo Tree Search agent to compare with TD-Leaf.
4. **Custom Board Setup & Handicap Mode**: Allow players to place custom initial piece configurations or play with piece handicaps.
5. **Interactive Replay Analyzer**: Add an engine analysis graph (eval over time) to the move list section in human play and arena games.
