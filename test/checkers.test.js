// Pruebas de las damas chinas (reglas, salas, bot) y de la Generación III
const test = require('node:test');
const assert = require('node:assert');
const C = require('../shared/checkers');
const Bot = require('../server/checkersBot');
const Gens = require('../shared/generations');
const { RoomManager } = require('../server/rooms');

test('el tablero de estrella tiene 121 huecos y 10 fichas por bando', () => {
  assert.strictEqual(C.CELLS.length, 121);
  const st = C.create();
  const own = (c) => Object.values(st.cells).filter((p) => p.color === c);
  assert.strictEqual(own('w').length, 10);
  assert.strictEqual(own('b').length, 10);
  assert.deepStrictEqual(own('w').map((p) => p.id).sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.strictEqual(st.turn, 'w');
});

test('pasos a huecos vecinos y saltos encadenados', () => {
  // Tablero casi vacío: una ficha blanca en 0,0 y fichas que saltar en 0,-1 y 0,-3
  const st = { cells: { '0,0': { color: 'w', id: 0 }, '0,-1': { color: 'b', id: 0 }, '0,-3': { color: 'w', id: 1 } }, turn: 'w', moves: 0 };
  const d = C.destinations(st, '0,0');
  assert.ok(d.has('1,0'), 'paso a un vecino libre');
  assert.ok(!d.has('0,-1'), 'no se puede pisar una ficha');
  assert.deepStrictEqual(d.get('0,-2'), ['0,0', '0,-2'], 'un salto');
  assert.deepStrictEqual(d.get('0,-4'), ['0,0', '0,-2', '0,-4'], 'dos saltos encadenados');
  assert.ok(!d.has('1,-1') || d.get('1,-1').length === 2, 'tras saltar no se puede dar un paso simple');
});

test('aplicar jugada valida turno, propiedad y destino', () => {
  const st = C.create();
  assert.throws(() => C.applyMove(st, 'b', '4,-6', '4,-4'), /turno/);
  assert.throws(() => C.applyMove(st, 'w', '4,-6', '4,-4'), /no es tuya/);
  assert.throws(() => C.applyMove(st, 'w', '-4,8', '0,0'), /ilegal/);
  const res = C.applyMove(st, 'w', '-4,6', '-4,4'); // salto sobre la primera fila
  assert.strictEqual(res.jumps, 1);
  assert.strictEqual(st.turn, 'b');
  assert.ok(st.cells['-4,4'] && !st.cells['-4,6']);
});

test('se gana llenando la meta con al menos una ficha propia', () => {
  const cells = {};
  C.GOAL.w.forEach((k, i) => { cells[k] = { color: i < 9 ? 'w' : 'b', id: i }; });
  assert.ok(C.hasWon({ cells }, 'w'), 'meta llena aunque una sea rival');
  const onlyRival = {};
  C.GOAL.w.forEach((k, i) => { onlyRival[k] = { color: 'b', id: i }; });
  assert.ok(!C.hasWon({ cells: onlyRival }, 'w'), 'sin fichas propias no se gana');
  delete cells[C.GOAL.w[0]];
  assert.ok(!C.hasWon({ cells }, 'w'), 'con un hueco libre no se gana');
});

test('el bot de damas chinas juega legal y termina partidas', () => {
  for (const [w, b] of [['easy', 'normal'], ['hard', 'easy']]) {
    const st = C.create();
    let winner = null;
    while (st.moves < C.MAX_MOVES && !winner) {
      const color = st.turn;
      const m = Bot.chooseMove(st, color === 'w' ? w : b);
      assert.doesNotThrow(() => C.applyMove(st, color, m.from, m.to));
      if (C.hasWon(st, color)) winner = color;
    }
    assert.ok(winner, `${w} contra ${b} debería terminar antes de ${C.MAX_MOVES} jugadas`);
  }
});

test('sala de damas chinas contra el bot: movimientos, historial y fin', () => {
  const m = new RoomManager();
  const { room, token } = m.createBot(2, 'Ash', 'normal', 'checkers');
  assert.strictEqual(room.game, 'checkers');
  room.setReady(token, true);
  assert.strictEqual(room.status, 'playing');
  const mv = room.move(token, { from: '-4,6', to: '-4,4' });
  assert.deepStrictEqual(mv.path, ['-4,6', '-4,4']);
  assert.match(room.sanHistory[0], /salta$/);
  assert.ok(room.botToMove(), 'después le toca al bot');
  const s = room.publicState(token);
  assert.strictEqual(s.game, 'checkers');
  assert.strictEqual(s.turn, 'b');
  assert.strictEqual(s.ck.inGoal.w, 0);
  // El anfitrión puede volver al ajedrez en el lobby de la revancha
  room.resign(token);
  room.requestRematch(token);
  room.setGame(token, 'chess');
  assert.strictEqual(room.game, 'chess');
  assert.throws(() => room.setGame(token, 'parchis'), /no disponible/);
});

test('Generación III: piezas pedidas y rey/reina en pareja', () => {
  const g = Gens.GENERATIONS[3];
  const names = (t) => g.pieces[t].map((x) => x.name);
  assert.deepStrictEqual(names('p'), ['Wurmple']);
  assert.deepStrictEqual(names('r'), ['Registeel']);
  assert.deepStrictEqual(names('b'), ['Huntail']);
  assert.deepStrictEqual(names('n'), ['Donphan', 'Girafarig']);
  assert.deepStrictEqual(Gens.choosablePieces(3), ['n', 'k'], 'la reina no se elige aparte');
  const pair = (k) => [Gens.pokemonFor(3, 'k', { k }).name, Gens.pokemonFor(3, 'q', Gens.sanitizeChoices(3, { k, q: 1 - k })).name];
  assert.deepStrictEqual(pair(0), ['Groudon', 'Kyogre']);
  assert.deepStrictEqual(pair(1), ['Latios', 'Latias']);
  assert.strictEqual(Gens.GENERATIONS[3].checkers.length, 10);
  for (const gen of [1, 2]) assert.strictEqual(Gens.GENERATIONS[gen].checkers.length, 10);
});

test('Generación IV: Palkia, Dialga, Luxray, Milotic, Probopass y Bidoof; Gible→Garchomp; 10 de Sinnoh', () => {
  const g4 = Gens.GENERATIONS[4];
  const names = (k) => g4.pieces[k].map((x) => x.name);
  assert.deepStrictEqual(names('k'), ['Palkia']);
  assert.deepStrictEqual(names('q'), ['Dialga']);
  assert.deepStrictEqual(names('n'), ['Luxray']);
  assert.deepStrictEqual(names('b'), ['Milotic']);
  assert.deepStrictEqual(names('r'), ['Probopass']);
  assert.deepStrictEqual(names('p'), ['Bidoof']);
  assert.deepStrictEqual([g4.draughts.man.name, g4.draughts.king.name], ['Gible', 'Garchomp']);
  assert.strictEqual(g4.checkers.length, 10);
  // Se puede jugar con ella en una sala
  const m = new RoomManager();
  const { room, token } = m.create(4, 'Ash');
  const guest = m.join(room.code, 'Gary', 4);
  room.setReady(token, true);
  room.setReady(guest.token, true);
  assert.strictEqual(room.status, 'playing');
});
