/**
 * Lógica de salas y partidas (sin red). El servidor WebSocket solo traduce
 * mensajes a llamadas de estas clases, así que todo esto se prueba sin sockets.
 *
 * Una sala pasa por tres estados:
 *   lobby   -> cada jugador elige su generación y variantes, el anfitrión el tablero, y marcan "listo"
 *   playing -> se juega; el servidor valida cada jugada con chess.js
 *   over    -> terminó (mate, tablas o rendición); ambos pueden pedir revancha
 *
 * Modo atento (por defecto): se puede mover aunque el rey quede en peligro; si el
 * rival se come al rey, gana. No hay jaque mate automático ni avisos de jaque.
 * Se usan las jugadas "pseudolegales" de chess.js (_moves({ legal: false })).
 *
 * Modo de juego (room.game): 'chess' (ajedrez), 'draughts' (damas clásicas, reglas en
 * shared/draughts.js) o 'checkers' (damas chinas, shared/checkers.js). Lo elige el anfitrión.
 *
 * Salas contra el bot: uno de los asientos lo ocupa el bot (isBot), que siempre
 * está "listo" y "conectado". El jugador elige dificultad, su color y la
 * generación del bot. Quién mueve al bot lo decide server.js (botToMove + bot.js).
 */
const crypto = require('crypto');
const { Chess } = require('chess.js');
const Gens = require('../shared/generations');
const Boards = require('../shared/boards');
const Checkers = require('../shared/checkers');
const Draughts = require('../shared/draughts');
const GAMES = ['chess', 'draughts', 'checkers'];

const { RoomError } = require('./errors');
const { RouteRoom } = require('./routeRoom');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
}

const BOT_LEVELS = ['easy', 'normal', 'hard'];
const COLOR_PREFS = ['w', 'b', 'random'];
const FLAG_CHARS = { 1: 'n', 2: 'c', 4: 'b', 8: 'e', 16: 'p', 32: 'k', 64: 'q' };
/** Casilla 0x88 -> 'e4'. */
const sq = (i) => 'abcdefgh'[i & 15] + (8 - (i >> 4));
/** Bits de jugada interna de chess.js -> letras de flags ('c', 'e', 'k'...). */
const flagString = (bits) => Object.entries(FLAG_CHARS).filter(([b]) => bits & Number(b)).map(([, c]) => c).join('');

const genIds = () => Object.keys(Gens.GENERATIONS).map(Number);

/** Generación y variantes al azar (para el bot). */
function randomLineup(rand = Math.random) {
  const ids = genIds();
  const gen = ids[Math.floor(rand() * ids.length)];
  const choices = {};
  for (const t of Gens.choosablePieces(gen)) choices[t] = Math.floor(rand() * Gens.GENERATIONS[gen].pieces[t].length);
  return { gen, choices };
}

function cleanName(name, fallback) {
  const n = String(name || '').trim().slice(0, 16);
  return n || fallback;
}

class Room {
  constructor(code) {
    this.code = code;
    this.status = 'lobby';
    this.seats = { w: null, b: null }; // cada asiento: { token, name, gen, choices, ready, connected }
    this.board = 'random';             // tablero elegido por el anfitrión ('random' o id de shared/boards.js)
    this.activeBoard = null;           // tablero de la partida en curso (se decide al empezar)
    this.hostToken = null;
    this.chess = new Chess();
    this.lastMove = null;
    this.result = null; // { winner: 'w'|'b'|null, reason }
    this.rematch = { w: false, b: false };
    this.bot = null;                   // en salas contra el bot: { level, colorPref }
    this.game = 'chess';               // 'chess' | 'checkers'
    this.ck = null;                    // estado de las damas chinas durante la partida
    this.dr = null;                    // estado de las damas clásicas durante la partida
    this.drForced = false;             // damas: comer obligatorio (false = comer libre)
    this.attentive = true;             // modo atento: se puede dejar al rey en peligro
    this.sanHistory = [];              // historial propio (chess.js no anota jugadas pseudolegales)
    this.updatedAt = Date.now();
  }

  /** Sienta al bot en el asiento libre. */
  addBot(level = 'normal', lineup = randomLineup()) {
    if (!BOT_LEVELS.includes(level)) throw new RoomError('Dificultad no disponible');
    const color = !this.seats.w ? 'w' : !this.seats.b ? 'b' : null;
    if (!color) throw new RoomError('La sala está llena');
    this.seats[color] = {
      token: 'bot-' + crypto.randomBytes(8).toString('hex'),
      name: 'Bot Rojo',
      gen: lineup.gen,
      choices: Gens.sanitizeChoices(lineup.gen, lineup.choices),
      ready: true,
      connected: true,
      isBot: true,
    };
    this.bot = { level, colorPref: color === 'b' ? 'w' : 'b' };
    this.touch();
    return color;
  }

  /** Color del bot, o null si la sala no tiene bot. */
  botColor() {
    return ['w', 'b'].find((c) => this.seats[c] && this.seats[c].isBot) || null;
  }

  /** Token del bot si le toca mover ahora; si no, null. */
  botToMove() {
    const c = this.botColor();
    return c && this.status === 'playing' && this.turn() === c ? this.seats[c].token : null;
  }

  /**
   * (Solo el jugador humano, en el lobby) cambia las opciones del bot:
   * { level, gen, choices } o { random: true } para generación y piezas al azar.
   */
  setBotOptions(token, opts = {}) {
    this.colorOf(token);
    const bc = this.botColor();
    if (!bc) throw new RoomError('Esta sala no tiene bot');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    const seat = this.seats[bc];
    if (opts.level !== undefined) {
      if (!BOT_LEVELS.includes(opts.level)) throw new RoomError('Dificultad no disponible');
      this.bot.level = opts.level;
    }
    if (opts.random) {
      const l = randomLineup();
      seat.gen = l.gen;
      seat.choices = l.choices;
    } else {
      if (opts.gen !== undefined) {
        const gen = Number(opts.gen);
        if (!Gens.GENERATIONS[gen]) throw new RoomError('Generación no disponible');
        if (gen !== seat.gen) { seat.gen = gen; seat.choices = Gens.defaultChoices(gen); }
      }
      if (opts.choices) seat.choices = Gens.sanitizeChoices(seat.gen, opts.choices);
    }
    this.touch();
  }

  /** (Salas con bot) el jugador elige jugar con blancas, negras o al azar. */
  setColorPref(token, pref) {
    const me = this.colorOf(token);
    if (!this.bot) throw new RoomError('Esta sala no tiene bot');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    if (!COLOR_PREFS.includes(pref)) throw new RoomError('Color no válido');
    this.bot.colorPref = pref;
    if (pref !== 'random' && pref !== me) [this.seats.w, this.seats.b] = [this.seats.b, this.seats.w];
    this.touch();
  }

  /** Ocupa el primer asiento libre. Devuelve { token, color }. */
  addPlayer(name, gen = 1) {
    gen = Number(gen);
    if (!Gens.GENERATIONS[gen]) throw new RoomError('Generación no disponible');
    const color = !this.seats.w ? 'w' : !this.seats.b ? 'b' : null;
    if (!color) throw new RoomError('La sala está llena');
    const token = crypto.randomBytes(16).toString('hex');
    this.seats[color] = {
      token,
      name: cleanName(name, color === 'w' ? 'Entrenador 1' : 'Entrenador 2'),
      gen,
      choices: Gens.defaultChoices(gen),
      ready: false,
      connected: true,
    };
    if (!this.hostToken) this.hostToken = token;
    this.touch();
    return { token, color };
  }

  /** Color del jugador con ese token; lanza error si no está en la sala. */
  colorOf(token) {
    if (this.seats.w && this.seats.w.token === token) return 'w';
    if (this.seats.b && this.seats.b.token === token) return 'b';
    throw new RoomError('No perteneces a esta sala');
  }

  setConnected(token, connected) {
    this.seats[this.colorOf(token)].connected = connected;
    this.touch();
  }

  nameOf(token) { return this.seats[this.colorOf(token)].name; }

  /** Pokémon que representa al jugador en el chat: su rey, su primera ficha o su ficha de damas. */
  monOf(token) {
    const color = this.colorOf(token);
    const s = this.seats[color];
    const g = Gens.GENERATIONS[s.gen];
    const mon = this.game === 'checkers' ? g.checkers[0] : this.game === 'draughts' ? g.draughts.man : Gens.pokemonFor(s.gen, 'k', s.choices);
    return { id: mon.id, shiny: color === 'b' };
  }

  /** Cada jugador elige SU generación (solo en el lobby). Reinicia sus variantes. */
  setGeneration(token, gen) {
    const seat = this.seats[this.colorOf(token)];
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    gen = Number(gen);
    if (!Gens.GENERATIONS[gen]) throw new RoomError('Generación no disponible');
    seat.gen = gen;
    seat.choices = Gens.defaultChoices(gen);
    seat.ready = false;
    this.touch();
  }

  /** El anfitrión elige a qué se juega: ajedrez o damas chinas. */
  setGame(token, game) {
    this.colorOf(token);
    if (token !== this.hostToken) throw new RoomError('Solo el anfitrión elige el juego');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    if (!GAMES.includes(game)) throw new RoomError('Juego no disponible');
    this.game = game;
    this.touch();
  }

  /** Turno actual en cualquiera de los dos juegos. */
  turn() {
    if (this.game === 'checkers' && this.ck) return this.ck.turn;
    if (this.game === 'draughts' && this.dr) return this.dr.turn;
    return this.chess.turn();
  }

  /** (Damas) el anfitrión elige si comer es obligatorio o libre. */
  setDraughtsForced(token, on) {
    this.colorOf(token);
    if (token !== this.hostToken) throw new RoomError('Solo el anfitrión elige las reglas');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    this.drForced = !!on;
    this.touch();
  }

  /** El anfitrión elige las reglas: modo atento (true) o clásico (false). */
  setAttentive(token, on) {
    this.colorOf(token);
    if (token !== this.hostToken) throw new RoomError('Solo el anfitrión elige las reglas');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    this.attentive = !!on;
    this.touch();
  }

  /** El anfitrión elige el tablero temático (o 'random'). */
  setBoard(token, board) {
    this.colorOf(token);
    if (token !== this.hostToken) throw new RoomError('Solo el anfitrión elige el tablero');
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    if (!Boards.isBoard(board)) throw new RoomError('Tablero no disponible');
    this.board = board;
    this.touch();
  }

  /** Cada jugador elige sus propias variantes (caballo / alfil...). */
  choose(token, choices) {
    const seat = this.seats[this.colorOf(token)];
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    seat.choices = Gens.sanitizeChoices(seat.gen, choices);
    seat.ready = false; // si cambias tus piezas, vuelves a confirmar
    this.touch();
  }

  /** Marca listo; cuando ambos jugadores lo están, empieza la partida. */
  setReady(token, ready) {
    const seat = this.seats[this.colorOf(token)];
    if (this.status !== 'lobby') throw new RoomError('La partida ya empezó');
    seat.ready = !!ready;
    if (this.seats.w && this.seats.b && this.seats.w.ready && this.seats.b.ready) this.start();
    this.touch();
  }

  start() {
    // Contra el bot con color "aleatorio": se sortea al empezar
    if (this.bot && this.bot.colorPref === 'random' && Math.random() < 0.5) {
      [this.seats.w, this.seats.b] = [this.seats.b, this.seats.w];
    }
    this.chess = new Chess();
    this.ck = this.game === 'checkers' ? Checkers.create() : null;
    this.dr = this.game === 'draughts' ? Draughts.create({ forced: this.drForced }) : null;
    this.sanHistory = [];
    this.lastMove = null;
    this.result = null;
    this.rematch = { w: false, b: false };
    this.status = 'playing';
    this.activeBoard = this.board === 'random' ? Boards.randomBoard() : this.board;
  }

  /**
   * Valida y aplica una jugada. Devuelve { from, to, san, flags, captured, promotion }.
   * En modo atento vale cualquier jugada que la pieza pueda hacer, aunque deje
   * a su rey en peligro; comerse al rey termina la partida.
   */
  move(token, { from, to, promotion, path } = {}) {
    const color = this.colorOf(token);
    if (this.status !== 'playing') throw new RoomError('La partida no está en curso');
    if (this.turn() !== color) throw new RoomError('No es tu turno');
    if (this.game === 'checkers') return this.checkersMove(color, from, to);
    if (this.game === 'draughts') return this.draughtsMove(color, from, to, path);
    const mv = this.attentive ? this.pseudoMove(from, to, promotion) : this.legalMove(from, to, promotion);
    if (!mv) throw new RoomError('Jugada ilegal');
    this.sanHistory.push(mv.san);
    this.lastMove = mv;
    if (mv.captured === 'k') this.finish(color, 'king');
    else this.checkGameOver();
    this.touch();
    return mv;
  }

  /** Damas chinas: valida y aplica; gana quien llena la meta, tablas al límite de jugadas. */
  checkersMove(color, from, to) {
    let res;
    try { res = Checkers.applyMove(this.ck, color, from, to); } catch (e) { throw new RoomError(e.message); }
    const seat = this.seats[color];
    const mon = Gens.GENERATIONS[seat.gen].checkers[res.id];
    const text = `${mon.name} ${res.jumps ? (res.jumps > 1 ? `salta ×${res.jumps}` : 'salta') : 'avanza'}`;
    this.sanHistory.push(text);
    this.lastMove = { from, to, path: res.path, id: res.id, color, jumps: res.jumps };
    if (Checkers.hasWon(this.ck, color)) this.finish(color, 'goal');
    else if (this.ck.moves >= Checkers.MAX_MOVES) this.finish(null, 'limit');
    this.touch();
    return this.lastMove;
  }

  /** Damas clásicas: valida, aplica, anota y comprueba si la partida terminó. */
  draughtsMove(color, from, to, path) {
    let m;
    try { m = Draughts.applyMove(this.dr, color, from, to, Array.isArray(path) ? path : undefined); } catch (e) { throw new RoomError(e.message); }
    const pair = Gens.GENERATIONS[this.seats[color].gen].draughts;
    const name = m.wasKing ? pair.king.name : pair.man.name;
    const route = m.captured.length ? m.path.join('×') : `${from}-${to}`;
    this.sanHistory.push(`${name} ${route}${m.crown ? ' ⭐' : ''}`);
    this.lastMove = { from, to, path: m.path, captured: m.captured, crown: m.crown, color, id: m.id };
    const end = Draughts.outcome(this.dr);
    if (end) this.finish(end.winner, end.reason);
    this.touch();
    return this.lastMove;
  }

  /** Reglas clásicas: la API pública de chess.js. */
  legalMove(from, to, promotion) {
    let mv = null;
    try { mv = this.chess.move({ from, to, promotion: promotion || undefined }); } catch { mv = null; }
    return mv && { from: mv.from, to: mv.to, san: mv.san, flags: mv.flags, captured: mv.captured, promotion: mv.promotion };
  }

  /** Modo atento: busca la jugada entre las pseudolegales y la aplica con los métodos internos. */
  pseudoMove(from, to, promotion) {
    const c = this.chess;
    const moves = c._moves({ legal: false });
    const m = moves.find((x) => sq(x.from) === from && sq(x.to) === to
      && (!x.promotion || x.promotion === (promotion || 'q')));
    if (!m) return null;
    let san;
    if (m.captured === 'k') san = `${m.piece === 'p' ? from[0] : m.piece.toUpperCase()}x${to}#`;
    else {
      try { san = c._moveToSan(m, moves).replace(/[+#]$/, ''); } catch { san = from + to; }
    }
    c._makeMove(m);
    return { from, to, san, flags: flagString(m.flags), captured: m.captured, promotion: m.promotion };
  }

  checkGameOver() {
    const c = this.chess;
    if (this.attentive) {
      // Sin jaque mate ni ahogado: solo tablas por material o por la regla de 50 jugadas
      if (c.isInsufficientMaterial()) this.finish(null, 'material');
      else if (c._halfMoves >= 100) this.finish(null, 'fifty');
      return;
    }
    if (!c.isGameOver()) return;
    let reason;
    let winner = null;
    if (c.isCheckmate()) {
      reason = 'checkmate';
      winner = c.turn() === 'w' ? 'b' : 'w'; // el que tiene el turno es el que recibió mate
    } else if (c.isStalemate()) reason = 'stalemate';
    else if (c.isThreefoldRepetition()) reason = 'repetition';
    else if (c.isInsufficientMaterial()) reason = 'material';
    else reason = 'fifty';
    this.finish(winner, reason);
  }

  finish(winner, reason) {
    this.status = 'over';
    this.result = { winner, reason };
    this.rematch = { w: false, b: false };
  }

  resign(token) {
    const color = this.colorOf(token);
    if (this.status !== 'playing') throw new RoomError('La partida no está en curso');
    this.finish(color === 'w' ? 'b' : 'w', 'resign');
    this.touch();
  }

  /**
   * Revancha: cuando ambos la piden se vuelve al lobby con los colores
   * intercambiados (así se puede cambiar de generación o de piezas).
   */
  requestRematch(token) {
    const color = this.colorOf(token);
    if (this.status !== 'over') throw new RoomError('La partida no ha terminado');
    this.rematch[color] = true;
    const bc = this.botColor();
    if (bc) this.rematch[bc] = true; // el bot siempre acepta la revancha
    if (this.rematch.w && this.rematch.b) {
      // Contra el bot se respeta el color elegido (o se vuelve a sortear al empezar)
      if (!bc) [this.seats.w, this.seats.b] = [this.seats.b, this.seats.w];
      for (const c of ['w', 'b']) this.seats[c].ready = !!this.seats[c].isBot;
      this.status = 'lobby';
      this.result = null;
      this.lastMove = null;
      this.rematch = { w: false, b: false };
      this.chess = new Chess();
      this.ck = null;
      this.dr = null;
      this.sanHistory = [];
    }
    this.touch();
  }

  touch() {
    this.updatedAt = Date.now();
  }

  /**
   * Un jugador sale de la sala. En plena partida cuenta como rendición; después la sala
   * vuelve al lobby con su asiento libre (esperando a otro rival) y, si era el anfitrión,
   * el cargo pasa al otro jugador. Devuelve { name, resigned }.
   */
  leave(token) {
    const color = this.colorOf(token);
    const seat = this.seats[color];
    const resigned = this.status === 'playing';
    if (resigned) this.finish(color === 'w' ? 'b' : 'w', 'left');
    this.seats[color] = null;
    const other = this.seats[color === 'w' ? 'b' : 'w'];
    if (token === this.hostToken) this.hostToken = other && !other.isBot ? other.token : null;
    // De vuelta al lobby: el que se queda espera a un rival nuevo
    this.status = 'lobby';
    this.chess = new Chess();
    this.ck = null;
    this.dr = null;
    this.sanHistory = [];
    this.lastMove = null;
    this.result = null;
    this.rematch = { w: false, b: false };
    if (other && !other.isBot) other.ready = false;
    this.touch();
    return { name: seat.name, resigned };
  }

  /** ¿Queda algún jugador humano en la sala? */
  hasHumans() {
    return ['w', 'b'].some((c) => this.seats[c] && !this.seats[c].isBot);
  }

  isEmpty() {
    return !['w', 'b'].some((c) => this.seats[c] && !this.seats[c].isBot && this.seats[c].connected);
  }

  /** Estado que se envía a un jugador (nunca incluye los tokens). */
  publicState(token) {
    let you = null;
    try { you = this.colorOf(token); } catch { /* espectador / desconocido */ }
    const seat = (c) => {
      const s = this.seats[c];
      return s ? { name: s.name, gen: s.gen, choices: s.choices, ready: s.ready, connected: s.connected, host: s.token === this.hostToken, bot: !!s.isBot } : null;
    };
    return {
      code: this.code,
      board: this.board,
      activeBoard: this.activeBoard,
      status: this.status,
      you,
      isHost: token === this.hostToken,
      players: { w: seat('w'), b: seat('b') },
      fen: this.chess.fen(),
      history: this.sanHistory,
      game: this.game,
      drForced: this.drForced,
      dr: this.dr ? { cells: this.dr.cells, quiet: this.dr.quiet, forced: this.dr.forced, count: { w: Draughts.count(this.dr, 'w'), b: Draughts.count(this.dr, 'b') } } : null,
      ck: this.ck ? { cells: this.ck.cells, moves: this.ck.moves, inGoal: { w: Checkers.inGoal(this.ck, 'w'), b: Checkers.inGoal(this.ck, 'b') } } : null,
      turn: this.turn(),
      // En modo atento no se avisa del jaque (hay que estar atento)
      inCheck: this.game === 'chess' && !this.attentive && this.status === 'playing' && this.chess.inCheck(),
      attentive: this.attentive,
      lastMove: this.lastMove,
      result: this.result,
      rematch: this.rematch,
      bot: this.bot ? { ...this.bot } : null,
      botThinking: !!this.botThinking,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  /** Crea una sala; el creador es el anfitrión y juega con blancas. */
  create(gen, name, game = 'chess') {
    if (!Gens.GENERATIONS[Number(gen)]) throw new RoomError('Generación no disponible');
    if (!GAMES.includes(game) && game !== 'route') throw new RoomError('Juego no disponible');
    let code;
    do code = randomCode(); while (this.rooms.has(code));
    if (game === 'route') {
      // Ruta de Medallas: sala propia de hasta 4 asientos
      const room = new RouteRoom(code);
      this.rooms.set(code, room);
      return { room, ...room.addPlayer(name) };
    }
    const room = new Room(code);
    room.game = game;
    this.rooms.set(code, room);
    return { room, ...room.addPlayer(name, gen) };
  }

  /** Partida contra el bot: el jugador es anfitrión (blancas) y el bot ocupa las negras. */
  createBot(gen, name, level = 'normal', game = 'chess') {
    const res = this.create(gen, name, game);
    if (game === 'route') {
      res.room.botLevel = BOT_LEVELS.includes(level) ? level : 'normal';
      res.room.addBot();
      return res;
    }
    res.room.addBot(level);
    return res;
  }

  join(code, name, gen = 1) {
    const room = this.get(code);
    return { room, ...room.addPlayer(name, gen) };
  }

  /** Un jugador sale; si no quedan humanos, la sala se cierra. */
  leave(code, token) {
    const room = this.get(code);
    const res = room.leave(token);
    const closed = !room.hasHumans();
    if (closed) this.rooms.delete(room.code);
    return { room, closed, ...res };
  }

  get(code) {
    const room = this.rooms.get(String(code || '').trim().toUpperCase());
    if (!room) throw new RoomError('Sala no encontrada');
    return room;
  }

  /** Borra salas vacías sin actividad en `maxIdleMs`. */
  sweep(maxIdleMs = 30 * 60 * 1000, now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (room.isEmpty() && now - room.updatedAt > maxIdleMs) this.rooms.delete(code);
    }
  }
}

module.exports = { Room, RoomManager, RoomError, BOT_LEVELS, GAMES };
