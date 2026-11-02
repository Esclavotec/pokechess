/**
 * Bot de damas clásicas.
 *
 * Evaluación (para el bando que mueve): fichas 100, damas 170, más un premio por
 * avanzar (las fichas cerca de coronar valen más), por ocupar el centro y por
 * guardar la última fila propia (dificulta que el rival corone).
 *
 * - Fácil:   jugada legal al azar (las capturas son obligatorias por regla).
 * - Normal:  negamax con poda alfa-beta a 4 jugadas, con algo de variedad.
 * - Difícil: profundización iterativa hasta 8 jugadas con límite de tiempo.
 */
const D = require('../shared/draughts');

const LEVELS = {
  easy: {},
  normal: { depth: 4, timeMs: 1200, slack: 8 },
  hard: { depth: 8, timeMs: 2200, slack: 0 },
};
const WIN = 100000;

function evaluate(st, color) {
  let score = 0;
  for (const [k, p] of Object.entries(st.cells)) {
    const [f, r] = D.fr(k);
    let v = p.king ? 170 : 100;
    if (!p.king) {
      const advance = p.color === 'w' ? r - 1 : 8 - r; // 0..7
      v += advance * 5;
      if ((p.color === 'w' && r === 1) || (p.color === 'b' && r === 8)) v += 8; // guarda la última fila
    }
    if (f >= 2 && f <= 5 && r >= 3 && r <= 6) v += 6; // centro
    score += p.color === color ? v : -v;
  }
  return score;
}

class Timeout extends Error {}

function search(st, depth, alpha, beta, ply, deadline) {
  if (Date.now() > deadline) throw new Timeout();
  const moves = D.legalMoves(st);
  if (!moves.length) return -WIN + ply; // sin jugadas (o sin fichas): pierde quien mueve
  if (depth <= 0 && !moves[0].captured.length) return evaluate(st, st.turn);
  // Con capturas pendientes se sigue buscando (evita cortar a mitad de un intercambio)
  if (depth <= -4) return evaluate(st, st.turn);
  for (const m of moves) {
    const s = D.clone(st);
    D.applyMove(s, s.turn, m.from, m.to, m.path);
    const score = -search(s, depth - 1, -beta, -alpha, ply + 1, deadline);
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/**
 * Elige la jugada del bot: { from, to, path } o null.
 * @param {object} st     estado (shared/draughts.js)
 * @param {string} level  'easy' | 'normal' | 'hard'
 * @param {object} [opts] { rand, timeMs }
 */
function chooseMove(st, level = 'normal', opts = {}) {
  const rand = opts.rand || Math.random;
  const moves = D.legalMoves(st);
  if (!moves.length) return null;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const out = (m) => ({ from: m.from, to: m.to, path: m.path });
  if (level === 'easy' || moves.length === 1) return out(pick(moves));

  const cfg = LEVELS[level] || LEVELS.normal;
  const deadline = Date.now() + (opts.timeMs || cfg.timeMs);
  let best = moves.map((m) => ({ m, score: 0 }));
  for (let d = 1; d <= cfg.depth; d++) {
    try {
      const scored = best.map(({ m }) => {
        const s = D.clone(st);
        D.applyMove(s, s.turn, m.from, m.to, m.path);
        return { m, score: -search(s, d - 1, -Infinity, Infinity, 1, deadline) };
      });
      scored.sort((a, b) => b.score - a.score);
      best = scored;
      if (best[0].score >= WIN - 100) break;
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
  }
  const top = best.filter((x) => x.score >= best[0].score - cfg.slack);
  return out(pick(top).m);
}

module.exports = { chooseMove, evaluate, LEVELS };
