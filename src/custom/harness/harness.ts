import { globalIntransitiveTT } from '../engine/transposition';
import { getTopMoves } from '../engine/search';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import { IntransitiveGame } from '../core/game';
import { loadFixture, serializeMove } from './fixtures';
import { runReferenceSearch } from './referenceMinimax';
import type {
  BenchmarkFixtureSummary,
  BenchmarkReport,
  BenchmarkSample,
  HarnessEngine,
  HarnessSearchResult,
  HarnessWeights,
  IntransitiveFixture,
  LoggedMove,
  MatchAgent,
  MatchGameLog,
  MatchOutcome,
  PairedMatchReport,
  SearchLimit,
  SearchRequest,
} from './types';

export const HARNESS_ENGINE_VERSION = 'package-0-harness-v1';
const INITIAL_FEN = '9/4pr3/4spr2/5spr1/1PS3sp1/1RPS5/2RPS4/3RP4/9 b 0 1';

export function createSeededRng(seed: number): () => number {
  let state = (seed >>> 0) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deriveSeed(seed: number, ...parts: number[]): number {
  let value = seed >>> 0;
  for (const part of parts) {
    value ^= (part + 0x9e3779b9 + (value << 6) + (value >>> 2)) >>> 0;
    value = Math.imul(value ^ (value >>> 16), 0x45d9f3b) >>> 0;
  }
  return value >>> 0;
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function limitValue(limit: SearchLimit): SearchLimit {
  if (limit.kind === 'depth') return { kind: 'depth', value: Math.max(1, Math.floor(limit.value)) };
  if (limit.kind === 'nodes') return { kind: 'nodes', value: Math.max(1, Math.floor(limit.value)) };
  return { kind: 'time', valueMs: Math.max(1, Math.floor(limit.valueMs)) };
}

function productionSearch(
  game: IntransitiveGame,
  weights: HarnessWeights,
  request: SearchRequest
): HarnessSearchResult {
  if (request.limit.kind === 'nodes') {
    throw new Error('The legacy production adapter does not expose a node budget; use --engine reference for node-limited runs.');
  }

  globalIntransitiveTT.clear();
  const startedAt = performance.now();
  const maxDepth = Math.max(1, Math.floor(request.maxDepth ?? (request.limit.kind === 'depth' ? request.limit.value : 6)));
  const depthLimit = request.limit.kind === 'depth'
    ? Math.max(1, Math.floor(request.limit.value))
    : maxDepth;
  const context = { nodes: 0 };
  let lastCandidates = getTopMoves(game, weights, request.count ?? 1, 1, context);
  let completedDepth = 1;
  let stopReason: HarnessSearchResult['stopReason'] = request.limit.kind === 'depth' ? 'depth' : 'time-budget';

  if (request.limit.kind === 'depth') {
    lastCandidates = getTopMoves(game, weights, request.count ?? 1, depthLimit, context);
    completedDepth = depthLimit;
  } else {
    for (let depth = 2; depth <= depthLimit; depth++) {
      if (performance.now() - startedAt >= request.limit.valueMs) break;
      const candidates = getTopMoves(game, weights, request.count ?? 1, depth, context);
      if (candidates.length > 0) {
        lastCandidates = candidates;
        completedDepth = depth;
      }
      if (performance.now() - startedAt >= request.limit.valueMs) break;
    }
    if (completedDepth >= depthLimit && performance.now() - startedAt < request.limit.valueMs) {
      stopReason = 'depth';
    }
  }

  const elapsedMs = performance.now() - startedAt;
  const best = lastCandidates[0];
  if (!best) {
    return {
      bestMove: null,
      score: 0,
      completedDepth: 0,
      nodes: context.nodes,
      elapsedMs: roundMetric(elapsedMs),
      stopReason: 'fallback',
      scoreKind: 'static',
      candidates: [],
    };
  }

  return {
    bestMove: best.move,
    score: best.score,
    completedDepth,
    nodes: context.nodes,
    elapsedMs: roundMetric(elapsedMs),
    stopReason,
    scoreKind: 'engine',
    candidates: lastCandidates,
  };
}

export function searchPosition(
  game: IntransitiveGame,
  weights: HarnessWeights,
  request: SearchRequest
): HarnessSearchResult {
  const normalizedRequest = { ...request, limit: limitValue(request.limit) };
  if (normalizedRequest.engine === 'reference') {
    const startedAt = performance.now();
    const reference = runReferenceSearch(
      game,
      weights,
      normalizedRequest.limit,
      normalizedRequest.maxDepth ?? 4
    );
    const candidates = reference.candidates.slice(0, normalizedRequest.count ?? 1).map((candidate, index) => ({
      move: candidate.move,
      rank: index + 1,
      score: candidate.score,
      san: game.formatMoveSAN(candidate.move),
    }));
    return {
      bestMove: reference.bestMove,
      score: reference.score,
      completedDepth: reference.completedDepth,
      nodes: reference.nodes,
      elapsedMs: roundMetric(performance.now() - startedAt),
      stopReason: reference.stopReason,
      scoreKind: reference.completedDepth > 0 ? (reference.stopped ? 'partial' : 'exact') : 'static',
      candidates,
    };
  }
  return productionSearch(game, weights, normalizedRequest);
}

export interface BenchmarkOptions {
  fixtures: IntransitiveFixture[];
  modelId: string;
  weights: HarnessWeights;
  engine: HarnessEngine;
  limit: SearchLimit;
  warmupRuns?: number;
  measuredRuns?: number;
  maxDepth?: number;
}

export function runSearchBenchmark(options: BenchmarkOptions): BenchmarkReport {
  const warmupRuns = Math.max(0, Math.floor(options.warmupRuns ?? 1));
  const measuredRuns = Math.max(1, Math.floor(options.measuredRuns ?? 5));
  const rawSamples: BenchmarkSample[] = [];

  for (const fixture of options.fixtures) {
    for (let run = 0; run < warmupRuns + measuredRuns; run++) {
      const game = loadFixture(fixture);
      const result = searchPosition(game, options.weights, {
        engine: options.engine,
        limit: options.limit,
        maxDepth: options.maxDepth,
        count: 1,
      });
      if (run < warmupRuns) continue;

      rawSamples.push({
        fixtureId: fixture.id,
        engine: options.engine,
        repetition: run - warmupRuns + 1,
        score: result.score,
        selectedMove: result.candidates[0]?.san ?? (result.bestMove ? game.formatMoveSAN(result.bestMove) : null),
        completedDepth: result.completedDepth,
        nodes: result.nodes,
        elapsedMs: result.elapsedMs,
        stopReason: result.stopReason,
        scoreKind: result.scoreKind,
      });
    }
  }

  const summaries: BenchmarkFixtureSummary[] = options.fixtures.map((fixture) => {
    const samples = rawSamples.filter((sample) => sample.fixtureId === fixture.id);
    const times = samples.map((sample) => sample.elapsedMs);
    const nodes = samples.map((sample) => sample.nodes);
    return {
      fixtureId: fixture.id,
      engine: options.engine,
      samples: samples.length,
      medianMs: roundMetric(median(times)),
      p95Ms: roundMetric(percentile(times, 0.95)),
      maxMs: roundMetric(Math.max(...times)),
      medianNodes: Math.round(median(nodes)),
      medianScore: roundMetric(median(samples.map((sample) => sample.score))),
      selectedMoves: [...new Set(samples.map((sample) => sample.selectedMove).filter((move): move is string => move !== null))],
    };
  });

  const allTimes = rawSamples.map((sample) => sample.elapsedMs);
  const allNodes = rawSamples.map((sample) => sample.nodes);
  return {
    kind: 'intransitive-search-benchmark-report',
    schemaVersion: 1,
    engineVersion: HARNESS_ENGINE_VERSION,
    modelId: options.modelId,
    limit: limitValue(options.limit),
    warmupRuns,
    measuredRuns,
    fixtures: summaries,
    overall: {
      medianMs: roundMetric(median(allTimes)),
      p95Ms: roundMetric(percentile(allTimes, 0.95)),
      maxMs: roundMetric(Math.max(...allTimes)),
      medianNodes: Math.round(median(allNodes)),
    },
    rawSamples,
  };
}

function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.piece === b.piece && a.captured === b.captured;
}

function chooseRandomMove(game: IntransitiveGame, rng: () => number): Move | null {
  const moves = game.generateLegalMoves();
  if (moves.length === 0) return null;
  return moves[Math.min(moves.length - 1, Math.floor(rng() * moves.length))];
}

function makeLoggedMove(
  game: IntransitiveGame,
  move: Move,
  source: LoggedMove['source'],
  ply: number,
  elapsedMs?: number,
  nodes?: number,
  completedDepth?: number
): LoggedMove {
  const player = game.activePlayer === PLAYER_BLUE ? 'blue' : 'red';
  const san = game.formatMoveSAN(move);
  if (!game.makeMove(move)) {
    throw new Error(`Harness attempted an illegal move ${JSON.stringify(move)}`);
  }
  return {
    ply,
    player,
    move: serializeMove(move),
    san,
    fen: game.toFEN(),
    source,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
    ...(nodes === undefined ? {} : { nodes }),
    ...(completedDepth === undefined ? {} : { completedDepth }),
  };
}

function generateOpening(startFen: string, openingPlies: number, seed: number): Move[] {
  const game = new IntransitiveGame(startFen);
  const rng = createSeededRng(seed);
  const opening: Move[] = [];
  for (let ply = 0; ply < openingPlies; ply++) {
    if (game.isTerminal().isOver) break;
    const move = chooseRandomMove(game, rng);
    if (!move) break;
    opening.push(move);
    game.makeMove(move);
  }
  return opening;
}

function outcomeForStatus(game: IntransitiveGame, aIsBlue: boolean): MatchOutcome | null {
  const status = game.isTerminal();
  if (!status.isOver) return null;
  if (status.winner === 'draw') return 'draw';
  if (status.winner === PLAYER_BLUE) return aIsBlue ? 'A' : 'B';
  if (status.winner === PLAYER_RED) return aIsBlue ? 'B' : 'A';
  return null;
}

function runMatchGame(
  pairIndex: number,
  gameIndex: number,
  seed: number,
  openingSeed: number,
  opening: Move[],
  agentA: MatchAgent,
  agentB: MatchAgent,
  aIsBlue: boolean,
  safetyCap: number,
  startFen: string
): MatchGameLog {
  const startedAt = performance.now();
  const game = new IntransitiveGame(startFen);
  const rng = createSeededRng(deriveSeed(seed, pairIndex, gameIndex, 0x51f15e));
  const moves: LoggedMove[] = [];

  try {
    for (const openingMove of opening) {
      moves.push(makeLoggedMove(game, openingMove, 'opening', moves.length + 1));
    }

    while (moves.length < safetyCap) {
      const existingOutcome = outcomeForStatus(game, aIsBlue);
      if (existingOutcome) {
        return makeMatchLog(pairIndex, gameIndex, seed, openingSeed, opening.length, aIsBlue, agentA, agentB, moves, existingOutcome, game.isTerminal().reason, startedAt, false);
      }

      const isBlue = game.activePlayer === PLAYER_BLUE;
      const currentAgent = (isBlue === aIsBlue) ? agentA : agentB;
      const source = currentAgent.kind === 'random' ? 'random' : 'engine';
      const moveStart = performance.now();
      let result: HarnessSearchResult | null = null;
      let move: Move | null;
      if (currentAgent.kind === 'random') {
        move = chooseRandomMove(game, rng);
      } else {
        if (!currentAgent.weights || !currentAgent.search) {
          throw new Error(`Search agent ${currentAgent.modelId} is missing weights or search settings.`);
        }
        result = searchPosition(game, currentAgent.weights, currentAgent.search);
        move = result.bestMove;
      }
      if (!move) {
        return makeMatchLog(pairIndex, gameIndex, seed, openingSeed, opening.length, aIsBlue, agentA, agentB, moves, 'error', 'no-legal-move', startedAt, false);
      }
      const legalMove = game.generateLegalMoves().find((candidate) => sameMove(candidate, move));
      if (!legalMove) {
        return makeMatchLog(pairIndex, gameIndex, seed, openingSeed, opening.length, aIsBlue, agentA, agentB, moves, 'error', 'illegal-engine-move', startedAt, false);
      }
      const elapsed = result?.elapsedMs ?? roundMetric(performance.now() - moveStart);
      moves.push(makeLoggedMove(game, legalMove, source, moves.length + 1, elapsed, result?.nodes, result?.completedDepth));
    }

    const outcome = outcomeForStatus(game, aIsBlue);
    return makeMatchLog(pairIndex, gameIndex, seed, openingSeed, opening.length, aIsBlue, agentA, agentB, moves, outcome ?? 'truncated', outcome ? game.isTerminal().reason : 'safety-cap', startedAt, !outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeMatchLog(pairIndex, gameIndex, seed, openingSeed, opening.length, aIsBlue, agentA, agentB, moves, 'error', message, startedAt, false);
  }
}

function makeMatchLog(
  pairIndex: number,
  gameIndex: number,
  seed: number,
  openingSeed: number,
  openingPlies: number,
  aIsBlue: boolean,
  agentA: MatchAgent,
  agentB: MatchAgent,
  moves: LoggedMove[],
  outcome: MatchOutcome,
  reason: string | null,
  startedAt: number,
  capHit: boolean
): MatchGameLog {
  return {
    kind: 'intransitive-match-game',
    schemaVersion: 1,
    engineVersion: HARNESS_ENGINE_VERSION,
    pairIndex,
    gameIndex,
    seed,
    openingSeed,
    openingPlies,
    aIsBlue,
    modelIds: {
      blue: aIsBlue ? agentA.modelId : agentB.modelId,
      red: aIsBlue ? agentB.modelId : agentA.modelId,
    },
    limits: {
      blue: (aIsBlue ? agentA : agentB).kind === 'random' ? 'random' : (aIsBlue ? agentA : agentB).search!.limit,
      red: (!aIsBlue ? agentA : agentB).kind === 'random' ? 'random' : (!aIsBlue ? agentA : agentB).search!.limit,
    },
    moves,
    outcome,
    reason,
    plies: moves.length,
    elapsedMs: roundMetric(performance.now() - startedAt),
    capHit,
  };
}

export interface PairedMatchOptions {
  agentA: MatchAgent;
  agentB: MatchAgent;
  pairCount?: number;
  seed?: number;
  openingPlies?: number;
  safetyCap?: number;
  startFen?: string;
}

export function runPairedMatch(options: PairedMatchOptions): PairedMatchReport {
  const pairCount = Math.max(1, Math.floor(options.pairCount ?? 1));
  const seed = options.seed ?? 1;
  const openingPlies = Math.max(0, Math.floor(options.openingPlies ?? 4));
  const safetyCap = Math.max(openingPlies, Math.floor(options.safetyCap ?? 400));
  const startFen = options.startFen;
  const games: MatchGameLog[] = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const openingSeed = deriveSeed(seed, pairIndex, 0x0f31a);
    const opening = generateOpening(startFen ?? INITIAL_FEN, openingPlies, openingSeed);
    for (let assignment = 0; assignment < 2; assignment++) {
      const gameIndex = pairIndex * 2 + assignment;
      games.push(runMatchGame(
        pairIndex,
        gameIndex,
        seed,
        openingSeed,
        opening,
        options.agentA,
        options.agentB,
        assignment === 0,
        safetyCap,
        startFen ?? INITIAL_FEN
      ));
    }
  }

  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let truncations = 0;
  let errors = 0;
  let totalPlies = 0;
  for (const game of games) {
    totalPlies += game.plies;
    if (game.outcome === 'A') winsA++;
    else if (game.outcome === 'B') winsB++;
    else if (game.outcome === 'draw') draws++;
    else if (game.outcome === 'truncated') truncations++;
    else errors++;
  }
  const resolvedGames = winsA + winsB + draws;
  const scoreA = winsA + draws / 2;
  return {
    kind: 'intransitive-paired-match-report',
    schemaVersion: 1,
    engineVersion: HARNESS_ENGINE_VERSION,
    seed,
    pairCount,
    gamesPlayed: games.length,
    resolvedGames,
    winsA,
    winsB,
    draws,
    truncations,
    errors,
    scoreA: roundMetric(scoreA),
    scoreAPerResolvedGame: resolvedGames > 0 ? roundMetric(scoreA / resolvedGames) : null,
    averagePlies: games.length > 0 ? Math.round(totalPlies / games.length) : 0,
    capHitRate: games.length > 0 ? roundMetric(truncations / games.length) : 0,
    games,
  };
}

export function stripGames(report: PairedMatchReport): Omit<PairedMatchReport, 'games'> {
  const { games: _games, ...compact } = report;
  return compact;
}
