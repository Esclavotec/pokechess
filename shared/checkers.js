/**
 * Reglas de las damas chinas para 2 jugadores (tablero de estrella de 121 huecos).
 *
 * Coordenadas axiales hexagonales (q, r) con s = -q - r. La estrella es la unión
 * de dos triángulos: todas las coordenadas ≤ 4, o todas ≥ -4 (91 + 91 - 61 = 121).
 * Las casillas se identifican con la cadena "q,r".
 *
 * - Blancas ('w') empiezan en la punta de abajo (r ≥ 5) y van a la de arriba (r ≤ -5).
 * - Negras ('b') al revés. Cada bando tiene 10 fichas (id 0..9 = Pokémon de su generación).
 * - Un turno: avanzar a un hueco vecino, o saltar por encima de una ficha (de quien
 *   sea) a un hueco libre justo detrás, encadenando todos los saltos que se quiera.
 * - Gana quien llena la punta contraria con al menos una ficha propia dentro
 *   (así un rival no puede bloquear dejando fichas en tu meta para siempre).
 * - Tablas al llegar a MAX_MOVES jugadas.
 *
 * Funciona en Node (require) y en el navegador (window.PokeCheckers).
 */
(function (root) {
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
  const MAX_MOVES = 200;
  const key = (q, r) => `${q},${r}`;
  const parse = (k) => k.split(',').map(Number);

  function inStar(q, r) {
    const s = -q - r;
    return (q <= 4 && r <= 4 && s <= 4 && q >= -8 && r >= -8 && s >= -8) || (q >= -4 && r >= -4 && s >= -4 && q <= 8 && r <= 8 && s <= 8);
  }

  // Todas las casillas del tablero, ordenadas de arriba abajo y de izquierda a derecha
  const CELLS = [];
  for (let r = -8; r <= 8; r++) for (let q = -8; q <= 8; q++) if (inStar(q, r)) CELLS.push(key(q, r));
  const CELL_SET = new Set(CELLS);

  const HOME = {
    w: CELLS.filter((k) => parse(k)[1] >= 5),  // punta de abajo
    b: CELLS.filter((k) => parse(k)[1] <= -5), // punta de arriba
  };
  const GOAL = { w: HOME.b, b: HOME.w };
  const GOAL_SET = { w: new Set(GOAL.w), b: new Set(GOAL.b) };
  const TIP = { w: [4, -8], b: [-4, 8] }; // vértice de la meta de cada bando

  function hexDist([q1, r1], [q2, r2]) {
    return (Math.abs(q1 - q2) + Math.abs(r1 - r2) + Math.abs(q1 + r1 - q2 - r2)) / 2;
  }

  /** Partida nueva: { cells: { "q,r": { color, id } }, turn, moves }. */
  function create() {
    const cells = {};
    for (const c of ['w', 'b']) {
      // id 0 en el vértice; así la ficha 0 es la "líder" del grupo
      const ordered = [...HOME[c]].sort((a, b) => hexDist(parse(a), c === 'w' ? [-4, 8] : [4, -8]) - hexDist(parse(b), c === 'w' ? [-4, 8] : [4, -8]));
      ordered.forEach((k, id) => { cells[k] = { color: c, id }; });
    }
    return { cells, turn: 'w', moves: 0 };
  }

  const clone = (st) => ({ cells: { ...st.cells }, turn: st.turn, moves: st.moves });

  /**
   * Destinos de una ficha: Map destino -> camino (lista de casillas desde el origen).
   * Los pasos simples solo valen como primer y único movimiento; los saltos se encadenan.
   */
  function destinations(st, from) {
    const out = new Map();
    const [q0, r0] = parse(from);
    for (const [dq, dr] of DIRS) {
      const k = key(q0 + dq, r0 + dr);
      if (CELL_SET.has(k) && !st.cells[k]) out.set(k, [from, k]);
    }
    // Saltos encadenados (búsqueda en anchura; la ficha que se mueve deja su hueco libre)
    const seen = new Set([from]);
    const queue = [[from]];
    while (queue.length) {
      const path = queue.shift();
      const [q, r] = parse(path[path.length - 1]);
      for (const [dq, dr] of DIRS) {
        const over = key(q + dq, r + dr);
        const land = key(q + 2 * dq, r + 2 * dr);
        if (!CELL_SET.has(land) || seen.has(land)) continue;
        const overBusy = st.cells[over] && over !== from;
        const landFree = !st.cells[land] || land === from;
        if (!overBusy || !landFree) continue;
        seen.add(land);
        const next = [...path, land];
        if (land !== from) out.set(land, next);
        queue.push(next);
      }
    }
    return out;
  }

  /** Todas las jugadas del bando que mueve: [{ from, to, path }]. */
  function allMoves(st, color = st.turn) {
    const moves = [];
    for (const [k, p] of Object.entries(st.cells)) {
      if (p.color !== color) continue;
      for (const [to, path] of destinations(st, k)) moves.push({ from: k, to, path });
    }
    return moves;
  }

  /** ¿Ha ganado `color`? Meta llena y con al menos una ficha propia. */
  function hasWon(st, color) {
    let own = 0;
    for (const k of GOAL[color]) {
      const p = st.cells[k];
      if (!p) return false;
      if (p.color === color) own++;
    }
    return own > 0;
  }

  /**
   * Aplica una jugada (valida turno y destino). Devuelve { path, id, jumps } o lanza Error.
   * Modifica `st`.
   */
  function applyMove(st, color, from, to) {
    if (st.turn !== color) throw new Error('No es tu turno');
    const p = st.cells[from];
    if (!p || p.color !== color) throw new Error('Esa ficha no es tuya');
    const path = destinations(st, from).get(to);
    if (!path) throw new Error('Jugada ilegal');
    delete st.cells[from];
    st.cells[to] = p;
    st.turn = color === 'w' ? 'b' : 'w';
    st.moves++;
    const jumps = path.length === 2 && hexDist(parse(from), parse(to)) === 1 ? 0 : path.length - 1;
    return { path, id: p.id, jumps };
  }

  /** Fichas de `color` ya dentro de su meta. */
  function inGoal(st, color) {
    return Object.entries(st.cells).filter(([k, p]) => p.color === color && GOAL_SET[color].has(k)).length;
  }

  /** Posición en pantalla (x, y) de una casilla, con x en [-6, 6] e y en [-6.93, 6.93]. */
  function toXY(k) {
    const [q, r] = parse(k);
    return { x: q + r / 2, y: (r * Math.sqrt(3)) / 2 };
  }

  const api = { CELLS, HOME, GOAL, TIP, MAX_MOVES, key, parse, hexDist, create, clone, destinations, allMoves, applyMove, hasWon, inGoal, toXY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeCheckers = api;
})(typeof window !== 'undefined' ? window : globalThis);
