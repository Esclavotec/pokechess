// Pruebas de las damas clásicas: reglas, coronación, bot y sala
const test = require('node:test');
const assert = require('node:assert');
const D = require('../shared/draughts');
const Bot = require('../server/draughtsBot');
const Gens = require('../shared/generations');
const { RoomManager } = require('../server/rooms');

const man = (color, id = 0) => ({ color, king: false, id });
const king = (color, id = 0) => ({ color, king: true, id });

test('posición inicial: 12 fichas por bando en casillas oscuras, blancas empiezan', () => {
  const st = D.create();
  assert.strictEqual(D.count(st, 'w'), 12);
  assert.strictEqual(D.count(st, 'b'), 12);
  for (const k of Object.keys(st.cells)) assert.ok(D.isDark(...D.fr(k)), `${k} debe ser oscura`);
  assert.strictEqual(st.turn, 'w');
  assert.strictEqual(D.legalMoves(st).length, 7);
});

test('las fichas solo avanzan en diagonal hacia delante', () => {
  const st = { cells: { d4: man('w') }, turn: 'w', quiet: 0, plies: 0 };
  assert.deepStrictEqual(D.legalMoves(st).map((m) => m.to).sort(), ['c5', 'e5']);
  const sb = { cells: { d4: man('b') }, turn: 'b', quiet: 0, plies: 0 };
  assert.deepStrictEqual(D.legalMoves(sb).map((m) => m.to).sort(), ['c3', 'e3']);
});

test('comer es obligatorio', () => {
  const st = { cells: { c3: man('w', 0), d4: man('b', 0), g3: man('w', 1) }, turn: 'w', quiet: 0, plies: 0 };
  const moves = D.legalMoves(st);
  assert.ok(moves.every((m) => m.captured.length), 'solo capturas');
  assert.deepStrictEqual(moves.map((m) => m.to), ['e5']);
  assert.throws(() => D.applyMove(D.clone(st), 'w', 'g3', 'h4'), /obligatorio/);
});

test('capturas encadenadas en una sola jugada', () => {
  const st = { cells: { a1: man('w'), b2: man('b', 0), d4: man('b', 1), h8: man('b', 2) }, turn: 'w', quiet: 0, plies: 0 };
  const m = D.applyMove(st, 'w', 'a1', 'e5');
  assert.deepStrictEqual(m.path, ['a1', 'c3', 'e5']);
  assert.deepStrictEqual(m.captured, ['b2', 'd4']);
  assert.strictEqual(D.count(st, 'b'), 1);
});

test('coronación: la ficha que llega al fondo es dama y se mueve hacia atrás', () => {
  const st = { cells: { c7: man('w'), a1: man('b') }, turn: 'w', quiet: 0, plies: 0 };
  const m = D.applyMove(st, 'w', 'c7', 'd8');
  assert.ok(m.crown);
  assert.ok(st.cells.d8.king);
  st.turn = 'w';
  assert.deepStrictEqual(D.movesFrom(st, 'd8').map((x) => x.to).sort(), ['c7', 'e7']);
});

test('la dama come hacia atrás y gana quien deja al rival sin fichas', () => {
  const st = { cells: { e5: king('w'), d4: man('b') }, turn: 'w', quiet: 0, plies: 0 };
  D.applyMove(st, 'w', 'e5', 'c3');
  assert.deepStrictEqual(D.outcome(st), { winner: 'w', reason: 'wipeout' });
});

test('gana quien deja al rival sin movimientos', () => {
  // La ficha negra de a1... está bloqueada: blancas en b2 y la casilla c3 ocupada
  const st = { cells: { h8: man('b'), g7: man('w', 0), f6: man('w', 1) }, turn: 'b', quiet: 0, plies: 0 };
  assert.deepStrictEqual(D.outcome(st), { winner: 'w', reason: 'blocked' });
});

test('el bot de damas juega legal y termina partidas', () => {
  for (const [w, b] of [['normal', 'easy'], ['easy', 'hard']]) {
    const st = D.create();
    let res = null;
    while (!res && st.plies < 300) {
      const m = Bot.chooseMove(st, st.turn === 'w' ? w : b, { timeMs: 300 });
      assert.doesNotThrow(() => D.applyMove(st, st.turn, m.from, m.to, m.path));
      res = D.outcome(st);
    }
    assert.ok(res, `${w} contra ${b} debería terminar`);
  }
});

test('el bot elige la captura doble antes que la sencilla', () => {
  const st = { cells: { a1: man('w', 0), b2: man('b', 0), d4: man('b', 1), g3: man('w', 1), h4: man('b', 2) }, turn: 'w', quiet: 0, plies: 0 };
  // g3 puede comer h4? no (h4 está en el borde). a1 come dos.
  const m = Bot.chooseMove(st, 'hard');
  assert.strictEqual(m.from, 'a1');
  assert.strictEqual(m.to, 'e5');
});

test('sala de damas: piezas por generación, movimiento con cadena y fin', () => {
  for (const gen of [1, 2, 3]) assert.ok(Gens.GENERATIONS[gen].draughts.man && Gens.GENERATIONS[gen].draughts.king);
  assert.deepStrictEqual([Gens.GENERATIONS[1].draughts.man.name, Gens.GENERATIONS[1].draughts.king.name], ['Magikarp', 'Gyarados']);
  const m = new RoomManager();
  const { room, token } = m.createBot(3, 'Ash', 'normal', 'draughts');
  room.setReady(token, true);
  assert.strictEqual(room.game, 'draughts');
  const mv = room.move(token, { from: 'c3', to: 'd4' });
  assert.deepStrictEqual(mv.path, ['c3', 'd4']);
  assert.match(room.sanHistory[0], /^Bagon c3-d4$/);
  assert.ok(room.botToMove());
  const s = room.publicState(token);
  assert.strictEqual(s.dr.count.w, 12);
  assert.strictEqual(s.turn, 'b');
});
