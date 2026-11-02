// Prueba de extremo a extremo: servidor real + dos clientes WebSocket
const test = require('node:test');
const assert = require('node:assert');
const WebSocket = require('ws');
const { createServer } = require('../server/server');

/** Cliente de prueba que guarda los mensajes y permite esperar uno concreto. */
function client(port) {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  return {
    ws,
    open: () => new Promise((r) => ws.on('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    wait: (pred) => new Promise((resolve) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return resolve(hit); }
      waiters.push({ pred, resolve });
    }),
  };
}

test('dos jugadores juegan una partida por WebSocket', async () => {
  const { server } = createServer();
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const a = client(port);
  const b = client(port);
  await Promise.all([a.open(), b.open()]);

  a.send({ type: 'create', gen: 1, name: 'Ash' });
  const joinedA = await a.wait((m) => m.type === 'joined');
  b.send({ type: 'join', code: joinedA.code, name: 'Gary', gen: 2 });
  const joinedB = await b.wait((m) => m.type === 'joined');
  assert.strictEqual(joinedB.color, 'b');

  b.send({ type: 'choose', choices: { n: 1 } });
  await a.wait((m) => m.type === 'state' && m.state.players.b && m.state.players.b.gen === 2 && m.state.players.b.choices.n === 1);
  a.send({ type: 'board', board: 'islas-remolino' });
  await b.wait((m) => m.type === 'state' && m.state.board === 'islas-remolino');

  a.send({ type: 'ready', ready: true });
  b.send({ type: 'ready', ready: true });
  const playing = await a.wait((m) => m.type === 'state' && m.state.status === 'playing');
  assert.strictEqual(playing.state.activeBoard, 'islas-remolino');

  b.send({ type: 'move', from: 'e7', to: 'e5' });
  const err = await b.wait((m) => m.type === 'error');
  assert.match(err.message, /turno/);

  a.send({ type: 'move', from: 'e2', to: 'e4' });
  const st = await b.wait((m) => m.type === 'state' && m.state.history.length === 1);
  assert.deepStrictEqual(st.state.history, ['e4']);
  assert.strictEqual(st.state.turn, 'b');

  // Reconexión con el token: vuelve al mismo asiento
  b.ws.close();
  const b2 = client(port);
  await b2.open();
  b2.send({ type: 'resume', code: joinedA.code, token: joinedB.token });
  const back = await b2.wait((m) => m.type === 'state');
  assert.strictEqual(back.state.you, 'b');

  // Archivos estáticos que necesita el navegador
  for (const p of ['/', '/app.js', '/sprites.js', '/shared/generations.js', '/shared/boards.js', '/vendor/chess.js',
    '/img/honor-ball.svg', '/img/ocaso-ball.svg', '/assets/sprite-meta.json', '/assets/pokemon/150/Idle.png', '/assets/pokemon/250/s/Attack.png']) {
    const res = await fetch(`http://localhost:${port}${p}`);
    assert.strictEqual(res.status, 200, p);
  }

  a.ws.close();
  b2.ws.close();
  await new Promise((r) => server.close(r));
});
