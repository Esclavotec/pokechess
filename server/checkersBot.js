/**
 * Bot de damas chinas.
 *
 * Evaluación (desde el punto de vista de `color`): cuánto le falta al rival menos
 * cuánto me falta a mí, medido como suma de distancias hexagonales de cada ficha
 * al vértice de su meta, con un castigo extra para la ficha más atrasada (para no
 * dejar "rezagadas") y un premio por cada ficha ya dentro de la meta.
 *
 * - Fácil:   elige al azar entre las 5 jugadas que más avanzan.
 * - Normal:  la jugada que deja mejor evaluación (con algo de variedad).
 * - Difícil: mira también la mejor respuesta del rival (2 jugadas), sobre las
 *            12 jugadas más prometedoras de cada lado.
 */
const C = require('../shared/checkers');

const other = (c) => (c === 'w' ? 'b' : 'w');
const goalSet = { w: new Set(C.GOAL.w), b: new Set(C.GOAL.b) };

/** Lo que le falta a `color` para terminar (cuanto menor, mejor). */
function remaining(st, color) {
  let sum = 0;
  let worst = 0;
  let inside = 0;
  for (const [k, p] of Object.entries(st.cells)) {
    if (p.color !== color) continue;
    const d = C.hexDist(C.parse(k), C.TIP[color]);
    sum += d;
    if (d > worst) worst = d;
    if (goalSet[color].has(k)) inside++;
  }
  return sum + worst * 1.5 - inside * 2;
}

function evaluate(st, color) {
  if (C.hasWon(st, color)) return 1e6;
  if (C.hasWon(st, other(color))) return -1e6;
  return remaining(st, other(color)) - remaining(st, color);
}

/** Avance de una jugada: cuánto se acerca la ficha a su meta. */
function gain(m, color) {
  return C.hexDist(C.parse(m.from), C.TIP[color]) - C.hexDist(C.parse(m.to), C.TIP[color]);
}

function after(st, m) {
  const s = C.clone(st);
  C.applyMove(s, s.turn, m.from, m.to);
  return s;
}

/**
 * Elige la jugada del bot.
 * @param {object} st      estado de la partida (shared/checkers.js)
 * @param {string} level   'easy' | 'normal' | 'hard'
 * @param {object} [opts]  { rand }
 * @returns {{from, to}|null}
 */
function chooseMove(st, level = 'normal', opts = {}) {
  const rand = opts.rand || Math.random;
  const color = st.turn;
  const moves = C.allMoves(st, color);
  if (!moves.length) return null;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // Si una jugada gana ya, se juega en cualquier nivel
  for (const m of moves) if (C.hasWon(after(st, m), color)) return { from: m.from, to: m.to };

  if (level === 'easy') {
    const sorted = [...moves].sort((a, b) => gain(b, color) - gain(a, color));
    const m = pick(sorted.slice(0, 5));
    return { from: m.from, to: m.to };
  }

  // Normal: mejor evaluación tras mi jugada
  const scored = moves.map((m) => ({ m, s: evaluate(after(st, m), color) })).sort((a, b) => b.s - a.s);
  if (level !== 'hard') {
    const top = scored.filter((x) => x.s >= scored[0].s - 0.5);
    const m = pick(top).m;
    return { from: m.from, to: m.to };
  }

  // Difícil: mi jugada y la mejor respuesta del rival
  let best = null;
  for (const { m } of scored.slice(0, 12)) {
    const s1 = after(st, m);
    if (C.hasWon(s1, color)) return { from: m.from, to: m.to };
    const replies = C.allMoves(s1, other(color))
      .sort((a, b) => gain(b, other(color)) - gain(a, other(color)))
      .slice(0, 12);
    let worst = Infinity;
    for (const r of replies) worst = Math.min(worst, evaluate(after(s1, r), color));
    if (!replies.length) worst = evaluate(s1, color);
    if (!best || worst > best.s) best = { m, s: worst };
  }
  return { from: best.m.from, to: best.m.to };
}

module.exports = { chooseMove, evaluate };
