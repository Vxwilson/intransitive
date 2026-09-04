/**
 * FEN validation and helper utilities.
 */

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function isValidFEN(fen: string): { valid: boolean; error?: string } {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) {
    return { valid: false, error: 'A valid FEN must contain at least 4 chunks' };
  }

  const [ranks, active, castling, ep] = parts;

  // Check board ranks
  const rankList = ranks.split('/');
  if (rankList.length !== 8) {
    return { valid: false, error: 'FEN must contain 8 ranks separated by /' };
  }

  for (const r of rankList) {
    let count = 0;
    for (const ch of r) {
      if (ch >= '1' && ch <= '8') {
        count += parseInt(ch, 10);
      } else if ('pnbrqkPNBRQK'.includes(ch)) {
        count += 1;
      } else {
        return { valid: false, error: `Invalid character '${ch}' in board placement` };
      }
    }
    if (count !== 8) {
      return { valid: false, error: `Rank does not sum to 8 squares: ${r}` };
    }
  }

  // Active color
  if (active !== 'w' && active !== 'b') {
    return { valid: false, error: "Active player must be 'w' or 'b'" };
  }

  // Castling
  if (!/^(-|[KQkq]{1,4})$/.test(castling)) {
    return { valid: false, error: 'Invalid castling flags' };
  }

  // En passant
  if (ep !== '-' && !/^[a-h][36]$/.test(ep)) {
    return { valid: false, error: 'Invalid en passant target square' };
  }

  return { valid: true };
}
