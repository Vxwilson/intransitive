# Intransitive Package 2 search

Package 2 adds the optimized best-move root path and makes searched analysis
lines explicit. It keeps the Package 1 correctness-first search contract.

## Root policies

`selectMove` uses the greedy root path when temperature and root noise are both
zero. The first root child is searched with a full window; later siblings share
the root alpha/beta bounds. The selected result is the exact score for the
completed depth, and its PV is built recursively by the search.

`getTopMoves` always uses the full-window root path. This is intentional:
exploration needs exact scores for softmax, and MultiPV candidates must all be
scored at the requested completed depth. Bounds from the greedy path are never
passed to exploration as candidate scores.

Root ordering is: the last completed root move, the current search-context TT
hint, immediate legal goals, then the existing goal-distance/capture ordering.
Ordering keys are cached once per sort operation.

## Reproduce

Run the focused tests:

```sh
npx tsx src/custom/engine/package2.test.ts
```

Compare the two root paths on the same frozen evaluator and fixtures:

```sh
npm run intransitive:benchmark -- \
  --model master --engine production --root greedy \
  --fixtures start,developed-center --depth 3 --warmup 1 --runs 5

npm run intransitive:benchmark -- \
  --model master --engine production --root full \
  --fixtures start,developed-center --depth 3 --warmup 1 --runs 5
```

The benchmark records median/tail latency, nodes, score, completed depth, and
selected move. These are search-work measurements, not a playing-strength
claim. Strength still requires the paired-opening promotion gate in the main
improvement plan.

The checked-in sample artifacts are
[`package-2-sample-benchmark-greedy.json`](../reports/package-2-sample-benchmark-greedy.json)
and
[`package-2-sample-benchmark-full.json`](../reports/package-2-sample-benchmark-full.json).
The equal-wall-time Master-vs-Master paired replay is recorded in
[`package-2-sample-match.json`](../reports/package-2-sample-match.json) and
[`package-2-sample-match.jsonl`](../reports/package-2-sample-match.jsonl).
