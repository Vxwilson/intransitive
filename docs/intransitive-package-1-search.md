# Intransitive Package 1 search

Package 1 is the correctness-first search pass described in
[`intransitive-improvement-plan.md`](./intransitive-improvement-plan.md).

## Search contract

`selectMove` accepts either a fixed depth or one of these mutually exclusive
limits:

```ts
{ limit: { kind: 'depth', depth: 3 } }
{ limit: { kind: 'nodes', nodes: 50_000 }, maxDepth: 64 }
{ limit: { kind: 'time', timeMs: 250 }, maxDepth: 64 }
```

The legacy numeric depth and `thinkTimeSec`/`thinkTimeMs` forms remain
supported. Time and node searches return the last fully completed iteration;
the result includes `completedDepth`, `nodes`, `elapsedMs`, a searched `pv`,
`stopReason`, and `scoreKind`. A nonterminal search always has a legal fallback
even when the first iteration is interrupted.

The transposition table is allocated by `SearchContext` and is used only for
move ordering. Scores and bounds are not reused across evaluators, clocks, or
repetition histories. Terminal draws are exact zeroes. Runway detection remains
available as a diagnostic helper but is not a production win/loss cutoff.

## History and workers

FEN-only imports intentionally start with fresh repetition history. Live and
analysis requests can instead send `{ startFen, moves }`; workers replay and
validate that history before searching. The UI sends the actual played ply for
opening exploration, rather than deriving it from the capture-resetting
halfmove clock. Competitive arena moves use greedy selection.

Infinite analysis is iterative and yields between depths, with
`MAX_SEARCH_DEPTH` as a safety ceiling. Worker termination/recreation remains
the cancellation mechanism for an in-progress synchronous depth.

## Validation

Run the focused checks with:

```sh
npx tsx src/custom/engine/package1.test.ts
```

Run the complete repository suite and build with:

```sh
npm test
npm run build
```

The Package 1 regression suite covers evaluator/TT contamination, the known
runner/halfmove counterexample, exact draws, abort state restoration, time-only
search beyond the old depth-2 ceiling, repetition replay, and searched PVs.
