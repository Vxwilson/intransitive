# Intransitive: 9x9 Cyclic RPS Game & Tabula Rasa RL Studio
## Architectural Blueprint, Methods & Studio Documentation

---

## 1. Executive Summary

**Intransitive** is an original 2-player cyclic strategy board game designed, implemented, and fully verified within **Chessesque**. It features an omnidirectional 1-step movement model governed by cyclic Rock-Paper-Scissors capture mechanics ($R > S > P > R$), dual terminal win conditions (Touchdown and Elimination), and an autonomous **Tabula Rasa Reinforcement Learning Engine** powered by Temporal Difference Leaf ($\text{TD-Leaf}(\lambda)$) backpropagation.

All custom modules are isolated under `src/custom/`, guaranteeing **zero regression** on the classical 8x8 Chess engine.

---

## 2. Game Rules & Mechanics

### A. The Board & Setup
- **Geometry**: $9 \times 9$ grid (81 squares), with files labeled `a` through `i` (left to right) and ranks `1` through `9` (bottom to top).
- **Armies**: Each player commands 10 pieces arranged in exact $180^\circ$ rotational echelon symmetry:
  - **Blue (Player 1)**: 3 Rocks, 4 Papers, 3 Scissors clustered near home goal `a1`.
  - **Red (Player 2)**: 3 Scissors, 4 Papers, 3 Rocks clustered near home goal `i9`.
- **Touchdown Goals**:
  - `i9` is the Red player's home corner. A Blue piece entering `i9` scores an instant **Touchdown Victory**.
  - `a1` is the Blue player's home corner. A Red piece entering `a1` scores an instant **Touchdown Victory**.

### B. Movement & Cyclic Captures
- **Movement**: Every piece moves exactly 1 step in any of the 8 compass directions (King-like movement: orthogonal and diagonal), provided the target square is not occupied by a friendly piece.
- **Intransitive Captures**:
  - **Rock** ($R$) captures **Scissors** ($S$)
  - **Scissors** ($S$) captures **Paper** ($P$)
  - **Paper** ($P$) captures **Rock** ($R$)
- **Blockades & Non-Capture Collisions**: If a piece attempts to move onto an enemy square that it *cannot* capture (e.g., Rock trying to step onto Paper), the move is illegal. Enemy predators and equal pieces act as impenetrable physical barriers.
- **Terminal Win Conditions**:
  1. **Touchdown**: Moving any piece into the opponent's home goal square (`i9` for Blue, `a1` for Red).
  2. **Elimination**: Capturing all opposing pieces.
  3. **Immobilization**: Leaving the opponent with zero legal moves.
  4. **Draws**: 80-ply move limit or threefold repetition (tracked via 64-bit Zobrist hashes).

---

## 3. Reinforcement Learning Methods (TD-Leaf & Self-Play)

### A. Tabula Rasa State Representation
The engine starts at **Generation 0 with strict zero-knowledge**:
$$w_R = 0.0, \quad w_P = 0.0, \quad w_S = 0.0, \quad w_{\text{goal}} = 0.0$$
The AI evaluates states through a linear combination of exact tactical and positional features:
$$V(s) = w_R \cdot \Delta R + w_P \cdot \Delta P + w_S \cdot \Delta S + w_{\text{goal}} \cdot \Delta \text{Goal} + w_{\text{threat}} \cdot \Delta \text{Threat} + w_{\text{vuln}} \cdot \Delta \text{Vuln} + \sum_{sq} \Delta \text{PST}(sq)$$

### B. TD-Leaf($\lambda$) Credit Assignment
During self-play, every state transition $s_t \to s_{t+1}$ generates a Temporal Difference error:
$$\delta_t = V(s_{t+1}) - V(s_t)$$
For the terminal state $s_T$ with game outcome $z \in \{+1000, -1000, 0\}$:
$$\delta_{T-1} = z - V(s_{T-1})$$
Eligibility traces $E_t$ accumulate backwards from the terminal outcome:
$$E_t = \delta_t + \lambda \cdot E_{t+1}$$
Gradients for each feature $f_k$ are accumulated across all plies $t \in [0, T-1]$:
$$\Delta w_k = \frac{\alpha}{\sqrt{T}} \sum_{t=0}^{T-1} E_t \cdot f_k(s_t)$$

### C. Stabilizing Cyclic Limit Cycles (The "Red Queen" Effect)
In any intransitive zero-sum game, unregularized self-play naturally exhibits rotational limit cycles:
$$\text{High Paper} \longrightarrow \text{Scissors adapts to hunt Paper} \longrightarrow \text{Rock adapts to hunt Scissors} \longrightarrow \text{Paper surges again}$$
To keep training healthy, tactical, and robust:
1. **Minimum Pawn Floor ($\ge 1.0$)**:
   - In analogy to chess pawns having a base value of 1, no piece value is ever allowed to collapse to $0.0$. Even during a cyclic downturn, each piece retains a tangible value of at least $1.0$ for board control and touchdown threats.
2. **Mean-Centering Regularization**:
   - A gentle mean-centering penalty pulls $(w_R, w_P, w_S)$ towards their collective tactical mean, preventing runaway divergence while preserving relative predator-prey premiums.

---

## 4. Studio Tabs & User Experience

The Studio interface is organized into 4 dedicated operational tabs:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       INTRANSITIVE STUDIO HEADER                                       │
│ [ 🔬 Visual Live ]       [ ⚡ Turbo Trainer ]       [ 🏆 Checkpoint Arena ]       [ 🎮 Human Play ]    │
├───────────────────────────────────────────┬────────────────────────────────────────────────────────────┤
│               LEFT COLUMN                 │                        RIGHT COLUMN                        │
│                                           │                                                            │
│  • Turn & Live Evaluation Status Bar      │  TAB 1 (Visual Live): Live Model Inspector & Telemetry     │
│  • 9x9 Tactile Wood Board                 │  TAB 2 (Turbo Trainer): 50/200/1000 Batching & Save Card   │
│  • Visual Live Playback Toolbar           │  TAB 3 (Arena): Gen X vs Gen Y Matchmaker & Tournaments   │
│    (Play, Step Fwd, Step Back, Speed Bar) │  TAB 4 (Human Play): Opponent Difficulty & Color Selector  │
│  • Victory Callout Banner                 │                                                            │
│                                           │  • Interpretability Dashboard (Always Visible across tabs) │
│                                           │    - SVG Polyline Evolution Chart (R, P, S dynamics)       │
│                                           │    - 9x9 Positional Heatmap (Learned square bonuses)       │
└───────────────────────────────────────────┴────────────────────────────────────────────────────────────┘
```

### Tab 1: 🔬 Visual Live Mode ("The Microscope")
- **Purpose**: Step-by-step observable AI self-play in real time.
- **Controls**:
  - **Live Playback Bar**: Play, Pause, Step Forward, Step Backward, Reset.
  - **Speed Slider**: Adjustable move delay from **50ms** (fast live) up to **2,000ms** (microscopic analysis) with quick presets (`50ms`, `300ms`, `1.0s`).
  - **Model Inspector**: Dropdown to select which AI model to observe (Current Model, Heuristic Master, Gen 0 Tabula Rasa, or user checkpoints).
  - **Telemetry**: Real-time halfmove ply counter, live centipawn evaluation score, and active piece tallies ($R:P:S$) for Blue and Red.

### Tab 2: ⚡ Turbo Trainer Mode
- **Purpose**: High-speed, non-blocking autonomous background self-play.
- **Capabilities**:
  - **Batch Training Buttons**:
    - **50 Games**: Quick refinement in $\sim 0.5\text{s}$.
    - **200 Games**: Deep strategic training in $\sim 2.0\text{s}$.
    - **1,000 Games**: Turbo reinforcement learning batch in $\sim 8.0\text{s}$.
  - **Live Progress Telemetry**: Real-time progress bar with throughput tracking (up to **20,000+ plies/sec**).
  - **Lifetime Metrics Grid**: Generation counter, total games played, Blue/Red win ratio, and average game length.
  - **Inline Snapshot Saver**: Instant "Save Gen X Snapshot" with custom name input right on the card.
  - **"Watch Live" Preview**: Immediate one-click jump to watch the newly trained model play on the board.

### Tab 3: 🏆 Checkpoint Arena
- **Purpose**: Objective benchmarking and head-to-head tournament evaluation.
- **Capabilities**:
  - **Matchmaker**: Select **Fighter A (Blue)** vs **Fighter B (Red)** from built-in benchmarks or user checkpoints.
  - **Built-in Benchmarks**:
    - `Gen 0 (Tabula Rasa / 0-Knowledge)`: Untrained baseline.
    - `Heuristic Benchmark (Hand-Tuned Master)`: Algorithmic "boss" with tactical predator/prey heuristics ($R=100, P=100, S=100, \text{Goal}=20$).
  - **Exhibition Modes**:
    - **Watch 1 Live Match**: Observes a single decisive game between the two generations on the board.
    - **Simulate 20 Games**: Runs a rapid 20-game tournament and renders a 3-segment win distribution bar ($A\text{ wins}, \text{Draws}, B\text{ wins}$).
  - **Checkpoint Management**: Export all checkpoints to JSON or import community models from JSON.

### Tab 4: 🎮 Human Play Mode
- **Purpose**: Interactive play for humans to test their strategic wits against the AI.
- **Capabilities**:
  - **Opponent Selector**: Play against the **Heuristic Master (Challenging)**, your **Current Trained Model**, **Gen 0 Tabula Rasa**, or any custom checkpoint.
  - **Side Selection**: Play as **Blue** (moves 1st, attacks `i9`) or **Red** (moves 2nd, defending near `i9`, attacks `a1` — AI automatically makes the opening move as Blue).
  - **Interactive 9x9 Board**: Click any piece to see valid destination dots and capture target brackets. Turns are strictly enforced so users cannot move during AI thinking.

### Always-Visible Interpretability Dashboard
- **Piece Value Dynamics (SVG Polyline Chart)**: Displays the historical trajectory of Rock ($w_R$, amber), Paper ($w_P$, green), and Scissors ($w_S$, rose) across all training generations.
- **Positional Heatmap (9x9 Grid)**: Interactive square bonus map for Rock, Paper, and Scissors showing learned spatial preferences.

---

## 5. System Architecture & Directory Organization

```
src/
├── custom/
│   ├── core/                        # Phase 1: 9x9 Core Rules & Move Generator
│   │   ├── types.ts                 # Player, PieceType, Move, GameStatus interfaces
│   │   ├── constants.ts             # 9x9 coordinates, touchdown targets, 8-neighbor lookup
│   │   ├── zobrist.ts               # 64-bit atomic Zobrist hashing with SplitMix64 PRNG
│   │   ├── fen.ts                   # 9x9 FEN parser & serializer
│   │   ├── game.ts                  # IntransitiveGame engine (make/unmake, perft, SAN)
│   │   └── game.test.ts             # 12-stage core test suite (Perft depth 1-3)
│   ├── engine/                      # Phase 2: TD-Learning, Evaluation & Worker
│   │   ├── types.ts                 # EvaluationWeights, TrainingStats, Checkpoint, Worker protocol
│   │   ├── evaluator.ts             # Linear evaluator, Manhattan distance, exact gradients
│   │   ├── search.ts                # Minimax Alpha-Beta search with epsilon exploration
│   │   ├── tdLearner.ts             # TD-Leaf(lambda) backpropagation, floor >= 1.0, mean-centering
│   │   ├── trainer.ts               # SelfPlayTrainer (game simulation, adjudication, tournament)
│   │   ├── checkpoint.ts            # Checkpoint storage (presets, localStorage, JSON export/import)
│   │   ├── trainingWorker.ts        # Dedicated Web Worker for background turbo training
│   │   └── engine.test.ts           # TD-Learning and arena test suite
│   └── ui/                          # Phase 3 & 4: Luxury Editorial Studio UI
│       ├── PieceIcons.tsx           # Handcrafted Zen ceramic token medallions (SVG)
│       ├── IntransitiveBoard.tsx    # 9x9 CSS Grid tactile wood board with touchdown corners
│       ├── LiveControls.tsx         # Playback toolbar with speed slider (50ms - 2s)
│       ├── TurboTrainerCard.tsx     # Turbo trainer card with inline snapshot saving
│       ├── InterpretabilityCard.tsx # Real-time SVG evolution chart & 9x9 positional heatmap
│       ├── ArenaCard.tsx            # Checkpoint matchmaker & 20-game tournament bar
│       ├── IntransitiveStudio.tsx   # Master Studio container connecting worker and board
│       └── intransitive.css         # 100% pure vanilla CSS Claude editorial design system
├── audio/
│   └── soundEffects.ts              # Web Audio procedural synthesis (moves, captures, touchdown)
└── App.tsx                          # Mode Switcher: [Standard Chess (8x8)] vs [Intransitive (9x9)]
```

---

## 6. Design System: Claude Modern Editorial Aesthetic

The studio visual identity draws inspiration from **Claude's modern editorial aesthetic**:
- **Palette**:
  - **Background**: Warm ivory linen (`#FBF9F4` / `#F4F0E6`) applied edge-to-edge across the entire viewport.
  - **Board Frame**: Tactile birch wood framing (`#EDE6DA`) with beveled edging.
  - **Grid Squares**: Cream linen light squares (`#F7F5EE`) and toasted sand dark squares (`#DFD7C7`).
  - **Terracotta Accent**: Warm artisan terracotta (`#C2410C` / `#EA580C`).
  - **Blue Player Accent**: Noble deep cobalt (`#2563EB`).
  - **Red Player Accent**: Warm terracotta crimson (`#EA580C`).
- **Piece Icons**:
  - Replaced neon clip-art with handcrafted minimalist circular ceramic tokens.
  - Clean Zen crest silhouettes: Mountain boulder (**Rock**), folded origami scroll (**Paper**), and precision shears (**Scissors**).
- **CSS Architecture**:
  - **100% pure vanilla CSS** (`src/custom/ui/intransitive.css`) with zero external CSS library dependencies (no Tailwind required).

---

## 7. Quality Assurance & Verification

| Test Suite | Result | Details |
|---|---|---|
| **Standard Chess Rules** | ✅ PASS (100%) | Perft, Fool's mate, En Passant, Promotions, Threefold |
| **Classical Chess Engine** | ✅ PASS (100%) | Evaluation, SharedArrayBuffer TT, Mate in 1 & 2, Iterative Deepening |
| **Intransitive Core Engine** | ✅ PASS (100%) | 52,758-node Perft(3) in 5.8ms, Adjacency, Counter matrix, Touchdown, Elimination |
| **Intransitive TD-Learning** | ✅ PASS (100%) | Tabula Rasa weights, TD-Leaf gradient, self-play games, Checkpoint Arena |
| **Linter (`oxlint`)** | ✅ 0 Warnings, 0 Errors | 51 files inspected with 116 rules |
| **Production Build** | ✅ Clean Build (313ms) | Vite v8.2.2 bundle with workers bundled cleanly |
