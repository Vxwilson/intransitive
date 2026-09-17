# Intransitive Package 3: linear TD self-play

Package 3 repairs the existing cheap linear learner while keeping its TD(λ)
update, feature layout, and ±1000 terminal reward scale as a controlled
baseline. It is not TD-Leaf or AlphaZero training.

The trainer now:

- records only rules-defined wins, losses, and draws;
- gives Blue wins `+1000`, Red wins `-1000`, and true draws `0` in the fixed
  Blue perspective;
- skips the entire update for safety-cap truncations and records them
  separately;
- alternates the learner between Blue and Red;
- accepts an injected seeded RNG for opponent selection and exploration; and
- records learner colors, opponent versions, terminal/truncated games, and
  trajectory position counts.

## Continue a checkpoint from the CLI

The command writes a new JSON checkpoint and never depends on browser
`localStorage`. The default start is the frozen linear Master checkpoint and
the default opponent is the heuristic baseline.

```sh
npm run intransitive:train -- \
  --start master --opponent heuristic --games 3 --seed 20260917 \
  --search-depth 1 --output reports/package-3-seed-20260917.json \
  --log reports/package-3-seed-20260917.jsonl
```

Run additional bounded seeds as separate candidates:

```sh
npm run intransitive:train -- --start master --opponent heuristic --games 3 --seed 7
npm run intransitive:train -- --start master --opponent heuristic --games 3 --seed 42
npm run intransitive:train -- --start master --opponent heuristic --games 3 --seed 99
```

Useful controls are `--max-plies`, `--learning-rate`, `--lambda`,
`--epsilon`, and `--no-annealing`. A checkpoint's `trainingMetadata` records
the actual run counts, seed, configuration, start checkpoint, elapsed CPU/wall
time, and opponent/color assignments. `engineCommit` is `unknown` unless
`INTRANSITIVE_ENGINE_COMMIT` is supplied by the caller.

Legacy checkpoint JSON remains loadable. Its absent Package 3 metadata and new
training counters are treated as unknown by the file format; new continuation
runs record fresh measured counts rather than fabricating historical values.

## Validation

```sh
npx tsx src/custom/engine/package3.test.ts
npm run test
npm run build
```

These checks are correctness/reproducibility checks, not a playing-strength
claim. Candidate promotion still requires the paired-opening match gate in
`docs/intransitive-improvement-plan.md`.
