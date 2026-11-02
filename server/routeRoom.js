/**
 * Sala de "Ruta de Medallas" (2-4 asientos, humanos o bots).
 *
 * Tiene la misma "forma" que Room (rooms.js) para que server.js la trate igual:
 * colorOf(token) (aquí devuelve el número de asiento), setConnected, isEmpty,
 * publicState, botToMove, nameOf... y además handle(token, msg) para sus mensajes:
 *   pick {mon, shiny} · ready {ready} · addBot · removeBot {seat} · target {n}
 *   board {board} · botOptions {level} · route {action...} · resign · rematch
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const R = require('../shared/route');
const Boards = require('../shared/boards');
const RouteBot = require('./routeBot');

const { RoomError } = require('./errors');
const SEATS = 4;
const LEVELS = ['easy', 'normal', 'hard'];
const BOT_NAMES = ['Bot Rojo', 'Bot Azul', 'Bot Amarillo', 'Bot Verde'];

// Pokémon elegibles: el primero de cada línea evolutiva (regla estricta), con sprite
const BASE_FORMS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'base-forms.json'), 'utf8'));
const BASE_BY_ID = new Map(BASE_FORMS.map((m) => [m.id, m]));

function cleanName(name, fallback) {
  const n = String(name || '').trim().slice(0, 16);
  return n || fallback;
}

class RouteRoom {
  constructor(code) {
    this.code = code;
    this.kind = 'route';
    this.game = 'route';
    this.status = 'lobby';
    this.seats = Array(SEATS).fill(null); // { token, name, mon, shiny, ready, connected, isBot }
    this.hostToken = null;
    this.target = 8;
    this.board = 'random';
    this.activeBoard = null;
    this.botLevel = 'normal';
    this.rs = null;          // estado de la partida (shared/route.js)
    this.order = [];         // order[i] = asiento del jugador i en la partida
    this.rematch = {};
    this.updatedAt = Date.now();
  }

  touch() { this.updatedAt = Date.now(); }

  /** Pokémon al azar que nadie esté usando. */
  freeMon() {
    const used = new Set(this.seats.filter(Boolean).map((s) => s.mon.id));
    const pool = BASE_FORMS.filter((m) => !used.has(m.id));
    return pool[Math.floor(Math.random() * pool.length)];
  }

  addPlayer(name) {
    const i = this.seats.findIndex((s) => !s);
    if (i < 0) throw new RoomError('La sala está llena');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    const token = crypto.randomBytes(16).toString('hex');
    this.seats[i] = { token, name: cleanName(name, `Entrenador ${i + 1}`), mon: this.freeMon(), shiny: false, ready: false, connected: true, isBot: false };
    if (!this.hostToken) this.hostToken = token;
    this.touch();
    return { token, color: i };
  }

  addBot() {
    const i = this.seats.findIndex((s) => !s);
    if (i < 0) throw new RoomError('No quedan asientos libres');
    this.seats[i] = { token: 'bot-' + crypto.randomBytes(8).toString('hex'), name: BOT_NAMES[i], mon: this.freeMon(), shiny: Math.random() < 0.15, ready: true, connected: true, isBot: true };
    this.touch();
    return i;
  }

  colorOf(token) {
    const i = this.seats.findIndex((s) => s && s.token === token);
    if (i < 0) throw new RoomError('No perteneces a esta sala');
    return i;
  }
  nameOf(token) { return this.seats[this.colorOf(token)].name; }
  monOf(token) { const s = this.seats[this.colorOf(token)]; return { id: s.mon.id, shiny: s.shiny }; }

  setConnected(token, connected) {
    this.seats[this.colorOf(token)].connected = connected;
    this.touch();
  }

  isEmpty() {
    return !this.seats.some((s) => s && !s.isBot && s.connected);
  }

  requireHost(token) {
    this.colorOf(token);
    if (token !== this.hostToken) throw new RoomError('Solo el anfitrión puede hacer eso');
  }
  requireLobby() { if (this.status !== 'lobby') throw new RoomError('La partida ya empezó'); }

  /** Jugador de la partida (índice en rs.players) que corresponde a un token. */
  playerOf(token) {
    const p = this.order.indexOf(this.colorOf(token));
    if (p < 0) throw new RoomError('No juegas en esta partida');
    return p;
  }

  start() {
    const filled = this.seats.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    // Orden de turnos al azar
    for (let i = filled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [filled[i], filled[j]] = [filled[j], filled[i]];
    }
    this.order = filled;
    this.rs = R.create({ n: filled.length, target: this.target, names: filled.map((i) => this.seats[i].name) });
    this.activeBoard = this.board === 'random' ? Boards.randomBoard() : this.board;
    this.status = 'playing';
    this.rematch = {};
  }

  tryStart() {
    const filled = this.seats.filter(Boolean);
    if (filled.length >= 2 && filled.every((s) => s.ready)) this.start();
  }

  /** Mensajes propios de esta sala. */
  handle(token, msg) {
    const seat = this.colorOf(token);
    const me = this.seats[seat];
    switch (msg.type) {
      case 'pick': {
        this.requireLobby();
        const mon = BASE_BY_ID.get(Number(msg.mon));
        if (!mon) throw new RoomError('Ese Pokémon no es el primero de su línea evolutiva');
        if (this.seats.some((s, i) => s && i !== seat && s.mon.id === mon.id)) throw new RoomError('Otro jugador ya eligió ese Pokémon');
        me.mon = mon;
        me.shiny = !!msg.shiny;
        me.ready = false;
        break;
      }
      case 'ready':
        this.requireLobby();
        me.ready = !!msg.ready;
        this.tryStart();
        break;
      case 'addBot':
        this.requireHost(token); this.requireLobby();
        this.addBot();
        break;
      case 'removeBot': {
        this.requireHost(token); this.requireLobby();
        const s = this.seats[Number(msg.seat)];
        if (!s || !s.isBot) throw new RoomError('Ese asiento no es un bot');
        this.seats[Number(msg.seat)] = null;
        break;
      }
      case 'target': {
        this.requireHost(token); this.requireLobby();
        const n = Number(msg.n);
        if (!(n >= 3 && n <= 8)) throw new RoomError('Las medallas deben ser de 3 a 8');
        this.target = n;
        break;
      }
      case 'board':
        this.requireHost(token); this.requireLobby();
        if (!Boards.isBoard(msg.board)) throw new RoomError('Tablero no disponible');
        this.board = msg.board;
        break;
      case 'botOptions':
        this.requireHost(token); this.requireLobby();
        if (!LEVELS.includes(msg.level)) throw new RoomError('Dificultad no disponible');
        this.botLevel = msg.level;
        break;
      case 'route': {
        if (this.status !== 'playing') throw new RoomError('La partida no está en curso');
        this.act(this.playerOf(token), msg.action || {});
        break;
      }
      case 'resign':
        if (this.status !== 'playing') throw new RoomError('La partida no está en curso');
        this.act(this.playerOf(token), { type: 'retire' });
        break;
      case 'rematch': {
        if (this.status !== 'over') throw new RoomError('La partida no ha terminado');
        this.rematch[seat] = true;
        const humans = this.seats.map((s, i) => (s && !s.isBot ? i : -1)).filter((i) => i >= 0);
        if (humans.every((i) => this.rematch[i])) {
          this.status = 'lobby';
          this.rs = null;
          this.order = [];
          for (const s of this.seats) if (s) s.ready = !!s.isBot;
        }
        break;
      }
      default:
        throw new RoomError('Acción no disponible en Ruta de Medallas');
    }
    this.touch();
  }

  /** Aplica una acción del jugador p y comprueba si terminó la partida. */
  act(p, action) {
    try {
      R.act(this.rs, p, action);
    } catch (e) {
      throw new RoomError(e.message);
    }
    if (this.rs.phase === 'over') this.status = 'over';
  }

  /** Token del bot que tiene algo que hacer ahora (turno, deuda u oferta pendiente). */
  botToMove() {
    if (this.status !== 'playing') return null;
    for (let p = 0; p < this.order.length; p++) {
      const seat = this.seats[this.order[p]];
      if (!seat || !seat.isBot || this.rs.players[p].out) continue;
      if (RouteBot.decide(this.rs, p, this.botLevel, () => 0.5)) return seat.token;
    }
    return null;
  }

  /** Hace una acción del bot. Devuelve la acción hecha (o null). */
  botStep() {
    const token = this.botToMove();
    if (!token) return null;
    const p = this.playerOf(token);
    const action = RouteBot.decide(this.rs, p, this.botLevel);
    if (!action) return null;
    this.act(p, action);
    return { p, action };
  }

  /** Cuánto esperar antes del siguiente paso del bot (para que se vean las animaciones). */
  botDelay(base) {
    if (!base) return 0;
    const st = this.rs;
    if (!st) return base;
    let ms = base;
    for (const m of st.moves) ms += (m.path.length - 1) * 200;
    if (st.event) ms += 2200;
    if (st.battle) ms += 2600;
    return Math.min(ms, 8000);
  }

  publicState(token) {
    let you = null;
    try { you = this.colorOf(token); } catch { /* espectador */ }
    return {
      kind: 'route',
      game: 'route',
      code: this.code,
      status: this.status,
      you,
      isHost: token === this.hostToken,
      seats: this.seats.map((s) => (s ? { name: s.name, mon: s.mon, shiny: s.shiny, ready: s.ready, connected: s.connected, bot: s.isBot, host: s.token === this.hostToken } : null)),
      target: this.target,
      board: this.board,
      activeBoard: this.activeBoard,
      botLevel: this.botLevel,
      order: this.order,
      rs: this.rs,
      rematch: this.rematch,
      botThinking: !!this.botThinking,
    };
  }
}

module.exports = { RouteRoom, RoomError, BASE_FORMS };
