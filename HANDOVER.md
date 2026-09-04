# Chessesque: Project Handover & Phase 3 Blueprint

> **Notice for Incoming LLM / Developer**:
> This repository contains **Chessesque**, a high-performance bitboard chess and 2-player board game engine studio.
> - **Phase 1 (Complete Rule Engine & Luxury Web Studio)** is **100% complete, play-tested, and verified**.
> - **Phase 2 (Classical Search Engine, Web Worker & Live AI Studio)** is **100% complete, tested, and verified**.
>   - Classical evaluation (PeSTO PST + dynamic phase tapering).
>   - Alpha-Beta search with Quiescence, MVV-LVA, Killer & History moves, Transposition Table, Iterative Deepening.
>   - Modern pruning techniques: Null Move Pruning (NMP) & Late Move Reductions (LMR) scaling search to Depth 11–24+.
>   - Multi-PV support (1 to 5 candidate lines) & configurable infinite thinking mode.
>   - Hardware telemetry controls: up to 16 CPU threads, 16MB–256MB Transposition Table RAM slider.
>   - Robust SVG arrow rendering: single unified polygon path with `userSpaceOnUse` gradient coordinates (zero marker dependencies, immune to 0-width/0-height clipping).
>   - Complete cross-session persistence via `localStorage` for all 12 user settings.
> You are being tasked with executing **Phase 3: Trainable Evaluation Architecture (NNUE & Training Pipeline)**.
> Read this document to understand the current architecture, testing commands, and Phase 3 specifications.

---

## 1. Project Overview & Mission

The long-term goal of **Chessesque** is to build a high-performance, trainable 2-player game engine (capable of producing centipawn evaluations like `+0.50`, `-1.20`, and training neural network evaluations such as NNUE), with international chess as the flagship foundation, extending to other deterministic 2-player board games (Xiangqi, Checkers, and custom variants).

### Phased Roadmap:
- [x] **Phase 1: 100% Complete Rule Engine & Luxury Interactive Studio** (Completed & Verified)
- [x] **Phase 2: Classical Search Engine & Live Game Analysis** (Completed & Verified)
- [ ] **Phase 3: Trainable Evaluation Architecture (NNUE & PyTorch Pipeline)** (Current Target)
- [ ] **Phase 4: Generalized 2-Player & Custom Game Framework**

---

## 2. Current Codebase Structure & Phase 2 Accomplishments

```
chessesque/
├── HANDOVER.md                # This handover document
├── package.json               # Dependencies & scripts (build, test, lint, dev)
├── tsconfig.app.json          # TypeScript config (verbatimModuleSyntax: true, erasableSyntaxOnly: true)
├── vite.config.ts             # Vite bundler configuration
├── index.html                 # App entry point with custom favicon & SEO metadata
├── src/
│   ├── core/                  # Core Bitboard Engine (Platform Agnostic)
│   │   ├── types.ts           # Color, PieceType, Square, Move, MoveFlag, GameStatus
│   │   ├── bitboard.ts        # 64-bit BigInt bitboards, popcount, precomputed attack tables
│   │   ├── zobrist.ts         # 64-bit Zobrist keys for O(1) state hashing & repetition
│   │   ├── chess.ts           # 100% complete rule engine with legal movegen & make/unmake
│   │   ├── perft.ts           # Perft benchmark runner (Initial, Kiwipete, Endgames, Divide)
│   │   ├── chess.test.ts      # Automated verification test suite
│   │   ├── fen.ts             # FEN validation and presets
│   │   └── pgn.ts             # PGN generation and SAN formatting
│   ├── engine/                # Classical Engine & AI
│   │   ├── evaluate.ts        # PeSTO piece-square tables with game phase tapering (MG/EG)
│   │   ├── transposition.ts   # Dynamic Transposition Table with Zobrist indexing & aging
│   │   ├── search.ts          # Negamax, Alpha-Beta, Quiescence, MVV-LVA, Killer, History, NMP, LMR, Multi-PV
│   │   ├── worker.ts          # Dedicated Web Worker for non-blocking 60fps search
│   │   ├── engineClient.ts    # Main-thread Worker communication client with fallback
│   │   ├── engineTypes.ts     # Game modes, difficulty presets, settings persistence (localStorage)
│   │   └── engine.test.ts     # Search, evaluation, settings, and arrow geometry test suite
│   ├── audio/
│   │   └── soundEffects.ts    # Zero-latency procedural Web Audio synthesizer
│   ├── ui/
│   │   ├── ChessBoard.tsx     # Interactive SVG board (drag-and-drop, hints, best move overlay)
│   │   ├── ArrowOverlay.tsx   # Unified SVG polygon best-move arrow with userSpaceOnUse gradient
│   │   ├── PieceIcons.tsx     # Vector SVG chess pieces with gradients & drop shadows
│   │   ├── EvalBar.tsx        # Vertical centipawn advantage bar with logistic curve
│   │   ├── EngineStatsPanel.tsx # Telemetry dashboard (Depth, NPS, Nodes, Time, Multi-PV lines, Hardware sliders)
│   │   ├── MoveHistory.tsx    # Scrollable SAN move notation with step & time-travel controls
│   │   ├── GameControls.tsx   # New Game, Flip, Undo, Sound toggle, FEN/PGN export
│   │   ├── PromotionModal.tsx # Pawn underpromotion selector (Queen, Rook, Bishop, Knight)
│   │   ├── GameStatusBanner.tsx # Checkmate (with confetti) and draw alerts
│   │   ├── PerftModal.tsx     # In-browser Perft verification modal with live node counting
│   │   └── FenModal.tsx       # FEN position loader with validation
│   ├── styles/
│   │   └── index.css          # Master CSS design system (obsidian dark, glassmorphism)
│   ├── main.tsx
│   └── App.tsx                # Studio orchestrating board, history, engine analysis, AI, & settings
```

---

## 3. Key Technical Decisions & Solved Gotchas

### A. Arrow Rendering Fix (SVG Specification Edge Case)
- **Problem**: Best-move arrows disappeared on vertical moves (e.g. `e2-e4`, `d2-d4`) while working on diagonal/knight moves.
- **Root Cause**: SVG 1.1 §13.2.2 specifies that `<linearGradient>` with default `gradientUnits="objectBoundingBox"` resolves coordinates against the target element's bounding box. For a vertical `<line>`, `width = 0` (and for horizontal moves, `height = 0`). Chromium and WebKit evaluate zero-dimension bounding boxes as degenerate and drop the stroke paint entirely.
- **Solution in [`src/ui/ArrowOverlay.tsx`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/ui/ArrowOverlay.tsx)**:
  1. Converted the arrow shaft, aerodynamic wings, tip, and notch into a **single continuous 2D polygon path**. Bounding box is guaranteed to be $\ge 30\text{px}$ in both dimensions across all angles.
  2. Configured `gradientUnits="userSpaceOnUse"` from `(fromPos.x, fromPos.y)` to `(toPos.x, toPos.y)`.
  3. Added stale move protection: `setLatestStats(null)` is called on move execution and undo, and `bestMoveToDisplay` validates that the piece color matches `activeBoard.activeColor`.

### B. Modern Pruning & Search Enhancements
- **Late Move Reductions (LMR)**: Quiet late moves ($i \ge 3$) searched at reduced depth with automatic re-search on fail-highs, accelerating depth climb from depth 7 to depths 11–24+.
- **Null Move Pruning (NMP)**: Fast $\beta$-cutoff checking when a free pass to the opponent still refutes the position ($R = 2$ to $3$).
- **Check Extensions**: When in check, search depth is extended by 1 ply to prevent tactical horizon blunders.

### C. Cross-Session Settings Persistence
All 12 user preferences and studio settings persist across page reloads via `localStorage` (`chessesque_user_settings_v1`):
1. `isAnalysisEnabled` (Live analysis toggle)
2. `searchTimeSec` (Search time slider: 1s–30s)
3. `isInfinite` (Infinite thinking mode)
4. `multiPv` (Candidate lines: 1–5)
5. `threads` (CPU threads: 1–16)
6. `hashMb` (RAM hash table size: 16–256MB)
7. `gameMode` (`human_vs_human` / `play_vs_computer`)
8. `difficulty` (`casual`, `intermediate`, `strong`)
9. `playerColor` (White `0` / Black `1`)
10. `isFlipped` (Board perspective)
11. `soundEnabled` (Audio synthesizer mute toggle)
12. `isHardwareExpanded` (Settings drawer open/collapsed state)

The Web Worker hash size (`engineClient.setHashSize`) and procedural sound synthesizer mute status synchronize automatically on mount.

### D. Multi-PV Candidate Arrow Visual Hierarchy
- **Enhancement in [`src/ui/ArrowOverlay.tsx`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/ui/ArrowOverlay.tsx)**:
  - When Multi-PV is active (1 to 5 candidate lines), all candidate lines render simultaneously on the board.
  - Clear visual hierarchy:
    - **Rank 1**: 10px shaft (`shaftHalfWidth = 5.0`), 30px wingspan, 0.95 opacity, Emerald-to-Cyan gradient, origin halo. Rendered on top of all other arrows.
    - **Rank 2**: 8.4px shaft, 26px wingspan, 0.72 opacity, Sky Blue-to-Royal Blue gradient.
    - **Rank 3**: 7.0px shaft, 22px wingspan, 0.52 opacity, Indigo-to-Violet gradient.
    - **Rank 4**: 5.8px shaft, 19px wingspan, 0.38 opacity, Teal-to-Slate gradient.
### E. Search Concurrency, Worker Abort & Play vs Computer Fix
- **Problem**: In infinite search or fast play, the worker was trapped in a synchronous Negamax loop. Messages like `STOP_SEARCH` remained queued in the worker event loop until the search completed. When a move was made (e.g. White played 1. Nf3), the worker finished the *previous* White search and returned White's move to Black, replaying White moves and spawning pieces from nowhere.
- **Solution in [`src/engine/engineClient.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/engineClient.ts) & [`src/engine/worker.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/worker.ts)**:
  1. **Synchronous Worker Abort**: `engineClient.stop()` immediately calls `worker.terminate()` and re-instantiates `initWorker()`. This kills the runaway synchronous search loop with 0ms delay at the OS level.
  2. **Search ID Tagging**: Every search request receives an incrementing `searchId`. The worker tags all `SEARCH_UPDATE` and `SEARCH_COMPLETE` messages with `searchId`. Messages from stale searches are discarded immediately.
  3. **Strict Move Legality Validation in `handleMakeMove`**: `chess.generateLegalMoves()` validates that incoming moves are strictly legal in the active board position before execution, preventing any corrupt bitboard mutations or phantom piece spawns.
  4. **Active Board FEN Guard**: AI computer opponent callbacks verify `activeBoard.toFEN() === currentFEN` before applying moves.

### F. SharedArrayBuffer, Lockless Atomics Transposition Table & Lazy SMP Multithreading
- **Problem**: When 10–16 threads were configured, previous single-worker implementation only utilized ~100% of 1 CPU core because all search work ran in a single thread, and standard Web Workers without shared memory cannot coordinate alpha-beta cutoffs.
- **Solution in [`src/engine/transposition.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/transposition.ts), [`src/engine/search.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/search.ts), [`src/engine/worker.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/worker.ts) & [`src/engine/engineClient.ts`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/engine/engineClient.ts)**:
  1. **Cross-Origin Isolation**: Configured `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` in `vite.config.ts`, unlocking browser-native `SharedArrayBuffer` and `Atomics`.
  2. **Lockless 64-bit Atomic TT (`SharedTranspositionTable`)**:
     - Packed binary entries into 16 bytes: Word 0 (`BigUint64`) = 64-bit Zobrist key; Word 1 (`BigUint64`) = 64-bit packed payload with `score` (16b), `depth` (8b), `flag` (2b), `age` (6b), and full `Move` data (`from`, `to`, `piece`, `captured`, `promotion`, `flags`).
     - Fully lockless concurrent reads and writes using `Atomics.load` and `Atomics.store` with double-read validation against torn writes.
  3. **Lazy SMP Search Diversification**:
     - Up to 16 Web Workers spawned into a managed pool sharing the exact same `SharedArrayBuffer`.
     - Worker 0 (Master) performs standard Iterative Deepening and emits official PV lines.
     - Workers 1..$N-1$ (Helpers) run staggered depth searches ($d=2$) with deterministic pseudo-random history score jitter for quiet moves. This diversifies subtrees searched, populating the shared TT with cutoffs and killer moves ahead of the master thread.
     - Emits periodic node increments every 1024 nodes via `NODES_UPDATE`, aggregating real-time throughput ($300\%\text{--}1000\%$ CPU and scaling NPS telemetry).
  4. **Click-to-Apply Move Rows**:
     - In [`src/ui/EngineStatsPanel.tsx`](file:///Volumes/SN770%20BLACK/Documents/Coding/antigravity/chessesque/src/ui/EngineStatsPanel.tsx), clicking any candidate row in the Multi-PV table or the Best Move Chip immediately applies that move to the board via `onApplyMove(move)`.
     - Styled with interactive hover glow, chevron indicator, and subtle translate animations.

---

## 4. Verification & Testing Commands

All unit tests, linter checks, and production builds pass cleanly:

```bash
# Start Vite development server
npm run dev

# Run comprehensive test suite (Core rule tests, Perft suite, Engine tactical tests, Settings persistence, Arrow geometry)
npm test

# Run Oxlint (0 errors, 0 warnings)
npm run lint

# Run TypeScript compilation and production build
npm run build
```

### Test Suite Output Summary:
```
🧪 Starting Chessesque Core Engine Verification Suite...
--- 1. Perft Benchmark Verification ---
✓ Initial Position Perft: D1=20, D2=400, D3=8902 (100% match)
✓ Kiwipete Perft: D1=48, D2=2039, D3=97862 (100% match)
--- 2. Game Logic: Fool's Mate ---
✓ Fool's Mate correctly detected checkmate
--- 3. En Passant Execution & Undo ---
✓ En Passant capture and unmake verified
--- 4. Pawn Promotions ---
✓ All 4 pawn promotions (Queen, Rook, Bishop, Knight) generated correctly
--- 5. Threefold Repetition Draw ---
✓ Threefold repetition draw successfully detected via Zobrist hashing
--- 6. PGN Generation ---
✓ PGN generation verified
🎉 ALL CORE ENGINE AND RULE TESTS PASSED WITH 100% ACCURACY!

🧪 Starting Chessesque Engine & Search Verification Suite...
--- 1. Classical Evaluation Module ---
✓ Evaluation symmetry, material counting, and phase tapering verified
--- 2. Transposition Table ---
✓ Transposition table indexing, replacement, and mate-distance normalization verified
--- 3. Search Engine: Mate in 1 ---
✓ Mate in 1 correctly solved (Qxf7#)
--- 4. Search Engine: Mate in 2 ---
✓ Mate in 2 correctly solved (Rxh7+)
--- 5. Search Engine: Tactical Free Piece Capture ---
✓ Tactical capture correctly executed (Qxd4)
--- 6. Search Engine: Iterative Deepening & NPS Telemetry ---
✓ Iterative Deepening complete: 32039 nodes searched in 161ms (~200k NPS)
--- 7. User Settings Persistence & LocalStorage ---
✓ Cross-session settings storage, serializing, and deserializing verified
--- 8. Arrow Geometry: Guaranteed Non-Zero Bounding Box ---
✓ All arrow orientations (vertical [30x182], horizontal [182x30], knight [98.2x186.1]) guaranteed non-zero 2D polygons
--- 9. Multi-PV Multi-Arrow Line Generation ---
✓ Multi-PV 3 lines generated with distinct candidate moves (#1: Nf3, #2: Nc3, #3: Na3)
🎉 ALL ENGINE EVALUATION, SEARCH, STORAGE, AND GEOMETRY TESTS PASSED WITH 100% ACCURACY!
```

---

## 5. Phase 3 Blueprint: Trainable Evaluation Architecture (NNUE)

### Objective:
Upgrade the evaluation function to support both **Classical Hand-Crafted Evaluation (PeSTO HCE)** and an **Efficiently Updatable Neural Network (NNUE)** architecture that can be trained offline using PyTorch and executed directly in the browser via typed arrays / Web Worker.

### Target Features for Phase 3:
1. **In-Engine Neural Evaluation (`src/engine/nnue/`)**:
   - **Feature Transformer**: HalfKP features ($(64 \text{ squares} \times 10 \text{ piece types}) \times 256 \to 32 \to 32 \to 1$) or Piece-Square features ($768 \times 128 \to 32 \to 1$).
   - **Incremental Accumulator**: Efficiently updated upon `makeMove` / `unmakeMove` in $O(1)$ additions, avoiding full recalculation of the network.
   - **Quantized Integer Arithmetic**: Int16/Int8 quantized inference for fast CPU execution in the Web Worker.
2. **Offline Training Pipeline (`training/` or `scripts/train_nnue.py`)**:
   - PyTorch training pipeline on FEN position datasets with game outcomes or centipawn labels (e.g. Lichess evaluations dataset or self-play PGNs).
   - Sigmoid-scaled loss function against centipawn targets: $P = \frac{1}{1 + 10^{-\text{eval} / 400}}$.
   - Weight quantizer and exporter (outputs weights as JSON or compact binary buffer ready to load into the web engine).
3. **Engine Evaluation Model Switcher**:
   - UI selector in the Engine Analysis panel: `Evaluation Model: Classical (PeSTO) | Neural Network (NNUE)`.
   - Real-time comparison mode allowing users to compare Classical vs Neural positional evaluations on any board position.
4. **Self-Play & Dataset Generator**:
   - Optional in-browser self-play generator for generating annotated training datasets.

---

## 6. Phase 4 Preview: Generalized 2-Player & Custom Game Framework

Following Phase 3, the engine will be generalized to support other board games:
1. **Game Abstraction Layer**: Decouple the Search Engine (Negamax, Alpha-Beta, Transposition Table) to operate on an abstract `GameState<TMove>` interface.
2. **Checkers (Draughts)**: 8x8 board, diagonal moves, mandatory capture chains, kinging.
3. **Chinese Chess (Xiangqi)**: 9x10 board, river, palace, cannons, elephants, horse-leg blocking.
4. **Custom Game Sandbox**: Configurable board dimensions and custom piece move vectors.

---

## 7. Ready-to-Use Prompt for Phase 3

```text
Hi! I'm continuing the development of Chessesque, a high-performance bitboard chess and trainable game engine studio.
Phase 1 (Complete bitboard rules & luxury studio) and Phase 2 (Classical Search Engine, Web Worker, Live Analysis, Play vs Computer, Multi-PV, Modern Pruning, robust SVG arrow geometry, and settings persistence) are 100% complete, building cleanly, and verified.

Please review `HANDOVER.md` in the repository for full context, and proceed with executing Phase 3:
1. Implement the in-engine NNUE inference architecture in TypeScript with incrementally updated feature accumulators.
2. Provide an offline training pipeline (PyTorch) to train NNUE weights and export them for browser inference.
3. Add a model selector in the Engine Analysis panel (Classical PeSTO vs Neural NNUE) to compare evaluations in real-time.
4. Verify with automated tests and make sure `npm test`, `npm run lint`, and `npm run build` succeed cleanly.
```
