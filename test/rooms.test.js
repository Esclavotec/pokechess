// Pruebas de la lógica de salas y de los datos de generaciones (node --test)
const test = require('node:test');
const assert = require('node:assert');
const { RoomManager, RoomError } = require('../server/rooms');
const Gens = require('../shared/generations');
const Boards = require('../shared/boards');

/** Sala con dos jugadores ya listos (partida empezada). */
function startedRoom(gen = 1) {
  const m = new RoomManager();
  const host = m.create(gen, 'Ash');
  const guest = m.join(host.room.code, 'Gary');
  host.room.setReady(host.token, true);
  host.room.setReady(guest.token, true);
  return { room: host.room, w: host.token, b: guest.token, m };
}

test('las piezas de cada generación son las pedidas', () => {
  const names = (gen, t) => Gens.GENERATIONS[gen].pieces[t].map((x) => x.name);
  assert.deepStrictEqual(names(1, 'p'), ['Caterpie']);
  assert.deepStrictEqual(names(1, 'n'), ['Tauros', 'Rapidash']);
  assert.deepStrictEqual(names(1, 'b'), ['Arbok', 'Onix']);
  assert.deepStrictEqual(names(1, 'r'), ['Snorlax']);
  assert.deepStrictEqual(names(1, 'q'), ['Mew']);
  assert.deepStrictEqual(names(1, 'k'), ['Mewtwo']);
  assert.deepStrictEqual(names(2, 'p'), ['Weedle']);
  assert.deepStrictEqual(names(2, 'n'), ['Arcanine', 'Ninetales']);
  assert.deepStrictEqual(names(2, 'b'), ['Kingdra']);
  assert.deepStrictEqual(names(2, 'r'), ['Tyranitar']);
  assert.deepStrictEqual(names(2, 'q'), ['Lugia']);
  assert.deepStrictEqual(names(2, 'k'), ['Ho-Oh']);
  assert.deepStrictEqual(Gens.choosablePieces(1), ['n', 'b']);
  assert.deepStrictEqual(Gens.choosablePieces(2), ['n']);
});

test('URLs de sprite normal y shiny', () => {
  assert.match(Gens.spriteUrl(150, false), /sprites\/pokemon\/150\.png$/);
  assert.match(Gens.spriteUrl(150, true), /sprites\/pokemon\/shiny\/150\.png$/);
});

test('crear y unirse: anfitrión blancas, invitado negras, sala llena', () => {
  const m = new RoomManager();
  const host = m.create(2, 'Ash');
  assert.strictEqual(host.color, 'w');
  assert.throws(() => m.create(5), /no disponible/);
  assert.match(host.room.code, /^[A-Z2-9]{5}$/);
  const guest = m.join(host.room.code.toLowerCase(), 'Gary');
  assert.strictEqual(guest.color, 'b');
  assert.throws(() => m.join(host.room.code, 'Brock'), /llena/);
  assert.throws(() => m.join('ZZZZZ'), /no encontrada/);
});

test('cada jugador elige sus propias variantes', () => {
  const m = new RoomManager();
  const host = m.create(1, 'Ash');
  const guest = m.join(host.room.code, 'Gary');
  const room = host.room;
  room.choose(host.token, { n: 1, b: 1 }); // Rapidash + Onix
  room.choose(guest.token, { n: 0, b: 0, k: 5 }); // Tauros + Arbok; "k" se ignora
  assert.deepStrictEqual(room.seats.w.choices, { n: 1, b: 1 });
  assert.deepStrictEqual(room.seats.b.choices, { n: 0, b: 0 });
  assert.strictEqual(Gens.pokemonFor(1, 'n', room.seats.w.choices).name, 'Rapidash');
  assert.strictEqual(Gens.pokemonFor(1, 'b', room.seats.b.choices).name, 'Arbok');
  // índices inválidos vuelven al valor por defecto
  room.choose(guest.token, { n: 9 });
  assert.strictEqual(room.seats.b.choices.n, 0);
});

test('cada jugador elige su propia generación', () => {
  const m = new RoomManager();
  const host = m.create(1);
  const guest = m.join(host.room.code, 'Gary', 2);
  const room = host.room;
  assert.strictEqual(room.seats.w.gen, 1);
  assert.strictEqual(room.seats.b.gen, 2);
  room.choose(host.token, { n: 1, b: 1 });
  room.setGeneration(guest.token, 1);           // el invitado cambia SU generación
  room.choose(guest.token, { n: 1, b: 1 });
  assert.strictEqual(room.seats.b.gen, 1);
  assert.deepStrictEqual(room.seats.w.choices, { n: 1, b: 1 }); // la del anfitrión no cambia
  room.setGeneration(guest.token, 2);           // cambiar de generación reinicia sus variantes
  assert.deepStrictEqual(room.seats.b.choices, { n: 0 });
  assert.strictEqual(room.seats.w.gen, 1);
  assert.throws(() => room.setGeneration(host.token, 9), /no disponible/);
  assert.throws(() => m.join(room.code, 'X', 7), /no disponible|llena/);
});

test('solo el anfitrión elige el tablero; "aleatorio" se resuelve al empezar', () => {
  const m = new RoomManager();
  const host = m.create(1);
  const guest = m.join(host.room.code);
  const room = host.room;
  assert.strictEqual(room.board, 'random');
  assert.throws(() => room.setBoard(guest.token, 'ruta1'), /anfitrión/);
  assert.throws(() => room.setBoard(host.token, 'pueblo-inventado'), /no disponible/);
  room.setBoard(host.token, 'torre-campana');
  room.setReady(host.token, true);
  room.setReady(guest.token, true);
  assert.strictEqual(room.activeBoard, 'torre-campana');
  const m2 = new RoomManager();
  const h2 = m2.create(2);
  const g2 = m2.join(h2.room.code);
  h2.room.setReady(h2.token, true);
  h2.room.setReady(g2.token, true);
  assert.ok(Boards.BOARDS.some((b) => b.id === h2.room.activeBoard));
});

test('la partida empieza cuando ambos están listos', () => {
  const m = new RoomManager();
  const host = m.create(1);
  host.room.setReady(host.token, true);
  assert.strictEqual(host.room.status, 'lobby');
  const guest = m.join(host.room.code);
  host.room.setReady(guest.token, true);
  assert.strictEqual(host.room.status, 'playing');
});

test('turnos y jugadas ilegales', () => {
  const { room, w, b } = startedRoom();
  assert.throws(() => room.move(b, { from: 'e7', to: 'e5' }), /turno/);
  assert.throws(() => room.move(w, { from: 'e2', to: 'e5' }), /ilegal/);
  assert.throws(() => room.move('nadie', { from: 'e2', to: 'e4' }), RoomError);
  room.move(w, { from: 'e2', to: 'e4' });
  assert.deepStrictEqual(room.lastMove, { from: 'e2', to: 'e4' });
  assert.strictEqual(room.chess.turn(), 'b');
});

test('mate del pastor termina la partida con victoria de blancas', () => {
  const { room, w, b } = startedRoom(2);
  const moves = [[w, 'e2', 'e4'], [b, 'e7', 'e5'], [w, 'f1', 'c4'], [b, 'b8', 'c6'], [w, 'd1', 'h5'], [b, 'g8', 'f6'], [w, 'h5', 'f7']];
  for (const [t, from, to] of moves) room.move(t, { from, to });
  assert.strictEqual(room.status, 'over');
  assert.deepStrictEqual(room.result, { winner: 'w', reason: 'checkmate' });
  assert.throws(() => room.move(b, { from: 'a7', to: 'a6' }), /no está en curso/);
});

test('rendición y revancha con colores intercambiados', () => {
  const { room, w, b } = startedRoom();
  room.resign(b);
  assert.deepStrictEqual(room.result, { winner: 'w', reason: 'resign' });
  room.requestRematch(w);
  assert.strictEqual(room.status, 'over');
  room.requestRematch(b);
  assert.strictEqual(room.status, 'lobby');
  assert.strictEqual(room.colorOf(w), 'b');
  assert.strictEqual(room.colorOf(b), 'w');
});

test('coronación con la pieza elegida', () => {
  const { room, w, b } = startedRoom();
  room.chess.load('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  room.move(w, { from: 'a7', to: 'a8', promotion: 'n' });
  assert.deepStrictEqual(room.chess.get('a8'), { type: 'n', color: 'w' });
  void b;
});

test('el estado público no filtra tokens', () => {
  const { room, w } = startedRoom();
  const s = JSON.stringify(room.publicState(w));
  assert.ok(!s.includes(w));
  assert.strictEqual(room.publicState(w).you, 'w');
});
