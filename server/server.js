/**
 * Servidor de PokéChess: Express sirve la web y un WebSocket (/ws) lleva
 * las partidas en tiempo real. Toda la lógica de juego está en rooms.js.
 *
 * Protocolo (JSON). Cliente -> servidor:
 *   { type: 'create', gen, name, game }  crear sala (eres blancas y anfitrión); game: 'chess'|'checkers'
 *   { type: 'createBot', gen, name, level, game } partida contra el bot ('easy'|'normal'|'hard')
 *   { type: 'game', game }               (anfitrión) 'chess' | 'draughts' (damas) | 'checkers' (damas chinas)
 *   { type: 'join', code, name, gen }    unirte a una sala con tu generación
 *   { type: 'resume', code, token }      reconectar tras recargar la página
 *   { type: 'gen', gen }                 cambiar TU generación
 *   { type: 'board', board }             (anfitrión) tablero temático o 'random'
 *   { type: 'choose', choices }          elegir variantes, p. ej. { n: 1, b: 0 }
 *   { type: 'ready', ready }             listo / no listo
 *   { type: 'move', from, to, promotion }
 *   { type: 'botOptions', level?, gen?, choices?, random? }  (contra el bot) ajustes del bot
 *   { type: 'color', pref }              (contra el bot) 'w' | 'b' | 'random'
 *   { type: 'rules', attentive }         (anfitrión) modo atento o clásico
 *   { type: 'drRules', forced }          (anfitrión, damas) comer obligatorio (true) o libre (false)
 *   { type: 'resign' } | { type: 'rematch' }
 *   Ruta de Medallas (sala de 4): pick · ready · addBot · removeBot · target · board · botOptions
 *     route {action} (ver shared/route.js) · resign · rematch
 *   { type: 'leave' }                    salir de la sala (en partida = rendirse / retirarse)
 *   Pokéreloj (todas las salas): { type: 'chat', text } · { type: 'react', kind } · { type: 'typing' }
 * Servidor -> cliente:
 *   { type: 'joined', code, token, color }   guardar token para reconectar
 *   { type: 'state', state }                 estado completo de la sala
 *   { type: 'error', message }
 *   { type: 'chat', item } · { type: 'chatHistory', items } · { type: 'typing', name, seat }
 *   { type: 'left' } (saliste) · { type: 'notice', text } (aviso para los demás)
 */
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager, RoomError } = require('./rooms');
const Bot = require('./bot');
const CheckersBot = require('./checkersBot');
const DraughtsBot = require('./draughtsBot');
const Route = require('../shared/route');

/** Reacciones rápidas del Pokéreloj (clave -> texto). */
const REACTIONS = { gg: '¡GG!', nice: '¡Bien jugado!', noo: '¡Noooo!', ouch: '¡Eso dolió!', lol: '¡Jajaja!', turn: '¡Te toca!', wow: '¡Increíble!' };
const CHAT_KEEP = 50;
const ROUTE_TYPES = new Set(['pick', 'ready', 'addBot', 'removeBot', 'target', 'board', 'botOptions', 'route', 'resign', 'rematch']);

/**
 * @param {object} [opts]
 * @param {number} [opts.botDelayMs] pausa antes de que el bot mueva (para que se vea natural
 *        y dé tiempo a la animación de la jugada anterior). Las pruebas la ponen a 0.
 */
function createServer({ botDelayMs = 900 } = {}) {
  const app = express();
  const manager = new RoomManager();

  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));
  // Sprites animados (SpriteCollab vía pokesurvivor) y sus metadatos de fotogramas
  app.use('/assets', express.static(path.join(__dirname, '..', 'assets'), { maxAge: '7d' }));
  // chess.js (ESM) para que el navegador calcule las jugadas legales al resaltar casillas
  app.get('/vendor/chess.js', (req, res) =>
    res.sendFile(require.resolve('chess.js').replace(/cjs[\\/]chess\.js$/, path.join('esm', 'chess.js'))));
  app.get('/health', (req, res) => res.json({ ok: true, rooms: manager.rooms.size }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  /** Envía a cada socket de la sala su propia vista del estado. */
  function broadcast(room) {
    for (const ws of wss.clients) {
      if (ws.session && ws.session.code === room.code && ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'state', state: room.publicState(ws.session.token) }));
      }
    }
  }

  /**
   * Si le toca al bot, piensa y mueve tras una pausa. El cálculo es síncrono
   * pero está limitado en tiempo (ver LEVELS en bot.js).
   */
  function scheduleBot(room) {
    if (room.kind === 'route') return scheduleRouteBot(room);
    if (room.botThinking || !room.botToMove()) return;
    room.botThinking = true;
    broadcast(room); // el cliente muestra "pensando…"
    const plies = room.sanHistory.length;
    // Tras una captura la animación de ataque dura más: el bot espera a que termine
    // (en damas chinas, según cuántos saltos tiene que recorrer la ficha)
    const lm = room.lastMove;
    // (en damas, ~1,1 s por cada ficha comida para que se vea cada ataque)
    const extra = !botDelayMs || !lm ? 0
      : Array.isArray(lm.captured) ? 1100 * lm.captured.length
        : lm.captured ? 1300 : lm.path ? 250 * Math.max(0, lm.path.length - 2) : 0;
    setTimeout(() => {
      room.botThinking = false;
      const token = room.botToMove();
      // Puede que entretanto el jugador se haya rendido o la sala haya cambiado
      if (!token || room.sanHistory.length !== plies) return broadcast(room);
      try {
        const mv = room.game === 'checkers'
          ? CheckersBot.chooseMove(room.ck, room.bot.level)
          : room.game === 'draughts'
            ? DraughtsBot.chooseMove(room.dr, room.bot.level)
            : Bot.chooseMove(room.chess.fen(), room.bot.level, { attentive: room.attentive });
        if (mv) room.move(token, mv);
      } catch (err) {
        console.error('Error del bot:', err);
      }
      broadcast(room);
    }, botDelayMs + extra);
  }

  // ---------- Pokéreloj: chat y reacciones ----------
  function sendRoom(room, payload, except) {
    const data = JSON.stringify(payload);
    for (const ws of wss.clients) {
      if (ws !== except && ws.session && ws.session.code === room.code && ws.readyState === 1) ws.send(data);
    }
  }

  function pushChat(room, item) {
    room.chat = room.chat || [];
    room.chatSeq = (room.chatSeq || 0) + 1;
    const full = { id: room.chatSeq, at: Date.now(), ...item };
    room.chat.push(full);
    if (room.chat.length > CHAT_KEEP) room.chat.shift();
    sendRoom(room, { type: 'chat', item: full });
  }

  /** Mensaje o reacción de un jugador (con límite de 1 por segundo). */
  function chatFrom(room, token, item) {
    room.chatLast = room.chatLast || {};
    const now = Date.now();
    if (now - (room.chatLast[token] || 0) < 1000) throw new RoomError('Espera un segundo antes de enviar otro mensaje');
    room.chatLast[token] = now;
    pushChat(room, { seat: room.colorOf(token), name: room.nameOf(token), mon: room.monOf(token), ...item });
  }

  function botReact(room, token, kind) {
    try { pushChat(room, { seat: room.colorOf(token), name: room.nameOf(token), mon: room.monOf(token), kind: 'react', react: kind, text: REACTIONS[kind], bot: true }); } catch { /* sin asiento */ }
  }

  // ---------- Ruta de Medallas: pasos del bot ----------
  function scheduleRouteBot(room) {
    if (room.botThinking || !room.botToMove()) return;
    room.botThinking = true;
    broadcast(room);
    setTimeout(() => {
      room.botThinking = false;
      try {
        const step = room.botStep();
        const rs = room.rs;
        if (step && rs) {
          // Reacciones de los bots: "¡Eso dolió!" al perder un combate y "¡GG!" al terminar
          if (rs.battle) {
            const loserSeat = room.seats[room.order[rs.battle.loser]];
            if (loserSeat && loserSeat.isBot) botReact(room, loserSeat.token, 'ouch');
          }
          if (room.status === 'over') for (const s of room.seats) if (s && s.isBot) botReact(room, s.token, 'gg');
        }
      } catch (err) {
        console.error('Error del bot (ruta):', err);
      }
      broadcast(room);
      scheduleRouteBot(room);
    }, room.botDelay(botDelayMs));
  }

  function attach(ws, room, token, color) {
    ws.session = { code: room.code, token };
    room.setConnected(token, true);
    ws.send(JSON.stringify({ type: 'joined', code: room.code, token, color }));
    ws.send(JSON.stringify({ type: 'chatHistory', items: room.chat || [] }));
    broadcast(room);
    scheduleBot(room); // p. ej. al reconectar en mitad del turno del bot
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      try {
        if (msg.type === 'create') {
          const { room, token, color } = manager.create(msg.gen, msg.name, msg.game || 'chess');
          return attach(ws, room, token, color);
        }
        if (msg.type === 'createBot') {
          const { room, token, color } = manager.createBot(msg.gen, msg.name, msg.level || 'normal', msg.game || 'chess');
          return attach(ws, room, token, color);
        }
        if (msg.type === 'join') {
          const { room, token, color } = manager.join(msg.code, msg.name, msg.gen);
          return attach(ws, room, token, color);
        }
        if (msg.type === 'resume') {
          const room = manager.get(msg.code);
          return attach(ws, room, msg.token, room.colorOf(msg.token));
        }

        // El resto de mensajes necesita estar en una sala
        if (!ws.session) throw new RoomError('Primero crea o únete a una sala');
        const room = manager.get(ws.session.code);
        const { token } = ws.session;

        // Salir de la sala (cualquier juego)
        if (msg.type === 'leave') {
          const res = manager.leave(room.code, token);
          // Las otras pestañas de este mismo jugador también salen
          for (const other of wss.clients) {
            if (other.session && other.session.token === token) {
              other.session = null;
              if (other.readyState === 1) other.send(JSON.stringify({ type: 'left' }));
            }
          }
          if (!res.closed) {
            sendRoom(room, { type: 'notice', text: `${res.name} salió de la sala${res.resigned ? ' (cuenta como rendición)' : ''}.` });
            broadcast(room);
            scheduleBot(room);
          }
          return;
        }

        // Pokéreloj (cualquier sala)
        if (msg.type === 'chat') {
          const text = String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
          if (!text) return;
          return chatFrom(room, token, { kind: 'msg', text });
        }
        if (msg.type === 'react') {
          if (!REACTIONS[msg.kind]) throw new RoomError('Reacción no disponible');
          return chatFrom(room, token, { kind: 'react', react: msg.kind, text: REACTIONS[msg.kind] });
        }
        if (msg.type === 'typing') {
          return sendRoom(room, { type: 'typing', name: room.nameOf(token), seat: room.colorOf(token) }, ws);
        }

        if (room.kind === 'route') {
          if (!ROUTE_TYPES.has(msg.type)) throw new RoomError('Acción no disponible en Ruta de Medallas');
          room.handle(token, msg);
          broadcast(room);
          scheduleBot(room);
          return;
        }
        switch (msg.type) {
          case 'gen': room.setGeneration(token, msg.gen); break;
          case 'board': room.setBoard(token, msg.board); break;
          case 'choose': room.choose(token, msg.choices); break;
          case 'ready': room.setReady(token, msg.ready); break;
          case 'move': room.move(token, msg); break;
          case 'resign': room.resign(token); break;
          case 'rematch': room.requestRematch(token); break;
          case 'botOptions': room.setBotOptions(token, msg); break;
          case 'color': room.setColorPref(token, msg.pref); break;
          case 'rules': room.setAttentive(token, msg.attentive); break;
          case 'drRules': room.setDraughtsForced(token, msg.forced); break;
          case 'game': room.setGame(token, msg.game); break;
          default: return;
        }
        broadcast(room);
        scheduleBot(room);
      } catch (err) {
        if (!(err instanceof RoomError)) console.error(err);
        ws.send(JSON.stringify({ type: 'error', message: err instanceof RoomError ? err.message : 'Error del servidor' }));
      }
    });

    ws.on('close', () => {
      if (!ws.session) return;
      // Si el mismo jugador sigue conectado desde otra pestaña, no lo marcamos desconectado
      for (const other of wss.clients) {
        if (other !== ws && other.session && other.session.token === ws.session.token) return;
      }
      try {
        const room = manager.get(ws.session.code);
        room.setConnected(ws.session.token, false);
        broadcast(room);
      } catch { /* la sala ya no existe */ }
    });
  });

  // Ofertas de venta caducadas (30 s) en las partidas de Ruta de Medallas
  const offerTimer = setInterval(() => {
    for (const room of manager.rooms.values()) {
      if (room.kind === 'route' && room.status === 'playing' && Route.expireOffers(room.rs)) {
        broadcast(room);
        scheduleBot(room);
      }
    }
  }, 3000);
  server.on('close', () => clearInterval(offerTimer));

  // Ping cada 30 s para detectar conexiones muertas, y limpieza de salas vacías
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
    manager.sweep();
  }, 30000);
  server.on('close', () => clearInterval(timer));

  return { server, manager };
}

if (require.main === module) {
  const PORT = Number(process.env.PORT) || 3000;
  const { server } = createServer();
  server.listen(PORT, () => console.log(`PokéChess escuchando en http://localhost:${PORT}`));
}

module.exports = { createServer };
