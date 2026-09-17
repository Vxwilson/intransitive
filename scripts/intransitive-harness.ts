import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getStoredCheckpoints } from '../src/custom/engine/checkpoint.ts';
import { cloneWeights, createHeuristicWeights } from '../src/custom/engine/evaluator.ts';
import { SelfPlayTrainer } from '../src/custom/engine/trainer.ts';
import { deserializeWeights } from '../src/custom/engine/nnue/featureTransformer.ts';
import { INTRANSITIVE_FIXTURES } from '../src/custom/harness/fixtures.ts';
import {
  createSeededRng,
  runPairedMatch,
  runSearchBenchmark,
  stripGames,
} from '../src/custom/harness/harness.ts';
import type {
  HarnessEngine,
  MatchAgent,
  SearchLimit,
} from '../src/custom/harness/types.ts';
import type { Checkpoint, TrainingRunMetadata } from '../src/custom/engine/types.ts';

const DEFAULT_REPORT_DIR = 'reports';

function usage(): never {
  console.error(`Usage:
  npm run intransitive:benchmark -- [options]
  npm run intransitive:match -- [options]
  npm run intransitive:train -- [options]

Benchmark options:
  --model master|heuristic|zero|<checkpoint-id>  (default: master)
  --engine production|reference|both             (default: production)
  --depth N | --nodes N | --time-ms N            (default: --depth 2)
  --max-depth N                                  (time/node safety ceiling)
  --root greedy|full                             (production root policy, default: greedy)
  --fixtures id1,id2                             (default: all checked-in fixtures)
  --warmup N --runs N                            (defaults: 1 and 5)
  --output path                                   (optional JSON report)

Match options:
  --a master|heuristic|zero|random|<checkpoint-id> (default: master)
  --b master|heuristic|zero|random|<checkpoint-id> (default: heuristic)
  --games N --opening-plies N --max-plies N        (defaults: 10, 4, 400; games must be even)
  --pairs N                                       (legacy alias for --games N*2)
  --depth N | --nodes N | --time-ms N             (default: --depth 1)
  --a-depth N --b-depth N                         (optional per-agent depth overrides)
  --max-depth N                                   (time/node safety ceiling)
  --engine production|reference                  (default: production)
  --seed N --jsonl path --report path             (optional output paths)

Production search supports depth, node, and wall-time limits. The reference
engine remains a correctness oracle, not a strength claim.

Training options:
  --start master|heuristic|zero|<checkpoint-id> (default: master)
  --opponent heuristic|<checkpoint-id>             (default: heuristic)
  --games N --seed N --search-depth N             (defaults: 3, 1, 1)
  --max-plies N --learning-rate N --lambda N --epsilon N
  --no-annealing                                  disable learning-rate annealing
  --output path --log path                        new checkpoint and optional JSONL log`);
  process.exit(2);
}

function parseArgs(args: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (!token.startsWith('--')) usage();
    const name = token.slice(2);
    const value = args[i + 1];
    if (!value || value.startsWith('--')) usage();
    parsed.set(name, value);
    i++;
  }
  return parsed;
}

function numberArg(args: Map<string, string>, name: string, fallback: number): number {
  const raw = args.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) usage();
  return value;
}

function searchLimit(args: Map<string, string>, defaultDepth: number): SearchLimit {
  const selected = ['depth', 'nodes', 'time-ms'].filter((name) => args.has(name));
  if (selected.length > 1) {
    console.error('Choose exactly one of --depth, --nodes, or --time-ms.');
    process.exit(2);
  }
  if (args.has('nodes')) return { kind: 'nodes', value: numberArg(args, 'nodes', 1) };
  if (args.has('time-ms')) return { kind: 'time', valueMs: numberArg(args, 'time-ms', 1) };
  return { kind: 'depth', value: numberArg(args, 'depth', defaultDepth) };
}

function ensureOutputParent(path: string): string {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function findCheckpoint(identifier: string) {
  const aliases: Record<string, string> = {
    master: 'preset-master',
    heuristic: 'preset-heuristic-master',
    zero: 'preset-gen-0',
    novice: 'preset-novice',
    intermediate: 'preset-intermediate',
    advanced: 'preset-advanced',
  };
  const id = aliases[identifier.toLowerCase()] ?? identifier;
  const checkpoint = getStoredCheckpoints().find((candidate) => candidate.id === id);
  if (!checkpoint) {
    console.error(`Unknown checkpoint or model: ${identifier}`);
    process.exit(2);
  }
  return checkpoint;
}

function checkpointAgent(identifier: string, engine: HarnessEngine, limit: SearchLimit, maxDepth?: number): MatchAgent {
  if (identifier.toLowerCase() === 'random') {
    return { modelId: 'random-baseline', modelName: 'Random legal-move baseline', kind: 'random' };
  }
  const checkpoint = findCheckpoint(identifier);
  const weights = checkpoint.weights ?? (checkpoint.nnueWeights ? deserializeWeights(checkpoint.nnueWeights) : undefined);
  if (!weights) {
    console.error(`Checkpoint ${checkpoint.id} has no supported evaluator weights.`);
    process.exit(2);
  }
  return {
    modelId: checkpoint.id,
    modelName: checkpoint.name,
    kind: 'search',
    weights,
    search: { engine, limit, maxDepth, count: 1 },
  };
}

function runBenchmarkCommand(args: Map<string, string>): void {
  const model = findCheckpoint(args.get('model') ?? 'master');
  const weights = model.weights ?? (model.nnueWeights ? deserializeWeights(model.nnueWeights) : undefined);
  if (!weights) {
    console.error(`Checkpoint ${model.id} has no supported evaluator weights.`);
    process.exit(2);
  }
  const limit = searchLimit(args, 2);
  const requestedEngine = args.get('engine') ?? 'production';
  const engines: HarnessEngine[] = requestedEngine === 'both'
    ? ['production', 'reference']
    : requestedEngine === 'production' || requestedEngine === 'reference'
      ? [requestedEngine]
      : (console.error(`Unknown engine: ${requestedEngine}`), process.exit(2), []);
  const rootMode = args.get('root') ?? 'greedy';
  if (rootMode !== 'greedy' && rootMode !== 'full') {
    console.error(`Unknown --root mode: ${rootMode}`);
    process.exit(2);
  }

  const selectedIds = args.get('fixtures')?.split(',').map((id) => id.trim()).filter(Boolean);
  const fixtures = selectedIds
    ? INTRANSITIVE_FIXTURES.filter((fixture) => selectedIds.includes(fixture.id))
    : INTRANSITIVE_FIXTURES;
  if (fixtures.length === 0) {
    console.error('No matching fixtures.');
    process.exit(2);
  }
  const reports = engines.map((engine) => runSearchBenchmark({
    fixtures,
    modelId: model.id,
    weights,
    engine,
    limit,
    maxDepth: numberArg(args, 'max-depth', 4),
    warmupRuns: numberArg(args, 'warmup', 1),
    measuredRuns: numberArg(args, 'runs', 5),
    rootMode: rootMode as 'greedy' | 'full',
  }));
  const payload = reports.length === 1 ? reports[0] : { reports };
  const output = args.get('output');
  if (output) writeFileSync(ensureOutputParent(output), `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify(payload, null, 2));
}

function runMatchCommand(args: Map<string, string>): void {
  const engine = args.get('engine') ?? 'production';
  if (engine !== 'production' && engine !== 'reference') {
    console.error(`Unknown engine: ${engine}`);
    process.exit(2);
  }
  const limit = searchLimit(args, 1);
  const agentA = checkpointAgent(args.get('a') ?? 'master', engine, limit, numberArg(args, 'max-depth', 4));
  const agentB = checkpointAgent(args.get('b') ?? 'heuristic', engine, limit, numberArg(args, 'max-depth', 4));
  if (args.has('games') && args.has('pairs')) {
    console.error('Choose exactly one of --games or --pairs.');
    process.exit(2);
  }
  const totalGames = args.has('games')
    ? numberArg(args, 'games', 10)
    : args.has('pairs')
      ? numberArg(args, 'pairs', 5) * 2
      : 10;
  if (!Number.isInteger(totalGames) || totalGames < 2 || totalGames % 2 !== 0) {
    console.error(`Paired matches require an even integer game count of at least 2; received ${totalGames}`);
    process.exit(2);
  }
  const report = runPairedMatch({
    agentA: { ...agentA, search: agentA.search ? { ...agentA.search, limit: args.has('a-depth') ? { kind: 'depth', value: numberArg(args, 'a-depth', 1) } : agentA.search.limit } : undefined },
    agentB: { ...agentB, search: agentB.search ? { ...agentB.search, limit: args.has('b-depth') ? { kind: 'depth', value: numberArg(args, 'b-depth', 1) } : agentB.search.limit } : undefined },
    totalGames,
    seed: numberArg(args, 'seed', 1),
    openingPlies: numberArg(args, 'opening-plies', 4),
    safetyCap: numberArg(args, 'max-plies', 400),
  });

  const jsonlPath = ensureOutputParent(args.get('jsonl') ?? `${DEFAULT_REPORT_DIR}/intransitive-match.jsonl`);
  writeFileSync(jsonlPath, report.games?.map((game) => JSON.stringify(game)).join('\n') + '\n');
  const compact = stripGames(report);
  const reportPath = ensureOutputParent(args.get('report') ?? `${DEFAULT_REPORT_DIR}/intransitive-match-report.json`);
  writeFileSync(reportPath, `${JSON.stringify(compact, null, 2)}\n`);
  console.log(JSON.stringify({ ...compact, jsonl: jsonlPath, report: reportPath }, null, 2));
}

const LINEAR_TD_ENGINE_VERSION = 'package-3-linear-td-v1';

function trainingNumber(args: Map<string, string>, name: string, fallback: number): number {
  const value = numberArg(args, name, fallback);
  if (!Number.isFinite(value)) usage();
  return value;
}

function linearWeights(checkpoint: Checkpoint, label: string) {
  if (!checkpoint.weights) {
    console.error(`${label} checkpoint ${checkpoint.id} is not a linear evaluator.`);
    process.exit(2);
  }
  return cloneWeights(checkpoint.weights);
}

function runTrainingCommand(args: Map<string, string>): void {
  const startIdentifier = args.get('start') ?? 'master';
  const opponentIdentifier = args.get('opponent') ?? 'heuristic';
  const startCheckpoint = findCheckpoint(startIdentifier);
  const opponentCheckpoint = opponentIdentifier.toLowerCase() === 'heuristic'
    ? findCheckpoint('heuristic')
    : findCheckpoint(opponentIdentifier);
  const startWeights = linearWeights(startCheckpoint, 'Start');
  const opponentWeights = opponentIdentifier.toLowerCase() === 'heuristic'
    ? createHeuristicWeights()
    : linearWeights(opponentCheckpoint, 'Opponent');

  const requestedGames = Math.max(1, Math.floor(trainingNumber(args, 'games', 3)));
  const seed = Math.floor(trainingNumber(args, 'seed', 1));
  const config = {
    searchDepth: Math.max(1, Math.floor(trainingNumber(args, 'search-depth', 1))),
    maxPliesPerGame: Math.max(1, Math.floor(trainingNumber(args, 'max-plies', 80))),
    learningRate: Math.max(0, trainingNumber(args, 'learning-rate', 0.015)),
    lambda: Math.max(0, Math.min(1, trainingNumber(args, 'lambda', 0.7))),
    epsilon: Math.max(0, Math.min(1, trainingNumber(args, 'epsilon', 0.10))),
    learningRateAnnealing: !args.has('no-annealing'),
  };
  const trainer = new SelfPlayTrainer(startWeights, config, {
    rng: createSeededRng(seed),
    learnerColorPolicy: 'alternate',
    opponentPolicy: 'fixed',
    opponentWeights,
    opponentId: opponentCheckpoint.id,
    initialStats: JSON.parse(JSON.stringify(startCheckpoint.stats)),
  });

  const startedAt = performance.now();
  const startedCpu = process.cpuUsage();
  const games = [];
  let positions = 0;
  for (let game = 0; game < requestedGames; game++) {
    const record = trainer.playSelfPlayGame();
    games.push(record);
    positions += record.plies;
  }
  const elapsedWallMs = Math.round(performance.now() - startedAt);
  const elapsedCpu = process.cpuUsage(startedCpu);
  const elapsedCpuMs = Math.round((elapsedCpu.user + elapsedCpu.system) / 1000);
  const terminalGames = games.filter((game) => game.isTerminal).length;
  const truncatedGames = games.filter((game) => game.isTruncated).length;
  const metadata: TrainingRunMetadata = {
    schemaVersion: 1,
    engineVersion: LINEAR_TD_ENGINE_VERSION,
    engineCommit: process.env.INTRANSITIVE_ENGINE_COMMIT ?? 'unknown',
    algorithm: 'linear-td-self-play',
    config: {
      ...trainer.learner.config,
      learnerColorPolicy: trainer.learnerColorPolicy,
      opponentPolicy: trainer.opponentPolicy,
    },
    seed,
    startCheckpointId: startCheckpoint.id,
    startCheckpointName: startCheckpoint.name,
    requestedGames,
    actualGames: games.length,
    positions,
    terminalGames,
    truncatedGames,
    elapsedWallMs,
    elapsedCpuMs,
    learnerBlueGames: games.filter((game) => game.learnerColor === 'blue').length,
    learnerRedGames: games.filter((game) => game.learnerColor === 'red').length,
    opponentVersions: games.reduce<Record<string, number>>((counts, game) => {
      counts[game.opponentId] = (counts[game.opponentId] ?? 0) + 1;
      return counts;
    }, {}),
  };
  const checkpoint: Checkpoint = {
    id: `training-${Date.now()}-${seed}`,
    name: args.get('name') ?? `Linear TD self-play from ${startCheckpoint.name}`,
    generation: trainer.stats.generation,
    timestamp: Date.now(),
    modelType: 'linear',
    weights: trainer.weights,
    stats: trainer.stats,
    trainingMetadata: metadata,
  };

  const outputPath = ensureOutputParent(args.get('output') ?? `${DEFAULT_REPORT_DIR}/package-3-linear-td-seed-${seed}.json`);
  writeFileSync(outputPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
  const logPath = args.get('log');
  let absoluteLogPath: string | undefined;
  if (logPath) {
    absoluteLogPath = ensureOutputParent(logPath);
    writeFileSync(absoluteLogPath, games.map((game) => JSON.stringify({
      kind: 'intransitive-linear-td-game',
      engineVersion: LINEAR_TD_ENGINE_VERSION,
      seed,
      ...game,
    })).join('\n') + '\n');
  }
  console.log(JSON.stringify({
    checkpoint: outputPath,
    ...(absoluteLogPath ? { log: absoluteLogPath } : {}),
    metadata,
  }, null, 2));
}

function main(): void {
  const command = process.argv[2];
  if (!command) usage();
  const args = parseArgs(process.argv.slice(3));
  if (command === 'benchmark') runBenchmarkCommand(args);
  else if (command === 'match') runMatchCommand(args);
  else if (command === 'train') runTrainingCommand(args);
  else usage();
}

main();
