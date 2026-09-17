import rawFixtures from './fixtures.json';
import { IntransitiveGame } from '../core/game';
import type { Move } from '../core/types';
import type { FixtureMove, IntransitiveFixture } from './types';

export const INTRANSITIVE_FIXTURES = rawFixtures as IntransitiveFixture[];

function sameMove(a: Move, b: FixtureMove): boolean {
  return a.from === b.from && a.to === b.to && a.piece === b.piece && a.captured === b.captured;
}

/**
 * Loads a fixture and replays its optional history so repetition counts are
 * represented instead of being inferred from the final FEN.
 */
export function loadFixture(fixture: IntransitiveFixture): IntransitiveGame {
  const game = new IntransitiveGame(fixture.startFen ?? fixture.fen);
  for (const expectedMove of fixture.history ?? []) {
    const legalMove = game.generateLegalMoves().find((move) => sameMove(move, expectedMove));
    if (!legalMove) {
      throw new Error(`Fixture ${fixture.id} contains an illegal history move: ${JSON.stringify(expectedMove)}`);
    }
    game.makeMove(legalMove);
  }

  if (game.toFEN() !== fixture.fen) {
    throw new Error(`Fixture ${fixture.id} replay mismatch: expected ${fixture.fen}, got ${game.toFEN()}`);
  }
  return game;
}

export function fixtureMoveToMove(move: FixtureMove): Move {
  return { ...move };
}

export function serializeMove(move: Move): FixtureMove {
  return { ...move };
}
