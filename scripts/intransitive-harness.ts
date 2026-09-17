import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { getStoredCheckpoints } from '../src/custom/engine/checkpoint.ts';
import { deserializeWeights } from '../src/custom/engine/nnue/featureTransformer.ts';
import { INTRANSITIVE_FIXTURES } from '../src/custom/harness/fixtures.ts';
import {
  runPairedMatch,
  runSearchBenchmark,
  stripGames,
} from '../src/custom/harness/harness.ts';
import type {
  HarnessEngine,
  MatchAgent,
  SearchLimit,
} from '../src/custom/harness/types.ts';

const DEFAULT_REPORT_DIR = 'reports';

function usage(): never {
  console.error(`Usage:
  npm run intransitive:benchmark -- [options]
  npm run intransitive:match -- [options]

Benchmark options:
  --model master|heuristic|zero|<checkpoint-id>  (default: master)
  --engine production|reference|both             (default: production)
  --depth N | --nodes N | --time-ms N            (default: --depth 2)
  --max-depth N                                  (time/node safety ceiling)
  --fixtures id1,id2                             (default: all checked-in fixtures)
  --warmup N --runs N                            (defaults: 1 and 5)
  --output path                                   (optional JSON report)

Match options:
  --a master|heuristic|zero|random|<checkpoint-id> (default: master)
  --b master|heuristic|zero|random|<checkpoint-id> (default: heuristic)
  --pairs N --opening-plies N --max-plies N       (defaults: 1, 4, 400)
  --depth N | --nodes N | --time-ms N             (default: --depth 1)
  --a-depth N --b-depth N                         (optional per-agent depth overrides)
  --max-depth N                                   (time/node safety ceiling)
  --engine production|reference                  (default: production)
  --seed N --jsonl path --report path             (optional output paths)

Node-limited runs use the test-only reference engine because the legacy
production API has no interruptible node-budget contract yet.`);
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
  if (limit.kind === 'nodes' && engines.includes('production')) {
    console.error('Node-limited production benchmarks are unsupported; use --engine reference or --engine both without --nodes.');
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
  if (limit.kind === 'nodes' && engine === 'production') {
    console.error('Node-limited production matches are unsupported; use --engine reference.');
    process.exit(2);
  }
  const agentA = checkpointAgent(args.get('a') ?? 'master', engine, limit, numberArg(args, 'max-depth', 4));
  const agentB = checkpointAgent(args.get('b') ?? 'heuristic', engine, limit, numberArg(args, 'max-depth', 4));
  const report = runPairedMatch({
    agentA: { ...agentA, search: agentA.search ? { ...agentA.search, limit: args.has('a-depth') ? { kind: 'depth', value: numberArg(args, 'a-depth', 1) } : agentA.search.limit } : undefined },
    agentB: { ...agentB, search: agentB.search ? { ...agentB.search, limit: args.has('b-depth') ? { kind: 'depth', value: numberArg(args, 'b-depth', 1) } : agentB.search.limit } : undefined },
    pairCount: numberArg(args, 'pairs', 1),
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

function main(): void {
  const command = process.argv[2];
  if (!command) usage();
  const args = parseArgs(process.argv.slice(3));
  if (command === 'benchmark') runBenchmarkCommand(args);
  else if (command === 'match') runMatchCommand(args);
  else usage();
}

main();
