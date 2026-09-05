# Intransitive 9x9 NNUE Architecture & Transition Plan
## Efficiently Updatable Neural Network for Cyclic RPS Board Strategy

> **Status**: Design Document & Implementation Roadmap  
> **Target System**: `chessesque` Intransitive 9x9 Cyclic RPS Game Engine (`src/custom/`)  
> **Predecessor**: Linear Tabula Rasa TD-Leaf($\lambda$) Engine (`src/custom/engine/`)

---

## 1. Executive Summary & Problem Context

In our current implementation, the Intransitive engine relies on a **Linear Evaluation Function**:
$$V(s) = \sum_{i} w_i f_i(s)$$
Where features $f_i(s)$ include piece counts, Chebyshev goal proximity, unstoppable runner units, tactical threats, and piece-square tables (~250 parameters).

While the linear model plays respectable tactical moves, it possesses fundamental mathematical limitations:
1. **Linear Inexpressibility**: A single linear layer cannot model non-linear spatial interactions (e.g., *"Square A is only safe if Square B is blocked AND piece C is a predator"*). Every high-level concept must be manually engineered into $f(s)$.
2. **Feature Saturation**: Adding more linear features increases engineering complexity and parameter tuning overhead without granting the engine true strategic pattern emergence.

**The Solution**: Transitioning to **NNUE (Efficiently Updatable Neural Network)**.  
Invented by Yu Nasu for Shogi in 2018 and adopted by Stockfish in 2020 (+150 Elo leap), NNUE merges the non-linear intuition of deep neural networks with the raw speed of classical alpha-beta search. It evaluates **30,000–50,000+ positions per second in a single browser thread** using incremental accumulator caching.

---

## 2. High-Level Architecture Comparison

```
CURRENT (Linear TD-Leaf):
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│  Raw Board (81 Squares) │ ───► │  extractFeatures(game)  │ ───► │   w • x (Dot Product)   │ ──► Score (cp)
└─────────────────────────┘      │   (Manual Heuristics)   │      │    (~250 Parameters)    │
                                 └─────────────────────────┘      └─────────────────────────┘

PROPOSED (NNUE Architecture):
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐      ┌────────────────┐
│  Sparse Input Features  │ ───► │ Incremental Accumulator │ ───► │ Hidden Layer (32 units) │ ───► │ Output (Score) │
│  (81 Squares x 6 Types) │      │  (128 units, Cached!)   │      │  Clipped ReLU (0..1)    │      │ (Centipawns)   │
│       [486 bits]        │      │ [makeMove: 0.0001ms]    │      │    [32 x 1 weights]     │      │                │
└─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘      └────────────────┘
```

---

## 3. Mathematical Specification for 9x9 Intransitive Game

Because the 9x9 board is compact, the NNUE model will be **orders of magnitude smaller and faster** than standard chess NNUE models:

### 3.1 Feature Space (Input Layer)
- **Board Grid**: $9 \times 9 = 81$ squares.
- **Pieces**: 6 types:
  - Blue: Rock ($R$), Paper ($P$), Scissors ($S$)
  - Red: Rock ($r$), Paper ($p$), Scissors ($s$)
- **Perspective Feature Mapping**:
  - We evaluate the board from the active player's perspective.
  - To exploit the game's **$180^\circ$ rotational symmetry**, Red's perspective simply inverts the board square:
    $$\text{rotSq}(sq) = (8 - \text{rank}) \times 9 + (8 - \text{file})$$
  - Active friendly pieces become friendly features; opposing pieces become enemy features.
- **Total Feature Inputs**:
  $$M = 81 \text{ squares} \times 6 \text{ piece-channel combinations} = \mathbf{486 \text{ binary inputs}}$$
  *(Compare to Chess HalfKAv2: 45,056 inputs. Intransitive is 90x smaller!)*

### 3.2 Network Topology & Layer Sizes
An architecture of **486 $\to$ 128 $\to$ 32 $\to$ 1** provides the optimal balance of expressive representation and search speed:

1. **Feature Transformer (Accumulator Layer $L_0 \to L_1$)**:
   - Weights matrix $W_0 \in \mathbb{R}^{128 \times 486}$
   - Bias vector $b_0 \in \mathbb{R}^{128}$
   - Output: $A = b_0 + \sum_{i \in \text{active}} W_0[:, i]$
   - Activation: **Clipped ReLU**: $f(x) = \min(\max(x, 0), 1.0)$
2. **Hidden Layer ($L_1 \to L_2$)**:
   - Weights matrix $W_1 \in \mathbb{R}^{32 \times 128}$
   - Bias vector $b_1 \in \mathbb{R}^{32}$
   - Output: $H = \text{ClippedReLU}(W_1 \cdot f(A) + b_1)$
3. **Output Layer ($L_2 \to L_3$)**:
   - Weights vector $W_2 \in \mathbb{R}^{1 \times 32}$, Bias $b_2 \in \mathbb{R}$
   - Output: $\text{Score} = (W_2 \cdot H + b_2) \times 600$ (scaled to centipawns)

### 3.3 Parameter Count & Memory Footprint
- Feature Transformer: $486 \times 128 = 62,208$ weights + $128$ biases = **62,336 parameters**
- Hidden Layer: $128 \times 32 = 4,096$ weights + $32$ biases = **4,128 parameters**
- Output Layer: $32 \times 1 = 32$ weights + $1$ bias = **33 parameters**
- **Total Model Parameters**: **66,497 floats**
- **Raw File Size**:
  - `Float32Array` (uncompressed JSON/binary): **~265 KB**
  - Quantized `Int8` binary: **~66 KB**
  - Gzipped for web delivery: **~35 KB**!

---

## 4. The Performance Core: Incremental Accumulator Updates

The reason NNUE can evaluate at the speed of a hand-crafted function is that **the first layer is never recomputed from scratch during search**.

### 4.1 How It Works in TypeScript
When `makeMove(move)` executes:
1. Moving piece from `move.from` to `move.to`:
   - Subtract column: $A \leftarrow A - W_0[:, \text{feature}(\text{piece}, \text{move.from})]$
   - Add column: $A \leftarrow A + W_0[:, \text{feature}(\text{piece}, \text{move.to})]$
2. If capture occurs (`move.captured`):
   - Subtract column: $A \leftarrow A - W_0[:, \text{feature}(\text{captured}, \text{move.to})]$
3. Total operations per move: **only 128 or 256 additions/subtractions**.
4. In JavaScript using a typed `Float32Array`, updating the accumulator takes less than **$0.0001\text{ ms}$**.

### 4.2 Data Structure in `IntransitiveGame`
```typescript
export interface Accumulator {
  blue: Float32Array; // 128 floats
  red: Float32Array;  // 128 floats
}

// In IntransitiveGame:
public accumulator: Accumulator;
private accumulatorStack: Accumulator[] = [];
```
On `makeMove()`, push a clone or apply differential undo record. On `unmakeMove()`, pop the accumulator.

---

## 5. Training Pipeline & Data Generation

How will the NNUE learn the game without human hand-crafting?

```
┌────────────────────────────────────────────────────────────────────────┐
│                        NNUE TRAINING CYCLE                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   Step 1: Self-Play Data Generation                                    │
│   Existing SelfPlayTrainer runs 50,000 games at Depth 2/3              │
│   Yields ~1,500,000 training positions (FEN + Minimax Score + Outcome) │
│                                                                        │
│                                  │                                     │
│                                  ▼                                     │
│   Step 2: Training Loss (Supervised + TD-Leaf Target)                  │
│   Loss = α * MSE(Eval, SearchScore) + (1 - α) * MSE(Eval, WinOutcome)   │
│   Batch Size = 512, AdamW Optimizer, Cosine LR Decay                   │
│                                                                        │
│                                  │                                     │
│                                  ▼                                     │
│   Step 3: Verification & Tournament Benchmark                          │
│   Arena Tournament: NNUE vs Heuristic Master vs Tabula Rasa            │
│   Expected Outcome: Decisive win rate (>75%) over Heuristic Master     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Training Options: In-Browser vs. PyTorch Offline
We can provide two pathways:
1. **Pathway A: Headless Python/PyTorch Training Script (`scripts/train_nnue.py`)**:
   - Exports training data from `trainer.ts` into a `.jsonl` or `.bin` dataset.
   - 30-line PyTorch script trains the 66k parameters in **~45 seconds** on any laptop CPU or GPU.
   - Serializes trained weights into `src/custom/engine/nnue/nnue_weights.json`.
2. **Pathway B: Pure In-Browser Web Worker Trainer**:
   - Implements mini-batch SGD directly in `trainingWorker.ts`.
   - Allows users to click *"Train NNUE"* in the browser and watch loss drop in real time.

---

## 6. Codebase File Structure & Migration Plan

All NNUE code will live inside a dedicated subfolder `src/custom/engine/nnue/` to preserve complete isolation and backwards compatibility:

```
src/custom/
├── core/
│   └── game.ts                          # [MODIFY] Add optional accumulator hooks on make/unmake
│
├── engine/
│   ├── nnue/                            # [NEW MODULE]
│   │   ├── types.ts                     # NNUEWeights, Accumulator, FeatureIndex definitions
│   │   ├── featureTransformer.ts        # Fast incremental sparse accumulator addition/subtraction
│   │   ├── nnueEvaluator.ts             # Forward pass (128 -> 32 -> 1) Clipped ReLU inference
│   │   ├── nnueWeights.ts               # Default embedded master network weights
│   │   ├── nnueTrainer.ts               # Mini-batch backprop & loss optimization (AdamW)
│   │   └── nnue.test.ts                 # Tests for accumulator parity, forward pass, and speed
│   │
│   ├── search.ts                        # [MODIFY] Support evaluateNNUE() as drop-in evaluator
│   ├── evaluator.ts                     # Preserved as classical fallback & benchmark
│   ├── checkpoint.ts                    # [MODIFY] Support saving/loading NNUE model checkpoints
│   └── types.ts                         # Add 'nnue' model type flag
│
└── ui/
    ├── InterpretabilityCard.tsx         # [MODIFY] Add NNUE Accumulator Heatmap view
    └── StudioSettingsCard.tsx           # [MODIFY] Add NNUE model selection options
```

---

## 7. Step-by-Step Implementation Phases

### Phase 1: Feature Transformer & Accumulator (`src/custom/engine/nnue/`)
- [ ] Implement `featureTransformer.ts` mapping `(pieceCode, square, perspective) -> featureIndex (0..485)`.
- [ ] Implement incremental update routines:
  - `accumulateAdd(acc, featureIdx, weights)`
  - `accumulateSub(acc, featureIdx, weights)`
- [ ] Add unit test verifying that incrementally updated accumulators match fresh full-board recalculations with 100% precision.

### Phase 2: Forward Pass & Search Integration
- [ ] Implement `nnueEvaluator.ts` with SIMD-friendly loop unrolling for Clipped ReLU.
- [ ] Benchmark forward pass speed in `engine.test.ts` (target: $> 50,000$ evals/sec in JS).
- [ ] Add toggle in `search.ts` allowing `minimax` to call `evaluateNNUE(game, nnueWeights)` instead of linear `evaluate()`.

### Phase 3: Training Pipeline & Dataset Generation
- [ ] Implement dataset dumper in `trainer.ts`: records `[activeFeatures[], minimaxScore, gameResult]` for self-play games.
- [ ] Create PyTorch training script `scripts/train_intransitive_nnue.py` and embedded browser trainer `nnueTrainer.ts`.
- [ ] Train first-generation network (Gen 1 NNUE) on 50,000 games.

### Phase 4: Studio UI & Interpretability Integration
- [ ] Add `🧠 NNUE Master (66k Neural Network)` to `PRESET_CHECKPOINTS` and dropdown selectors in Visual Arena, Turbo Trainer, and Human Play.
- [ ] Add **NNUE Feature Heatmap** tab in `InterpretabilityCard.tsx`: visualize which of the 128 hidden neurons activate on specific board squares.
- [ ] Run 100-game head-to-head tournament against `Heuristic Master` to confirm Elo dominance.

---

## 8. Summary: Why This Is the Definitive Next Leap

| Attribute | Linear Tabula Rasa (Current) | Intransitive NNUE (Proposed) |
| :--- | :--- | :--- |
| **Model Type** | Linear Weighted Sum ($w^T x$) | 3-Layer Efficiently Updatable Neural Net |
| **Parameters** | ~250 | ~66,500 |
| **Non-Linear Knowledge** | Manual Feature Engineering Required | **Emergent & Self-Discovered** |
| **Touchdown & Runner Intuition** | Explicit rules & predator formulas | Learned via multi-neuron feature crossings |
| **Inference Speed** | ~100,000 pos/sec | **~40,000–60,000 pos/sec** |
| **Browser Compatibility** | 100% Native TypeScript | **100% Native TypeScript (Float32Array)** |
| **Memory Footprint** | ~5 KB | **~260 KB (JSON) / 66 KB (Binary)** |

By implementing this NNUE plan, `chessesque` will not only overcome tactical blindness permanently, but will become one of the rare web-based strategy games featuring a **genuine, modern NNUE reinforcement learning pipeline running 100% client-side**.
