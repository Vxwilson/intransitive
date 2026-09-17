import { createSearchContext, getTopMoves, selectMove } from '../engine/search';
import { PLAYER_BLUE, PLAYER_RED } from '../core/types';
import type { Move } from '../core/types';
import { IntransitiveGame } from '../core/game';
import { INITIAL_INTRANSITIVE_FEN } from '../core/fen';
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
  MatchOpening,
  MatchMoveEvent,
  MatchGameLog,
  MatchOutcome,
  PairedMatchReport,
  SearchLimit,
  SearchRequest,
} from './types';

export const HARNESS_ENGINE_VERSION = 'package-2-search-v1';
export const MATCH_ENGINE_VERSION = 'match-correctness-v2';
export const DEFAULT_MATCH_START_FEN = INITIAL_INTRANSITIVE_FEN;
export const DEFAULT_MATCH_OPENING_PLIES = 4;
export const DEFAULT_MATCH_SAFETY_CAP = 400;

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
  const useGreedyRoot = request.rootMode !== 'full' && (request.count ?? 1) <= 1;
  if (useGreedyRoot) {
    const searchLimit = request.limit.kind === 'depth'
      ? { kind: 'depth' as const, depth: request.limit.value }
      : request.limit.kind === 'nodes'
        ? { kind: 'nodes' as const, nodes: request.limit.value }
        : { kind: 'time' as const, timeMs: request.limit.valueMs };
    const result = selectMove(game, weights, {
      limit: searchLimit,
      maxDepth: request.maxDepth,
      temperature: 0,
      rootNoise: 0,
      openingPlies: 0,
    });
    const best = result.bestMove;
    return {
      bestMove: best,
      score: result.score,
      completedDepth: result.completedDepth,
      nodes: result.nodes,
      elapsedMs: roundMetric(result.elapsedMs),
      stopReason: result.stopReason === 'aborted' ? 'fallback' : result.stopReason,
      scoreKind: result.scoreKind === 'bound' ? 'partial' : result.scoreKind,
      candidates: best
        ? [{
            move: best,
            rank: 1,
            score: result.score,
            san: game.formatMoveSAN(best),
            pv: result.pv.slice(1).map((move) => game.formatMoveSAN(move)),
          }]
        : [],
    };
  }

  // Full-window root scoring is retained for MultiPV and explicit
  // corrected-vs-optimized benchmark comparisons. Fixed-depth runs are exact;
  // this path remains deliberately simple and does not feed bounds to policy.
  if (request.limit.kind === 'nodes') {
    throw new Error('Full-window MultiPV harness searches require a fixed depth or time limit.');
  }
  const startedAt = performance.now();
  const maxDepth = Math.max(1, Math.floor(request.maxDepth ?? (request.limit.kind === 'depth' ? request.limit.value : 6)));
  const depthLimit = request.limit.kind === 'depth'
    ? Math.max(1, Math.floor(request.limit.value))
    : maxDepth;
  const context = createSearchContext();
  let lastCandidates = getTopMoves(game, weights, request.count ?? 1, 1, context);
  let completedDepth = 1;
  let stopReason: HarnessSearchResult['stopReason'] = request.limit.kind === 'depth' ? 'depth' : 'time-budget';

  if (request.limit.kind === 'depth') {
    lastCandidates = getTopMoves(game, weights, request.count ?? 1, depthLimit, context);
    completedDepth = depthLimit;
  } else if (request.limit.kind === 'time') {
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
  } else {
    throw new Error('Full-window MultiPV harness searches require a fixed depth or time limit.');
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
    scoreKind: request.limit.kind === 'depth' || stopReason === 'depth' ? 'exact' : 'partial',
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
  rootMode?: 'greedy' | 'full';
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
        rootMode: options.rootMode,
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
    ...(options.engine === 'production'
      ? { rootMode: options.rootMode ?? 'greedy' as const }
      : {}),
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

function hashText(value: string): string {
  // FNV-1a is small, deterministic, and sufficient for an audit label. The
  // opening moves themselves remain in the log; this is not a cryptographic ID.
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export interface MatchOpeningOptions {
  startFen?: string;
  openingPlies?: number;
  seed: number;
}

/** Create one deterministic random legal opening for a paired evaluation. */
export function createMatchOpening(options: MatchOpeningOptions): MatchOpening {
  const startFen = options.startFen ?? DEFAULT_MATCH_START_FEN;
  const requestedPlies = Math.max(0, Math.floor(options.openingPlies ?? DEFAULT_MATCH_OPENING_PLIES));
  const game = new IntransitiveGame(startFen);
  const rng = createSeededRng(options.seed);
  const opening: Move[] = [];
  for (let ply = 0; ply < requestedPlies; ply++) {
    if (game.isTerminal().isOver) break;
    const move = chooseRandomMove(game, rng);
    if (!move) break;
    opening.push(move);
    game.makeMove(move);
  }
  const serializedMoves = opening.map((move) => serializeMove(move));
  return {
    startFen,
    seed: options.seed >>> 0,
    requestedPlies,
    moves: serializedMoves,
    identity: hashText(JSON.stringify({ startFen, moves: serializedMoves })),
  };
}

/**
 * Derive the opening used by a pair. Both color assignments must call this
 * function with the same pair index so they receive the same move history.
 */
export function createPairedMatchOpening(
  seed: number,
  pairIndex: number,
  startFen: string = DEFAULT_MATCH_START_FEN,
  openingPlies: number = DEFAULT_MATCH_OPENING_PLIES
): MatchOpening {
  return createMatchOpening({
    startFen,
    openingPlies,
    seed: deriveSeed(seed, pairIndex, 0x0f31a),
  });
}

/** Replay an opening with full legality and history validation. */
export function replayMatchOpening(opening: MatchOpening): IntransitiveGame {
  const game = new IntransitiveGame(opening.startFen);
  for (const requestedMove of opening.moves) {
    const legalMove = game.generateLegalMoves().find((move) => sameMove(move, requestedMove));
    if (!legalMove || !game.makeMove(legalMove)) {
      throw new Error(`Invalid opening move ${JSON.stringify(requestedMove)} for ${opening.identity}`);
    }
  }
  return game;
}

function outcomeForStatus(game: IntransitiveGame, aIsBlue: boolean): MatchOutcome | null {
  const status = game.isTerminal();
  if (!status.isOver) return null;
  if (status.winner === 'draw') return 'draw';
  if (status.winner === PLAYER_BLUE) return aIsBlue ? 'A' : 'B';
  if (status.winner === PLAYER_RED) return aIsBlue ? 'B' : 'A';
  return null;
}

export interface MatchGameOptions {
  pairIndex: number;
  gameIndex: number;
  totalGames: number;
  seed: number;
  opening: MatchOpening;
  agentA: MatchAgent;
  agentB: MatchAgent;
  aIsBlue: boolean;
  safetyCap: number;
  shouldCancel?: () => boolean;
  onMove?: (event: MatchMoveEvent) => void;
}

export function runMatchGame(options: MatchGameOptions): MatchGameLog {
  const {
    pairIndex,
    gameIndex,
    totalGames,
    seed,
    opening,
    agentA,
    agentB,
    aIsBlue,
    safetyCap,
    shouldCancel,
    onMove,
  } = options;
  const startedAt = performance.now();
  if (safetyCap < opening.moves.length) {
    throw new Error(`Safety cap ${safetyCap} is below opening length ${opening.moves.length}`);
  }
  const game = new IntransitiveGame(opening.startFen);
  const rng = createSeededRng(deriveSeed(seed, pairIndex, gameIndex, 0x51f15e));
  const moves: LoggedMove[] = [];

  try {
    // Replay the opening on the match game, retaining the repetition map. The
    // opening was generated once per pair and is intentionally not searched.
    for (const openingMove of opening.moves) {
      const loggedMove = makeLoggedMove(game, openingMove, 'opening', moves.length + 1);
      moves.push(loggedMove);
      onMove?.({
        pairIndex,
        gameIndex,
        totalGames,
        aIsBlue,
        opening,
        move: loggedMove,
        isOver: game.isTerminal().isOver,
      });
    }

    if (shouldCancel?.()) {
      return makeMatchLog(options, moves, 'cancelled', 'cancelled', startedAt, false);
    }

    while (moves.length < safetyCap) {
      const existingOutcome = outcomeForStatus(game, aIsBlue);
      if (existingOutcome) {
        return makeMatchLog(options, moves, existingOutcome, game.isTerminal().reason, startedAt, false);
      }
      if (shouldCancel?.()) {
        return makeMatchLog(options, moves, 'cancelled', 'cancelled', startedAt, false);
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
        return makeMatchLog(options, moves, 'error', 'no-legal-move', startedAt, false);
      }
      const legalMove = game.generateLegalMoves().find((candidate) => sameMove(candidate, move));
      if (!legalMove) {
        return makeMatchLog(options, moves, 'error', 'illegal-engine-move', startedAt, false);
      }
      const elapsed = result?.elapsedMs ?? roundMetric(performance.now() - moveStart);
      const loggedMove = makeLoggedMove(game, legalMove, source, moves.length + 1, elapsed, result?.nodes, result?.completedDepth);
      moves.push(loggedMove);
      onMove?.({
        pairIndex,
        gameIndex,
        totalGames,
        aIsBlue,
        opening,
        move: loggedMove,
        isOver: game.isTerminal().isOver,
      });
    }

    const outcome = outcomeForStatus(game, aIsBlue);
    return makeMatchLog(options, moves, outcome ?? 'truncated', outcome ? game.isTerminal().reason : 'safety-cap', startedAt, !outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return makeMatchLog(options, moves, 'error', message, startedAt, false);
  }
}

function makeMatchLog(
  options: MatchGameOptions,
  moves: LoggedMove[],
  outcome: MatchOutcome,
  reason: string | null,
  startedAt: number,
  capHit: boolean
): MatchGameLog {
  const historyMoves = moves.map((loggedMove) => ({ ...loggedMove.move }));
  const gameHash = hashText(JSON.stringify({
    startFen: options.opening.startFen,
    moves: historyMoves,
    outcome,
    reason,
  }));
  return {
    kind: 'intransitive-match-game',
    schemaVersion: 2,
    engineVersion: MATCH_ENGINE_VERSION,
    pairIndex: options.pairIndex,
    gameIndex: options.gameIndex,
    seed: options.seed,
    openingSeed: options.opening.seed,
    openingPlies: options.opening.moves.length,
    startFen: options.opening.startFen,
    opening: options.opening,
    history: {
      startFen: options.opening.startFen,
      moves: historyMoves,
    },
    gameHash,
    aIsBlue: options.aIsBlue,
    modelIds: {
      blue: options.aIsBlue ? options.agentA.modelId : options.agentB.modelId,
      red: options.aIsBlue ? options.agentB.modelId : options.agentA.modelId,
    },
    limits: {
      blue: (options.aIsBlue ? options.agentA : options.agentB).kind === 'random' ? 'random' : (options.aIsBlue ? options.agentA : options.agentB).search!.limit,
      red: (!options.aIsBlue ? options.agentA : options.agentB).kind === 'random' ? 'random' : (!options.aIsBlue ? options.agentA : options.agentB).search!.limit,
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
  /** Exact total game count. It must be even so every opening has both colors. */
  totalGames?: number;
  pairCount?: number;
  seed?: number;
  openingPlies?: number;
  safetyCap?: number;
  startFen?: string;
  shouldCancel?: () => boolean;
  onMove?: (event: MatchMoveEvent) => void;
  onGame?: (game: MatchGameLog) => void;
}

export interface PairedMatchSummaryOptions {
  requestedGames: number;
  pairCount: number;
  seed: number;
  openingPlies: number;
  safetyCap: number;
}

export function summarizePairedMatchGames(
  games: MatchGameLog[],
  options: PairedMatchSummaryOptions
): PairedMatchReport {
  let winsA = 0;
  let winsB = 0;
  let draws = 0;
  let truncations = 0;
  let cancelledGames = 0;
  let errors = 0;
  let totalPlies = 0;
  const openingIdentities = new Set<string>();
  const observedPairs = new Set<number>();
  for (const game of games) {
    totalPlies += game.plies;
    openingIdentities.add(game.opening.identity);
    observedPairs.add(game.pairIndex);
    if (game.outcome === 'A') winsA++;
    else if (game.outcome === 'B') winsB++;
    else if (game.outcome === 'draw') draws++;
    else if (game.outcome === 'truncated') truncations++;
    else if (game.outcome === 'cancelled') cancelledGames++;
    else errors++;
  }
  const resolvedGames = winsA + winsB + draws;
  const scoreA = winsA + draws / 2;
  return {
    kind: 'intransitive-paired-match-report',
    schemaVersion: 2,
    engineVersion: MATCH_ENGINE_VERSION,
    seed: options.seed,
    pairCount: options.pairCount,
    requestedGames: options.requestedGames,
    openingPlies: options.openingPlies,
    safetyCap: options.safetyCap,
    uniqueOpeningCount: openingIdentities.size,
    duplicateOpeningCount: Math.max(0, observedPairs.size - openingIdentities.size),
    gamesPlayed: games.length,
    resolvedGames,
    winsA,
    winsB,
    draws,
    truncations,
    cancelledGames,
    errors,
    scoreA: roundMetric(scoreA),
    scoreAPerResolvedGame: resolvedGames > 0 ? roundMetric(scoreA / resolvedGames) : null,
    averagePlies: games.length > 0 ? Math.round(totalPlies / games.length) : 0,
    capHitRate: games.length > 0 ? roundMetric(truncations / games.length) : 0,
    games,
  };
}

export function runPairedMatch(options: PairedMatchOptions): PairedMatchReport {
  const rawRequestedGames = options.totalGames !== undefined
    ? options.totalGames
    : (options.pairCount ?? 1) * 2;
  if (!Number.isInteger(rawRequestedGames) || rawRequestedGames < 2 || rawRequestedGames % 2 !== 0) {
    throw new Error(`Paired matches require an even integer total game count of at least 2; received ${rawRequestedGames}`);
  }
  const requestedGames = rawRequestedGames;
  const pairCount = requestedGames / 2;
  const seed = options.seed ?? 1;
  const openingPlies = Math.max(0, Math.floor(options.openingPlies ?? DEFAULT_MATCH_OPENING_PLIES));
  const safetyCap = Math.max(openingPlies, Math.floor(options.safetyCap ?? DEFAULT_MATCH_SAFETY_CAP));
  const startFen = options.startFen ?? DEFAULT_MATCH_START_FEN;
  const games: MatchGameLog[] = [];

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const opening = createPairedMatchOpening(seed, pairIndex, startFen, openingPlies);
    for (let assignment = 0; assignment < 2; assignment++) {
      if (options.shouldCancel?.()) break;
      const gameIndex = pairIndex * 2 + assignment;
      const game = runMatchGame({
        pairIndex,
        gameIndex,
        totalGames: requestedGames,
        seed,
        opening,
        agentA: options.agentA,
        agentB: options.agentB,
        aIsBlue: assignment === 0,
        safetyCap,
        shouldCancel: options.shouldCancel,
        onMove: options.onMove,
      });
      games.push(game);
      options.onGame?.(game);
      if (game.outcome === 'cancelled') break;
    }
    if (options.shouldCancel?.()) break;
  }

  return summarizePairedMatchGames(games, {
    requestedGames,
    pairCount,
    seed,
    openingPlies,
    safetyCap,
  });
}

export function stripGames(report: PairedMatchReport): Omit<PairedMatchReport, 'games'> {
  const { games: _games, ...compact } = report;
  return compact;
}
