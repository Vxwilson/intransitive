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
3. **Advanced AI Studio Features**:
   - **Continuous D1–D6 Search Sliders** & **Mutually Exclusive Thinking Time (Seconds)** with iterative deepening.
   - **Non-Blocking Tournament Simulation Engine** supporting live **Pause, Resume, and Early Stop** with real-time standings.
   - **Dedicated Background Analysis Worker** providing infinite candidate-move exploration with zero main-thread lag.
   - **Instant-Response Human Play** with zero artificial delay and dynamic depth/time opponent configuration.
   - **Full Checkpoint Management** with inline renaming, JSON export/import, and rolling historical league buffer.

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
├── engine/                              # AI, TD-Learning & Multithreaded Workers
│   ├── evaluator.ts                     # Linear evaluation, Heuristic Master, and Tabula Rasa weights
│   ├── search.ts                        # Minimax search (D1–D6), time-budgeted iterative deepening, forced mate (+M)
│   ├── tdLearner.ts                     # TD-Leaf(λ) backpropagation, gradient traces, adaptive LR annealing
│   ├── trainer.ts                       # Headless self-play loops, modular playArenaGame, cancellation tokens
│   ├── trainingWorker.ts                # Cooperative tournament worker (ARENA_RUN, ARENA_PAUSE, ARENA_RESUME, ARENA_STOP)
│   ├── analysisWorker.ts                # Dedicated background analysis worker for non-blocking infinite think
│   ├── checkpoint.ts                    # LocalStorage persistence, renaming, deletion, JSON backup/export
│   ├── types.ts                         # Worker request/response protocol, TrainingStats, Checkpoint, EvaluationWeights
│   └── engine.test.ts                   # Self-play simulation, weight evolution, asymmetric depth, and arena tests
│
└── ui/                                  # Luxury Studio Interface (Vanilla CSS, Warm Ivory Ceramic Palette)
    ├── IntransitiveStudio.tsx           # Master container, state manager, worker coordinator, settings persistence
    ├── IntransitiveBoard.tsx            # 9x9 interactive board, click-to-move, animations, vector arrows
    ├── IntransitiveArrowOverlay.tsx     # Graduated multi-color vector arrows for top candidate moves
    ├── ArenaCard.tsx                    # Visual Arena controls, D1-D6 sliders, think time textfield, pause/resume buttons
    ├── ArenaRealtimeResultsCard.tsx     # Live tournament standings, progress bar, win distribution bar, pause badge
    ├── TurboTrainerCard.tsx             # Turbo training controls, batch input, telemetry, inline model renaming
    ├── HumanAnalysisPanel.tsx           # Human Play candidate move analysis, depth targets, telemetry readout
    ├── MoveListSection.tsx              # Paired-turn move history, ply selection, time-travel controls
    ├── InterpretabilityCard.tsx         # SVG weight evolution chart, 9x9 positional heatmap, metrics
    ├── StudioSettingsCard.tsx           # Settings tab: coupled master model, checkpoint manager with rename, backup
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

- **Tabula Rasa**: Starts with all weights at 0.0 ($w_R = 0.0, w_P = 0.0, w_S = 0.0, w_{\text{goal}} = 0.0, w_{\text{runner}} = 0.0$).
- **State Value Function**:
  $$V(s) = \sum_{p \in \{R,P,S\}} w_p \cdot \Delta p + w_{\text{goal}} \cdot \Delta \text{Goal} + w_{\text{runner}} \cdot \Delta \text{Runner} + w_{\text{threat}} \cdot \Delta \text{Threat} + w_{\text{vuln}} \cdot \Delta \text{Vuln} + \sum_{sq} \Delta \text{PST}(sq)$$
- **Chebyshev Geometry & Unstoppable Runner Engine**:
  - Distance to goals is calculated using **8-directional Chebyshev distance**: $D(s_1, s_2) = \max(|f_1 - f_2|, |r_1 - r_2|)$.
  - **Unstoppable Runner Detection ("Rule of the Goal")**: For any friendly piece with distance $D \le 3$ to goal, the engine evaluates whether any opposing predator can intercept it before touchdown ($D_{\text{predator}} \le D$). Uncatchable runners receive decisive tactical scoring (+4000 cp for $D=1$, +1500 cp for $D=2$, +600 cp for $D=3$), preventing horizon effect blunders and converting forced wins.
- **TD-Leaf($\lambda$)**:
  $$\delta_t = V(s_{t+1}) - V(s_t), \quad \delta_{T-1} = z - V(s_{T-1})$$
  $$E_t = \delta_t + \lambda \cdot E_{t+1}, \quad \Delta w_k = \frac{\alpha}{\sqrt{T}} \sum_{t=0}^{T-1} E_t \cdot f_k(s_t)$$
- **AlphaZero Exploration & Move Sampling**:
  - **Softmax Temperature Annealing**: Moves during opening plies are sampled with $P(m) \propto \exp((Q(m) - Q_{\max})/\tau)$:
    - Plies 0–4 (Opening): $\tau = 24.0\text{ cp}, \epsilon = 0.25$ (forces exploration of alternative opening moves; escapes premature certainty and "tunnel vision").
    - Plies 5–8 (Transition): $\tau = 10.0\text{ cp}, \epsilon = 0.08$ (focused exploration among top candidates).
    - Plies 9+ (Endgame): $\tau = 0.0\text{ cp}$ (greedy argmax conversion to punish blunders and convert touchdowns).
  - **Dirichlet Root Noise**: Sampled via Marsaglia-Tsang Gamma generator with $\boldsymbol{\eta} \sim \text{Dir}(0.3)$ blended at $25\%$ during root openings.
- **Anti-Cycle Historical League Buffer**:
  - In cyclic games where $R > S > P > R$, pure self-play ($W_t$ vs $W_t$) oscillates in limit cycles (Red Queen effect).
  - A rolling buffer of deep-cloned weights is preserved every 50 generations (up to 12 models).
  - Opponents are mixed probabilistically: **65% Self-Play**, **20% Historical League Checkpoint**, **15% Heuristic Benchmark Anchor**.
- **Goal Anchor Floor & Parameter Safeguards**:
  - **Goal & Runner Floors ($\ge 10.0$ / $\ge 5.0$)**: Prevents catastrophic touchdown decay where drawn/counterattacked games previously drove touchdown weights to zero.
  - **Goal Gradient Normalization ($0.15\times$)**: Multi-piece Chebyshev distance sums are scaled to balance with single-piece material features.
  - **Piece & Tactical Floors**: Minimum floor of $5.0$ on piece values and $2.0$ on threat/vulnerability penalties ensures pieces remain valuable tactical assets throughout thousands of self-play games.

---

## 5. Search Engine & Engine Analysis System

### 5.1 Depth Sliders (D1–D6 Continuum)
The search depth selector provides continuous customization from D1 to D6:
- **D1 Fast (1 ply)**: Instant static leaf eval (~0.1ms/move, ideal for instant 100-game simulations).
- **D2 Tactical (2 plies)**: Minimax lookahead with opponent response modeling (~1–3ms/move, balanced default).
- **D3 Deep (3 plies)**: 3-ply minimax with full tactical conversion (~15–30ms/move).
- **D4 Master (4 plies)**: Deep positional evaluation and multi-piece combinations (~150–400ms/move).
- **D5 Grandmaster (5 plies)**: Extended tactical lookahead (~1–3s/move).
- **D6 Ultra (6 plies)**: Deep exhaustive tree search (~5–15s/move).

### 5.2 Mutually Exclusive Thinking Time (Iterative Deepening)
Both Visual Arena and Human Play feature a segmented mode switch: `[ 🎯 Depth | ⏱ Think Time ]`.
- In **Time Mode**, users configure allotted seconds per move (e.g., `0.5s`, `1.0s`, `2.0s`, `5.0s`).
- The engine executes **iterative deepening** ($d = 1, 2, 3, \dots$):
  - Automatically breaks when forced mate / touchdown (+M) is detected.
  - Halts if elapsed time exceeds $60\%$ of the budget or is within 30ms of timeout, preventing search time overshooting.

### 5.3 Dedicated Move Analysis Web Worker (`analysisWorker.ts`)
- **Main Thread Decoupling**: Move analysis runs in an independent Web Worker spawned on demand, completely isolated from gameplay and training workers.
- **Immediate Interruption**: Whenever the human or AI makes a move, the analysis worker is terminated instantly with zero latency, eliminating search lag.
- **Progressive Depth Telemetry**: Emits `ANALYSIS_PROGRESS` at each depth step with nodes, NPS, depth, centipawn score, and formatted PV continuation lines.

### 5.4 Cooperative Tournament Execution (Pause, Resume, Stop)
- In `trainingWorker.ts`, tournaments run cooperatively via `setTimeout(runNextGame, 0)`, allowing incoming messages (`ARENA_PAUSE`, `ARENA_RESUME`, `ARENA_STOP`) to be processed immediately by the worker event loop.
- **Pause**: Freezes tournament simulation and live board streaming; shows amber `⏸ PAUSED` badge and updates game progress label.
- **Resume**: Restores execution smoothly with zero state loss.
- **Stop**: Halts simulation after the current game and finalizes partial results immediately.

---

## 6. Studio Interface & Tabs

The studio features 4 dedicated operational tabs:

### Tab 1: Visual Arena (`arena`)
- **Fighter Configuration**: Independent search configuration for `🔵 Fighter A` and `🔴 Fighter B`:
  - Segmented switch `[ 🎯 Depth | ⏱ Think Time ]`.
  - Continuous D1–D6 depth slider or numeric seconds textfield with quick chips (`0.5s`, `1.0s`, `2.0s`, `5.0s`).
- **Interactive Board Zoom**: Real-time ~6ms per ply board animation during tournament simulation runs.
- **Simulation Arena Card**: Custom games input, quick presets (10, 20, 50, 100), Run Tournament, Pause, Resume, and Stop controls.
- **Real-Time Results Card (`ArenaRealtimeResultsCard`)**:
  - Automatically active during simulations.
  - Live progress bar with percentage, game count (`Simulating Game X of Y` or `⏸ Paused at Game X of Y`).
  - Head-to-head scorecard displaying fighter depth or thinking time (`🔵 Fighter A (1.0s)` vs `🔴 Fighter B (D3)`).
  - Dynamic proportional win distribution bar.
  - Toggle button to switch back and forth with `Move Notation`.

### Tab 2: Turbo Trainer (`turbo`)
- **Lifetime Training Metrics**: Generation count, total games played, Blue/Red win ratio, average game length.
- **Self-Play Training Depth**: Segmented selector between **Depth 1 (Ultra-Turbo ~25,000 plies/s)** for rapid feature discovery and **Depth 2 (Tactical Lookahead ~1,500 plies/s)** for blunder-free master training.
- **Batch Presets**: Custom games input with quick batch presets (100, 300, 500, 2500) and Train button.
- **Game Outcome Telemetry**: Touchdowns, Eliminations, Draws (repetition vs 80-ply limit), and ply extremes.
- **Checkpoint Snapshot Manager & Inline Renaming**: Save snapshots with custom names, click the edit icon to rename checkpoints inline directly in the list, and restore baselines.
- **Interpretability Visualizations**:
  - **Piece Value Dynamics**: Real-time SVG line graph tracking $w_R$, $w_P$, and $w_S$ over training generations.
  - **9x9 Positional Heatmap**: Visualizes the AI's learned tactical preferences for board squares and goal proximity.
  - **Tabula Rasa Parameter Grid**: Live numerical readouts of all learned model weights.

### Tab 3: Human Play (`play`)
- **Instant Response (Zero Artificial Delay)**: Artificial delays removed. AI moves trigger immediately following computational limits.
- **Opponent Engine Controls**:
  - Mode switch `[ 🎯 Depth | ⏱ Time ]`.
  - Opponent Depth slider (D1–D6) or Think Time seconds input with quick chips (`0.5s`, `1.0s`, `2.0s`).
- **Dynamic Turn Status Banner**: Displays `Computer is thinking (1.0s)...` or `Computer is thinking (Depth 3)...` dynamically.
- **Human Analysis Panel**: On/off toggle, 1–5 candidate lines, coupled model badge, centipawn evaluation, PV lines, and forced touchdown (+M) highlighting.
- **Dynamic Multi-Colored Arrows**: Graduated vector arrows on the 9x9 board (Emerald/Cyan for #1, Royal Blue for #2, Violet for #3, Amber for #4, Slate for #5).

### Tab 4: Settings (`settings`)
- **Coupled Master Evaluation Model**: Model selection for **Board Evaluation** and **Human Play Move Analysis** is coupled into a single master dropdown (`evalModelId`).
- **Checkpoint Management & Renaming**: View all checkpoints, edit/rename model names inline, delete user checkpoints, or clear all user checkpoints while preserving built-in presets.
- **Preference Controls**: Audio mute toggle, fast tournament zoom toggle, default side, and default search parameters.
- **Backup & Persistence**: Export/import all checkpoints as JSON, reset settings to defaults (`chessesque_intransitive_settings_v1`).

---

## 7. Verification & Test Commands

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

## 8. High-Value Roadmap Ideas for Future Iterations

For the next developer or LLM continuing work on Chessesque:
1. **NNUE Architecture Leap**: Implement the compact 66k-parameter browser-native NNUE engine (detailed architectural blueprint and migration plan fully documented in [INTRANSITIVE_NNUE_PLAN.md](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/INTRANSITIVE_NNUE_PLAN.md)).
2. **PGN/Replay Export for Intransitive**: Export games in a standardized custom PGN format with move notations and SAN tags.
3. **Round-Robin League Manager**: Automated tournament manager that pits all saved checkpoints against each other in a round-robin league table with live Elo calculation.
4. **Interactive Replay Graph**: Add an eval-over-time interactive curve in the move list section for human play and tournament review.

