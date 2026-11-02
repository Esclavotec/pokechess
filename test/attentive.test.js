// Pruebas del modo atento: se puede dejar al rey en peligro y comerse al rey gana
const test = require('node:test');
const assert = require('node:assert');
const { RoomManager } = require('../server/rooms');
const { chooseMove } = require('../server/bot');

function attentiveRoom() {
  const m = new RoomManager();
  const host = m.create(1, 'Ash');
  const guest = m.join(host.room.code, 'Gary');
  host.room.setReady(host.token, true);
  host.room.setReady(guest.token, true);
  return { room: host.room, w: host.token, b: guest.token, m };
}

test('el modo atento está activado por defecto y solo el anfitrión lo cambia', () => {
  const m = new RoomManager();
  const host = m.create(1);
  const guest = m.join(host.room.code);
  assert.strictEqual(host.room.attentive, true);
  assert.throws(() => host.room.setAttentive(guest.token, false), /anfitrión/);
  host.room.setAttentive(host.token, false);
  assert.strictEqual(host.room.attentive, false);
});

test('se puede ignorar el jaque y el rival se come al rey para ganar', () => {
  const { room, w, b } = attentiveRoom();
  // 1.e4 f6 2.Dh5+ : las negras están en jaque
  room.move(w, { from: 'e2', to: 'e4' });
  room.move(b, { from: 'f7', to: 'f6' });
  room.move(w, { from: 'd1', to: 'h5' });
  assert.strictEqual(room.publicState(b).inCheck, false, 'en modo atento no se avisa del jaque');
  assert.ok(!room.sanHistory.at(-1).includes('+'), 'el historial tampoco delata el jaque');
  // Las negras ignoran el jaque (en reglas clásicas sería ilegal)
  room.move(b, { from: 'a7', to: 'a6' });
  assert.strictEqual(room.status, 'playing');
  // Las blancas se comen al rey
  const mv = room.move(w, { from: 'h5', to: 'e8' });
  assert.strictEqual(mv.captured, 'k');
  assert.strictEqual(room.status, 'over');
  assert.deepStrictEqual(room.result, { winner: 'w', reason: 'king' });
  assert.ok(room.publicState(w).history.at(-1).endsWith('#'));
});

test('el "mate" no termina la partida: hay que comerse al rey', () => {
  const { room, w, b } = attentiveRoom();
  for (const [t, from, to] of [[w, 'e2', 'e4'], [b, 'e7', 'e5'], [w, 'f1', 'c4'], [b, 'b8', 'c6'], [w, 'd1', 'h5'], [b, 'g8', 'f6'], [w, 'h5', 'f7']]) {
    room.move(t, { from, to });
  }
  assert.strictEqual(room.status, 'playing');
  room.move(b, { from: 'a7', to: 'a6' }); // cualquier jugada vale
  room.move(w, { from: 'f7', to: 'e8' });
  assert.deepStrictEqual(room.result, { winner: 'w', reason: 'king' });
});

test('las reglas clásicas siguen rechazando dejar al rey en jaque', () => {
  const m = new RoomManager();
  const host = m.create(1);
  const guest = m.join(host.room.code);
  host.room.setAttentive(host.token, false);
  host.room.setReady(host.token, true);
  host.room.setReady(guest.token, true);
  const room = host.room;
  room.move(host.token, { from: 'e2', to: 'e4' });
  room.move(guest.token, { from: 'f7', to: 'f6' });
  room.move(host.token, { from: 'd1', to: 'h5' });
  assert.throws(() => room.move(guest.token, { from: 'a7', to: 'a6' }), /ilegal/);
});

test('el bot se come un rey desprotegido en cualquier nivel', () => {
  // Negras han ignorado el jaque de la dama en h5: el rey de e8 está a tiro
  const fen = 'rnbqkbnr/1pppp1pp/p4p2/7Q/4P3/8/PPPP1PPP/RNB1KBNR w KQkq - 0 3';
  for (const level of ['easy', 'normal', 'hard']) {
    assert.deepStrictEqual(chooseMove(fen, level, { attentive: true }), { from: 'h5', to: 'e8', promotion: undefined }, level);
  }
});

test('el bot sin jugadas legales mueve igualmente en modo atento', () => {
  // Negras en "mate" (mate del pastor): no tienen jugadas legales
  const fen = 'r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4';
  assert.strictEqual(chooseMove(fen, 'hard'), null);
  assert.ok(chooseMove(fen, 'hard', { attentive: true }));
});
