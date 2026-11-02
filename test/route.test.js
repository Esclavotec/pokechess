// Pruebas de "Ruta de Medallas": reglas, eventos, combates, deudas, bot, sala y chat
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const R = require('../shared/route');
const Bot = require('../server/routeBot');
const { RouteRoom } = require('../server/routeRoom');
const { RoomManager } = require('../server/rooms');
const { createServer } = require('../server/server');

/** Dados trucados: devuelve los números de `seq` (1-6) en orden y luego 0.5. */
function dice(...seq) {
  const vals = seq.map((d) => (d - 1) / 6 + 0.01);
  return () => (vals.length ? vals.shift() : 0.5);
}
const idx = (name) => R.SQUARES.findIndex((s) => s.name === name);

test('tablero: 44 casillas, 9 gimnasios, 15 pueblos en 5 regiones (con Teselia), 4 transportes, 2 servicios, cueva y Safari', () => {
  assert.strictEqual(R.N, 44);
  const count = (t) => R.SQUARES.filter((s) => s.type === t).length;
  assert.strictEqual(count('gym'), 9);
  assert.strictEqual(count('town'), 15);
  assert.strictEqual(count('transport'), 4);
  assert.strictEqual(count('service'), 2);
  assert.strictEqual(count('grass'), 3);
  assert.strictEqual(count('berry'), 3);
  assert.strictEqual(count('corona'), 1);
  assert.strictEqual(count('safari'), 1);
  assert.deepStrictEqual(Object.keys(R.REGIONS).sort(), ['hoenn', 'johto', 'kanto', 'sinnoh', 'teselia']);
  assert.ok(R.REGIONS.teselia.every((i) => R.SQUARES[i].type === 'town'));
  assert.ok(R.GRASS.length >= 10 && R.BERRY.length >= 9);
});

test('de 2 a 4 jugadores, medallas objetivo entre 3 y 8 (8 por defecto)', () => {
  assert.strictEqual(R.create({ n: 4 }).target, 8);
  assert.strictEqual(R.create({ n: 2, target: 1 }).target, 3);
  assert.strictEqual(R.create({ n: 2, target: 12 }).target, 8);
  assert.throws(() => R.create({ n: 5 }), /2 a 4/);
  assert.throws(() => R.create({ n: 1 }), /2 a 4/);
});

test('tirar, avanzar, reclamar un pueblo y cobrar entrenamiento (×2 con la región)', () => {
  const st = R.create({ n: 2 });
  R.act(st, 0, { type: 'roll' }, dice(1, 2)); // 3 casillas: Ciudad Carmín
  assert.strictEqual(st.players[0].pos, idx('Ciudad Carmín'));
  assert.strictEqual(st.phase, 'buy');
  R.act(st, 0, { type: 'buy' });
  assert.strictEqual(st.owners[3].owner, 0);
  assert.strictEqual(st.players[0].money, R.START_MONEY - 70);
  R.act(st, 0, { type: 'end' });
  R.act(st, 1, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.phase, 'battle', 'el dueño está en su pueblo: primero se ofrece combate');
  R.act(st, 1, { type: 'decline' });
  assert.strictEqual(st.players[1].money, R.START_MONEY - R.SQUARES[3].rent);
  // Región completa: el entrenamiento se duplica
  st.owners[1] = { owner: 0, daycare: false };
  st.owners[7] = { owner: 0, daycare: false };
  assert.strictEqual(R.rentOf(st, 3), R.SQUARES[3].rent * 2);
  st.owners[7].daycare = true; // un pueblo en la Guardería rompe el bono y no cobra
  assert.strictEqual(R.rentOf(st, 3), R.SQUARES[3].rent);
  assert.strictEqual(R.rentOf(st, 7), 0);
});

test('pasar por la salida cobra y los dobles dan otra tirada', () => {
  const st = R.create({ n: 2 });
  st.players[0].pos = 42;
  R.act(st, 0, { type: 'roll' }, dice(2, 2, 3, 3)); // dobles: 4 casillas, pasa por la salida
  assert.strictEqual(st.players[0].pos, 2);
  assert.ok(st.players[0].money >= R.START_MONEY + R.PASS_START - R.GYM_LOSS_FEE);
  assert.ok(st.extraRoll);
  while (st.phase !== 'end') R.act(st, 0, st.phase === 'buy' ? { type: 'skip' } : { type: 'decline' });
  R.act(st, 0, { type: 'end' });
  assert.strictEqual(st.turn, 0, 'con dobles vuelve a tirar el mismo jugador');
  assert.strictEqual(st.phase, 'roll');
});

test('gimnasio: medalla personal, experiencia al perder y la siguiente medalla si ya la tienes', () => {
  const st = R.create({ n: 2 });
  const gym = idx('Gimnasio Plateado');
  // Pierde: tira 1+1 contra 6+6
  R.act(st, 0, { type: 'roll' }, dice(1, 1, 1, 1, 6, 6));
  assert.strictEqual(st.players[0].pos, gym);
  assert.deepStrictEqual(st.players[0].medals, []);
  assert.strictEqual(st.players[0].exp, 1);
  assert.strictEqual(st.event.kind, 'gym');
  // Otro jugador también puede ganar la misma medalla
  const st2 = R.create({ n: 2 });
  R.act(st2, 0, { type: 'roll' }, dice(1, 1, 6, 6, 1, 1));
  assert.deepStrictEqual(st2.players[0].medals, [gym]);
  st2.turn = 1; st2.phase = 'roll'; st2.players[0].pos = 10; // que no coincidan en la casilla
  R.act(st2, 1, { type: 'roll' }, dice(1, 1, 6, 6, 1, 1));
  assert.deepStrictEqual(st2.players[1].medals, [gym]);
  // Volver a un gimnasio cuya medalla ya tienes: luchas por la siguiente que te falta
  st2.turn = 0; st2.phase = 'roll'; st2.players[0].pos = 0; st2.players[1].pos = 20;
  R.act(st2, 0, { type: 'roll' }, dice(1, 1, 6, 6, 1, 1));
  assert.deepStrictEqual(st2.players[0].medals, [gym, idx('Gimnasio Celeste')]);
});

test('gana quien llega a las medallas objetivo', () => {
  const st = R.create({ n: 2, target: 3 });
  st.players[0].medals = [R.GYMS[1], R.GYMS[2]];
  R.act(st, 0, { type: 'roll' }, dice(1, 1, 6, 6, 1, 1)); // gana la del Plateado
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.winner, 0);
  assert.strictEqual(st.reason, 'medals');
});

test('combate en la misma casilla: el perdedor vuelve a su casilla anterior', () => {
  const st = R.create({ n: 3 });
  st.players[1].pos = 3; st.players[1].prev = 1;
  R.act(st, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.phase, 'battle');
  assert.deepStrictEqual(st.pending.rivals, [1]);
  R.act(st, 0, { type: 'battle', target: 1 }, dice(6, 6, 1, 1)); // gana el que llega
  assert.strictEqual(st.battle.winner, 0);
  assert.strictEqual(st.players[1].pos, 1, 'el rival retrocede a donde estaba antes');
  assert.ok(st.moves.some((m) => m.kind === 'knockback' && m.p === 1));
  assert.strictEqual(st.phase, 'buy', 'después se resuelve la casilla');
  // Si pierde el que llega, vuelve él
  const s2 = R.create({ n: 2 });
  s2.players[1].pos = 3;
  R.act(s2, 0, { type: 'roll' }, dice(1, 2));
  R.act(s2, 0, { type: 'battle' }, dice(1, 1, 6, 6));
  assert.strictEqual(s2.players[0].pos, 0);
  assert.strictEqual(s2.phase, 'end');
  // Pasar del combate
  const s3 = R.create({ n: 2 });
  s3.players[1].pos = 3;
  R.act(s3, 0, { type: 'roll' }, dice(1, 2));
  R.act(s3, 0, { type: 'decline' });
  assert.strictEqual(s3.players[1].pos, 3);
});

/** Lanza un evento concreto colocando al jugador antes de la casilla. */
function event(deck, id, setup) {
  const st = R.create({ n: 3 });
  if (setup) setup(st);
  const sq = R.SQUARES.findIndex((s) => s.type === deck);
  st.players[0].pos = (sq - 2 + R.N) % R.N;
  const list = deck === 'grass' ? R.GRASS : R.BERRY;
  const k = list.findIndex((e) => e.id === id);
  R.act(st, 0, { type: 'roll' }, (() => { const q = [1 / 6 * 0 + 0.01, 0.01 + 1 / 6 * 0, (k + 0.5) / list.length, 0.5, 0.5, 0.5, 0.5]; return () => (q.length ? q.shift() : 0.5); })());
  assert.strictEqual(st.events[0] && st.events[0].id, id, `debería salir ${id}`);
  return st;
}

test('eventos de hierba alta: Snorlax, volver a tirar, teletransporte, dinero, retroceder, perder turno, objeto', () => {
  let st = event('grass', 'snorlax');
  assert.strictEqual(st.players[0].pos, R.SNORLAX);
  assert.strictEqual(st.players[0].stuck, 3);
  st = event('grass', 'ponyta');
  assert.ok(st.extraRoll, 'Ponyta: vuelve a tirar');
  st = event('grass', 'abra');
  assert.ok(st.moves.some((m) => m.kind === 'teleport'));
  st = event('grass', 'meowth');
  assert.strictEqual(st.players[0].money, R.START_MONEY + 100);
  st = event('grass', 'geodude');
  assert.ok(st.moves.some((m) => m.kind === 'back'));
  st = event('grass', 'gastly');
  assert.ok(st.players[0].skip);
  st = event('grass', 'flute');
  assert.strictEqual(st.players[0].items.flute, 1);
  st = event('grass', 'pidgey');
  assert.strictEqual(R.SQUARES[st.players[0].pos].type, 'center');
});

test('eventos del Árbol de Bayas: guardar Zreza, avanzar, retroceder, bayas para todos, fiesta, Aipom', () => {
  let st = event('berry', 'zreza');
  assert.strictEqual(st.players[0].items.zreza, 1);
  st = event('berry', 'meloc');
  assert.ok(st.moves.some((m) => m.kind === 'hop'));
  st = event('berry', 'atania');
  assert.ok(st.moves.some((m) => m.kind === 'back'));
  assert.strictEqual(st.events[1].kind, 'gym', 'retrocede a un gimnasio: se ven los dos eventos seguidos');
  st = event('berry', 'todos');
  assert.ok(st.players.every((p) => p.money === R.START_MONEY + 30));
  st = event('berry', 'fiesta');
  assert.strictEqual(st.players[0].money, R.START_MONEY + 40);
  assert.strictEqual(st.players[1].money, R.START_MONEY - 20);
  st = event('berry', 'aipom');
  assert.strictEqual(st.players[0].money, R.START_MONEY - 50);
  st = event('berry', 'caquic');
  assert.ok(st.players[0].skip);
});

test('Snorlax: atascado hasta sacar dobles, usar Poké Flauta / Baya Zreza o 3 turnos', () => {
  const st = R.create({ n: 2 });
  st.players[0].pos = R.SNORLAX; st.players[0].stuck = 3;
  R.act(st, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.players[0].pos, R.SNORLAX);
  assert.strictEqual(st.players[0].stuck, 2);
  assert.throws(() => R.act(st, 0, { type: 'useItem', item: 'flute' }), /No tienes/);
  st.players[0].items.zreza = 1;
  st.phase = 'roll';
  R.act(st, 0, { type: 'useItem', item: 'zreza' });
  assert.strictEqual(st.players[0].stuck, 0);
  assert.strictEqual(st.event.kind, 'wake');
  // Dobles: sale y avanza
  const s2 = R.create({ n: 2 });
  s2.players[0].pos = R.SNORLAX; s2.players[0].stuck = 3;
  R.act(s2, 0, { type: 'roll' }, dice(3, 3));
  assert.strictEqual(s2.players[0].pos, R.SNORLAX + 6);
});

test('deudas: Guardería (50 % y recuperar al 60 %), venta a la Tienda (40 %) y pago automático', () => {
  const st = R.create({ n: 2 });
  st.owners[34] = { owner: 0, daycare: false }; // Ciudad Jubileo (180)
  st.owners[36] = { owner: 0, daycare: false }; // Ciudad Corazón (190)
  st.owners[3] = { owner: 1, daycare: false };
  st.players[0].money = 5;
  R.act(st, 0, { type: 'roll' }, dice(1, 2)); // cae en el pueblo del rival
  assert.strictEqual(st.phase, 'debt');
  assert.strictEqual(st.debt.amount, R.SQUARES[3].rent);
  assert.throws(() => R.act(st, 0, { type: 'end' }), /terminar/);
  R.act(st, 0, { type: 'daycare', sq: 34 });
  assert.strictEqual(st.owners[34].daycare, true);
  assert.strictEqual(st.debt, null, 'con el dinero de la Guardería la deuda se paga sola');
  assert.strictEqual(st.players[0].money, 5 + 90 - R.SQUARES[3].rent);
  assert.throws(() => R.act(st, 0, { type: 'sellBank', sq: 34 }), /Guardería/);
  R.act(st, 0, { type: 'sellBank', sq: 36 });
  assert.ok(!st.owners[36], 'vendido a la Tienda queda libre');
  const before = st.players[0].money;
  R.act(st, 0, { type: 'redeem', sq: 34 });
  assert.strictEqual(st.players[0].money, before - Math.round(180 * 0.6));
  assert.strictEqual(st.owners[34].daycare, false);
});

test('vender a otro jugador: aceptar, rechazar y caducar a los 30 s', () => {
  const st = R.create({ n: 3 });
  st.owners[1] = { owner: 0, daycare: false };
  R.act(st, 0, { type: 'offer', sq: 1, to: 1, price: 90 });
  assert.strictEqual(st.offers.length, 1);
  assert.throws(() => R.act(st, 2, { type: 'answer', id: st.offers[0].id, accept: true }), /no es para ti/);
  R.act(st, 1, { type: 'answer', id: st.offers[0].id, accept: true }); // fuera de su turno también
  assert.strictEqual(st.owners[1].owner, 1);
  assert.strictEqual(st.players[0].money, R.START_MONEY + 90);
  st.owners[3] = { owner: 0, daycare: false };
  R.act(st, 0, { type: 'offer', sq: 3, to: 2, price: 50 });
  R.act(st, 2, { type: 'answer', id: st.offers[0].id, accept: false });
  assert.strictEqual(st.owners[3].owner, 0);
  R.act(st, 0, { type: 'offer', sq: 3, to: 2, price: 50 });
  assert.ok(R.expireOffers(st, Date.now() + 31000));
  assert.strictEqual(st.offers.length, 0);
});

test('retirarse: los bienes pasan al acreedor y el último con dinero gana', () => {
  const st = R.create({ n: 2 });
  st.owners[34] = { owner: 0, daycare: false };
  st.owners[3] = { owner: 1, daycare: false };
  st.players[0].money = 0;
  st.owners[34].daycare = true;
  R.act(st, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.phase, 'debt');
  R.act(st, 0, { type: 'retire' });
  assert.strictEqual(st.owners[34].owner, 1);
  assert.strictEqual(st.phase, 'over');
  assert.strictEqual(st.winner, 1);
  assert.strictEqual(st.reason, 'last');
});

test('transportes: billete según cuántos tenga el dueño y viaje gratis entre los propios', () => {
  const st = R.create({ n: 2 });
  const [t1, t2, t3] = R.TRANSPORTS;
  st.owners[t1] = { owner: 1, daycare: false };
  assert.strictEqual(R.rentOf(st, t1), 30);
  st.owners[t2] = { owner: 1, daycare: false };
  st.owners[t3] = { owner: 1, daycare: false };
  assert.strictEqual(R.rentOf(st, t1), 110);
  // Caer en un transporte propio: viajar a otro
  st.players[1].pos = t1 - 3; st.turn = 1;
  R.act(st, 1, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.phase, 'travel');
  assert.deepStrictEqual(st.pending.options.sort((a, b) => a - b), [t2, t3]);
  R.act(st, 1, { type: 'travel', to: t3 });
  assert.strictEqual(st.players[1].pos, t3);
  assert.ok(st.moves.some((m) => m.kind === 'train'));
});

test('servicios: se paga lo de los dados ×4, o ×10 si el dueño tiene los dos', () => {
  const st = R.create({ n: 2 });
  const [s1, s2] = R.SERVICES;
  st.owners[s1] = { owner: 1, daycare: false };
  st.players[0].pos = s1 - 4;
  R.act(st, 0, { type: 'roll' }, dice(1, 3));
  assert.strictEqual(st.players[0].money, R.START_MONEY - 4 * 4);
  st.owners[s2] = { owner: 1, daycare: false };
  assert.strictEqual(R.rentOf(st, s1, [3, 4]), 70);
});

test('Monte Corona: cruzar la cueva es un atajo que puede salir bien o mal', () => {
  const ok = R.create({ n: 2 });
  ok.players[0].pos = R.CORONA - 3;
  R.act(ok, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(ok.phase, 'corona');
  const k = R.CAVE_EVENTS.findIndex((e) => e.id === 'tunel');
  R.act(ok, 0, { type: 'cave', enter: true }, () => (k + 0.5) / R.CAVE_EVENTS.length);
  assert.strictEqual(ok.players[0].pos, R.CAVE_EXIT);
  assert.deepStrictEqual(ok.moves[0].path, [R.CORONA, ...R.CAVE, R.CAVE_EXIT]);
  const bad = R.create({ n: 2 });
  bad.players[0].pos = R.CORONA - 3;
  R.act(bad, 0, { type: 'roll' }, dice(1, 2));
  const z = R.CAVE_EVENTS.findIndex((e) => e.id === 'zubats');
  R.act(bad, 0, { type: 'cave', enter: true }, () => (z + 0.5) / R.CAVE_EVENTS.length);
  assert.strictEqual(bad.players[0].pos, R.CORONA, 'vuelve a la entrada');
  assert.strictEqual(bad.players[0].money, R.START_MONEY - 30);
  const no = R.create({ n: 2 });
  no.players[0].pos = R.CORONA - 3;
  R.act(no, 0, { type: 'roll' }, dice(1, 2));
  R.act(no, 0, { type: 'cave', enter: false });
  assert.strictEqual(no.players[0].pos, R.CORONA);
});

test('Zona Safari: entrada, 3 Safari Balls y bonus de un uso', () => {
  const st = R.create({ n: 2 });
  const safari = R.SQUARES.findIndex((x) => x.type === 'safari');
  st.players[0].pos = safari - 3;
  R.act(st, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.phase, 'safari');
  // Sale el primero de la lista (Kangaskhan) y la primera Safari Ball acierta
  R.act(st, 0, { type: 'safari', enter: true }, (() => { const q = [0.0, 0.0]; return () => (q.length ? q.shift() : 0.99); })());
  assert.strictEqual(st.players[0].money, R.START_MONEY - R.SAFARI_FEE);
  assert.deepStrictEqual(st.players[0].safari, ['kangaskhan']);
  assert.strictEqual(st.event.kind, 'safari');
  assert.deepStrictEqual(st.event.throws, [true]);
  R.act(st, 0, { type: 'useSafari', id: 'kangaskhan' });
  assert.strictEqual(st.players[0].money, R.START_MONEY - R.SAFARI_FEE + 120);
  assert.deepStrictEqual(st.players[0].safari, []);
  // Ninguna acierta: se escapa
  const s2 = R.create({ n: 2 });
  s2.players[0].pos = safari - 3;
  R.act(s2, 0, { type: 'roll' }, dice(1, 2));
  R.act(s2, 0, { type: 'safari', enter: true }, () => 0.99);
  assert.deepStrictEqual(s2.players[0].safari, []);
  assert.strictEqual(s2.event.throws.length, 3);
});

test('Pokémon del Safari: Exeggcute, Tauros, Dratini, Pinsir y Scyther', () => {
  const st = R.create({ n: 2 });
  st.phase = 'end';
  st.players[0].safari = ['exeggcute', 'tauros', 'dratini', 'pinsir', 'scyther'];
  R.act(st, 0, { type: 'useSafari', id: 'exeggcute' });
  assert.ok(st.extraRoll);
  R.act(st, 0, { type: 'useSafari', id: 'tauros' }, () => 0.5);
  assert.strictEqual(st.players[0].pos, 3);
  st.phase = 'end';
  R.act(st, 0, { type: 'useSafari', id: 'dratini' }, (() => { const q = [5 / 6 + 0.01, 5 / 6 + 0.01, 0.01, 0.01]; return () => (q.length ? q.shift() : 0.5); })());
  assert.strictEqual(st.players[0].medals.length, 1);
  st.owners[34] = { owner: 0, daycare: true };
  R.act(st, 0, { type: 'useSafari', id: 'pinsir', sq: 34 });
  assert.strictEqual(st.owners[34].daycare, false);
  assert.throws(() => R.act(st, 0, { type: 'useSafari', id: 'scyther' }), /solo cuando hace falta/);
  // Scyther protege automáticamente del Equipo Galaxia
  const galaxy = R.SQUARES.findIndex((x) => x.type === 'galaxy');
  st.turn = 0; st.phase = 'roll'; st.extraRoll = false; st.players[0].pos = galaxy - 3; st.players[1].pos = 30;
  const money = st.players[0].money;
  R.act(st, 0, { type: 'roll' }, dice(1, 2));
  assert.strictEqual(st.event.protected, true);
  assert.strictEqual(st.players[0].money, money);
  assert.deepStrictEqual(st.players[0].safari, []);
});

test('el bot juega partidas completas de 2 y 4 jugadores sin atascarse', () => {
  for (const levels of [['hard', 'easy'], ['easy', 'normal', 'hard', 'normal']]) {
    let seed = 42;
    const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const st = R.create({ n: levels.length, target: 5 });
    let n = 0;
    while (st.phase !== 'over' && n++ < 20000) {
      let acted = false;
      for (let p = 0; p < levels.length && !acted; p++) {
        const a = Bot.decide(st, p, levels[p], rng);
        if (a) { R.act(st, p, a, rng); acted = true; }
      }
      assert.ok(acted, `nadie puede actuar en la fase ${st.phase}`);
    }
    assert.strictEqual(st.phase, 'over');
  }
});

test('el bot sale de una deuda con la Guardería', () => {
  const st = R.create({ n: 2 });
  st.owners[34] = { owner: 0, daycare: false };
  st.debt = { p: 0, to: 1, amount: 50, resume: 'end' };
  st.phase = 'debt';
  st.players[0].money = 0;
  assert.deepStrictEqual(Bot.decide(st, 0, 'hard'), { type: 'daycare', sq: 34 });
});

test('Pokémon elegibles: solo el primero de su línea evolutiva (regla estricta) y con sprite', () => {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'base-forms.json'), 'utf8'));
  const ids = new Set(list.map((m) => m.id));
  for (const yes of [1, 4, 7, 172, 10, 129, 371]) assert.ok(ids.has(yes), `#${yes} debería estar`);
  for (const no of [25, 143, 2, 130, 373, 39]) assert.ok(!ids.has(no), `#${no} no es el primero de su línea`);
  assert.ok(list.length > 400);
});

test('sala de 4: bots, elegir Pokémon (shiny, sin repetir), medallas y arranque', () => {
  const m = new RoomManager();
  const { room, token } = m.create(1, 'Ash', 'route');
  assert.ok(room instanceof RouteRoom);
  const g = m.join(room.code, 'Gary');
  room.handle(token, { type: 'addBot' });
  room.handle(token, { type: 'addBot' });
  assert.throws(() => room.handle(token, { type: 'addBot' }), /asientos/);
  assert.throws(() => m.join(room.code, 'Brock'), /llena/);
  assert.throws(() => room.handle(g.token, { type: 'target', n: 5 }), /anfitrión/);
  assert.throws(() => room.handle(token, { type: 'target', n: 9 }), /3 a 8/);
  room.handle(token, { type: 'target', n: 5 });
  room.handle(token, { type: 'pick', mon: 172, shiny: true });
  assert.throws(() => room.handle(g.token, { type: 'pick', mon: 172 }), /ya eligió/);
  assert.throws(() => room.handle(g.token, { type: 'pick', mon: 25 }), /primero de su línea/);
  room.handle(g.token, { type: 'pick', mon: 4 });
  room.handle(token, { type: 'ready', ready: true });
  assert.strictEqual(room.status, 'lobby');
  room.handle(g.token, { type: 'ready', ready: true });
  assert.strictEqual(room.status, 'playing');
  assert.strictEqual(room.rs.players.length, 4);
  assert.strictEqual(room.rs.target, 5);
  const s = room.publicState(token);
  assert.strictEqual(s.seats[0].shiny, true);
  assert.strictEqual(s.seats[0].mon.name, 'Pichu');
  assert.ok(!JSON.stringify(s).includes(token), 'no se filtran tokens');
});

test('partida de Ruta contra bots y chat del Pokéreloj por WebSocket', async () => {
  const { server } = createServer({ botDelayMs: 0 });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const open = () => new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
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
  a.send(JSON.stringify({ type: 'createBot', gen: 1, name: 'Ash', level: 'easy', game: 'route' }));
  const joined = await a.wait((m) => m.type === 'joined');
  await a.wait((m) => m.type === 'chatHistory');
  const b = await open();
  b.send(JSON.stringify({ type: 'join', code: joined.code, name: 'Gary' }));
  const joinedB = await b.wait((m) => m.type === 'joined');

  // Chat: llega a todos, con límite de velocidad y sin HTML interpretado
  a.send(JSON.stringify({ type: 'chat', text: '<img src=x onerror=alert(1)> hola' }));
  const msg = await b.wait((m) => m.type === 'chat');
  assert.strictEqual(msg.item.name, 'Ash');
  assert.strictEqual(msg.item.text, '<img src=x onerror=alert(1)> hola', 'el servidor guarda el texto tal cual; el cliente lo muestra como texto');
  a.send(JSON.stringify({ type: 'chat', text: 'otra vez' }));
  const tooFast = await a.wait((m) => m.type === 'error');
  assert.match(tooFast.message, /segundo/);
  b.send(JSON.stringify({ type: 'react', kind: 'gg' }));
  const react = await a.wait((m) => m.type === 'chat' && m.item.kind === 'react');
  assert.strictEqual(react.item.text, '¡GG!');
  b.send(JSON.stringify({ type: 'typing' }));
  const typing = await a.wait((m) => m.type === 'typing');
  assert.strictEqual(typing.name, 'Gary');

  // Empezar con 3 jugadores (2 humanos + 1 bot) y jugar unas rondas
  a.send(JSON.stringify({ type: 'ready', ready: true }));
  b.send(JSON.stringify({ type: 'ready', ready: true }));
  let st = (await a.wait((m) => m.type === 'state' && m.state.status === 'playing')).state;
  assert.strictEqual(st.rs.players.length, 3);
  // Cada humano en su asiento real (el bot ocupa el asiento 1)
  const socks = { [joined.color]: a, [joinedB.color]: b };
  for (let i = 0; i < 40 && st.status === 'playing'; i++) {
    const rs = st.rs;
    const seatToMove = rs.debt ? st.order[rs.debt.p] : st.order[rs.turn];
    const ws = socks[seatToMove];
    if (!ws) { st = (await a.wait((m) => m.type === 'state' && m.state.rs && m.state.rs.seq > rs.seq)).state; continue; }
    const p = st.order.indexOf(seatToMove);
    const action = Bot.decide(rs, p, 'easy');
    ws.send(JSON.stringify({ type: 'route', action }));
    st = (await a.wait((m) => m.type === 'state' && m.state.rs && m.state.rs.seq > rs.seq)).state;
  }
  assert.ok(st.rs.seq > 10, 'la partida avanza con humanos y bot');

  // Historial del chat al reconectar
  const c = await open();
  c.send(JSON.stringify({ type: 'resume', code: joined.code, token: joined.token }));
  const hist = await c.wait((m) => m.type === 'chatHistory');
  assert.ok(hist.items.length >= 2);
  for (const ws of [a, b, c]) ws.close();
  await new Promise((r) => server.close(r));
});
