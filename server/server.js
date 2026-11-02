/**
 * Servidor de PokéChess: Express sirve la web y un WebSocket (/ws) lleva
 * las partidas en tiempo real. Toda la lógica de juego está en rooms.js.
 *
 * Protocolo (JSON). Cliente -> servidor:
 *   { type: 'create', gen, name }        crear sala (eres blancas y anfitrión)
 *   { type: 'createBot', gen, name, level } partida contra el bot ('easy'|'normal'|'hard')
 *   { type: 'join', code, name, gen }    unirte a una sala con tu generación
 *   { type: 'resume', code, token }      reconectar tras recargar la página
 *   { type: 'gen', gen }                 cambiar TU generación
 *   { type: 'board', board }             (anfitrión) tablero temático o 'random'
 *   { type: 'choose', choices }          elegir variantes, p. ej. { n: 1, b: 0 }
 *   { type: 'ready', ready }             listo / no listo
 *   { type: 'move', from, to, promotion }
 *   { type: 'botOptions', level?, gen?, choices?, random? }  (contra el bot) ajustes del bot
 *   { type: 'color', pref }              (contra el bot) 'w' | 'b' | 'random'
 *   { type: 'resign' } | { type: 'rematch' }
 * Servidor -> cliente:
 *   { type: 'joined', code, token, color }   guardar token para reconectar
 *   { type: 'state', state }                 estado completo de la sala
 *   { type: 'error', message }
 */
const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { RoomManager, RoomError } = require('./rooms');
const Bot = require('./bot');

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
    if (room.botThinking || !room.botToMove()) return;
    room.botThinking = true;
    broadcast(room); // el cliente muestra "pensando…"
    const plies = room.chess.history().length;
    setTimeout(() => {
      room.botThinking = false;
      const token = room.botToMove();
      // Puede que entretanto el jugador se haya rendido o la sala haya cambiado
      if (!token || room.chess.history().length !== plies) return broadcast(room);
      try {
        const mv = Bot.chooseMove(room.chess.fen(), room.bot.level);
        if (mv) room.move(token, mv);
      } catch (err) {
        console.error('Error del bot:', err);
      }
      broadcast(room);
    }, botDelayMs);
  }

  function attach(ws, room, token, color) {
    ws.session = { code: room.code, token };
    room.setConnected(token, true);
    ws.send(JSON.stringify({ type: 'joined', code: room.code, token, color }));
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
          const { room, token, color } = manager.create(msg.gen, msg.name);
          return attach(ws, room, token, color);
        }
        if (msg.type === 'createBot') {
          const { room, token, color } = manager.createBot(msg.gen, msg.name, msg.level || 'normal');
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
