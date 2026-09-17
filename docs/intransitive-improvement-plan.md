# Intransitive: first improvement cycle

## Objective and limits

Improve actual playing strength and useful analysis on a CPU-only Mac mini M4 with the smallest defensible set of changes. Preserve the existing UI and saved linear checkpoints. Exclude tablebases, NNUE repairs, a new language/runtime, MCTS, distributed infrastructure, and a wholesale UI rewrite.

Correctness and search-work reductions are deliverables we can establish with tests. A strength gain from a new learning method is an experimental outcome, not a guarantee. Never promote a checkpoint based only on generation count, training loss, or Blue's self-play win rate.

Implement packages 0–3 first. Package 4 is a bounded optional experiment; package 5 follows only if its tactical and match results justify adoption. Do not automatically expand into every attractive engine feature.

## Evidence motivating the work

Audit of the current repository established:

- `selectMove` already uses minimax/alpha-beta. Replacing it with negamax is not a performance project.
- The global TT reuses scores across evaluation weights. Reproduction: search the initial position with heuristic weights at depth 3, then zero weights without clearing; zero weights return the heuristic answer (+46). With a clear, zero weights return 0 and a different move.
- Root move selection searches each candidate with a full window. In three initial-position Node measurements with Master weights and cleared tables, depth 3 took 249–264 ms versus 52–53 ms for a shared-bound root minimax score; depth 4 took 1,764–1,796 ms versus 82–83 ms. Scores agreed. These are motivation, not general speed guarantees or equivalent exploration-policy implementations.
- `STEP_LIVE` defaults depth to 2, including when the caller supplies time only. Timed search uses that depth as a ceiling.
- The dedicated analysis worker caps even infinite mode at 6; the training worker has a different analysis implementation.
- Recursive search does not check deadlines. Worker message cancellation cannot interrupt synchronous JavaScript merely because a callback exists.
- Runner cutoff counterexample: `r8/9/6R2/9/9/9/9/9/9 b 99 1`. It returns +9997 although every next legal move draws under the halfmove rule.
- Trainer labels genuine draws and truncated games with a hand-written material/proximity adjudication. External opponents always play Red.
- Current learning records static values/features of played positions, not searched leaf targets. There are 251 scalar parameters; attack and vulnerability features are duplicates.
- Arena ends at 80 plies and calls depth-1 heuristic move agreement “accuracy.” Analysis continuation lines are greedy reconstructions, not searched PVs.
- Existing core/linear tests passed despite these issues. Some existing tests explicitly expect the problematic runner shortcut or draw contempt; replace those assertions with rule-correct expectations rather than preserving them at all costs.

Main files: `src/custom/engine/{search,transposition,runway,evaluator,trainer,tdLearner,trainingWorker,analysisWorker,types,checkpoint,defaultCheckpoints}.ts`, `src/custom/core/game.ts`, and `src/custom/ui/IntransitiveStudio.tsx`.

## Shared contracts and working rules

- Keep Master and other bundled checkpoint bytes unchanged. Copy/export reference artifacts before experiments. Backward-compatible optional metadata is allowed.
- Compare engine changes with identical frozen Master weights. Compare weights with the same corrected engine. Also report the final system versus the legacy system, explicitly naming that comparison.
- Deterministic mode takes an injected seeded RNG; evaluation matches use greedy moves after a shared seeded opening. Do not globally replace `Math.random`.
- Search input supports mutually exclusive fixed-depth, node-budget, or wall-time limits. A maximum-depth safety bound is separate from the requested budget. Legacy signatures can delegate to this interface.
- Search output includes legal best move, Blue-relative score, completed depth, nodes, elapsed time, actual searched PV, and stop reason. Mark bound/partial information explicitly when applicable; do not present a bound as an exact candidate score.
- Node accounting counts recursive main-search and, if enabled, quiescence nodes consistently. Report self-play plies/s and search nodes/s as distinct quantities.
- Correct position state includes board, side to move, halfmove clock, and relevant repetition history. A FEN alone does not preserve repetition history. Transmit/replay move history or serialize repetition counts across workers. Validate imported counts and restore them correctly on undo.
- Searches must leave board, side, counts, clock, Zobrist key, repetition map, and undo stack unchanged, including after abort.
- Keep one owner for shared search/types files at a time. Make small commits per concern, with regression tests and measured results. Do not mix a representation rewrite with algorithm changes.

## Package 0 — Reproducible local validation harness

**Owner:** harness agent. **Dependencies:** none. **Effort:** small–medium. Can run alongside Package 1 if API changes are coordinated.

### Work

1. Add Node/TypeScript CLI commands for search benchmarks, paired matches, and later training experiments. Use existing dependencies and engine modules; browser automation is not required for bulk games.
2. Add a small checked-in fixture suite, initially roughly 12–20 positions: start position, developed positions, captures, goal attacks/defenses, blocked routes, low material, repetition, and near-halfmove-limit states. Include histories where necessary. Record fixture provenance; do not hand-label uncertain strategic moves as objectively best.
3. Add a slow shallow reference minimax in test-only code: no TT score reuse, no runner proof cutoff, no selective pruning, and terminal draws scored zero. Use it for randomized reachable-position comparisons at affordable depths, not production matches.
4. Benchmark with warm-up, repeated measurements, fixed fixtures and weights, and clean per-run search state. Record nodes, elapsed time, completed depth, score, and selected move. Include median and tail latency, not one favorable example.
5. Paired matches replay each opening twice with model assignments swapped. Stop at actual rule terminal states; apply a configurable safety cap (initially 400 plies) only to prevent unbounded experiments. Record cap hits as truncations, never invented wins. Extend/replay truncated pairs before a promotion decision.
6. Log every game to JSONL with moves, seed, outcome/reason, limits, engine version, model IDs, and timing. Save a compact aggregate report.
7. Remove heuristic-agreement computation from the CLI match hot path. It doubles up move selection work without measuring strength.

### Acceptance

- Identical seed, node/depth budget, and versions reproduce identical game logs except timing. Wall-time matches are not expected to be bit-for-bit reproducible.
- Swapped assignments use the same opening and opening history.
- A random legal-move baseline is truly random, not zero weights plus tactical search.
- Harness can compare the same evaluator under two engine revisions/configurations without modifying presets.
- Test-only reference restores state and correctly handles terminal draws and forced wins.

### Delivery

Commands, fixture JSON, a sample short benchmark/match report, and instructions to reproduce. Snapshot the legacy baseline before search changes, using an isolated worktree or versioned executable; do not copy an entire second production engine into `src`.

## Package 1 — Correct search state, terminal handling, and time control

**Owner:** search agent. **Dependencies:** none; use Package 0 reference tests as they become available. **Effort:** medium. **Priority:** mandatory.

### Work

1. Remove global cross-model score reuse. Make table ownership explicit per root-search session/evaluator version. Reuse within iterative deepening only with valid context.
2. For the first release, use TT entries for move ordering only unless score reuse is proved safe against the reference tests. Board+turn+clock still omits repetition-path and extension context; clearing once per root does not solve this. Do not ship a partially keyed score cache on the assumption that history rarely matters. Re-enabling safe score cutoffs is a separate measured follow-up, not a prerequisite here.
3. Disable unverified runway results as exact win/loss cutoffs and mate labels in production. Keep them as move-ordering hints if useful. Immediate legal terminal wins remain exact. A clock guard alone does not establish the whole runner algorithm's proof; do not claim it does. Add the known clock counterexample and test ordinary search can still solve short runner wins.
4. Score terminal draws zero in the correctness-first search. Remove path-dependent twofold penalties and alternating draw contempt from exact minimax values. Do not alter game rules to avoid repetition.
5. Add an explicit search context with deadline/node budget, periodic stop checks, and a guaranteed legal fallback. Preserve the last fully completed iterative-deepening result; do not overwrite it with an aborted root iteration.
6. Use `try/finally` or equally reliable unwinding around each make/unmake pair. An abort must not write incomplete “exact” entries or publish incomplete PVs as complete results.
7. Fix time-only live requests so they do not acquire a depth-2 ceiling. Keep fixed-depth mode separate. Audit both arena and live call paths for the same issue.
8. Unify worker search-limit behavior through one shared search entry point. Replace the depth-6 analysis cap with explicit user limits and a documented safety ceiling; do not merely change 6 to 99 while leaving recursion uninterruptible.
9. Preserve repetition history across live/analysis requests. On a position imported without history, clearly treat it as a fresh history rather than inventing one.
10. For analysis cancellation, preserve terminate/recreate-worker behavior and reject stale request IDs. For a worker that must remain alive, yield between bounded jobs/iterations. A message-updated boolean is not a recursive interrupt; use deadline/node checks for synchronous work. Do not introduce SharedArrayBuffer/deployment headers in this cycle.
11. Fix live exploration's use of `halfmoveClock` as opening ply: captures reset that clock. Use actual played ply count, and keep competitive best-move mode greedy.

### Acceptance

- Heuristic → zero → Master searches in one process agree with isolated runs of each model.
- Small-depth scores match reference minimax on the fixture suite and seeded reachable positions, with shortcuts off. Equal-score alternative moves are allowed.
- History/clock changes are respected even for identical boards.
- Abort tests compare complete state snapshots before/after search, including repetition counts.
- Time-only requests demonstrably attempt depth >2 on a suitable position; do not require that every position completes a chosen depth in a fixed time.
- Short wall-time searches return within a measured bounded overshoot on the M4. Initial engineering target: p95 overshoot ≤max(25 ms, 10% of requested time), excluding process startup; report misses rather than weaken the test silently.
- Analysis cancellation and stale-result rejection pass a UI smoke check. Fixed-depth, time, arena, and analysis all remain usable.

## Package 2 — Faster best-move search and truthful analysis

**Owner:** same search agent after Package 1. **Dependencies:** 0 and 1. **Effort:** medium. **Priority:** mandatory.

### Work

1. Add a dedicated greedy best-move root path that shares alpha/beta across siblings. Blue maximizes and Red minimizes, using the same evaluator perspective. Preserve the existing full-window root-score path for exploration and initial MultiPV correctness.
2. Do not feed fail-high/fail-low bounds into softmax as exact scores. For training exploration, initially retain exact full-window scoring. Optimize this separately only if profiling shows it matters.
3. Order by last completed PV/root best move, TT move hint, immediate legal wins, then existing tactical ordering. Cache move-order keys rather than recomputing distances repeatedly in a sort comparator if profiling supports it.
4. Build the actual PV during search. Verify each PV move is legal when replayed. Remove the greedy `extractPVContinuation` approximation from searched-line displays.
5. Analysis must not downgrade remaining root candidates to static evaluation after encountering a mate. Top-N scores must refer to the requested completed depth. Initially prefer correctness over an elaborate MultiPV implementation.
6. Keep the implementation simple: no PVS, aspiration windows, null-move pruning, late-move reductions, or negamax rewrite in this package.

### Acceptance

- Best score matches the full-window/reference path at the same depth across fixtures and both colors. Node counts fall on representative branching positions.
- Equal-depth suite shows a repeatable aggregate improvement; initial target is ≥2× geometric-mean speedup versus the corrected full-window path. This is a target, not a promised outcome. Explain misses and outliers; do not cherry-pick fixtures.
- Compare legacy→corrected and corrected→optimized separately: disabling incorrect shortcuts may make some positions slower despite a better algorithm.
- Under equal wall time with identical Master weights, report completed depth and paired-match results. More nodes/s alone is not the success metric.
- Top-N depth/score labels and PVs are truthful, and checkpoints remain compatible.

## Package 3 — Repair the existing linear training and evaluation loop

**Owner:** training agent. **Dependencies:** shared API agreed with Package 1; final validation after Package 2. **Effort:** medium. Can implement in parallel outside search-owned files.

### Work

1. Keep the existing TD algorithm as the first controlled baseline. Rename its description to linear TD self-play, not TD-Leaf or AlphaZero training. Do not simultaneously replace its optimizer, features, and target method.
2. Real wins/losses receive consistent signed terminal rewards; real draws receive zero. Preserve the existing ±1000 TD reward scale for this baseline. Mate-distance search scores are a different representation and must not be mixed in directly.
3. Separate terminal games and safety-cap truncations. For this initial baseline, skip the entire TD update for truncated games; record them and raise/adjust the cap if common. Do not substitute a material judgment for an outcome.
4. Alternate learner color against historical/heuristic opponents. Keep trajectory evaluations in the fixed Blue perspective and verify signs in both colors. Apply seeded randomness to opponent choice and exploration.
5. Maintain the existing league and exploration schedule initially. Record the actual opponent version and learner color; do not infer RPS-style nontransitivity of whole-engine strength merely from cyclic capture rules.
6. Add optional checkpoint/run metadata: schema version, engine commit, training algorithm/config, seed, start checkpoint, actual game/position counts, terminal/truncated counts, and elapsed CPU/wall time where available. Old JSON must still load. Record unknown legacy values as unknown.
7. In the UI, distinguish true outcomes from historical legacy counters and label heuristic move agreement accurately or remove it from strength summaries. Keep this a small wording/data change.
8. Add CLI continuation training starting from frozen Master and a heuristic baseline, writing new checkpoint files. No browser localStorage dependency and no overwriting originals.
9. Evaluate candidate checkpoints using Package 0, not the current “accuracy” percentage. Self-play win balance is diagnostic only.

### Acceptance

- A terminal draw with unequal material produces zero terminal reward and increments only draw counters.
- A cap hit produces no update and increments truncation counters.
- Blue/Red learner assignments produce correct reward signs; resume/export/import preserves metadata without breaking legacy models.
- A small seeded run is reproducible and produces finite bounded weights.
- Three bounded training runs/seeds are possible through documented commands. Save candidates even if they fail promotion; never report an unmeasured candidate as stronger.

## Package 4 — Optional small search-target learning experiment

**Owner:** training agent after Package 3. **Dependencies:** 0–3. **Effort:** medium. **Run only after mandatory packages land.**

Purpose: test whether stronger search can teach the same cheap 251-parameter evaluator useful information without introducing NNUE. Do not call this TD-Leaf; it is supervised fitting to searched position values.

### Work

1. Freeze a teacher evaluator and corrected engine for a data-generation batch. Use mixed starting positions from logged games and diverse seeded openings. Exclude a permanently held-out opening/position set.
2. Collect an initial 10,000–50,000 nonterminal positions, capped by an explicit CPU-time budget. Persist positions, history/clock, searched score, depth/nodes, teacher version, and eventual true game result where available. Report achieved sample count rather than fabricate a target count.
3. Teacher search must be stronger than the cheap static student, using a fixed reproducible node/depth budget selected from the benchmark. Exact root values come from completed searches; discard abort-only targets. Start without quiescence changes to isolate the experiment.
4. Fit the linear evaluator in batches to a bounded target, e.g. tanh(searchScore / scale), treating true terminal outcomes as ±1/0. Explicitly map forced mate scores to outcomes rather than treating them as ordinary centipawns. Select and record the scale from a training/calibration subset; do not present it as a calibrated win probability.
5. Train against the same unrounded, clock-adjusted evaluator used by inference and use matching gradients. Do not assume `extractFeatures` currently gives the complete derivative: inference applies clock decay and rounding. Use an analytic pre-round path and test numerical gradients on small nonterminal fixtures.
6. Keep legacy weight serialization and feature layout. The duplicate attack/vulnerability terms can be tied or handled consistently inside the trainer; do not silently redefine old checkpoint semantics.
7. Establish two sanity checks before self-play: a tiny synthetic target-fitting test and imitation of a known evaluator on held-out positions. Then fit stronger-search targets. Preserve the same initialization across the TD and search-target comparison where practical.
8. Begin with one configurable mixture of searched targets and true outcomes; keep it simple and predeclare the setting. No broad hyperparameter sweep. Record clipping/saturation rates and held-out loss.
9. Evaluate at equal inference time against frozen Master and the repaired TD baseline. If successful, generate one new batch with the promoted teacher; do not create an endless autonomous training job.

### Acceptance

- Gradient, perspective, serialization, and synthetic-fitting checks pass.
- Held-out performance is reported by game/opening split, not randomly splitting adjacent positions from the same game.
- Candidate passes the match promotion gate below. Lower supervised loss alone is insufficient.
- If it fails, retain Packages 0–3 as the shipped improvement and publish the negative result. Do not “fix” the result by changing the held-out set.

## Package 5 — Optional bounded tactical horizon improvement

**Owner:** search agent. **Dependencies:** 0–3. **Effort:** medium. Independent experiment from Package 4; validate separately before combining.

Add a feature-flagged quiescence search with captures and legal immediate goal wins. If the opponent threatens a touchdown, include quiet defensive evasions and do not permit an invalid stand-pat assumption. Use a conservative extension/node cap, correct terminal/history checks, and the same global deadline.

Validate forced goal defenses, poisoned captures, races, and capture chains against deeper nonselective search on small positions. Record tactical solve rate, node/time overhead, and equal-time paired matches. A nominally deeper engine is not automatically a stronger engine. Enable by default only if the strength gate passes and time limits remain sound.

Defer history heuristics beyond simple ordering, PVS, aspiration windows, reductions, native/WASM ports, large feature expansions, and multiworker training until profiling or experiment results identify a specific bottleneck. Parallel self-play is attractive, but changes update scheduling and reproducibility; it is not required for this first cycle.

## Promotion and stopping rules

1. Run core, engine, accuracy, and compatibility tests plus `npm run build`; run the full existing test command before final integration, including NNUE compatibility tests without modifying NNUE training. Classify any pre-existing failures explicitly.
2. Screen each behavior-changing candidate on 40 paired openings (80 games) at a short measured time control. Use a development opening set for screening.
3. Confirm the chosen candidate on a separate fixed set, initially 100 paired openings (200 games), with model colors swapped and equal per-move time. Freeze the candidate before this test. Count draws as half a point.
4. Compute a 95% confidence interval using opening pairs as the resampling unit. Promotion requires the lower bound of mean score to exceed 50% against the incumbent, plus no unresolved tactical/correctness regression. If inconclusive, report inconclusive; choose a larger predeclared new test rather than repeatedly peeking at an ordinary interval until it passes.
5. Include the heuristic baseline and selected older checkpoints as regression opponents. A single opponent can miss specialization. A small random-baseline sanity check is useful but not a strength claim.
6. Truncated/aborted games must be reported and resolved before a confirmatory promotion decision. Do not drop them silently or manufacture wins. Record time forfeits/illegal moves as implementation failures, not learning progress.
7. Correctness fixes are accepted on rule-based evidence even if they remove a shortcut advantage. Strength experiments require match evidence. Publish separately: correctness, latency/depth, and playing strength.
8. The final report includes exact commands, revisions, hardware/runtime, seeds, budgets, aggregate benchmark results, paired match scores/intervals, cap-hit rate, and limitations. No Elo claim without a defined opponent pool and uncertainty.

## Delegation and integration order

| Agent assignment | Initial ownership | Starts | Handoff |
|---|---|---|---|
| Harness | New CLI/fixtures/test-only reference; package scripts by coordination | Immediately | Baseline artifact, reference tests, benchmark/match runner |
| Search | Search, TT, runway integration, search context; worker/UI call-site changes | Immediately | Package 1, then Package 2 in separate commits |
| Training | Trainer, learner, training metadata, training CLI adapter | After contracts agreed | Package 3; optional Package 4 later |
| Integrator | Shared types coordination, merges, final UI smoke checks and validation | Throughout | Reproducible report and final promotion decision |

If only two agents are available, combine harness/integration and keep search/training serial where ownership overlaps. Do not have multiple agents rewrite `search.ts`, `types.ts`, or `trainingWorker.ts` concurrently. Each agent reads this whole plan but implements only its assigned package(s).

Suggested dispatch instruction:

> Implement Package [N] from `docs/intransitive-improvement-plan.md`. Respect its scope, ownership, dependencies, and acceptance gates. Preserve bundled checkpoints and backward compatibility. Coordinate shared interfaces before editing shared files. Deliver code, focused tests, exact reproduction commands, and measured results. Do not claim a playing-strength improvement without paired-match evidence, and do not implement deferred features as unsolicited extras.

## Definition of this cycle being complete

Packages 0–3 are integrated; model/cache contamination and false terminal labels are fixed; time mode is genuinely time-limited; best-move search avoids unnecessary full-window root scoring; analysis shows actual searched lines; linear training is reproducible and outcome-correct; and the repository contains a benchmark/match report comparing frozen Master under legacy and corrected/optimized engines. A new trained model becomes the default only if it independently passes promotion. Optional experiments may fail without invalidating the mandatory improvements.
