/**
 * Lógica de salas y partidas (sin red). El servidor WebSocket solo traduce
 * mensajes a llamadas de estas clases, así que todo esto se prueba sin sockets.
 *
 * Una sala pasa por tres estados:
 *   lobby   -> cada jugador elige su generación y variantes, el anfitrión el tablero, y marcan "listo"
 *   playing -> se juega; el servidor valida cada jugada con chess.js
 *   over    -> terminó (mate, tablas o rendición); ambos pueden pedir revancha
 */
const crypto = require('crypto');
const { Chess } = require('chess.js');
const Gens = require('../shared/generations');
const Boards = require('../shared/boards');

/** Error "esperado" cuyo mensaje se puede mostrar al jugador. */
class RoomError extends Error {}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I para evitar confusiones

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
  return s;
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
    this.updatedAt = Date.now();
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
    this.chess = new Chess();
    this.lastMove = null;
    this.result = null;
    this.rematch = { w: false, b: false };
    this.status = 'playing';
    this.activeBoard = this.board === 'random' ? Boards.randomBoard() : this.board;
  }

  /** Valida y aplica una jugada. Devuelve el objeto de jugada de chess.js. */
  move(token, { from, to, promotion } = {}) {
    const color = this.colorOf(token);
    if (this.status !== 'playing') throw new RoomError('La partida no está en curso');
    if (this.chess.turn() !== color) throw new RoomError('No es tu turno');
    let mv;
    try {
      mv = this.chess.move({ from, to, promotion: promotion || undefined });
    } catch {
      mv = null;
    }
    if (!mv) throw new RoomError('Jugada ilegal');
    this.lastMove = { from: mv.from, to: mv.to };
    this.checkGameOver();
    this.touch();
    return mv;
  }

  checkGameOver() {
    const c = this.chess;
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
    if (this.rematch.w && this.rematch.b) {
      [this.seats.w, this.seats.b] = [this.seats.b, this.seats.w];
      for (const c of ['w', 'b']) this.seats[c].ready = false;
      this.status = 'lobby';
      this.result = null;
      this.lastMove = null;
      this.rematch = { w: false, b: false };
      this.chess = new Chess();
    }
    this.touch();
  }

  touch() {
    this.updatedAt = Date.now();
  }

  isEmpty() {
    return !['w', 'b'].some((c) => this.seats[c] && this.seats[c].connected);
  }

  /** Estado que se envía a un jugador (nunca incluye los tokens). */
  publicState(token) {
    let you = null;
    try { you = this.colorOf(token); } catch { /* espectador / desconocido */ }
    const seat = (c) => {
      const s = this.seats[c];
      return s ? { name: s.name, gen: s.gen, choices: s.choices, ready: s.ready, connected: s.connected, host: s.token === this.hostToken } : null;
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
      history: this.chess.history(),
      turn: this.chess.turn(),
      inCheck: this.chess.inCheck(),
      lastMove: this.lastMove,
      result: this.result,
      rematch: this.rematch,
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  /** Crea una sala; el creador es el anfitrión y juega con blancas. */
  create(gen, name) {
    if (!Gens.GENERATIONS[Number(gen)]) throw new RoomError('Generación no disponible');
    let code;
    do code = randomCode(); while (this.rooms.has(code));
    const room = new Room(code);
    this.rooms.set(code, room);
    return { room, ...room.addPlayer(name, gen) };
  }

  join(code, name, gen = 1) {
    const room = this.get(code);
    return { room, ...room.addPlayer(name, gen) };
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

module.exports = { Room, RoomManager, RoomError };
