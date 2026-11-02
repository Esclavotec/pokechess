// Pruebas del bot: legalidad, tácticas básicas, tiempos y partida completa
const test = require('node:test');
const assert = require('node:assert');
const { Chess } = require('chess.js');
const { chooseMove, LEVELS } = require('../server/bot');
const { RoomManager } = require('../server/rooms');
const WebSocket = require('ws');
const { createServer } = require('../server/server');

/** Generador pseudoaleatorio con semilla, para que las pruebas sean repetibles. */
function seeded(seed) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
}

test('el bot siempre hace jugadas legales (partidas bot contra bot)', () => {
  const rand = seeded(7);
  for (const [w, b] of [['easy', 'easy'], ['normal', 'easy'], ['easy', 'hard']]) {
    const chess = new Chess();
    for (let ply = 0; ply < 60 && !chess.isGameOver(); ply++) {
      const level = chess.turn() === 'w' ? w : b;
      const mv = chooseMove(chess.fen(), level, { rand, timeMs: 300 });
      assert.ok(mv, 'debe devolver jugada si la partida no terminó');
      assert.doesNotThrow(() => chess.move(mv), `jugada ilegal ${JSON.stringify(mv)} en ${chess.fen()}`);
    }
  }
});

test('todos los niveles ven el mate en 1', () => {
  // Mate del pastor: Dxf7#
  const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
  for (const level of Object.keys(LEVELS)) {
    assert.deepStrictEqual(chooseMove(fen, level), { from: 'h5', to: 'f7', promotion: undefined }, level);
  }
});

test('Normal y Difícil se comen una dama regalada', () => {
  // La dama negra en d4 está colgada del caballo de f3
  const fen = 'rnb1kbnr/pppp1ppp/8/4p3/3q4/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 3';
  for (const level of ['normal', 'hard']) {
    assert.deepStrictEqual(chooseMove(fen, level), { from: 'f3', to: 'd4', promotion: undefined }, level);
  }
});

test('Fácil prefiere comer la pieza más valiosa', () => {
  const fen = 'rnb1kbnr/pppp1ppp/8/4p3/3q4/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 3';
  assert.deepStrictEqual(chooseMove(fen, 'easy', { rand: () => 0 }), { from: 'f3', to: 'd4', promotion: undefined });
});

test('el bot corona y respeta su límite de tiempo', () => {
  const t = Date.now();
  const mv = chooseMove('8/P6k/8/8/8/8/8/K7 w - - 0 1', 'hard');
  assert.strictEqual(mv.to, 'a8');
  assert.strictEqual(mv.promotion, 'q');
  const t2 = Date.now();
  chooseMove('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 6 5', 'hard');
  assert.ok(Date.now() - t2 < LEVELS.hard.timeMs + 800, 'Difícil no debe pasarse de su tiempo');
  assert.ok(t2 - t < 3000);
});

test('sala contra el bot: asiento, opciones, color y revancha automática', () => {
  const m = new RoomManager();
  const { room, token, color } = m.createBot(1, 'Ash', 'easy');
  assert.strictEqual(color, 'w');
  assert.strictEqual(room.botColor(), 'b');
  assert.ok(room.seats.b.isBot && room.seats.b.ready);
  assert.throws(() => m.join(room.code, 'Gary'), /llena/);

  room.setBotOptions(token, { level: 'hard', gen: 2, choices: { n: 1 } });
  assert.strictEqual(room.bot.level, 'hard');
  assert.strictEqual(room.seats.b.gen, 2);
  assert.strictEqual(room.seats.b.choices.n, 1);
  assert.throws(() => room.setBotOptions(token, { level: 'imposible' }), /Dificultad/);

  room.setColorPref(token, 'b'); // el jugador pasa a negras, el bot a blancas
  assert.strictEqual(room.colorOf(token), 'b');
  assert.strictEqual(room.botColor(), 'w');

  room.setReady(token, true);
  assert.strictEqual(room.status, 'playing');
  assert.ok(room.botToMove(), 'con blancas, el bot empieza');

  room.resign(token);
  room.requestRematch(token);
  assert.strictEqual(room.status, 'lobby', 'el bot acepta la revancha él solo');
  assert.strictEqual(room.colorOf(token), 'b', 'se mantiene el color elegido');
  assert.ok(room.isEmpty() === false);
  room.setConnected(token, false);
  assert.ok(room.isEmpty(), 'una sala solo con el bot cuenta como vacía');
});

test('partida contra el bot por WebSocket: el bot responde solo', async () => {
  const { server } = createServer({ botDelayMs: 0 });
  await new Promise((r) => server.listen(0, r));
  const ws = new WebSocket(`ws://localhost:${server.address().port}/ws`);
  const inbox = [];
  let notify = null;
  ws.on('message', (raw) => { inbox.push(JSON.parse(raw)); if (notify) notify(); });
  const wait = async (pred) => {
    for (;;) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return inbox.splice(i, 1)[0];
      await new Promise((r) => (notify = r));
    }
  };
  await new Promise((r) => ws.on('open', r));

  ws.send(JSON.stringify({ type: 'createBot', gen: 1, name: 'Ash', level: 'normal' }));
  await wait((m) => m.type === 'joined');
  ws.send(JSON.stringify({ type: 'ready', ready: true }));
  await wait((m) => m.type === 'state' && m.state.status === 'playing');

  // Jugamos 4 jugadas; tras cada una el bot debe contestar
  const me = new Chess();
  for (let i = 0; i < 4; i++) {
    const mv = me.moves({ verbose: true })[0];
    ws.send(JSON.stringify({ type: 'move', from: mv.from, to: mv.to, promotion: mv.promotion }));
    const st = await wait((m) => m.type === 'state' && m.state.history.length === (i + 1) * 2);
    assert.strictEqual(st.state.turn, 'w');
    assert.ok(st.state.players.b.bot);
    me.load(st.state.fen);
  }

  ws.close();
  await new Promise((r) => server.close(r));
});
