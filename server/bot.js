/**
 * Cerebro del bot de PokéChess.
 *
 * - Fácil:   jugada casi al azar, pero si puede comer algo, come lo más valioso
 *            (y si tiene mate en 1, lo da).
 * - Normal:  minimax con poda alfa-beta a 2 jugadas, con un poco de variedad.
 * - Difícil: profundización iterativa hasta 4 jugadas con límite de tiempo.
 *
 * Modo atento: si el rival dejó su rey en peligro, cualquier nivel se lo come.
 * El bot nunca deja el suyo (busca solo entre sus jugadas legales); si no le
 * queda ninguna, mueve lo que pueda.
 *
 * La evaluación suma el material y una tabla de "buenas casillas" por pieza
 * (tablas simplificadas clásicas). Las capturas se exploran primero
 * (víctima más valiosa / atacante menos valioso) para podar más.
 *
 * Rendimiento: dentro de la búsqueda se usan los métodos internos de chess.js
 * (_moves, _makeMove, _undoMove y el tablero 0x88 _board), que son mucho más
 * rápidos que la API pública porque no recalculan la notación ni revalidan.
 * Por eso package.json fija la versión exacta chess.js 1.0.0.
 */
const { Chess } = require('chess.js');

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
const MATE = 100000;

// Tablas de casilla desde el punto de vista de las blancas (fila 8 arriba)
const PST = {
  p: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0],
  n: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50],
  b: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20],
  r: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0],
  q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20],
  k: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20],
};

const LEVELS = {
  easy: { name: 'Fácil' },
  normal: { name: 'Normal', depth: 2, timeMs: 1500, slack: 15 },
  hard: { name: 'Difícil', depth: 4, timeMs: 2500, slack: 0 },
};

/** Puntuación de la posición desde el punto de vista de las blancas (tablero 0x88). */
function evaluate(chess) {
  let score = 0;
  const board = chess._board;
  for (let i = 0; i < 128; i++) {
    if (i & 0x88) { i += 7; continue; } // salta las casillas fuera del tablero 0x88
    const p = board[i];
    if (!p) continue;
    const r = i >> 4;      // 0 = fila 8
    const c = i & 15;
    const idx = p.color === 'w' ? r * 8 + c : (7 - r) * 8 + c; // las negras se miran en espejo
    const v = VALUE[p.type] + PST[p.type][idx];
    score += p.color === 'w' ? v : -v;
  }
  return score;
}

/** Ordena primero coronaciones y capturas (víctima valiosa, atacante barato). */
function orderMoves(moves) {
  const key = (m) => (m.captured ? 10 * VALUE[m.captured] - VALUE[m.piece] + 1000 : 0) + (m.promotion ? 800 : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

/** Casilla 0x88 -> 'e4'. */
const square = (i) => 'abcdefgh'[i & 15] + (8 - (i >> 4));

class Timeout extends Error {}

/**
 * Negamax con poda alfa-beta. Devuelve la puntuación para el bando que mueve.
 * `ply` sirve para preferir los mates más cortos.
 */
function search(chess, depth, alpha, beta, ply, deadline) {
  if (Date.now() > deadline) throw new Timeout();
  const moves = chess._moves({ legal: true });
  if (moves.length === 0) return chess.inCheck() ? -MATE + ply : 0; // mate o ahogado
  if (depth === 0) {
    const s = evaluate(chess);
    return chess.turn() === 'w' ? s : -s;
  }
  for (const m of orderMoves(moves)) {
    chess._makeMove(m);
    const score = -search(chess, depth - 1, -beta, -alpha, ply + 1, deadline);
    chess._undoMove();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/** Puntúa todas las jugadas de la raíz a una profundidad dada. */
function scoreRoot(chess, moves, depth, deadline) {
  return moves.map((m) => {
    chess._makeMove(m);
    const score = -search(chess, depth - 1, -Infinity, Infinity, 1, deadline);
    chess._undoMove();
    return { m, score };
  });
}

const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const toMove = (m) => ({ from: square(m.from), to: square(m.to), promotion: m.promotion });

/**
 * Elige la jugada del bot.
 * @param {string} fen      posición actual
 * @param {string} level    'easy' | 'normal' | 'hard'
 * @param {object} [opts]   { attentive, rand: () => number, timeMs }
 * @returns {{from, to, promotion}|null}
 */
function chooseMove(fen, level = 'normal', opts = {}) {
  const rand = opts.rand || Math.random;
  const chess = new Chess(fen);
  if (opts.attentive) {
    const pseudo = chess._moves({ legal: false });
    const kingCapture = pseudo.find((m) => m.captured === 'k');
    if (kingCapture) return toMove(kingCapture);
    if (!chess._moves({ legal: true }).length) return pseudo.length ? toMove(pick(pseudo, rand)) : null;
  }
  const moves = chess._moves({ legal: true });
  if (!moves.length) return null;

  // Un mate en 1 lo ve cualquier nivel
  for (const m of moves) {
    chess._makeMove(m);
    const mate = chess.isCheckmate();
    chess._undoMove();
    if (mate) return toMove(m);
  }

  if (level === 'easy') {
    const captures = moves.filter((m) => m.captured);
    if (captures.length && rand() < 0.8) {
      const best = Math.max(...captures.map((m) => VALUE[m.captured]));
      return toMove(pick(captures.filter((m) => VALUE[m.captured] === best), rand));
    }
    return toMove(pick(moves, rand));
  }

  const cfg = LEVELS[level] || LEVELS.normal;
  const deadline = Date.now() + (opts.timeMs || cfg.timeMs);
  let ordered = orderMoves(moves);
  let best = ordered.map((m) => ({ m, score: 0 }));
  // Profundización iterativa: si se acaba el tiempo nos quedamos con la última profundidad completa
  for (let d = 1; d <= cfg.depth; d++) {
    try {
      const scored = scoreRoot(chess, ordered, d, deadline);
      scored.sort((a, b) => b.score - a.score);
      best = scored;
      ordered = scored.map((s) => s.m); // la mejor jugada se explora primero en la siguiente vuelta
      if (best[0].score >= MATE - 100) break; // ya encontró un mate forzado
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  // Algo de variedad entre jugadas casi igual de buenas (solo en Normal)
  const top = best.filter((s) => s.score >= best[0].score - cfg.slack);
  return toMove(pick(top, rand).m);
}

module.exports = { chooseMove, evaluate, LEVELS };
