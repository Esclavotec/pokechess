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

const Gens = window.PokeGenerations;
const Boards = window.PokeBoards;
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
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

let ws = null;
let state = null;          // último estado recibido del servidor
let selected = null;       // casilla seleccionada, p. ej. 'e2'
let homeGen = 1;           // generación elegida en la pantalla de inicio
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
  if (!state) return show('home');
  $('room-badge').textContent = `Sala ${state.code}`;
  $('room-badge').classList.remove('hidden');
  if (state.status === 'lobby') { show('lobby'); renderLobby(); }
  else { show('game'); renderGame(prev); }
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

  // Tableros (los elige el anfitrión)
  const opts = [{ id: 'random', name: 'Aleatorio', region: 'Sorpresa' }, ...Boards.BOARDS];
  $('lobby-boards').innerHTML = opts.map((b) => `
    <button class="board-card ${state.board === b.id ? 'active' : ''}" data-board="${b.id}" ${state.isHost ? '' : 'disabled'}>
      <div class="mini theme-${b.id}">${'<i></i>'.repeat(16)}</div>
      <div class="t">${b.name}</div><div class="r">${b.region}</div>
    </button>`).join('');
  if (state.isHost) $('lobby-boards').querySelectorAll('.board-card').forEach((b) => (b.onclick = () => send({ type: 'board', board: b.dataset.board })));
  $('board-note').textContent = state.isHost
    ? 'Como anfitrión eliges el tablero. Cada jugador elige su generación y sus piezas.'
    : 'El anfitrión elige el tablero. Tú eliges tu generación y tus piezas.';

  const me = state.you;
  const rival = me === 'w' ? 'b' : 'w';
  setHtml($('my-panel'), playerPanel(me, true));
  setHtml($('rival-panel'), state.players[rival]
    ? playerPanel(rival, false)
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
}

function playerPanel(color, mine) {
  const p = state.players[color];
  const g = Gens.GENERATIONS[p.gen];
  const shiny = color === 'b';
  const editable = mine && !p.ready;
  const gens = Object.entries(Gens.GENERATIONS).map(([n, gg]) => `
    <button class="gen-card compact ${Number(n) === p.gen ? 'active' : ''}" data-gen="${n}" ${editable ? '' : 'disabled'}>
      <div class="t">${gg.name}</div><div class="r">${gg.region}</div>
    </button>`).join('');
  const variants = Gens.choosablePieces(p.gen).map((t) => `
    <div class="variant">
      <div class="label">${Gens.PIECE_NAMES[t]}</div>
      <div class="opts">${g.pieces[t].map((mon, i) => `
        <button class="opt ${p.choices[t] === i ? 'active' : ''}" data-type="${t}" data-i="${i}" ${editable ? '' : 'disabled'}>
          ${thumb(mon, shiny)}<span>${mon.name}</span>
        </button>`).join('')}
      </div>
    </div>`).join('');
  const lineup = ['k', 'q', 'r', 'b', 'n', 'p'].map((t) => {
    const mon = Gens.pokemonFor(p.gen, t, p.choices);
    return `<div>${thumb(mon, shiny)}<span>${Gens.PIECE_NAMES[t]}</span></div>`;
  }).join('');
  return `
    <div class="panel-head">
      <div class="who">${escapeHtml(p.name)}${mine ? ' (tú)' : ''}</div>
      <span class="tag"><span class="ball-icon ${BALL[color].cls}"></span>${COLOR_NAME[color]}${shiny ? ' · shiny' : ''}</span>
    </div>
    <div class="muted small">${p.host ? 'Anfitrión · ' : ''}${p.connected ? 'Conectado' : 'Desconectado'}</div>
    <div class="label-sm">Generación</div>
    <div class="gen-pick">${gens}</div>
    ${variants || '<p class="muted small">En esta generación no hay piezas a elegir.</p>'}
    <div class="lineup">${lineup}</div>
    ${mine
      ? `<button class="btn primary ready-btn">${p.ready ? 'Cancelar listo' : '¡Listo!'}</button>`
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
  const chess = new Chess(state.fen);
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
    for (const m of chess.moves({ square: selected, verbose: true })) targets.set(m.to, m);
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
    st.textContent = myTurn ? (state.inCheck ? '¡Jaque! Te toca' : 'Te toca mover') : `Turno de ${state.players[state.turn].name}`;
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
let piecesFen = null;     // posición que muestran las piezas
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

/** Deja la capa de piezas exactamente como la posición actual (sin animar). */
function syncPieces(flip) {
  if (piecesFlip !== flip) {
    for (const e of pieces.values()) removePiece(e);
    pieces.clear();
    piecesFlip = flip;
  }
  const chess = new Chess(state.fen);
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
  piecesFen = state.fen;
}

function updatePieces(prev, flip) {
  if (piecesFen === state.fen && piecesFlip === flip) return; // nada cambió (p. ej. solo selección)
  const oneMoreMove = prev && prev.status !== 'lobby' && piecesFen === prev.fen && piecesFlip === flip
    && state.history.length === prev.history.length + 1;
  if (oneMoreMove && !reduceMotion.matches) animateMove(prev, flip);
  else { animToken++; syncPieces(flip); }
}

/**
 * Anima la última jugada: la pieza camina hasta su destino mirando hacia
 * donde va; si captura, ataca y la víctima se desvanece. En el enroque la
 * torre camina también.
 */
function animateMove(prev, flip) {
  const token = ++animToken;
  let mv;
  try { mv = new Chess(prev.fen).move(state.history[state.history.length - 1]); } catch { mv = null; }
  const mover = mv && pieces.get(mv.from);
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
  piecesFen = state.fen;

  const finish = () => {
    if (token !== animToken) return;
    if (victim) removePiece(victim);
    mover.el.classList.remove('attacking');
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
  const capImgs = caps.map((t) => thumb(monFor(victimColor, t), victimColor === 'b')).join('');
  return `<span class="ball-icon ${BALL[color].cls}" title="${BALL[color].name}"></span>
    <span class="nm">${escapeHtml(p.name)}${color === state.you ? ' (tú)' : ''}</span>
    <span class="tag">${Gens.GENERATIONS[p.gen].name}</span>
    ${p.connected ? '' : '<span class="tag off">desconectado</span>'}
    ${turn ? '<span class="turn">● su turno</span>' : ''}
    <span class="captured">${capImgs}</span>`;
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
  $('btn-create').onclick = () => send({ type: 'create', gen: homeGen, name: name() });
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

init();
