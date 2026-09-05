/**
 * PGN Serializer Unit Tests
 */

import { generateGamePGN, generateTournamentPGN } from './pgn';

console.log('🧪 Starting Intransitive PGN Serialization Verification Suite...\n');

// 1. Basic Single Game PGN Generation
const game1 = generateGamePGN({
  event: 'Studio Exhibition Match',
  site: 'Intransitive Studio',
  white: 'Master (Trained)',
  black: 'Advanced (Trained)',
  result: '1-0',
  termination: 'Blue Won (touchdown)',
  moves: [
    { san: 'Pe2-f1' },
    { san: 'Se7-d6' },
    { san: 'Pf1-g2' },
    { san: 'Sd6-c5' },
    { san: 'Pg2-h3#' },
  ],
});

if (!game1.includes('[Event "Studio Exhibition Match"]')) {
  throw new Error('Event header missing');
}
if (!game1.includes('[White "Master (Trained)"]')) {
  throw new Error('White header missing');
}
if (!game1.includes('[Result "1-0"]')) {
  throw new Error('Result header missing');
}
if (!game1.includes('1. Pe2-f1 Se7-d6 2. Pf1-g2 Sd6-c5 3. Pg2-h3# 1-0')) {
  throw new Error(`Unexpected movetext in PGN:\n${game1}`);
}
console.log('✓ Basic single game PGN generation verified');

// 2. Custom FEN PGN Generation
const customFen = '9/9/9/9/4P4/9/9/9/9 b 0 10';
const game2 = generateGamePGN({
  fen: customFen,
  moves: [{ san: 'Pe5-e6' }],
  result: '*',
});

if (!game2.includes('[SetUp "1"]')) {
  throw new Error('SetUp header should be present for custom FEN');
}
if (!game2.includes(`[FEN "${customFen}"]`)) {
  throw new Error('Custom FEN missing from headers');
}
console.log('✓ Custom FEN setup tagging verified');

// 3. Multi-Game Tournament PGN Aggregation
const tournamentPGN = generateTournamentPGN({
  fighterAName: 'Master (Blue)',
  fighterBName: 'Novice (Red)',
  games: [
    {
      gameNumber: 1,
      fighterAIsBlue: true,
      result: '1-0',
      termination: 'Blue won by touchdown',
      moves: [{ san: 'Pe2-f3' }, { san: 'Se7-f6' }],
    },
    {
      gameNumber: 2,
      fighterAIsBlue: false,
      result: '0-1',
      termination: 'Red won by touchdown',
      moves: [{ san: 'Se2-f3' }, { san: 'Pe7-f6' }],
    },
  ],
});

const pgnCount = (tournamentPGN.match(/\[Event /g) || []).length;
if (pgnCount !== 2) {
  throw new Error(`Expected 2 games in tournament PGN, got ${pgnCount}`);
}
if (!tournamentPGN.includes('[Round "1"]') || !tournamentPGN.includes('[Round "2"]')) {
  throw new Error('Round numbering missing in tournament PGN');
}
console.log('✓ Multi-game tournament PGN aggregation verified');

console.log('\n🎉 ALL PGN SERIALIZATION TESTS PASSED WITH 100% ACCURACY!\n');
