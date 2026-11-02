// Pruebas de "Salir de la sala" en todos los juegos
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { RoomManager } = require('../server/rooms');
const { createServer } = require('../server/server');

test('salir del lobby libera el asiento y el anfitrión pasa al otro jugador', () => {
  const m = new RoomManager();
  const host = m.create(1, 'Ash');
  const guest = m.join(host.room.code, 'Gary');
  const res = m.leave(host.room.code, host.token);
  assert.strictEqual(res.closed, false);
  assert.strictEqual(res.resigned, false);
  assert.strictEqual(host.room.seats.w, null, 'el asiento queda libre');
  assert.strictEqual(host.room.hostToken, guest.token, 'Gary pasa a ser anfitrión');
  const brock = m.join(host.room.code, 'Brock'); // entra otro en el asiento libre
  assert.strictEqual(brock.color, 'w');
});

test('salir en plena partida cuenta como rendición y la sala vuelve al lobby', () => {
  const m = new RoomManager();
  const host = m.create(1, 'Ash', 'draughts');
  const guest = m.join(host.room.code, 'Gary');
  host.room.setReady(host.token, true);
  host.room.setReady(guest.token, true);
  assert.strictEqual(host.room.status, 'playing');
  const res = m.leave(host.room.code, guest.token);
  assert.strictEqual(res.resigned, true);
  assert.strictEqual(host.room.status, 'lobby');
  assert.strictEqual(host.room.seats.b, null);
  assert.strictEqual(host.room.seats.w.ready, false);
  assert.throws(() => host.room.colorOf(guest.token), /No perteneces/);
});

test('contra el bot, si sale el único humano la sala se cierra', () => {
  const m = new RoomManager();
  const { room, token } = m.createBot(2, 'Ash', 'normal', 'chess');
  const res = m.leave(room.code, token);
  assert.strictEqual(res.closed, true);
  assert.throws(() => m.get(room.code), /no encontrada/);
});

test('Ruta de Medallas: salir en partida es retirarse y los demás siguen', () => {
  const m = new RoomManager();
  const host = m.create(1, 'Ash', 'route');
  const guest = m.join(host.room.code, 'Gary');
  const room = host.room;
  room.handle(host.token, { type: 'addBot' });
  room.handle(host.token, { type: 'ready', ready: true });
  room.handle(guest.token, { type: 'ready', ready: true });
  assert.strictEqual(room.status, 'playing');
  const p = room.order.indexOf(room.colorOf(host.token));
  const res = m.leave(room.code, host.token);
  assert.strictEqual(res.resigned, true);
  assert.strictEqual(res.closed, false);
  assert.ok(room.rs.players[p].out, 'Ash queda retirado');
  assert.strictEqual(room.status, 'playing', 'Gary y el bot siguen jugando');
  assert.strictEqual(room.hostToken, guest.token, 'el anfitrión pasa a Gary');
  assert.ok(room.publicState(guest.token).seats.some((s) => s && s.left));
  // Si sale también el último humano, la sala se cierra
  assert.strictEqual(m.leave(room.code, guest.token).closed, true);
});

test('Ruta de Medallas: salir del lobby libera el asiento', () => {
  const m = new RoomManager();
  const host = m.create(1, 'Ash', 'route');
  const guest = m.join(host.room.code, 'Gary');
  m.leave(host.room.code, guest.token);
  assert.strictEqual(host.room.seats.filter(Boolean).length, 1);
});

test('por WebSocket: el que sale recibe "left" y el otro un aviso', async () => {
  const { server } = createServer({ botDelayMs: 0 });
  await new Promise((r) => server.listen(0, r));
  const open = () => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${server.address().port}/ws`);
    const inbox = [];
    let notify = null;
    ws.on('message', (raw) => { inbox.push(JSON.parse(raw)); if (notify) notify(); });
    ws.wait = async (pred) => {
      for (;;) {
        const i = inbox.findIndex(pred);
        if (i >= 0) return inbox.splice(i, 1)[0];
        await new Promise((r) => (notify = r));
      }
    };
    ws.on('open', () => resolve(ws));
  });
  const a = await open();
  a.send(JSON.stringify({ type: 'create', gen: 1, name: 'Ash' }));
  const joined = await a.wait((m) => m.type === 'joined');
  const b = await open();
  b.send(JSON.stringify({ type: 'join', code: joined.code, name: 'Gary' }));
  await b.wait((m) => m.type === 'joined');
  b.send(JSON.stringify({ type: 'leave' }));
  await b.wait((m) => m.type === 'left');
  const notice = await a.wait((m) => m.type === 'notice');
  assert.match(notice.text, /Gary salió de la sala/);
  const st = await a.wait((m) => m.type === 'state' && m.state.players.b === null);
  assert.strictEqual(st.state.status, 'lobby');
  // Gary ya no puede volver con su token antiguo
  b.send(JSON.stringify({ type: 'resume', code: joined.code, token: 'x' }));
  await b.wait((m) => m.type === 'error');
  a.close();
  b.close();
  await new Promise((r) => server.close(r));
});
