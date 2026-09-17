# Step 4 training benchmark

The Step 4 benchmark measures throughput separately from playing strength. It
compares the serial online TD schedule with frozen-policy batches on one, two,
and four persistent Node workers. Every trial uses the same starting
checkpoint, fixed opponent snapshot, run seed, search depth, ply cap, game
count, and batch size. A worker-count change therefore measures scheduling
throughput, not a different learner.

Run a short smoke benchmark:

```sh
npm run intransitive:training-benchmark -- \
  --games 40 --runs 3 --warmup-games 4 \
  --depths 1,2 --workers 1,2,4 --batch-games 4 \
  --seed 1 --output reports/intransitive-training-benchmark.json
```

The JSON report records startup and warm-up wall time separately from the
measured run, plus wall/CPU time, RSS before/after/peak, games/positions/nodes
per second, generation time, learner update time, coordination residual,
terminal/truncated games, and worker cancellation latency. The coordination
residual is the measured batch wait minus the slowest worker’s reported game
time; it includes structured-clone transport and scheduler overhead, so it is
an operational estimate rather than a direct serialization timer.

The serial row uses online updates after every game. The frozen-batch rows
generate a batch from one learner snapshot and commit complete results in
game-ID order. Batch size is intentionally independent of worker count.
Truncated games are reported and never counted as accepted TD learning games.

This command does not make a strength claim and does not write trained
checkpoints. Compare checkpoints produced by the training command with the
paired match harness at equal wall time or equal generated-game counts, using
held-out opening pairs and reporting truncations:

```sh
npm run intransitive:match -- \
  --a path/to/candidate.json --b master \
  --games 20 --opening-plies 4 --max-plies 400 --depth 2 --seed 7
```

The browser trainer exposes the same generation, update, node, and position
telemetry in its progress bar. Its worker count and batch size controls use
the frozen-policy protocol; NNUE remains outside this first benchmark because
its replay-buffer and optimizer schedule require a separate measurement plan.
