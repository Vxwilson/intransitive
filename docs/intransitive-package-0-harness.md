# Intransitive Package 0 harness

Package 0 adds a Node/TypeScript validation harness for the 9x9 Intransitive game. It is intentionally separate from the browser workers and from the existing arena/trainer loop. The attached improvement plan is the specification for this harness; the user request limits this change to Package 0, so it does not repair production search, time control, or training behavior from Packages 1–3.

## Reproduce

Install the repository dependencies, then run the focused checks:

```sh
npm run test:intransitive:harness
npm run build
```

Run a repeated benchmark on the checked-in fixtures. `both` compares the current production adapter with the independent shallow reference engine using the same frozen Master evaluator; it does not modify either preset.

```sh
npm run intransitive:benchmark -- \
  --model master \
  --engine both \
  --depth 2 \
  --warmup 1 \
  --runs 5 \
  --output reports/package-0-benchmark.json
```

Run a short paired match. Each pair uses one seeded random opening twice, then swaps A/B colors. The default safety cap is 400 plies. Use a larger `--max-plies` to replay a run after investigating cap hits.

```sh
npm run intransitive:match -- \
  --a master \
  --b heuristic \
  --pairs 1 \
  --opening-plies 4 \
  --max-plies 400 \
  --depth 1 \
  --seed 20260917 \
  --jsonl reports/package-0-match.jsonl \
  --report reports/package-0-match.json
```

For a true random legal-move baseline, use `--a random` or `--b random`. It samples uniformly from the current legal move list and does not call the evaluator or search. The corrected production search supports node budgets; use `--root greedy` for optimized best-move searches or `--root full` for exact full-window root comparisons.

The reference engine checks node/time budgets during recursion. The optimized production path uses the shared Package 1 hard-deadline/node-budget entry point. An explicit full-window MultiPV wall-time benchmark remains a diagnostic adapter that checks time between completed depths and can overshoot a small budget.

## Checked-in inputs and outputs

- [`fixtures.json`](../src/custom/harness/fixtures.json) contains 15 positions spanning start, developed, captures, goal attacks/defenses, blocked routes, low material, repetition, and halfmove-clock boundaries. No uncertain strategic move is labeled as objectively best.
- A fixture can provide `startFen` plus serialized legal `history`. The loader replays that history and verifies the final FEN, so repetition counts are not invented from a FEN that cannot encode them.
- The reference search is in [`referenceMinimax.ts`](../src/custom/harness/referenceMinimax.ts). It uses no transposition-table score reuse, runway proof, selective extension, draw contempt, or heuristic unfinished-game adjudication. Every make/unmake is unwound with `finally`.
- [`harness.ts`](../src/custom/harness/harness.ts) records nodes, elapsed time, completed depth, selected move, stop reason, and score kind. Benchmarks discard warmups and report per-fixture and overall median, p95, and maximum latency.
- Match JSONL records contain the seed, opening seed, assignments, model IDs, limits, every move and FEN, outcome/reason, cap-hit flag, and timing. The aggregate report keeps wins, draws, truncations, errors, resolved-game count, and score separate.

The `production` benchmark intentionally exposes differences from the reference oracle. For example, a current runway shortcut may produce a decisive score where the reference search reports a material/positional score. That is diagnostic evidence for Package 1, not a Package 0 strength claim.

## Promotion-use rules

Package 0 reports are measurement artifacts. They do not establish playing-strength improvement. Before using a report for promotion, resolve every `truncated` or `error` game: rerun the same seeds with a larger declared cap, or otherwise extend/replay the pair. Do not convert a cap hit into a win. Use separate corrected-engine and frozen-weight comparisons when Packages 1–3 are available.

The existing `SelfPlayTrainer.runArenaTournament` is not used by this harness because it has an 80-ply cap and performs an extra depth-1 benchmark search per move under the name “accuracy.”
