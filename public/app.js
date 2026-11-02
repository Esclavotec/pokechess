/**
 * Cliente de PokéChess.
 * - Se conecta al servidor por WebSocket y muestra el estado que este envía.
 * - El servidor es la autoridad; aquí chess.js solo se usa para resaltar las
 *   jugadas legales y para saber cómo animar la última jugada.
 * - El tablero tiene dos capas: casillas (#board, se redibuja libremente) y
 *   piezas (#pieces, persistentes, para que caminen de una casilla a otra).
 * - El token de cada jugador se guarda en sessionStorage (por pestaña), así
 *   recargar la página te devuelve a tu asiento y dos pestañas pueden jugar entre sí.
 */
import { Chess } from '/vendor/chess.js';
import { loadMeta, MonSprite, dirFromDelta, hydrateThumbs } from './sprites.js';
import { createRouteUI } from './route-ui.js';
import { createPoketch } from './poketch.js';

const Gens = window.PokeGenerations;
const Boards = window.PokeBoards;
const CK = window.PokeCheckers;
const DR = window.PokeDraughts;
const $ = (id) => document.getElementById(id);
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const COLOR_NAME = { w: 'Blancas', b: 'Negras' };
const BALL = { w: { cls: 'honor', name: 'Honor Ball' }, b: { cls: 'ocaso', name: 'Ocaso Ball' } };
const REASONS = {
  checkmate: '¡Jaque mate!',
  resign: 'Rendición',
  stalemate: 'Tablas por ahogado',
  repetition: 'Tablas por triple repetición',
  material: 'Tablas por material insuficiente',
  fifty: 'Tablas por la regla de 50 jugadas',
  king: '¡Se comió al rey!',
  goal: '¡Todas sus fichas llegaron a la meta!',
  limit: 'Tablas por límite de jugadas',
  wipeout: '¡Se comió todas las fichas!',
  blocked: '¡Dejó al rival sin movimientos!',
  quiet: 'Tablas: 80 jugadas sin capturas',
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const LEVEL_NAME = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
const ROBOT = '<span class="px-robot" aria-hidden="true"></span>';

/** Carga una posición aunque falte un rey (al final de una partida en modo atento). */
function loadChess(fen) {
  const c = new Chess();
  c.load(fen, { skipValidation: true });
  return c;
}
/** Casilla 0x88 interna de chess.js -> 'e4'. */
const sq0x88 = (i) => 'abcdefgh'[i & 15] + (8 - (i >> 4));

let ws = null;
let state = null;          // último estado recibido del servidor
let selected = null;       // casilla seleccionada, p. ej. 'e2'
let homeGen = 1;           // generación elegida en la pantalla de inicio
let homeGame = 'chess';    // juego elegido en la pantalla de inicio
let pendingPromo = null;   // { from, to } mientras se elige la pieza de coronación

// ---------- Conexión ----------

function connect(onOpen) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = onOpen;
  ws.onmessage = (ev) => handle(JSON.parse(ev.data));
  ws.onclose = () => {
    // Reintenta y recupera el asiento si estábamos en una sala
    const saved = loadSession();
    if (saved) setTimeout(() => connect(() => send({ type: 'resume', ...saved })), 1500);
  };
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
  else toast('Conectando con el servidor…');
}

function saveSession(code, token) { try { sessionStorage.setItem('pokechess', JSON.stringify({ code, token })); } catch {} }
function loadSession() { try { return JSON.parse(sessionStorage.getItem('pokechess')); } catch { return null; } }
function clearSession() { try { sessionStorage.removeItem('pokechess'); } catch {} }

function handle(msg) {
  if (msg.type === 'joined') {
    saveSession(msg.code, msg.token);
    history.replaceState(null, '', `?sala=${msg.code}`);
  } else if (msg.type === 'state') {
    const prev = state;
    state = msg.state;
    if (!prev || prev.status !== state.status) selected = null;
    render(prev);
  } else if (msg.type === 'chat') {
    poketch.message(msg.item);
  } else if (msg.type === 'chatHistory') {
    poketch.history(msg.items);
  } else if (msg.type === 'typing') {
    poketch.typing(msg.name);
  } else if (msg.type === 'error') {
    toast(msg.message);
    // Si la sala ya no existe o el token no vale, volvemos al inicio
    if (/no encontrada|No perteneces/.test(msg.message) && !state) clearSession();
  }
}

// ---------- Utilidades de sprites ----------

function monFor(color, type, st = state) {
  const p = st.players[color];
  return Gens.pokemonFor(p.gen, type, p.choices);
}

/** Miniatura animada (se activa con hydrateThumbs tras insertar el HTML). */
function thumb(mon, shiny, extra = '') {
  return `<canvas class="thumb ${extra}" data-mon="${mon.id}" data-shiny="${shiny ? 1 : 0}" title="${mon.name}" aria-label="${mon.name}"></canvas>`;
}

function setHtml(el, html) {
  el.innerHTML = html;
  hydrateThumbs(el);
}

// ---------- Render general ----------

function show(screen) {
  for (const s of ['home', 'lobby', 'game']) $(`screen-${s}`).classList.toggle('hidden', s !== screen);
}

function render(prev) {
  poketch.setVisible(!!state);
  if (!state) return show('home');
  $('room-badge').textContent = `Sala ${state.code}`;
  $('room-badge').classList.remove('hidden');
  if (state.kind === 'route') {
    if (state.status === 'lobby') { routeUI.reset(); show('lobby'); renderBoardsPick(); routeUI.renderLobby(); }
    else { show('game'); routeUI.renderGame(prev); }
  } else if (state.status === 'lobby') { show('lobby'); renderLobby(); }
  else { show('game'); renderGame(prev); }
  poketch.refreshLog();
}

/** Líneas del registro de la partida para el Pokéreloj. */
function gameLog() {
  if (!state) return [];
  if (state.kind === 'route') return state.rs ? state.rs.log.map((l) => l.text) : [];
  return (state.history || []).map((h, i) => (state.game === 'chess' ? `${Math.floor(i / 2) + 1}${i % 2 ? '…' : '.'} ${h}` : h));
}

/** Tarjetas de generación con su rey, reina y peón animados. */
function genCards(container, activeGen, enabled, onPick) {
  setHtml(container, Object.entries(Gens.GENERATIONS).map(([n, g]) => `
    <button class="gen-card ${Number(n) === activeGen ? 'active' : ''}" data-gen="${n}" ${enabled ? '' : 'disabled'}>
      <div class="t">${g.name}</div><div class="r">${g.region}</div>
      <div class="mons">${['k', 'q', 'p'].map((t) => thumb(g.pieces[t][0], false)).join('')}</div>
    </button>`).join(''));
  if (enabled) container.querySelectorAll('.gen-card').forEach((b) => (b.onclick = () => onPick(Number(b.dataset.gen))));
}

// ---------- Lobby ----------

function renderLobby() {
  $('lobby-code').textContent = state.code;
  $('share-row').classList.toggle('hidden', !!state.bot); // contra el bot no hay nada que compartir
  renderBotSettings();
  renderGameSettings();
  renderRules();

  renderBoardsPick();
  $('board-note').textContent = state.bot
    ? 'Elige el tablero, tus piezas y las del bot.'
    : state.isHost
      ? 'Como anfitrión eliges el tablero. Cada jugador elige su generación y sus piezas.'
      : 'El anfitrión elige el tablero. Tú eliges tu generación y tus piezas.';
  renderLobbyPanels();
}

/** Tableros temáticos (los elige el anfitrión). */
function renderBoardsPick() {
  const opts = [{ id: 'random', name: 'Aleatorio', region: 'Sorpresa' }, ...Boards.BOARDS];
  $('lobby-boards').innerHTML = opts.map((b) => `
    <button class="board-card ${state.board === b.id ? 'active' : ''}" data-board="${b.id}" ${state.isHost ? '' : 'disabled'}>
      <div class="mini theme-${b.id}">${'<i></i>'.repeat(16)}</div>
      <div class="t">${b.name}</div><div class="r">${b.region}</div>
    </button>`).join('');
  if (state.isHost) $('lobby-boards').querySelectorAll('.board-card').forEach((b) => (b.onclick = () => send({ type: 'board', board: b.dataset.board })));
}

/** Paneles de los dos jugadores en el lobby de ajedrez, damas y damas chinas. */
function renderLobbyPanels() {
  const me = state.you;
  const rival = me === 'w' ? 'b' : 'w';
  setHtml($('my-panel'), playerPanel(me, true));
  setHtml($('rival-panel'), state.players[rival]
    ? playerPanel(rival, false, !!state.bot)
    : `<div class="panel-head"><div class="who">Esperando rival…</div></div>
       <p class="muted">Comparte el código <b>${state.code}</b> o el link de la sala.</p>`);

  // Eventos del panel propio
  const panel = $('my-panel');
  panel.querySelectorAll('.gen-card').forEach((b) => (b.onclick = () => send({ type: 'gen', gen: Number(b.dataset.gen) })));
  panel.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    const choices = { ...state.players[me].choices, [b.dataset.type]: Number(b.dataset.i) };
    send({ type: 'choose', choices });
  }));
  const readyBtn = panel.querySelector('.ready-btn');
  if (readyBtn) readyBtn.onclick = () => send({ type: 'ready', ready: !state.players[me].ready });

  // Contra el bot: tú eliges también su generación y sus piezas
  if (state.bot) {
    const bp = $('rival-panel');
    bp.querySelectorAll('.gen-card').forEach((b) => (b.onclick = () => send({ type: 'botOptions', gen: Number(b.dataset.gen) })));
    bp.querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
      const choices = { ...state.players[rival].choices, [b.dataset.type]: Number(b.dataset.i) };
      send({ type: 'botOptions', choices });
    }));
    const rnd = bp.querySelector('.random-btn');
    if (rnd) rnd.onclick = () => send({ type: 'botOptions', random: true });
  }
}

/** Reglas: modo atento (por defecto) o clásico. Las elige el anfitrión. */
function renderRules() {
  const box = $('rules-settings');
  if (state.game === 'draughts') return renderDraughtsRules(box);
  if (state.game !== 'chess') { box.innerHTML = ''; return; } // las damas chinas no tienen opciones
  const can = state.isHost;
  box.innerHTML = `
    <h2>Reglas</h2>
    <div class="segmented" data-name="rules">
      <button class="seg ${state.attentive ? 'active' : ''}" data-v="1" ${can ? '' : 'disabled'}>Modo atento</button>
      <button class="seg ${state.attentive ? '' : 'active'}" data-v="0" ${can ? '' : 'disabled'}>Clásico</button>
    </div>
    <p class="muted small">${state.attentive
      ? 'Puedes mover aunque dejes a tu rey en peligro, y nadie te avisa del jaque. Si el rival se come a tu rey, pierdes. ¡Atento!'
      : 'Reglas normales del ajedrez: no se puede dejar al rey en jaque y se gana por jaque mate.'}</p>`;
  if (can) box.querySelectorAll('.seg').forEach((b) => (b.onclick = () => send({ type: 'rules', attentive: b.dataset.v === '1' })));
}

/** Reglas de las damas: comer libre (por defecto) u obligatorio. */
function renderDraughtsRules(box) {
  const can = state.isHost;
  box.innerHTML = `
    <h2>Reglas</h2>
    <div class="segmented" data-name="drRules">
      <button class="seg ${state.drForced ? '' : 'active'}" data-v="0" ${can ? '' : 'disabled'}>Comer libre</button>
      <button class="seg ${state.drForced ? 'active' : ''}" data-v="1" ${can ? '' : 'disabled'}>Comer obligatorio</button>
    </div>
    <p class="muted small">${state.drForced
      ? 'Si puedes comer, tienes que comer, y la cadena de saltos se completa entera.'
      : 'Comes solo si quieres, y en una cadena de saltos puedes parar en cualquier salto.'}</p>`;
  if (can) box.querySelectorAll('.seg').forEach((b) => (b.onclick = () => send({ type: 'drRules', forced: b.dataset.v === '1' })));
}

/** Juego de la sala: ajedrez o damas chinas (lo elige el anfitrión). */
function renderGameSettings() {
  const box = $('game-settings');
  const can = state.isHost;
  box.innerHTML = `
    <h2>Juego</h2>
    <div class="segmented" data-name="game">
      <button class="seg ${state.game === 'chess' ? 'active' : ''}" data-v="chess" ${can ? '' : 'disabled'}>♟ Ajedrez</button>
      <button class="seg ${state.game === 'draughts' ? 'active' : ''}" data-v="draughts" ${can ? '' : 'disabled'}>⛀ Damas</button>
      <button class="seg ${state.game === 'checkers' ? 'active' : ''}" data-v="checkers" ${can ? '' : 'disabled'}>✦ Damas chinas</button>
    </div>
    ${state.game === 'draughts' ? '<p class="muted small">Damas clásicas: avanza en diagonal y come saltando, encadenando capturas. Al llegar al fondo la ficha evoluciona y se mueve en cualquier diagonal. Gana quien deja al rival sin fichas o sin movimientos.</p>' : ''}
    ${state.game === 'checkers' ? '<p class="muted small">Lleva tus 10 Pokémon a la punta contraria de la estrella. Puedes avanzar a un hueco vecino o saltar por encima de cualquier ficha, encadenando saltos. Tablas a las 200 jugadas.</p>' : ''}`;
  if (can) box.querySelectorAll('.seg').forEach((b) => (b.onclick = () => send({ type: 'game', game: b.dataset.v })));
}

/** Ajustes de la partida contra el bot: dificultad y tu color. */
function renderBotSettings() {
  const box = $('bot-settings');
  if (!state.bot) { box.innerHTML = ''; return; }
  const seg = (name, items, active) => `<div class="segmented" data-name="${name}">${items.map(([v, label]) =>
    `<button class="seg ${v === active ? 'active' : ''}" data-v="${v}">${label}</button>`).join('')}</div>`;
  const help = state.game === 'draughts' ? {
    easy: 'Mueve casi al azar, aunque si puede comer suele comer.',
    normal: 'Piensa 4 jugadas por adelantado.',
    hard: 'Piensa hasta 8 jugadas por adelantado.',
  } : state.game === 'checkers' ? {
    easy: 'Elige al azar entre las jugadas que más avanzan.',
    normal: 'Busca la jugada (o cadena de saltos) que más le acerca a la meta.',
    hard: 'Además piensa en tu mejor respuesta.',
  } : {
    easy: 'Mueve casi al azar, pero si puede comer una pieza la come.',
    normal: 'Piensa 2 jugadas por adelantado.',
    hard: 'Piensa hasta 4 jugadas por adelantado.',
  };
  box.innerHTML = `
    <h2>Contra el bot</h2>
    <div class="label-sm">Dificultad</div>
    ${seg('level', [['easy', 'Fácil'], ['normal', 'Normal'], ['hard', 'Difícil']], state.bot.level)}
    <p class="muted small">${help[state.bot.level]}</p>
    <div class="label-sm">Tu color</div>
    ${seg('color', [['w', 'Blancas · Honor Ball'], ['b', 'Negras · Ocaso Ball'], ['random', 'Aleatorio']], state.bot.colorPref)}`;
  box.querySelectorAll('[data-name="level"] .seg').forEach((b) => (b.onclick = () => send({ type: 'botOptions', level: b.dataset.v })));
  box.querySelectorAll('[data-name="color"] .seg').forEach((b) => (b.onclick = () => send({ type: 'color', pref: b.dataset.v })));
}

function playerPanel(color, mine, botEditable = false) {
  const p = state.players[color];
  const g = Gens.GENERATIONS[p.gen];
  const shiny = color === 'b';
  const editable = (mine && !p.ready) || (botEditable && !state.players[state.you].ready);
  const gens = Object.entries(Gens.GENERATIONS).map(([n, gg]) => `
    <button class="gen-card compact ${Number(n) === p.gen ? 'active' : ''}" data-gen="${n}" ${editable ? '' : 'disabled'}>
      <div class="t">${gg.name}</div><div class="r">${gg.region}</div>
    </button>`).join('');
  const checkers = state.game === 'checkers';
  const draughts = state.game === 'draughts';
  const variants = checkers || draughts ? '' : Gens.choosablePieces(p.gen).map((t) => {
    const partner = Gens.partnerOf(p.gen, t); // p. ej. la reina que va con el rey
    return `
    <div class="variant">
      <div class="label">${Gens.PIECE_NAMES[t]}${partner ? ` y ${Gens.PIECE_NAMES[partner].toLowerCase()} (pareja)` : ''}</div>
      <div class="opts">${g.pieces[t].map((mon, i) => {
        const pm = partner && g.pieces[partner][i];
        return `
        <button class="opt ${p.choices[t] === i ? 'active' : ''}" data-type="${t}" data-i="${i}" ${editable ? '' : 'disabled'}>
          <span class="opt-mons">${thumb(mon, shiny)}${pm ? thumb(pm, shiny) : ''}</span><span>${mon.name}${pm ? ` y ${pm.name}` : ''}</span>
        </button>`;
      }).join('')}
      </div>
    </div>`;
  }).join('');
  const lineup = checkers
    ? g.checkers.map((mon) => `<div>${thumb(mon, shiny)}<span>${mon.name}</span></div>`).join('')
    : draughts
      ? `<div>${thumb(g.draughts.man, shiny)}<span>Ficha · ${g.draughts.man.name}</span></div><div>${thumb(g.draughts.king, shiny)}<span>Dama · ${g.draughts.king.name}</span></div>`
    : ['k', 'q', 'r', 'b', 'n', 'p'].map((t) => {
      const mon = Gens.pokemonFor(p.gen, t, p.choices);
      return `<div>${thumb(mon, shiny)}<span>${Gens.PIECE_NAMES[t]}</span></div>`;
    }).join('');
  return `
    <div class="panel-head">
      <div class="who">${escapeHtml(p.name)}${mine ? ' (tú)' : ''}</div>
      <span class="tag"><span class="ball-icon ${BALL[color].cls}"></span>${COLOR_NAME[color]}${shiny ? ' · shiny' : ''}</span>
    </div>
    <div class="muted small">${p.bot ? `${ROBOT} Bot · ${LEVEL_NAME[state.bot.level]}` : `${p.host ? 'Anfitrión · ' : ''}${p.connected ? 'Conectado' : 'Desconectado'}`}</div>
    <div class="label-sm">Generación</div>
    <div class="gen-pick">${gens}</div>
    ${checkers || draughts ? `<div class="label-sm">${mine ? 'Tus' : 'Sus'} fichas</div>` : variants || '<p class="muted small">En esta generación no hay piezas a elegir.</p>'}
    <div class="lineup ${checkers ? 'ck-lineup' : draughts ? 'dr-lineup' : ''}">${lineup}</div>
    ${mine
      ? `<button class="btn primary ready-btn">${p.ready ? 'Cancelar listo' : state.bot ? '¡A jugar!' : '¡Listo!'}</button>`
      : p.bot
        ? `<button class="btn small random-btn" ${editable ? '' : 'disabled'}>🎲 Generación y piezas al azar</button>`
        : `<span class="tag ${p.ready ? 'ok' : 'off'}">${p.ready ? 'Listo' : 'Eligiendo…'}</span>`}`;
}

// ---------- Partida: capa de casillas ----------

/** Posición en pantalla (columna, fila 0..7) de una casilla según la orientación. */
function viewPos(sq, flip) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - Number(sq[1]);
  return flip ? { col: 7 - c, row: 7 - r } : { col: c, row: r };
}

function renderGame(prev) {
  if ($('route-panel')) $('route-panel').remove();
  if (state.game === 'checkers') return renderCheckers(prev);
  if (state.game === 'draughts') return renderDraughts(prev);
  $('board').className = 'board';
  const chess = loadChess(state.fen);
  const me = state.you;
  const flip = me === 'b';
  const files = 'abcdefgh';
  const myTurn = state.status === 'playing' && state.turn === me;

  // Tema del tablero
  const theme = state.activeBoard || 'ruta1';
  $('board-wrap').className = `board-wrap theme-${theme}`;
  const bd = Boards.BOARDS.find((b) => b.id === theme);
  $('board-name').textContent = bd ? `📍 ${bd.name}` : '';

  // Destinos legales de la pieza seleccionada
  const targets = new Map();
  if (selected && myTurn) {
    if (state.attentive) {
      // Modo atento: también las jugadas que dejan al rey en peligro
      for (const m of chess._moves({ legal: false, square: selected })) {
        targets.set(sq0x88(m.to), { to: sq0x88(m.to), promotion: m.promotion });
      }
    } else {
      for (const m of chess.moves({ square: selected, verbose: true })) targets.set(m.to, m);
    }
  }
  const checkSq = state.inCheck ? findKing(chess.board(), state.turn) : null;

  let html = '';
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr;
      const c = flip ? 7 - vc : vc;
      const sq = files[c] + (8 - r);
      const cls = ['sq', (r + c) % 2 === 0 ? 'l' : 'd'];
      if (state.lastMove && (sq === state.lastMove.from || sq === state.lastMove.to)) cls.push('last');
      if (sq === selected) cls.push('sel');
      if (sq === checkSq) cls.push('check');
      if (targets.has(sq)) cls.push(chess.get(sq) ? 'cap' : 'dot');
      let inner = '';
      if (vc === 0) inner += `<span class="coord r">${8 - r}</span>`;
      if (vr === 7) inner += `<span class="coord f">${files[c]}</span>`;
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  $('board').innerHTML = html;
  $('board').querySelectorAll('.sq').forEach((el) => (el.onclick = () => onSquare(el.dataset.sq, chess, targets)));

  updatePieces(prev, flip);

  // Barras de jugador: rival arriba, tú abajo
  const rival = me === 'w' ? 'b' : 'w';
  const captured = capturedBy(chess.board());
  setHtml($('bar-top'), playerBar(rival, captured[rival]));
  setHtml($('bar-bottom'), playerBar(me, captured[me]));

  // Estado
  const st = $('status');
  st.classList.toggle('end', state.status === 'over');
  if (state.status === 'over') {
    const r = state.result;
    const who = r.winner ? `Ganan ${COLOR_NAME[r.winner]} (${state.players[r.winner].name})` : 'Empate';
    st.textContent = `${REASONS[r.reason]} ${who}`;
  } else {
    const other = state.players[state.turn];
    st.textContent = myTurn
      ? (state.inCheck ? '¡Jaque! Te toca' : 'Te toca mover') // inCheck siempre es false en modo atento
      : other.bot ? `${other.name} está pensando…` : `Turno de ${other.name}`;
  }

  // Historial en parejas (blancas / negras)
  const h = state.history;
  let rows = '';
  for (let i = 0; i < h.length; i += 2) rows += `<li><span>${h[i]}</span><span>${h[i + 1] || ''}</span></li>`;
  $('history').innerHTML = rows;
  $('history').scrollTop = $('history').scrollHeight;

  $('btn-resign').classList.toggle('hidden', state.status !== 'playing');
  const rb = $('btn-rematch');
  rb.classList.toggle('hidden', state.status !== 'over');
  rb.disabled = !!(state.rematch && state.rematch[me]);
  rb.textContent = state.rematch && state.rematch[me]
    ? 'Esperando al rival…'
    : state.rematch && state.rematch[rival] ? 'Aceptar revancha' : 'Revancha';
}

// ---------- Partida: capa de piezas animadas ----------

const pieces = new Map(); // casilla -> { el, sprite, key }
let piecesFlip = null;    // orientación con la que se colocaron
let piecesFen = null;     // posición que muestran las piezas (ver posKey)

/** Identificador de la posición, sirva para ajedrez o damas chinas. */
function posKey(st) {
  if (st.game === 'checkers' && st.ck) return 'ck:' + JSON.stringify(st.ck.cells);
  if (st.game === 'draughts' && st.dr) return 'dr:' + JSON.stringify(st.dr.cells);
  return st.fen;
}
let animToken = 0;        // invalida animaciones viejas si llega otra jugada

function pieceKey(p) { return `${p.color}${p.type}${monFor(p.color, p.type).id}`; }

function place(entry, sq, flip) {
  const { col, row } = viewPos(sq, flip);
  entry.el.style.left = `${col * 12.5}%`;
  entry.el.style.top = `${row * 12.5}%`;
}

function createPiece(p, sq, flip) {
  const mon = monFor(p.color, p.type);
  const el = document.createElement('div');
  el.className = `piece ${p.color}`;
  el.innerHTML = `<span class="ball-badge ${BALL[p.color].cls}" title="${BALL[p.color].name}"></span><canvas></canvas>`;
  el.title = `${mon.name} (${Gens.PIECE_NAMES[p.type]})`;
  $('pieces').appendChild(el);
  const entry = { el, sprite: new MonSprite(el.querySelector('canvas'), mon.id, p.color === 'b', 'board'), key: pieceKey(p) };
  place(entry, sq, flip);
  return entry;
}

function removePiece(entry) {
  entry.sprite.destroy();
  entry.el.remove();
}

let pendingCleanup = null; // termina al instante la animación en curso (si llega otra jugada)

/** Deja la capa de piezas exactamente como la posición actual (sin animar). */
function syncPieces(flip) {
  if (pendingCleanup) pendingCleanup();
  if (piecesFlip !== flip) {
    for (const e of pieces.values()) removePiece(e);
    pieces.clear();
    piecesFlip = flip;
  }
  const chess = loadChess(state.fen);
  const want = new Map();
  for (const row of chess.board()) for (const p of row) if (p) want.set(p.square, p);
  for (const [sq, e] of pieces) {
    const p = want.get(sq);
    if (!p || pieceKey(p) !== e.key) { removePiece(e); pieces.delete(sq); }
  }
  for (const [sq, p] of want) {
    if (!pieces.has(sq)) pieces.set(sq, createPiece(p, sq, flip));
    else place(pieces.get(sq), sq, flip);
  }
  // Ningún sprite puede quedar en el tablero sin una pieza real detrás
  const alive = new Set([...pieces.values()].map((e) => e.el));
  for (const el of [...$('pieces').children]) if (!alive.has(el)) el.remove();
  piecesFen = posKey(state);
}

function updatePieces(prev, flip) {
  if (piecesFen === posKey(state) && piecesFlip === flip) return; // nada cambió (p. ej. solo selección)
  const oneMoreMove = prev && prev.status !== 'lobby' && prev.game === state.game && piecesFen === posKey(prev)
    && piecesFlip === flip && state.history.length === prev.history.length + 1;
  const sync = { checkers: syncCheckers, draughts: syncDraughts }[state.game] || syncPieces;
  const animate = { checkers: animateCheckers, draughts: animateDraughts }[state.game] || animateMove;
  if (oneMoreMove && !reduceMotion.matches) animate(prev, flip);
  else { animToken++; sync(flip); }
}

/**
 * Anima la última jugada: la pieza camina hasta su destino mirando hacia
 * donde va; si captura, ataca y la víctima se desvanece. En el enroque la
 * torre camina también.
 */
function animateMove(prev, flip) {
  if (pendingCleanup) pendingCleanup(); // la jugada anterior aún se animaba: se termina ya
  const token = ++animToken;
  const mv = state.lastMove; // { from, to, flags, captured } enviado por el servidor
  const mover = mv && mv.flags !== undefined && pieces.get(mv.from);
  if (!mover) return syncPieces(flip);

  const steps = [{ entry: mover, from: mv.from, to: mv.to }];
  if (mv.flags.includes('k') || mv.flags.includes('q')) {
    const rank = mv.from[1];
    const [rf, rt] = mv.flags.includes('k') ? ['h', 'f'] : ['a', 'd'];
    const rook = pieces.get(rf + rank);
    if (rook) steps.push({ entry: rook, from: rf + rank, to: rt + rank });
  }
  const victimSq = mv.flags.includes('e') ? mv.to[0] + mv.from[1] : mv.captured ? mv.to : null;
  const victim = victimSq ? pieces.get(victimSq) : null;

  // Actualiza el mapa: la víctima sale, las piezas que se mueven pasan a su destino
  if (victimSq) pieces.delete(victimSq);
  for (const s of steps) pieces.delete(s.from);
  for (const s of steps) pieces.set(s.to, s.entry);
  piecesFen = posKey(state);

  // Limpieza: se ejecuta al terminar o si otra jugada interrumpe esta animación
  const cleanup = () => {
    if (pendingCleanup !== cleanup) return;
    pendingCleanup = null;
    if (victim) removePiece(victim);
    for (const s of steps) {
      s.entry.el.style.transition = '';
      s.entry.el.classList.remove('moving', 'attacking');
      s.entry.sprite.play('Idle', { dir: 0 });
    }
  };
  pendingCleanup = cleanup;
  const finish = () => {
    if (token !== animToken) return;
    cleanup();
    syncPieces(flip); // aplica coronaciones y corrige cualquier diferencia
  };

  let longest = 0;
  for (const s of steps) {
    const a = viewPos(s.from, flip);
    const b = viewPos(s.to, flip);
    const dist = Math.hypot(b.col - a.col, b.row - a.row);
    const ms = Math.min(260 + dist * 170, 1300);
    longest = Math.max(longest, ms);
    const dir = dirFromDelta(b.col - a.col, b.row - a.row);
    s.entry.sprite.play('Walk', { dir });
    s.entry.el.classList.add('moving');
    s.entry.el.style.transition = `left ${ms}ms linear, top ${ms}ms linear`;
    void s.entry.el.offsetWidth; // fuerza el punto de partida antes de la transición
    place(s.entry, s.to, flip);
    s.entry.dir = dir;
  }

  setTimeout(() => {
    if (token !== animToken) return;
    for (const s of steps) {
      s.entry.el.style.transition = '';
      s.entry.el.classList.remove('moving');
    }
    if (victim) {
      // Captura: el atacante usa una de sus animaciones de ataque (al azar) y,
      // a mitad del golpe, la víctima recibe el daño, se debilita y desaparece.
      const attack = pickAttack(mover.sprite);
      mover.el.classList.add('attacking'); // el atacante siempre por delante de su víctima
      const atk = mover.sprite.duration(attack) || 400;
      mover.sprite.play(attack, { dir: mover.dir, loop: false, onDone: () => mover.sprite.play('Idle', { dir: 0 }) });
      setTimeout(() => {
        if (token !== animToken) return;
        const v = victim.sprite;
        v.play('Hurt', {
          dir: (mover.dir + 4) % 8, // mira hacia el atacante
          loop: false,
          onDone: () => v.play('Faint', { loop: false, onDone: () => victim.el.classList.add('fainting') }),
        });
      }, atk * 0.4);
      const victimTime = atk * 0.4 + victim.sprite.duration('Hurt') + victim.sprite.duration('Faint') + 400;
      setTimeout(finish, Math.max(atk, victimTime, 600));
    } else {
      for (const s of steps) s.entry.sprite.play('Idle', { dir: 0 });
      finish();
    }
  }, longest);
}

/** Elige al azar una animación de ataque del Pokémon (cuerpo a cuerpo o a distancia). */
function pickAttack(sprite) {
  const opts = ['Attack', 'Shoot'].filter((a) => sprite.duration(a) > 0);
  return opts[Math.floor(Math.random() * opts.length)] || 'Attack';
}

// ---------- Damas clásicas: tablero de 8×8 ----------

let drSelected = null; // ficha seleccionada en damas

function renderDraughts(prev) {
  const me = state.you;
  const flip = me === 'b';
  const myTurn = state.status === 'playing' && state.turn === me;
  const theme = state.activeBoard || 'ruta1';
  $('board-wrap').className = `board-wrap theme-${theme}`;
  const bd = Boards.BOARDS.find((b) => b.id === theme);
  $('board-name').textContent = bd ? `📍 ${bd.name}` : '';

  const st = { cells: state.dr ? state.dr.cells : {}, turn: state.turn, forced: !!(state.dr && state.dr.forced) };
  const legal = myTurn ? DR.legalMoves(st) : [];
  const movable = new Set(legal.map((m) => m.from));
  const mustCapture = st.forced && legal.some((m) => m.captured.length); // solo con "comer obligatorio"
  // Si varias cadenas acaban en la misma casilla, se marca la que más come
  const dests = new Map();
  for (const m of drSelected ? legal.filter((x) => x.from === drSelected) : []) {
    if (!dests.has(m.to) || dests.get(m.to).captured.length < m.captured.length) dests.set(m.to, m);
  }
  const lm = state.lastMove && state.lastMove.path ? state.lastMove : null;

  const files = 'abcdefgh';
  let html = '';
  for (let vr = 0; vr < 8; vr++) {
    for (let vc = 0; vc < 8; vc++) {
      const r = flip ? 7 - vr : vr;
      const c = flip ? 7 - vc : vc;
      const sq = files[c] + (8 - r);
      const cls = ['sq', (r + c) % 2 === 0 ? 'l' : 'd'];
      if (lm && lm.path.includes(sq)) cls.push('last');
      if (sq === drSelected) cls.push('sel');
      if (dests.has(sq)) cls.push('dot');
      if (mustCapture && movable.has(sq) && sq !== drSelected) cls.push('must');
      let inner = '';
      if (vc === 0) inner += `<span class="coord r">${8 - r}</span>`;
      if (vr === 7) inner += `<span class="coord f">${files[c]}</span>`;
      html += `<div class="${cls.join(' ')}" data-sq="${sq}">${inner}</div>`;
    }
  }
  const b = $('board');
  b.className = 'board';
  b.innerHTML = html;
  b.querySelectorAll('.sq').forEach((el) => (el.onclick = () => onDraughtSquare(el.dataset.sq, st, movable, dests)));

  updatePieces(prev, flip);

  const rival = me === 'w' ? 'b' : 'w';
  setHtml($('bar-top'), playerBar(rival, []));
  setHtml($('bar-bottom'), playerBar(me, []));

  const s = $('status');
  s.classList.toggle('end', state.status === 'over');
  if (state.status === 'over') {
    const r = state.result;
    const who = r.winner ? `Ganan ${COLOR_NAME[r.winner]} (${state.players[r.winner].name})` : 'Empate';
    s.textContent = `${REASONS[r.reason]} ${who}`;
  } else {
    const other = state.players[state.turn];
    s.textContent = myTurn ? (mustCapture ? '¡Tienes que comer!' : 'Te toca mover') : other.bot ? `${other.name} está pensando…` : `Turno de ${other.name}`;
  }
  $('history').innerHTML = state.history.map((h, i) => `<li class="ck-h ${i % 2 ? 'b' : 'w'}">${escapeHtml(h)}</li>`).join('');
  $('history').scrollTop = $('history').scrollHeight;
  $('btn-resign').classList.toggle('hidden', state.status !== 'playing');
  const rb = $('btn-rematch');
  rb.classList.toggle('hidden', state.status !== 'over');
  rb.disabled = !!(state.rematch && state.rematch[me]);
  rb.textContent = state.rematch && state.rematch[me] ? 'Esperando al rival…' : state.rematch && state.rematch[rival] ? 'Aceptar revancha' : 'Revancha';
}

function onDraughtSquare(sq, st, movable, dests) {
  if (!state || state.status !== 'playing' || state.turn !== state.you) return;
  if (drSelected && dests.has(sq)) {
    const m = dests.get(sq);
    send({ type: 'move', from: m.from, to: m.to, path: m.path });
    drSelected = null;
    return renderDraughts(state);
  }
  const p = st.cells[sq];
  if (p && p.color === state.you && !movable.has(sq) && st.forced) toast('Comer es obligatorio: mueve una ficha que pueda comer');
  drSelected = p && movable.has(sq) && sq !== drSelected ? sq : null;
  renderDraughts(state);
}

function drMon(p) {
  const pair = Gens.GENERATIONS[state.players[p.color].gen].draughts;
  return p.king ? pair.king : pair.man;
}
function drPieceKey(p) { return `${p.color}d${p.id}${p.king ? 'K' : ''}-${drMon(p).id}`; }

function createDr(p, sq, flip) {
  const mon = drMon(p);
  const el = document.createElement('div');
  el.className = `piece ${p.color}${p.king ? ' king' : ''}`;
  el.innerHTML = `<span class="ball-badge ${BALL[p.color].cls}" title="${BALL[p.color].name}"></span><canvas></canvas>`;
  el.title = `${mon.name}${p.king ? ' (dama)' : ''}`;
  $('pieces').appendChild(el);
  const entry = { el, sprite: new MonSprite(el.querySelector('canvas'), mon.id, p.color === 'b', 'board'), key: drPieceKey(p) };
  place(entry, sq, flip);
  return entry;
}

/** Deja las fichas como en el estado actual. Las que acaban de coronar aparecen evolucionando. */
function syncDraughts(flip) {
  if (pendingCleanup) pendingCleanup();
  if (piecesFlip !== flip) {
    for (const e of pieces.values()) removePiece(e);
    pieces.clear();
    piecesFlip = flip;
  }
  const want = new Map(Object.entries(state.dr ? state.dr.cells : {}));
  for (const [sq, e] of pieces) {
    const p = want.get(sq);
    if (!p || drPieceKey(p) !== e.key) {
      if (p && p.king && e.key === drPieceKey({ ...p, king: false })) e.evolved = true; // coronó
      removePiece(e);
      pieces.delete(sq);
      if (p && p.king && e.evolved) {
        const ne = createDr(p, sq, flip);
        ne.el.classList.add('evolving');
        pieces.set(sq, ne);
      }
    }
  }
  for (const [sq, p] of want) {
    if (!pieces.has(sq)) pieces.set(sq, createDr(p, sq, flip));
    else place(pieces.get(sq), sq, flip);
  }
  const alive = new Set([...pieces.values()].map((e) => e.el));
  for (const el of [...$('pieces').children]) if (!alive.has(el)) el.remove();
  piecesFen = posKey(state);
}

/** La ficha recorre su camino; en cada captura ataca y la víctima se debilita. */
function animateDraughts(prev, flip) {
  if (pendingCleanup) pendingCleanup();
  const token = ++animToken;
  const mv = state.lastMove;
  const mover = mv && mv.path && pieces.get(mv.from);
  if (!mover) return syncDraughts(flip);
  const victims = (mv.captured || []).map((sq) => pieces.get(sq) || null);
  for (const sq of mv.captured || []) pieces.delete(sq);
  pieces.delete(mv.from);
  pieces.set(mv.to, mover);
  piecesFen = posKey(state);

  const cleanup = () => {
    if (pendingCleanup !== cleanup) return;
    pendingCleanup = null;
    for (const v of victims) if (v) removePiece(v);
    mover.el.style.transition = '';
    mover.el.classList.remove('moving', 'attacking');
    mover.sprite.play('Idle', { dir: 0 });
  };
  pendingCleanup = cleanup;
  const done = () => { if (token !== animToken) return; cleanup(); syncDraughts(flip); };

  const step = (i) => {
    if (token !== animToken) return;
    if (i >= mv.path.length) return done();
    const a = viewPos(mv.path[i - 1], flip);
    const b = viewPos(mv.path[i], flip);
    const dir = dirFromDelta(b.col - a.col, b.row - a.row);
    const ms = victims.length ? 420 : 320;
    mover.sprite.play('Walk', { dir });
    mover.el.classList.add('moving');
    mover.el.style.transition = `left ${ms}ms linear, top ${ms}ms linear`;
    void mover.el.offsetWidth;
    place(mover, mv.path[i], flip);
    setTimeout(() => {
      if (token !== animToken) return;
      mover.el.style.transition = '';
      mover.el.classList.remove('moving');
      const victim = victims[i - 1];
      if (!victim) return step(i + 1);
      // Ataque sobre la ficha saltada: se gira hacia atrás (donde quedó la víctima)
      const attack = pickAttack(mover.sprite);
      const atk = Math.min(mover.sprite.duration(attack) || 400, 700);
      mover.el.classList.add('attacking');
      mover.sprite.play(attack, { dir: (dir + 4) % 8, loop: false, onDone: () => mover.sprite.play('Idle', { dir: 0 }) });
      setTimeout(() => {
        if (token !== animToken) return;
        victim.sprite.play('Hurt', { dir, loop: false, onDone: () => victim.sprite.play('Faint', { loop: false, onDone: () => victim.el.classList.add('fainting') }) });
      }, atk * 0.4);
      setTimeout(() => { mover.el.classList.remove('attacking'); step(i + 1); }, Math.max(atk, 650));
    }, ms);
  };
  step(1);
}

// ---------- Damas chinas: tablero de estrella ----------

/** Casilla tal como se ve: el jugador de negras ve la estrella girada 180°. */
const ckView = (k, flip) => { if (!flip) return k; const [q, r] = CK.parse(k); return CK.key(-q, -r); };

/** Posición en % (centro) de una casilla dentro del tablero de estrella. */
function ckPos(k, flip) {
  const { x, y } = CK.toXY(ckView(k, flip));
  return { left: ((x + 6.5) / 13) * 100, top: ((y + 7.43) / 14.86) * 100 };
}

let ckSelected = null; // ficha seleccionada en damas chinas

function renderCheckers(prev) {
  const me = state.you;
  const flip = me === 'b';
  const myTurn = state.status === 'playing' && state.turn === me;
  const theme = state.activeBoard || 'ruta1';
  $('board-wrap').className = `board-wrap theme-${theme}`;
  const bd = Boards.BOARDS.find((b) => b.id === theme);
  $('board-name').textContent = bd ? `📍 ${bd.name}` : '';

  const cells = state.ck ? state.ck.cells : {};
  const dests = ckSelected && myTurn ? CK.destinations({ cells, turn: state.turn }, ckSelected) : new Map();
  const homeW = new Set(CK.HOME.w);
  const homeB = new Set(CK.HOME.b);
  const lm = state.lastMove && state.lastMove.path ? state.lastMove : null;
  const b = $('board');
  b.className = 'board star';
  b.innerHTML = CK.CELLS.map((k) => {
    const { left, top } = ckPos(k, flip);
    const cls = ['hole'];
    if (homeW.has(k)) cls.push('home-w');
    if (homeB.has(k)) cls.push('home-b');
    if (lm && (k === lm.from || k === lm.to)) cls.push('last');
    if (k === ckSelected) cls.push('sel');
    if (dests.has(k)) cls.push('dot');
    return `<div class="${cls.join(' ')}" data-k="${k}" style="left:${left}%;top:${top}%"></div>`;
  }).join('');
  b.querySelectorAll('.hole').forEach((el) => (el.onclick = () => onHole(el.dataset.k, cells, dests)));

  updatePieces(prev, flip);

  const rival = me === 'w' ? 'b' : 'w';
  setHtml($('bar-top'), playerBar(rival, []));
  setHtml($('bar-bottom'), playerBar(me, []));

  const st = $('status');
  st.classList.toggle('end', state.status === 'over');
  if (state.status === 'over') {
    const r = state.result;
    const who = r.winner ? `Ganan ${COLOR_NAME[r.winner]} (${state.players[r.winner].name})` : 'Empate';
    st.textContent = `${REASONS[r.reason]} ${who}`;
  } else {
    const other = state.players[state.turn];
    st.textContent = myTurn ? 'Te toca mover' : other.bot ? `${other.name} está pensando…` : `Turno de ${other.name}`;
  }
  $('history').innerHTML = state.history.map((h, i) => `<li class="ck-h ${i % 2 ? 'b' : 'w'}">${escapeHtml(h)}</li>`).join('');
  $('history').scrollTop = $('history').scrollHeight;
  $('btn-resign').classList.toggle('hidden', state.status !== 'playing');
  const rb = $('btn-rematch');
  rb.classList.toggle('hidden', state.status !== 'over');
  rb.disabled = !!(state.rematch && state.rematch[me]);
  rb.textContent = state.rematch && state.rematch[me] ? 'Esperando al rival…' : state.rematch && state.rematch[rival] ? 'Aceptar revancha' : 'Revancha';
}

function onHole(k, cells, dests) {
  if (!state || state.status !== 'playing' || state.turn !== state.you) return;
  if (ckSelected && dests.has(k)) {
    send({ type: 'move', from: ckSelected, to: k });
    ckSelected = null;
    return renderCheckers(state);
  }
  const p = cells[k];
  ckSelected = p && p.color === state.you && k !== ckSelected ? k : null;
  renderCheckers(state);
}

function ckMon(p) { return Gens.GENERATIONS[state.players[p.color].gen].checkers[p.id]; }
function ckPieceKey(p) { return `${p.color}c${p.id}-${ckMon(p).id}`; }

function placeCk(entry, k, flip) {
  const { left, top } = ckPos(k, flip);
  entry.el.style.left = `${left}%`;
  entry.el.style.top = `${top}%`;
}

function createCk(p, k, flip) {
  const mon = ckMon(p);
  const el = document.createElement('div');
  el.className = `piece ck ${p.color}`;
  el.innerHTML = `<span class="ball-badge ${BALL[p.color].cls}" title="${BALL[p.color].name}"></span><canvas></canvas>`;
  el.title = mon.name;
  $('pieces').appendChild(el);
  const entry = { el, sprite: new MonSprite(el.querySelector('canvas'), mon.id, p.color === 'b', 'board'), key: ckPieceKey(p) };
  placeCk(entry, k, flip);
  return entry;
}

/** Deja las fichas como en el estado actual (sin animar). */
function syncCheckers(flip) {
  if (pendingCleanup) pendingCleanup();
  if (piecesFlip !== flip) {
    for (const e of pieces.values()) removePiece(e);
    pieces.clear();
    piecesFlip = flip;
  }
  const want = new Map(Object.entries(state.ck ? state.ck.cells : {}));
  for (const [k, e] of pieces) {
    const p = want.get(k);
    if (!p || ckPieceKey(p) !== e.key) { removePiece(e); pieces.delete(k); }
  }
  for (const [k, p] of want) {
    if (!pieces.has(k)) pieces.set(k, createCk(p, k, flip));
    else placeCk(pieces.get(k), k, flip);
  }
  const alive = new Set([...pieces.values()].map((e) => e.el));
  for (const el of [...$('pieces').children]) if (!alive.has(el)) el.remove();
  piecesFen = posKey(state);
}

/** La ficha recorre su camino hueco a hueco (en los saltos, pasando por encima). */
function animateCheckers(prev, flip) {
  if (pendingCleanup) pendingCleanup();
  const token = ++animToken;
  const mv = state.lastMove;
  const entry = mv && mv.path && pieces.get(mv.from);
  if (!entry) return syncCheckers(flip);
  pieces.delete(mv.from);
  pieces.set(mv.to, entry);
  piecesFen = posKey(state);

  const cleanup = () => {
    if (pendingCleanup !== cleanup) return;
    pendingCleanup = null;
    entry.el.style.transition = '';
    entry.el.classList.remove('moving', 'hopping');
    entry.sprite.play('Idle', { dir: 0 });
  };
  pendingCleanup = cleanup;

  const path = mv.path;
  const jump = mv.jumps > 0;
  const stepMs = jump ? 360 : 300;
  entry.el.classList.add('moving');
  const step = (i) => {
    if (token !== animToken) return;
    if (i >= path.length) { cleanup(); return syncCheckers(flip); }
    const a = ckPos(path[i - 1], flip);
    const b = ckPos(path[i], flip);
    entry.sprite.play('Walk', { dir: dirFromDelta(b.left - a.left, b.top - a.top) });
    entry.el.classList.toggle('hopping', jump);
    entry.el.style.transition = `left ${stepMs}ms ease-in-out, top ${stepMs}ms ease-in-out`;
    void entry.el.offsetWidth;
    placeCk(entry, path[i], flip);
    setTimeout(() => step(i + 1), stepMs);
  };
  step(1);
}

// ---------- Partida: interacción ----------

function onSquare(sq, chess, targets) {
  if (!state || state.status !== 'playing' || state.turn !== state.you) return;
  if (selected && targets.has(sq)) {
    const mv = targets.get(sq);
    if (mv.promotion) {
      pendingPromo = { from: selected, to: sq };
      openPromo();
    } else {
      send({ type: 'move', from: selected, to: sq });
    }
    selected = null;
    return renderGame(state);
  }
  const piece = chess.get(sq);
  selected = piece && piece.color === state.you && sq !== selected ? sq : null;
  renderGame(state);
}

function openPromo() {
  const opts = ['q', 'r', 'b', 'n'];
  setHtml($('promo-options'), opts.map((t) => {
    const mon = monFor(state.you, t);
    return `<button class="opt" data-t="${t}">${thumb(mon, state.you === 'b')}<span>${Gens.PIECE_NAMES[t]}</span></button>`;
  }).join(''));
  $('promo-options').querySelectorAll('.opt').forEach((b) => (b.onclick = () => {
    send({ type: 'move', ...pendingPromo, promotion: b.dataset.t });
    pendingPromo = null;
    $('promo').classList.add('hidden');
  }));
  $('promo').classList.remove('hidden');
}

function playerBar(color, caps) {
  const p = state.players[color];
  const turn = state.status === 'playing' && state.turn === color;
  const victimColor = color === 'w' ? 'b' : 'w';
  const capImgs = state.game !== 'chess' ? '' : caps.map((t) => thumb(monFor(victimColor, t), victimColor === 'b')).join('');
  return `<span class="ball-icon ${BALL[color].cls}" title="${BALL[color].name}"></span>
    <span class="nm">${escapeHtml(p.name)}${color === state.you ? ' (tú)' : ''}</span>
    <span class="tag">${Gens.GENERATIONS[p.gen].name}</span>
    ${p.bot ? `<span class="tag">${ROBOT} ${LEVEL_NAME[state.bot.level]}</span>` : ''}
    ${p.connected ? '' : '<span class="tag off">desconectado</span>'}
    ${turn ? '<span class="turn">● su turno</span>' : ''}
    ${state.game === 'draughts' && state.dr
      ? `<span class="tag goal-tag">Fichas: ${state.dr.count[color]}/12</span>`
      : state.game === 'checkers' && state.ck
      ? `<span class="tag goal-tag">En meta: ${state.ck.inGoal[color]}/10</span>`
      : `<span class="captured">${capImgs}</span>`}`;
}

/** Piezas que cada bando ha capturado, comparando con la posición inicial. */
function capturedBy(board) {
  const count = { w: {}, b: {} };
  for (const row of board) for (const p of row) if (p) count[p.color][p.type] = (count[p.color][p.type] || 0) + 1;
  const out = { w: [], b: [] };
  for (const victim of ['w', 'b']) {
    const taker = victim === 'w' ? 'b' : 'w';
    for (const [t, n] of Object.entries(START_COUNT)) {
      const missing = Math.max(0, n - (count[victim][t] || 0));
      for (let i = 0; i < missing; i++) out[taker].push(t);
    }
  }
  return out;
}

function findKing(board, color) {
  for (const row of board) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
  return null;
}

// ---------- Varios ----------

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let toastTimer;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------- Arranque ----------

async function init() {
  await loadMeta(); // tamaños de fotograma de los sprites, necesarios antes de dibujar
  try { $('name').value = localStorage.getItem('pokechess:name') || ''; } catch {}
  const renderHomeGens = () => genCards($('home-gens'), homeGen, true, (g) => { homeGen = g; renderHomeGens(); });
  renderHomeGens();

  const name = () => {
    const n = $('name').value.trim();
    try { localStorage.setItem('pokechess:name', n); } catch {}
    return n;
  };
  $('home-game').querySelectorAll('.seg').forEach((b) => (b.onclick = () => {
    homeGame = b.dataset.v;
    // En Ruta de Medallas el Pokémon se elige en la sala, no por generación
    const route = homeGame === 'route';
    $('home-gens').classList.toggle('hidden', route);
    $('gen-label').classList.toggle('hidden', route);
    $('route-note').classList.toggle('hidden', !route);
    $('btn-bot').innerHTML = `${ROBOT} ${route ? 'Jugar contra bots' : 'Jugar contra el bot'}`;
    $('home-game').querySelectorAll('.seg').forEach((x) => x.classList.toggle('active', x === b));
  }));
  $('btn-create').onclick = () => send({ type: 'create', gen: homeGen, name: name(), game: homeGame });
  $('btn-bot').onclick = () => send({ type: 'createBot', gen: homeGen, name: name(), level: 'normal', game: homeGame });
  $('btn-join').onclick = () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 5) return toast('El código tiene 5 caracteres');
    send({ type: 'join', code, name: name(), gen: homeGen });
  };
  $('join-code').onkeydown = (e) => { if (e.key === 'Enter') $('btn-join').click(); };
  $('btn-copy').onclick = async () => {
    const url = `${location.origin}${location.pathname}?sala=${state.code}`;
    try { await navigator.clipboard.writeText(url); toast('Link copiado'); } catch { toast(url); }
  };
  $('btn-resign').onclick = () => { if (confirm('¿Seguro que te rindes?')) send({ type: 'resign' }); };
  $('btn-rematch').onclick = () => send({ type: 'rematch' });

  // ?sala=CODIGO en la URL: reconectar si ya tenemos asiento, si no rellenar el código
  const urlCode = new URLSearchParams(location.search).get('sala');
  const saved = loadSession();
  connect(() => {
    if (saved && (!urlCode || saved.code === urlCode.toUpperCase())) send({ type: 'resume', ...saved });
    else if (urlCode) $('join-code').value = urlCode.toUpperCase();
  });
}

// Ruta de Medallas y Pokéreloj (necesitan las utilidades de arriba)
const routeUI = createRouteUI({ $, send, setHtml, thumb, toast, escapeHtml, hydrate: hydrateThumbs, getState: () => state });
const poketch = createPoketch({
  send,
  escapeHtml,
  getLog: gameLog,
  getStage: () => (state && state.kind === 'route' && $('route-stage')) || (state && state.status !== 'lobby' ? $('board-wrap') : $('screen-lobby')),
  tokenSprite: (seat) => routeUI.tokenSprite(seat),
});

init();
