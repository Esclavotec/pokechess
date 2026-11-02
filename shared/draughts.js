/**
 * Reglas de las damas clásicas en tablero de 8×8 (casillas oscuras).
 *
 * - Casillas con la notación del ajedrez ('a1'..'h8'); se juega en las oscuras (a1 es oscura).
 * - Blancas ('w') en las filas 1-3 y mueven primero; negras ('b') en las filas 6-8. 12 fichas cada uno.
 * - Las fichas avanzan una casilla en diagonal hacia delante y comen saltando hacia delante.
 * - Comer es obligatorio: si alguna ficha puede comer, hay que hacer una captura, y la
 *   cadena de saltos debe completarse hasta que no se pueda comer más.
 * - Al llegar a la última fila la ficha corona (dama: se mueve y come una casilla en
 *   cualquier diagonal). Si corona en mitad de una cadena, la jugada termina ahí.
 * - Gana quien deja al rival sin fichas o sin movimientos. Tablas tras QUIET_LIMIT
 *   jugadas seguidas sin capturas.
 *
 * Funciona en Node (require) y en el navegador (window.PokeDraughts).
 */
(function (root) {
  const FILES = 'abcdefgh';
  const QUIET_LIMIT = 80;
  const sq = (f, r) => (f >= 0 && f < 8 && r >= 1 && r <= 8 ? FILES[f] + r : null);
  const fr = (s) => [FILES.indexOf(s[0]), Number(s[1])];
  const isDark = (f, r) => (f + r) % 2 === 1;
  const other = (c) => (c === 'w' ? 'b' : 'w');
  const FORWARD = { w: 1, b: -1 };

  /** Partida nueva: { cells: { a1: { color, king, id } }, turn, quiet, plies }. */
  function create() {
    const cells = {};
    const ids = { w: 0, b: 0 };
    for (let r = 1; r <= 8; r++) {
      for (let f = 0; f < 8; f++) {
        if (!isDark(f, r)) continue;
        const color = r <= 3 ? 'w' : r >= 6 ? 'b' : null;
        if (color) cells[sq(f, r)] = { color, king: false, id: ids[color]++ };
      }
    }
    return { cells, turn: 'w', quiet: 0, plies: 0 };
  }

  const clone = (st) => ({ cells: Object.fromEntries(Object.entries(st.cells).map(([k, p]) => [k, { ...p }])), turn: st.turn, quiet: st.quiet, plies: st.plies });

  /** Direcciones (df, dr) en las que puede ir una pieza. */
  function dirsFor(p) {
    const fwd = FORWARD[p.color];
    return p.king ? [[1, 1], [-1, 1], [1, -1], [-1, -1]] : [[1, fwd], [-1, fwd]];
  }
  const lastRank = (c) => (c === 'w' ? 8 : 1);

  /** Cadenas de captura de una pieza (búsqueda en profundidad). */
  function captureChains(st, from) {
    const p = st.cells[from];
    const chains = [];
    const walk = (at, path, captured, king) => {
      const [f, r] = fr(at);
      let extended = false;
      for (const [df, dr] of dirsFor({ ...p, king })) {
        const over = sq(f + df, r + dr);
        const land = sq(f + 2 * df, r + 2 * dr);
        if (!over || !land) continue;
        const victim = st.cells[over];
        if (!victim || victim.color === p.color || captured.includes(over)) continue;
        if (st.cells[land] && land !== from) continue;
        extended = true;
        const crowned = !king && fr(land)[1] === lastRank(p.color);
        const nextPath = [...path, land];
        const nextCap = [...captured, over];
        if (crowned) chains.push({ from, to: land, path: nextPath, captured: nextCap, crown: true });
        else walk(land, nextPath, nextCap, king);
      }
      if (!extended && captured.length) chains.push({ from, to: at, path, captured, crown: false });
    };
    walk(from, [from], [], p.king);
    return chains;
  }

  /** Pasos simples de una pieza. */
  function steps(st, from) {
    const p = st.cells[from];
    const [f, r] = fr(from);
    const out = [];
    for (const [df, dr] of dirsFor(p)) {
      const to = sq(f + df, r + dr);
      if (to && !st.cells[to]) out.push({ from, to, path: [from, to], captured: [], crown: !p.king && fr(to)[1] === lastRank(p.color) });
    }
    return out;
  }

  /** Jugadas legales del bando: si hay capturas, solo capturas (comer es obligatorio). */
  function legalMoves(st, color = st.turn) {
    const mine = Object.keys(st.cells).filter((k) => st.cells[k].color === color);
    const caps = mine.flatMap((k) => captureChains(st, k));
    if (caps.length) return caps;
    return mine.flatMap((k) => steps(st, k));
  }

  /** Jugadas legales de una ficha concreta (respetando la captura obligatoria). */
  function movesFrom(st, from) {
    return legalMoves(st).filter((m) => m.from === from);
  }

  /**
   * Aplica una jugada. `path` (opcional) desempata si dos cadenas acaban en la misma casilla.
   * Devuelve la jugada aplicada o lanza Error. Modifica `st`.
   */
  function applyMove(st, color, from, to, path) {
    if (st.turn !== color) throw new Error('No es tu turno');
    const p = st.cells[from];
    if (!p || p.color !== color) throw new Error('Esa ficha no es tuya');
    const options = legalMoves(st, color).filter((m) => m.from === from && m.to === to);
    if (!options.length) {
      const mustCapture = legalMoves(st, color).some((m) => m.captured.length);
      throw new Error(mustCapture ? 'Comer es obligatorio' : 'Jugada ilegal');
    }
    const m = (path && options.find((o) => o.path.join() === path.join())) || options[0];
    delete st.cells[from];
    for (const c of m.captured) delete st.cells[c];
    st.cells[to] = { ...p, king: p.king || m.crown };
    st.turn = other(color);
    st.quiet = m.captured.length ? 0 : st.quiet + 1;
    st.plies++;
    return { ...m, id: p.id, wasKing: p.king };
  }

  /** Resultado tras una jugada: { winner, reason } o null si sigue. */
  function outcome(st) {
    const toMove = st.turn;
    if (!Object.values(st.cells).some((p) => p.color === toMove)) return { winner: other(toMove), reason: 'wipeout' };
    if (!legalMoves(st, toMove).length) return { winner: other(toMove), reason: 'blocked' };
    if (st.quiet >= QUIET_LIMIT) return { winner: null, reason: 'quiet' };
    return null;
  }

  const count = (st, color) => Object.values(st.cells).filter((p) => p.color === color).length;

  const api = { QUIET_LIMIT, create, clone, legalMoves, movesFrom, applyMove, outcome, count, isDark, fr, sq };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeDraughts = api;
})(typeof window !== 'undefined' ? window : globalThis);
