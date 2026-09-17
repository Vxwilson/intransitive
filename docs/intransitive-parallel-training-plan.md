# Trainer architecture, move diversity, and parallel training

Audit date: 2026-09-17. This is an investigation and proposed implementation plan, not an implementation of the earlier improvement plan. Production code and bundled checkpoints are unchanged.

## Findings in the current implementation

### Execution architecture

- `IntransitiveStudio.tsx` creates one training/gameplay Web Worker and a separate analysis worker. The latter does not help generate training games.
- `trainingWorker.ts` runs linear games sequentially in chunks of 25 at depth 1 or 5 at greater depths. `setTimeout` yields between chunks; it does not run them concurrently. NNUE also uses a sequential generation/training loop in that worker.
- `scripts/intransitive-harness.ts` runs CLI training in a synchronous loop. There is no training worker pool in either runtime.
- Each linear game collects features and static learner evaluations, then applies TD(lambda) once if the game ended under the rules. Truncations skip learning. Each next game sees the previous game's updated weights.
- Browser training uses the league/heuristic opponent mixture and defaults to `Math.random`. CLI training injects a seed and currently selects a fixed opponent. These are different training configurations, so runtime comparisons must align them.

Use dedicated [Web Workers](https://developer.mozilla.org/en-US/docs/Web/API/Worker) in the browser and [Node worker_threads](https://nodejs.org/api/worker_threads.html) in the CLI. Service workers are intended for network/offline lifecycle work, not this persistent computation pool. A Node promise or async function alone does not parallelize this CPU work.

### Does the model always choose the same move?

Weights alone do not determine the answer. Full position/history, search budget, move policy, and RNG state also matter.

| Path | Current move policy | Consequence |
| --- | --- | --- |
| Linear training | Plies 0–4: temperature 24, root noise 0.25; plies 5–8: temperature 10, noise 0.08; thereafter greedy | Games explore even with frozen initial weights; weights also change after terminal games. Seeded runs reproduce. |
| UI tournament | Greedy throughout, initial position every game, colors alternate | Fixed-depth games repeat for each color assignment. |
| CLI paired match | Default four seeded random legal opening plies per pair, shared by both color assignments; greedy thereafter | Already has the intended diversity mechanism. Different opening seeds can still collide; zero opening plies restores repeated-game behavior. |
| Human play / visual bot play | `STEP_LIVE` uses temperature 15 for plies 0–3, then greedy | Opening moves can vary; this is not currently a strict best-move-only mode. |
| Greedy depth/node search | No sampling | Same full state, weights, engine and budget should reproduce. |
| Wall-time search | Stops at last completed iteration | Runtime load can change completed depth and moves; this is not a controlled diversity mechanism. |

Deterministic best-move selection is desirable for analysis and competitive play. The evaluation problem is repeatedly testing only one opening, not determinism itself. Identical boards with different repetition histories or halfmove clocks need not produce identical moves.

### Reproductions and related gaps

Directly called `SelfPlayTrainer.playArenaGame(i, 10, master, heuristic, 1, 1)` for indices 0–9:

- Games 1, 3, 5, 7, 9: A wins by touchdown in 61 plies, identical SAN sequences.
- Games 2, 4, 6, 8, 10: B wins by touchdown in 47 plies, identical SAN sequences.
- Exactly one unique sequence per color assignment. Ten games here provide one opening pair, not five independent opening pairs.

Ran 20-game linear training probes from heuristic weights at depth 1 with seeds 42, 42, and 43. Seed 42 reproduced both records and final weights exactly; seed 43 changed the games. All three probes ended with 20 terminal games and no truncations. Total times were approximately 175–210 ms; intercepted TD update calls accounted for approximately 0.9–2.5 ms. This short Node probe suggests game generation dominates, but is not a browser benchmark or a worker speedup measurement. Depth-1 jobs are short enough that messaging overhead matters.

Additional issues to cover:

- UI arena still stops at 80 plies and reports nonterminal cap hits as draws; the CLI correctly distinguishes truncations and defaults to a 400-ply safety cap.
- UI arena cancellation callbacks cannot observe new worker messages during a synchronous game. Training cancellation likewise waits for the current chunk to yield.
- The training `epsilon` setting is stored and exposed by CLI but is not read by the current self-play move policy. Exploration uses the hard-coded temperature/noise schedule instead.
- Live callers often supply total history length as `ply`; branching from an earlier history index should use the selected position's actual played ply.
- Current turbo `nps` estimates plies per second from completed games and a rounded lifetime average, not search nodes per second. Use actual run counters.

## Recommended implementation order

### 1. Unify match correctness and explicit move policies

Extract reusable, runtime-neutral opening generation/replay and single-game execution from the CLI harness. Keep file output and browser messaging in adapters. Route UI tournaments and CLI matches through the same semantics.

- Configure tournaments as opening pairs. A 10-game tournament means five seeded openings, each replayed with colors swapped. Require an even count for paired evaluation, or explicitly exclude an unmatched game from paired statistics.
- Initially reuse the CLI's four random legal opening plies. Log seed, exact opening moves, opening identity, full starting history, model IDs, limits, engine version, outcome and all moves. Retain history through replay, not FEN alone.
- Keep greedy play after the opening. Do not silently randomize all competitive moves. Report duplicate openings and completed-game hashes; deterministic deduplication can construct a fixed evaluation suite if collisions become material.
- Use a configurable 400-ply safety cap and distinct terminal, truncated, cancelled and error results. Never turn unfinished games into draws or scored PGN results.
- Add explicit `competitive`, `casual-opening`, and `training` policy/config fields. Competitive is greedy; human play can retain its current casual opening behavior with a visible choice. Visual competitive matches must match tournament behavior.
- Inject seeds where requested; fix history-branch ply calculation. Remove/deprecate inactive epsilon controls or map them only through an explicitly versioned policy change.

Acceptance: both colors replay the exact same opening/history; UI and CLI depth-limited games agree; seed reproduction passes; known repeated baseline is reproduced before the fix; the seeded suite contains varied openings; cap hits and cancellation never increment draws. Preserve deterministic analysis tests. For strength reports, uncertainty is based on opening pairs, not individual games or repeated copies of one opening.

### 2. Separate game generation from learning, preserving the serial baseline

Refactor `playSelfPlayGame` into a pure game-generation job plus coordinator-owned learning/statistics. Workers receive frozen learner/opponent snapshots and return trajectory features/evaluations, actual outcome, moves and telemetry. Workers do not mutate canonical weights.

Keep the existing serial algorithm as batch size 1. Verify seeded games, weights, league schedule, color assignments and terminal/truncation handling against the pre-refactor baseline. Retain per-game clipping, constraints, regularization and learning-rate semantics.

Define a versioned job contract with run ID, batch ID, game ID, learner version, opponent content/version ID, color, seed, search config and opening/history. Persist actual versions rather than only rolling league-buffer slot names. Derive independent streams from run seed and game ID, not worker ID or completion order.

### 3. Add one central learner with parallel game generation

Proposed first algorithm: synchronous frozen-policy batches.

1. Freeze learner and league snapshots for a batch of B games; the coordinator assigns opponents, colors and seeds.
2. Dispatch jobs through a persistent pool of W workers. Begin by testing W = 1, 2, 4.
3. Gather results, order by game ID, and apply the existing per-game TD updates centrally. Only terminal games contribute updates. Evaluations remain those recorded under the batch snapshot; label this bounded stale-data algorithm explicitly.
4. Update statistics and scheduled league snapshots centrally, publish weights, then begin the next batch.

This preserves the existing per-game update mechanics but changes the data-generation/update schedule when B > 1. It is an experiment, not bit-for-bit equivalent to online TD. Do not claim that recomputing static values would make games generated by old weights on-policy.

Keep B independent of W: e.g. B = 4 with W = 1 versus W = 4 must produce the same model under deterministic budgets, merely at different speeds. Compare B = 1 separately for learning quality. Start small; larger batches amortize overhead but increase policy lag. Freeze opponent selection at dispatch; newly added league snapshots become eligible next batch.

Do not average four independently trained final checkpoints. Clipping, constraints, regularization, different trajectories and opponent histories make that a different unvalidated algorithm. Four independent runs are useful immediately as separate seeded candidates, each evaluated separately.

Implementation requirements:

- Shared coordinator/job logic, browser dedicated-worker adapter, Node worker_threads adapter; no DOM or Node-only imports in the shared engine.
- Worker count selector / CLI `--workers`; explicit `--batch-games`, seed and policy metadata. These are proposed options, not currently available flags.
- Persistent workers and compact batched results; profile structured cloning before adding transferable arrays. No shared mutable weights or shared TT required.
- Exactly-once result application using IDs; reject stale results; deterministic retries reuse the same job and seed.
- Cancellation stops dispatch and terminates workers for prompt interruption. Discard an incomplete batch and retain the last committed batch checkpoint. Save league state, next IDs and RNG derivation/version for exact new-format resume; legacy imports remain valid starts without claims of exact historical continuation.
- Record games generated, terminal games, truncated games, accepted learning games, positions, search nodes, wall time, CPU time where available, worker count and batch size. Use actual counters for plies/s and nodes/s.

Keep NNUE training outside the first parallel learner change. Its buffer/optimizer needs a separate design; the shared game protocol can support it later.

### 4. Measure throughput and playing strength separately

Benchmark serial online TD, batched TD on one worker, and the identical batched configuration on two/four workers. Align starting checkpoint, opponent policy, seeds, total jobs, limits and batch size. Warm up persistent workers and run sufficiently long repeated trials at depths 1 and 2; report startup separately, throughput, wall/CPU time, memory, update time, serialization overhead and cancellation latency. Test browser and CLI independently.

Four workers can approach fourfold game-generation throughput only when compute dominates and hardware supplies capacity. Total speedup is bounded by serial work and overhead: approximately `1 / (s + (1-s)/4)`, before communication/contention. Do not promise fourfold speedup or fourfold faster learning. More games per second does not guarantee fewer seconds to a stronger model.

Use the earlier plan's frozen candidate, development/held-out paired openings and pair-level uncertainty gates to compare quality at equal wall time and equal generated-game counts. Report skipped truncations. Keep batched training opt-in until strength and reliability are established.

Parallel evaluation games are an easier independent use of the same pool because weights remain frozen and scores can simply be aggregated. Use depth/node budgets to validate reproducibility; avoid parallel timed promotion matches until CPU contention is controlled and both competitors receive balanced resources.

## Scope and outcome

Prioritize shared arena correctness, then a serial-preserving refactor, then opt-in parallel batches and measurements. This extends the original plan's deferred multiworker work in response to the present architecture review; it does not authorize implementing other optional packages. No production behavior has been changed as part of this audit.
