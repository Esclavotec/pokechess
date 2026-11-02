/**
 * Interfaz de "Ruta de Medallas": lobby de 4 asientos, tablero dinámico de 44 casillas
 * (12×12) con escenario vivo en el centro (nubes, Pokémon salvajes, día y noche, la cueva
 * del Monte Corona y la Zona Safari), casillas en pixel art, panel de acciones,
 * Guardería/ventas y animaciones (caminar, combates, eventos, monedas, medallas, confeti).
 *
 * app.js le pasa un contexto con lo que necesita (estado, envío de mensajes, utilidades)
 * y llama a renderLobby() / renderGame(prev) según la fase de la sala.
 */
import { MonSprite, dirFromDelta } from './sprites.js';

const R = window.PokeRoute;
const Boards = window.PokeBoards;
const BALLS = ['honor', 'ocaso', 'super', 'ultra'];          // insignia de cada asiento
const SEAT_COLORS = ['#e3350d', '#2a75bb', '#e0b400', '#2e9b48'];
const REGION_COLORS = { kanto: '#e3350d', johto: '#c9a227', hoenn: '#2e9b48', sinnoh: '#2a75bb', teselia: '#7d4fc4' };
const SIDE_REGION = [['Kanto', '#e3350d'], ['Johto', '#c9a227'], ['Hoenn', '#2e9b48'], ['Sinnoh · Teselia', '#2a75bb']];
const L = 12;                       // lado de la cuadrícula
const CELL = 100 / L;               // tamaño de una casilla en %
const CAVE_COLS = [2, 4, 7, 9];     // columnas de las 4 casillas de la cueva (fila del Monte Corona)
const DAYTIME = ['manana', 'tarde', 'atardecer', 'noche'];
// Pokémon salvajes que pasean por el escenario. Cada uno va por su carril (en % del escenario)
// sin cruzar el cartel del atajo ni la tarjeta central: top, de minX a maxX, velocidad (%/s).
const WILD = [
  { id: 16, top: 6, min: 2, max: 88, speed: 7, fly: true },   // Pidgey volando entre los árboles
  { id: 399, top: 22, min: 4, max: 86, speed: 4 },            // Bidoof
  { id: 43, top: 80, min: 30, max: 62, speed: 3 },            // Oddish entre el Safari y el estanque
];
// Nombres cortos para que quepan en la casilla
const SHORT = { 'Salida · Pueblo Paleta': 'Salida', 'Ferry S.S. Aqua': 'Ferry', 'Metro Batalla': 'Metro', 'Central Eléctrica': 'Central', 'Torre Radio': 'Radio', 'Equipo Galaxia': 'Galaxia', 'Hierba alta': 'Hierba', 'Árbol de Bayas': 'Bayas', 'Centro Pokémon': 'Centro', 'Tienda Pokémon': 'Tienda', 'Zona Safari': 'Safari', 'Snorlax dormido': 'Snorlax' };
const P = (name, cls = '') => `<img class="prop ${cls}" src="img/props/${name}.svg" alt="" draggable="false">`;
// Elementos repartidos por el escenario: [elemento, left %, top %, tamaño %]
const DECOR = [
  ['tree', 3, 4, 13], ['tree', 14, 1, 11], ['berrytree', 84, 3, 12], ['tree', 74, 8, 10], ['flowers', 30, 8, 8],
  ['rock', 58, 6, 7], ['flowers', 48, 26, 7], ['grass', 6, 26, 9], ['grass', 86, 26, 9], ['rock', 22, 28, 6],
  ['flowers', 70, 30, 7], ['lamp', 27, 60, 6], ['lamp', 67, 60, 6], ['tree', 44, 86, 10],
];
const REASON = { medals: '¡Consiguió las medallas!', last: '¡Último con dinero!', worth: 'Ganó por patrimonio' };
const LEVEL_NAME = { easy: 'Fácil', normal: 'Normal', hard: 'Difícil' };
let BASE = null; // lista de Pokémon elegibles (assets/base-forms.json)

export function createRouteUI(ctx) {
  const { $, send, setHtml, thumb, toast, escapeHtml } = ctx;
  const S = () => ctx.getState();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  let pickGen = 1;
  let pickQuery = '';
  let lastSeq = -1;
  let animating = false;
  let queued = null;
  let showAssets = false;
  let prevRs = null;        // estado anterior (para los efectos de dinero, medallas y propiedades)
  let stageTimer = null;    // los avisos de eventos se apartan solos
  const tokens = new Map(); // índice de jugador -> { el, sprite, pos }

  fetch('/assets/base-forms.json').then((r) => r.json()).then((list) => { BASE = list; if (S() && S().status === 'lobby') renderLobby(); });

  // ---------- Utilidades ----------
  const seatOfPlayer = (st, p) => st.seats[st.order[p]];
  const myPlayer = (st) => (st.order ? st.order.indexOf(st.you) : -1);
  const money = (n) => `${n} ₽`;

  /** Fila y columna (0..11) de la casilla i en la cuadrícula de 12×12 (salida abajo a la derecha). */
  function cellRC(i) {
    if (i >= R.N) return { row: cellRC(R.CORONA).row, col: CAVE_COLS[i - R.N] }; // cueva
    if (i <= 11) return { row: 11, col: 11 - i };
    if (i <= 22) return { row: 11 - (i - 11), col: 0 };
    if (i <= 33) return { row: 0, col: i - 22 };
    return { row: i - 33, col: 11 };
  }

  // ---------- Lobby ----------
  function renderLobby() {
    const st = S();
    $('lobby-code').textContent = st.code;
    $('share-row').classList.remove('hidden');
    const host = st.isHost;
    const filled = st.seats.filter(Boolean).length;
    $('game-settings').innerHTML = `
      <h2>Ruta de Medallas</h2>
      <p class="muted small">De 2 a 4 jugadores. Tira los dados, reclama pueblos, desafía a los líderes de gimnasio y gana medallas. Comparte el código con tus amigos o añade bots.</p>
      <div class="label-sm">Medallas para ganar</div>
      <div class="segmented" data-name="target">${[3, 4, 5, 6, 7, 8].map((n) =>
        `<button class="seg ${st.target === n ? 'active' : ''}" data-v="${n}" ${host ? '' : 'disabled'}>${n}</button>`).join('')}</div>`;
    $('bot-settings').innerHTML = `
      <h2>Bots</h2>
      <div class="segmented" data-name="level">${['easy', 'normal', 'hard'].map((l) =>
        `<button class="seg ${st.botLevel === l ? 'active' : ''}" data-v="${l}" ${host ? '' : 'disabled'}>${LEVEL_NAME[l]}</button>`).join('')}</div>
      ${host ? `<button class="btn small add-bot" ${filled >= 4 ? 'disabled' : ''}>+ Añadir bot</button>` : ''}`;
    $('rules-settings').innerHTML = '';
    if (host) {
      $('game-settings').querySelectorAll('.seg').forEach((b) => (b.onclick = () => send({ type: 'target', n: Number(b.dataset.v) })));
      $('bot-settings').querySelectorAll('.seg').forEach((b) => (b.onclick = () => send({ type: 'botOptions', level: b.dataset.v })));
      const ab = $('bot-settings').querySelector('.add-bot');
      if (ab) ab.onclick = () => send({ type: 'addBot' });
    }
    // Tablero temático (lo pinta app.js) y nota
    $('board-note').textContent = host ? 'Como anfitrión eliges las medallas, los bots y el tablero.' : 'El anfitrión elige las medallas, los bots y el tablero.';

    // Asientos
    setHtml($('rival-panel'), `
      <div class="panel-head"><div class="who">Jugadores (${filled}/4)</div></div>
      <div class="seats">${st.seats.map((s, i) => s ? `
        <div class="seat ${i === st.you ? 'me' : ''}">
          <span class="ball-icon ${BALLS[i]}"></span>
          ${thumb(s.mon, s.shiny)}
          <div class="seat-info"><b>${escapeHtml(s.name)}${i === st.you ? ' (tú)' : ''}</b>
            <span class="muted small">${s.mon.name}${s.shiny ? ' ✨' : ''} · ${s.bot ? `bot ${LEVEL_NAME[st.botLevel]}` : s.host ? 'anfitrión' : s.connected ? 'conectado' : 'desconectado'}</span></div>
          ${s.bot ? (host ? `<button class="btn small rm-bot" data-seat="${i}">Quitar</button>` : '<span class="tag ok">Listo</span>')
            : `<span class="tag ${s.ready ? 'ok' : 'off'}">${s.ready ? 'Listo' : 'Eligiendo…'}</span>`}
        </div>` : `<div class="seat empty"><span class="muted">Asiento libre</span></div>`).join('')}
      </div>`);
    $('rival-panel').querySelectorAll('.rm-bot').forEach((b) => (b.onclick = () => send({ type: 'removeBot', seat: Number(b.dataset.seat) })));

    // Mi Pokémon: buscador con filtro por generación, shiny y listo
    const me = st.seats[st.you];
    const list = (BASE || []).filter((m) => (pickGen === 0 || m.gen === pickGen) && (!pickQuery || m.name.toLowerCase().includes(pickQuery)));
    const taken = new Set(st.seats.filter((s, i) => s && i !== st.you).map((s) => s.mon.id));
    setHtml($('my-panel'), `
      <div class="panel-head"><div class="who">Tu Pokémon</div><span class="tag"><span class="ball-icon ${BALLS[st.you]}"></span>Asiento ${st.you + 1}</span></div>
      <div class="my-mon">${thumb(me.mon, me.shiny, 'big')}<div><b>${me.mon.name}</b><br><span class="muted small">Primera fase de su línea evolutiva</span>
        <label class="shiny-toggle"><input type="checkbox" class="shiny" ${me.shiny ? 'checked' : ''} ${me.ready ? 'disabled' : ''}> Versión shiny ✨</label></div></div>
      <input class="mon-search" placeholder="Buscar Pokémon…" value="${escapeHtml(pickQuery)}" ${me.ready ? 'disabled' : ''}>
      <div class="segmented gen-filter">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((g) =>
        `<button class="seg ${pickGen === g ? 'active' : ''}" data-g="${g}">${g === 0 ? 'Todas' : `Gen ${g}`}</button>`).join('')}</div>
      <div class="mon-grid">${list.slice(0, 90).map((m) => `
        <button class="mon-opt ${m.id === me.mon.id ? 'active' : ''}" data-id="${m.id}" ${taken.has(m.id) || me.ready ? 'disabled' : ''} title="${m.name}">
          <canvas class="thumb" data-mon="${m.id}" data-shiny="${me.shiny ? 1 : 0}" data-still="1"></canvas><span>${m.name}</span>
        </button>`).join('')}</div>
      ${list.length > 90 ? `<p class="muted small">Mostrando 90 de ${list.length}: usa el buscador o filtra por generación.</p>` : ''}
      ${!BASE ? '<p class="muted small">Cargando Pokémon…</p>' : ''}
      <button class="btn primary ready-btn">${me.ready ? 'Cancelar listo' : '¡Listo!'}</button>`);
    const panel = $('my-panel');
    panel.querySelectorAll('.mon-opt').forEach((b) => (b.onclick = () => send({ type: 'pick', mon: Number(b.dataset.id), shiny: me.shiny })));
    panel.querySelector('.shiny').onchange = (e) => send({ type: 'pick', mon: me.mon.id, shiny: e.target.checked });
    const search = panel.querySelector('.mon-search');
    search.oninput = () => { pickQuery = search.value.trim().toLowerCase(); if (pickQuery) pickGen = 0; renderLobby(); const s2 = $('my-panel').querySelector('.mon-search'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); };
    panel.querySelectorAll('.gen-filter .seg').forEach((b) => (b.onclick = () => { pickGen = Number(b.dataset.g); renderLobby(); }));
    panel.querySelector('.ready-btn').onclick = () => send({ type: 'ready', ready: !me.ready });
  }

  // ---------- Partida ----------
  function renderGame(prev) {
    const st = S();
    const rs = st.rs;
    if (!rs) return;
    const theme = st.activeBoard || 'ruta1';
    $('board-wrap').className = `board-wrap route-wrap theme-${theme}`;
    const bd = Boards.BOARDS.find((b) => b.id === theme);
    $('board-name').textContent = bd ? `📍 ${bd.name} · Ronda ${Math.min(rs.round, rs.maxRounds)}/${rs.maxRounds} · ${rs.target} medallas para ganar` : '';
    $('bar-top').innerHTML = '';
    $('bar-bottom').innerHTML = '';

    drawBoard(st);
    renderPanel(st);
    $('history').innerHTML = rs.log.map((l) => `<li class="ck-h">${escapeHtml(l.text)}</li>`).join('');
    $('history').scrollTop = $('history').scrollHeight;
    $('btn-resign').classList.toggle('hidden', st.status !== 'playing' || rs.players[myPlayer(st)]?.out);
    const rb = $('btn-rematch');
    rb.classList.toggle('hidden', st.status !== 'over');
    rb.disabled = !!st.rematch[st.you];
    rb.textContent = st.rematch[st.you] ? 'Esperando a los demás…' : 'Revancha';

    // Animar la última acción (o colocar sin animar si nos saltamos alguna)
    if (rs.seq !== lastSeq) {
      const step = lastSeq >= 0 && rs.seq === lastSeq + 1 && !reduce.matches;
      const before = prevRs;
      lastSeq = rs.seq;
      prevRs = JSON.parse(JSON.stringify(rs));
      showDice(rs, step && rs.dice && before && JSON.stringify(before.dice) !== JSON.stringify(rs.dice) || (step && rs.moves.some((m) => m.kind === 'walk')));
      if (step) animate(st, before);
      else { placeAll(st); showEvent(st, st.rs.event); }
    } else if (!animating) {
      placeAll(st);
    }
  }

  /** Contenido de cada casilla: elementos pixel art propios o el Pokémon que la representa. */
  function cellArt(st, i) {
    const sq = R.SQUARES[i];
    const rs = st.rs;
    const o = rs.owners[i];
    const owner = o ? o.owner : null;
    const roof = owner !== null ? SEAT_COLORS[st.order[owner]] : '#9aa1ad';
    const label = SHORT[sq.name] || sq.name.replace(/^Ciudad /, '').replace(/^Gimnasio /, '');
    const price = (txt) => `<span class="pr">${txt}</span>`;
    const ownedInfo = () => (o ? (o.daycare ? '🥚' : `${R.rentOf(rs, i, null)} ₽`) : `${sq.price} ₽`);
    const sprite = (id) => `<canvas class="thumb mini" data-mon="${id}" data-shiny="0"></canvas>`;
    switch (sq.type) {
      case 'town':
        return `<span class="house" style="--roof:${roof}"><i class="roofm"></i>${P('house')}</span><span class="nm">${label}</span>${price(ownedInfo())}`;
      case 'transport':
        return `<span class="rail-art">${P('rails')}<b>${sq.icon}</b></span><span class="nm">${label}</span>${price(ownedInfo())}`;
      case 'service':
        return `${sprite(sq.monId)}<span class="nm">${label}</span>${price(o ? (o.daycare ? '🥚' : 'dados×4') : `${sq.price} ₽`)}`;
      case 'gym': {
        const holders = rs.players.map((p, k) => (p.medals.includes(i) ? k : -1)).filter((k) => k >= 0);
        return `${sprite(sq.monId)}<span class="nm">${label}</span>
          <span class="medal-dots">${holders.map((k) => `<i style="background:${SEAT_COLORS[st.order[k]]}"></i>`).join('')}</span>`;
      }
      case 'grass': return `${P('grass', 'big')}<span class="nm">Hierba</span>`;
      case 'berry': return `${P('berrytree', 'big')}<span class="nm">Bayas</span>`;
      case 'snorlax': return '<canvas class="thumb snorlax-mon" data-mon="143" data-shiny="0"></canvas><span class="zzz small">Z<i>z</i><b>z</b></span><span class="nm">Snorlax</span>';
      case 'center': return `${P('pokecenter', 'big')}<span class="nm">Centro</span>`;
      case 'shop': return `${P('shop', 'big')}<span class="nm">Tienda</span>`;
      case 'galaxy': return `${sprite(434)}<span class="nm galaxy-name">Galaxia</span>`;
      case 'safari': return `${P('fence', 'big')}<span class="nm">Safari</span>${price(`${R.SAFARI_FEE} ₽`)}`;
      case 'corona': return `${P('cave', 'big')}<span class="nm">Monte Corona</span><span class="pr">atajo →</span>`;
      case 'start': return `${P('sign', 'big')}<span class="nm">Salida</span>${price(`+${R.PASS_START}`)}`;
      default: return `<span class="nm">${label}</span>`;
    }
  }

  function cellClass(st, i) {
    const sq = R.SQUARES[i];
    const o = st.rs.owners[i];
    return `rcell t-${sq.type} ${o ? 'owned' : ''} ${o && o.daycare ? 'daycare' : ''} ${st.rs.pending && st.rs.pending.sq === i ? 'focus' : ''}`;
  }

  /** Construye el tablero la primera vez (para no reiniciar las animaciones del escenario). */
  function buildBoard(st) {
    const b = $('board');
    b.className = 'board route';
    b.dataset.built = st.code;
    const cells = R.SQUARES.map((sq, i) => {
      const { row, col } = cellRC(i);
      const o = st.rs.owners[i];
      const oc = o ? SEAT_COLORS[st.order[o.owner]] : 'transparent';
      return `<div class="${cellClass(st, i)}" data-sq="${i}" title="${sq.name}"
        style="grid-row:${row + 1};grid-column:${col + 1};${sq.region ? `--rc:${REGION_COLORS[sq.region]};` : ''}--oc:${oc}">
        ${sq.region ? '<span class="band"></span>' : ''}<div class="art">${cellArt(st, i)}</div><span class="owner"></span></div>`;
    }).join('');
    const coronaRow = cellRC(R.CORONA).row + 1;
    const cave = R.CAVE.map((c, k) => `<div class="rcell cavecell" data-sq="${c}" style="grid-row:${coronaRow};grid-column:${CAVE_COLS[k] + 1}"><span class="rock"></span></div>`).join('');
    const banners = SIDE_REGION.map(([name, color], k) => `<span class="banner b${k}" style="--bc:${color}">${name}</span>`).join('');
    // Fila de la cueva dentro del escenario (el escenario empieza en la fila 1 y mide 10 filas)
    const caveTop = ((coronaRow - 2) / (L - 2)) * 100;
    b.innerHTML = `
      <div class="scene" style="grid-row:2/${L};grid-column:2/${L}">
        <div class="ground"></div>
        ${DECOR.map(([name, x, y, w]) => `<span class="decor" style="left:${x}%;top:${y}%;width:${w}%">${P(name)}</span>`).join('')}
        <div class="pond"></div>
        <div class="safari-park"><span>Zona Safari</span>${P('fence')}${P('fence')}${P('fence')}<canvas class="park-mon" data-wild="115"></canvas></div>
        <div class="tunnel" style="top:${caveTop}%;height:10%">
          <span class="tunnel-sign">⛰ Atajo del Monte Corona → Ciudad Rocavelo</span>
          <span class="arrow a1">▶</span><span class="arrow a2">▶</span><span class="arrow a3">▶</span>
        </div>
        <div class="cloud c1"></div><div class="cloud c2"></div>
        ${WILD.map((w, k) => `<canvas class="wild w${k}" data-wild="${w.id}" style="top:${w.top}%;left:${w.min}%"></canvas>`).join('')}
        <div class="night"></div>
        ${banners}
        <div id="route-stage" class="stage"></div>
        <div class="rcenter">
          <div class="turn-line"></div>
          <div class="dice"></div>
        </div>
      </div>${cells}${cave}`;
    // Pokémon salvajes paseando por el escenario (caminan de lado a lado)
    startWild(b);
    // Al pasar por el Monte Corona se resalta todo el atajo
    const corona = b.querySelector(`.rcell[data-sq="${R.CORONA}"]`);
    corona.onmouseenter = () => b.classList.add('show-shortcut');
    corona.onmouseleave = () => b.classList.remove('show-shortcut');
    ctx.hydrate(b);
    b.querySelectorAll('.rcell:not(.cavecell)').forEach((el) => (el.onclick = () => cellInfo(Number(el.dataset.sq))));
  }

  /**
   * Paseo de los Pokémon salvajes: una sola animación por Pokémon, que camina mirando
   * hacia donde va (fila derecha o izquierda de su sprite), se da la vuelta en los bordes
   * de su carril y a veces se para un momento mirando de lado.
   */
  let wildLoop = null;
  function startWild(b) {
    if (wildLoop) cancelAnimationFrame(wildLoop);
    const park = b.querySelector('canvas.park-mon');
    if (park) new MonSprite(park, Number(park.dataset.wild), false, 'roomy');
    const walkers = [...b.querySelectorAll('canvas.wild')].map((cv, k) => {
      const cfg = WILD[k];
      const sprite = new MonSprite(cv, cfg.id, false, 'roomy');
      const w = { cv, cfg, sprite, x: cfg.min + Math.random() * (cfg.max - cfg.min), dir: Math.random() < 0.5 ? 1 : -1, pauseUntil: 0, nextPause: 0, phase: Math.random() * 6 };
      w.nextPause = performance.now() + 3000 + Math.random() * 5000;
      sprite.play('Walk', { dir: w.dir > 0 ? 2 : 6 });
      return w;
    });
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      for (const w of walkers) {
        if (!w.cv.isConnected) { cancelAnimationFrame(wildLoop); wildLoop = null; return; }
        const side = w.dir > 0 ? 2 : 6; // 2 = mira a la derecha, 6 = a la izquierda
        if (reduce.matches) { if (w.sprite.anim !== 'Idle') w.sprite.play('Idle', { dir: side }); continue; }
        if (now < w.pauseUntil) continue;                         // en pausa (reposo de lado)
        if (w.sprite.anim !== 'Walk') w.sprite.play('Walk', { dir: side });
        if (!w.cfg.fly && now > w.nextPause) {                    // de vez en cuando se para
          w.pauseUntil = now + 900 + Math.random() * 1400;
          w.nextPause = w.pauseUntil + 3500 + Math.random() * 6000;
          w.sprite.play('Idle', { dir: side });
          continue;
        }
        w.x += w.dir * w.cfg.speed * dt;
        if (w.x > w.cfg.max || w.x < w.cfg.min) {                // borde del carril: se da la vuelta
          w.x = Math.max(w.cfg.min, Math.min(w.cfg.max, w.x));
          w.dir = -w.dir;
          w.sprite.play('Walk', { dir: w.dir > 0 ? 2 : 6 });
        }
        w.phase += dt * 4;
        const bob = w.cfg.fly ? Math.sin(w.phase) * 6 : 0;        // Pidgey sube y baja al volar
        w.cv.style.left = `${w.x}%`;
        w.cv.style.transform = `translateY(${bob}px)`;
      }
      wildLoop = requestAnimationFrame(tick);
    };
    wildLoop = requestAnimationFrame(tick);
  }

  function drawBoard(st) {
    const rs = st.rs;
    const b = $('board');
    if (b.dataset.built !== st.code || !b.querySelector('.scene')) buildBoard(st);
    // Momento del día: cambia cada 2 rondas (mañana, tarde, atardecer, noche)
    const time = DAYTIME[Math.floor((Math.min(rs.round, rs.maxRounds) - 1) / 2) % DAYTIME.length];
    b.querySelector('.scene').className = `scene time-${time}`;
    // Actualiza solo las casillas que cambian (dueño, Guardería, medallas)
    R.SQUARES.forEach((sq, i) => {
      const el = b.querySelector(`.rcell[data-sq="${i}"]`);
      const cls = cellClass(st, i);
      const o = rs.owners[i];
      el.style.setProperty('--oc', o ? SEAT_COLORS[st.order[o.owner]] : 'transparent');
      const key = JSON.stringify([o, rs.players.map((p) => p.medals.includes(i))]);
      if (el.dataset.key !== key) {
        el.dataset.key = key;
        setHtml(el.querySelector('.art'), cellArt(st, i));
      }
      if (el.className !== cls) el.className = cls;
    });
    const tl = b.querySelector('.turn-line');
    if (rs.phase === 'over') tl.textContent = `🏆 ${rs.players[rs.winner].name}: ${REASON[rs.reason]}`;
    else tl.textContent = `Turno de ${rs.players[rs.turn].name}${st.botThinking ? ' (pensando…)' : ''}`;
  }

  /** Dados: giran unos instantes y rebotan antes de mostrar el resultado. */
  function showDice(rs, animateIt) {
    const box = $('board').querySelector('.dice');
    if (!box) return;
    const faces = (d) => d.map((n) => `<span class="die d${n}">${'<i></i>'.repeat(n)}</span>`).join('');
    if (!rs.dice) { box.innerHTML = ''; return; }
    if (!animateIt || reduce.matches) { box.innerHTML = faces(rs.dice); return; }
    let k = 0;
    box.classList.add('rolling');
    const spin = setInterval(() => {
      box.innerHTML = faces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      if (++k >= 6) {
        clearInterval(spin);
        box.classList.remove('rolling');
        box.innerHTML = faces(rs.dice);
        if (rs.dice[0] === rs.dice[1]) floatText('¡Dobles!', box);
      }
    }, 70);
  }

  /** Texto que salta y se desvanece (¡Dobles!, +100 ₽…). */
  function floatText(text, anchor, cls = '') {
    const stageEl = $('board-wrap');
    const a = anchor.getBoundingClientRect();
    const w = stageEl.getBoundingClientRect();
    const el = document.createElement('span');
    el.className = `float-text ${cls}`;
    el.textContent = text;
    el.style.left = `${a.left - w.left + a.width / 2}px`;
    el.style.top = `${a.top - w.top}px`;
    stageEl.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  function cellInfo(i) {
    const st = S();
    const sq = R.SQUARES[i];
    const o = st.rs.owners[i];
    let text = sq.name;
    if (sq.type === 'town') text += ` · ${R.REGION_NAMES[sq.region]} · precio ${money(sq.price)} · entrenamiento ${money(sq.rent)} (×2 con la región)` + (o ? ` · de ${st.rs.players[o.owner].name}${o.daycare ? ' (en la Guardería)' : ''}` : ' · libre');
    if (sq.type === 'gym') text += ` · Líder ${sq.leader}`;
    if (sq.type === 'transport') text += ` · precio ${money(sq.price)} · billete 30/60/110/180 ₽ según cuántos tenga el dueño · si es tuyo, viajas gratis a otro` + (o ? ` · de ${st.rs.players[o.owner].name}` : ' · libre');
    if (sq.type === 'service') text += ` · precio ${money(sq.price)} · se paga lo de los dados ×4 (×10 si el dueño tiene los dos)` + (o ? ` · de ${st.rs.players[o.owner].name}` : ' · libre');
    if (sq.type === 'corona') text += ' · Puedes cruzar la cueva por el centro hasta el otro lado (arriesgado).';
    if (sq.type === 'safari') text += ` · Entrada ${money(R.SAFARI_FEE)}: 3 Safari Balls para capturar un Pokémon con un bonus de un uso.`;
    toast(text);
  }

  // ---------- Fichas ----------
  function tokenFor(st, p) {
    let t = tokens.get(p);
    const seat = seatOfPlayer(st, p);
    const key = `${seat.mon.id}-${seat.shiny}`;
    if (t && t.key === key && t.el.isConnected) return t;
    if (t) { t.sprite.destroy(); t.el.remove(); }
    const el = document.createElement('div');
    el.className = 'piece rtoken';
    el.innerHTML = `<span class="turn-arrow" style="--sc:${SEAT_COLORS[st.order[p]]}"></span><span class="ball-badge ${BALLS[st.order[p]]}"></span><canvas></canvas>`;
    el.title = `${seat.name} · ${seat.mon.name}`;
    $('pieces').appendChild(el);
    t = { el, sprite: new MonSprite(el.querySelector('canvas'), seat.mon.id, seat.shiny, 'board'), key, pos: null };
    tokens.set(p, t);
    return t;
  }

  /** Posición (en %) de un jugador en una casilla, separados si comparten casilla. */
  function tokenPos(st, p, sq, positions) {
    const { row, col } = cellRC(sq);
    const here = st.rs.players.map((pl, k) => k).filter((k) => !st.rs.players[k].out && positions[k] === sq);
    const idx = here.indexOf(p);
    const crowd = here.length > 1;
    const off = crowd ? [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]][idx % 4] : [0, 0];
    return { left: col * CELL + off[0], top: row * CELL + off[1], crowd };
  }

  function placeToken(st, p, sq, positions, ms = 0) {
    const t = tokenFor(st, p);
    const { left, top, crowd } = tokenPos(st, p, sq, positions);
    t.el.style.transition = ms ? `left ${ms}ms linear, top ${ms}ms linear` : '';
    t.el.style.left = `${left}%`;
    t.el.style.top = `${top}%`;
    t.el.classList.toggle('crowd', crowd);
    t.pos = sq;
  }

  function placeAll(st) {
    const rs = st.rs;
    const positions = rs.players.map((pl) => pl.pos);
    // Foco en el turno: el Pokémon al que le toca da saltitos con una flecha de su color
    for (const [p, t] of tokens) t.el.classList.toggle('active', p === rs.turn && rs.phase !== 'over');
    rs.players.forEach((pl, p) => {
      if (pl.out) { const t = tokens.get(p); if (t) { t.sprite.destroy(); t.el.remove(); tokens.delete(p); } return; }
      placeToken(st, p, pl.pos, positions);
    });
    for (const el of [...$('pieces').children]) if (![...tokens.values()].some((t) => t.el === el)) el.remove();
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Anima la última acción: movimientos, combate (antes del retroceso) y evento. */
  async function animate(st, before) {
    if (animating) { queued = st; return; }
    animating = true;
    const rs = st.rs;
    // Punto de partida: dónde estaba cada ficha antes de esta acción
    const positions = rs.players.map((pl, p) => (tokens.get(p) && tokens.get(p).pos !== null ? tokens.get(p).pos : pl.pos));
    rs.players.forEach((pl, p) => { if (!pl.out) placeToken(st, p, positions[p], positions); });
    // Los eventos pueden encadenarse (una baya te hace retroceder a un gimnasio...):
    // el primero se muestra antes del movimiento que provoca y el resto al final, uno tras otro.
    const events = rs.events && rs.events.length ? rs.events : rs.event ? [rs.event] : [];
    const evMoveIdx = rs.moves.findIndex((m) => !['walk', 'knockback'].includes(m.kind));
    let next = 0;
    for (let i = 0; i < rs.moves.length; i++) {
      const m = rs.moves[i];
      if (i === evMoveIdx && events[next]) { showEvent(st, events[next++]); await wait(1500); }
      if (m.kind === 'knockback' && rs.battle) await showBattle(st);
      await moveAlong(st, m, positions);
    }
    while (next < events.length) {
      showEvent(st, events[next++]);
      if (next < events.length) await wait(1700);
    }
    placeAll(st);
    if (before) effects(st, before);
    animating = false;
    if (queued) { const q = queued; queued = null; renderGame(q); }
  }

  /** Centro (en px dentro del board-wrap) de la ficha de un jugador o de una casilla. */
  function pointOf(p, sq) {
    const w = $('board-wrap').getBoundingClientRect();
    const el = p !== null ? tokens.get(p) && tokens.get(p).el : $('board').querySelector(`.rcell[data-sq="${sq}"]`);
    const r = (el || $('board').querySelector('.rcenter')).getBoundingClientRect();
    return { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2 };
  }

  /** Monedas que vuelan de quien paga a quien cobra, medallas nuevas y confeti al reclamar. */
  function effects(st, before) {
    const rs = st.rs;
    const deltas = rs.players.map((pl, p) => pl.money - (before.players[p] ? before.players[p].money : pl.money));
    const payers = deltas.map((d, p) => (d < 0 ? p : -1)).filter((p) => p >= 0);
    const gainers = deltas.map((d, p) => (d > 0 ? p : -1)).filter((p) => p >= 0);
    for (const from of payers) {
      const to = gainers[0] !== undefined ? gainers[0] : null;
      coins(pointOf(from), to !== null ? pointOf(to) : pointOf(null, -1));
    }
    if (!payers.length) for (const to of gainers) coins(pointOf(null, -1), pointOf(to));
    rs.players.forEach((pl, p) => {
      const t = tokens.get(p);
      if (!t) return;
      const gained = deltas[p];
      if (gained) floatText(`${gained > 0 ? '+' : ''}${gained} ₽`, t.el, gained > 0 ? 'gain' : 'loss');
      if (before.players[p] && pl.medals.length > before.players[p].medals.length) medalPop(t.el);
    });
    for (const k of Object.keys(rs.owners)) {
      if (!before.owners[k] || before.owners[k].owner !== rs.owners[k].owner) confetti($('board').querySelector(`.rcell[data-sq="${k}"]`));
    }
  }

  function coins(from, to) {
    const w = $('board-wrap');
    for (let k = 0; k < 5; k++) {
      const c = document.createElement('span');
      c.className = 'fly-coin';
      c.style.left = `${from.x}px`;
      c.style.top = `${from.y}px`;
      w.appendChild(c);
      setTimeout(() => { c.style.transform = `translate(${to.x - from.x}px, ${to.y - from.y}px) scale(0.7)`; c.style.opacity = '0.2'; }, 30 + k * 90);
      setTimeout(() => c.remove(), 1000 + k * 90);
    }
  }

  function medalPop(anchor) {
    const w = $('board-wrap');
    const a = anchor.getBoundingClientRect();
    const r = w.getBoundingClientRect();
    const m = document.createElement('span');
    m.className = 'medal-pop';
    m.style.left = `${a.left - r.left + a.width / 2}px`;
    m.style.top = `${a.top - r.top}px`;
    w.appendChild(m);
    setTimeout(() => m.remove(), 1600);
  }

  function confetti(cell) {
    if (!cell) return;
    cell.classList.remove('claimed');
    void cell.offsetWidth;
    cell.classList.add('claimed');
    setTimeout(() => cell.classList.remove('claimed'), 1200);
  }

  async function moveAlong(st, m, positions) {
    const t = tokenFor(st, m.p);
    if (m.kind === 'teleport' || m.kind === 'snorlax' || m.kind === 'train') {
      if (m.kind === 'train') t.el.classList.add('train');
      t.el.classList.add('vanish');
      await wait(350);
      positions[m.p] = m.path[m.path.length - 1];
      placeToken(st, m.p, positions[m.p], positions);
      t.el.classList.remove('vanish');
      await wait(350);
      t.el.classList.remove('train');
      return;
    }
    const stepMs = m.kind === 'knockback' ? 380 : m.kind === 'fly' ? 700 : m.kind === 'cave' ? 320 : 190;
    if (m.kind === 'cave') t.el.classList.add('in-cave');
    if (m.kind === 'knockback') t.sprite.play('Hurt', { loop: false });
    if (m.kind === 'fly') t.el.classList.add('flying');
    for (let k = 1; k < m.path.length; k++) {
      const a = cellRC(m.path[k - 1]);
      const b = cellRC(m.path[k]);
      if (m.kind !== 'knockback') t.sprite.play('Walk', { dir: dirFromDelta(b.col - a.col, b.row - a.row) });
      positions[m.p] = m.path[k];
      placeToken(st, m.p, m.path[k], positions, stepMs);
      lightCell(m.path[k], k === m.path.length - 1);
      await wait(stepMs);
    }
    t.el.classList.remove('flying', 'in-cave');
    t.sprite.play('Idle', { dir: 0 });
  }

  /** La casilla por la que pasa la ficha se ilumina; la de llegada da un pulso. */
  function lightCell(sq, last) {
    const el = $('board').querySelector(`.rcell[data-sq="${sq}"]`);
    if (!el) return;
    el.classList.add(last ? 'landed' : 'step');
    setTimeout(() => el.classList.remove('step', 'landed'), last ? 900 : 420);
  }

  /** Combate: los dos Pokémon frente a frente, dados, ataque del ganador y golpe al perdedor. */
  async function showBattle(st) {
    const rs = st.rs;
    const bt = rs.battle;
    const last = bt.rolls[bt.rolls.length - 1];
    const stage = $('route-stage');
    if (!stage) return;
    const sa = seatOfPlayer(st, bt.a);
    const sb = seatOfPlayer(st, bt.b);
    stage.className = 'stage battle show';
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => stage.classList.remove('show'), 4200);
    stage.innerHTML = `<div class="ev-title">¡Combate!</div>
      <div class="vs"><div><canvas class="ev-mon a"></canvas><b>${escapeHtml(sa.name)}</b><span>${last.me[0]} + ${last.me[1]}</span></div>
      <span class="vs-x">VS</span>
      <div><canvas class="ev-mon b"></canvas><b>${escapeHtml(sb.name)}</b><span>${last.them[0]} + ${last.them[1]}</span></div></div>
      <div class="ev-text">${bt.rolls.length > 1 ? `Empataron ${bt.rolls.length - 1} vez/veces. ` : ''}Gana ${escapeHtml(st.rs.players[bt.winner].name)}</div>`;
    const ca = new MonSprite(stage.querySelector('.ev-mon.a'), sa.mon.id, sa.shiny, 'thumb');
    const cb = new MonSprite(stage.querySelector('.ev-mon.b'), sb.mon.id, sb.shiny, 'thumb');
    ca.play('Idle', { dir: 2 });
    cb.play('Idle', { dir: 6 });
    await wait(900);
    const [win, lose, dirW] = bt.winner === bt.a ? [ca, cb, 2] : [cb, ca, 6];
    win.play(win.duration('Attack') ? 'Attack' : 'Idle', { dir: dirW, loop: false });
    const tw = tokens.get(bt.winner);
    if (tw) tw.sprite.play('Attack', { loop: false, onDone: () => tw.sprite.play('Idle', { dir: 0 }) });
    await wait(450);
    lose.play('Hurt', { dir: dirW === 2 ? 6 : 2, loop: false });
    await wait(650);
  }

  /** Tarjeta del evento (hierba alta, bayas, gimnasio, Equipo Galaxia, despertar a Snorlax). */
  function showEvent(st, ev) {
    const rs = st.rs;
    const stage = $('route-stage');
    if (!stage) return;
    if (!ev) return; // el aviso anterior se aparta solo
    const pl = rs.players[ev.p];
    const seat = seatOfPlayer(st, ev.p);
    let title = ev.title;
    let text = ev.text;
    let monId = ev.mon;
    let anim = ev.anim || 'pop';
    if (ev.kind === 'gym') {
      const medal = R.SQUARES[ev.medal || ev.gym].name;
      title = `${R.SQUARES[ev.gym].name}: ${ev.leader}`;
      text = `${pl.name} ${ev.mine[0] + ev.mine[1]}${ev.bonus ? ` +${ev.bonus} exp.` : ''} contra ${ev.lead[0] + ev.lead[1]} · ${ev.win ? `¡Medalla de ${medal}!` : `Pierde y paga ${R.GYM_LOSS_FEE} ₽`}`;
      anim = ev.win ? 'medal' : 'attack';
    } else if (ev.kind === 'galaxy') {
      title = ev.protected ? '¡Scyther te protege!' : '¡Equipo Galaxia!';
      text = ev.protected ? `El Scyther de ${pl.name} ahuyenta al Equipo Galaxia.`
        : ev.stole !== undefined ? `Le roban ${R.SQUARES[ev.stole].name} a ${pl.name}.` : `Le quitan ${ev.money} ₽ a ${pl.name}.`;
      anim = 'attack';
    } else if (ev.kind === 'cave') {
      anim = ev.ok ? 'cave-ok' : 'attack';
    } else if (ev.kind === 'safari') {
      title = `Zona Safari: ¡un ${ev.name} salvaje!`;
      text = `${ev.throws.map((t) => (t ? '◉' : '○')).join(' ')} · ${ev.caught ? `¡Capturado! ${ev.text}` : 'Se escapó…'}`;
      anim = ev.caught ? 'caught' : 'run';
    } else if (ev.kind === 'safariUse') {
      title = `¡Adelante, ${ev.name}!`;
      anim = 'heal';
    } else if (ev.kind === 'wake') {
      title = '¡Snorlax se despierta!';
      text = `${pl.name} usa ${ev.item === 'flute' ? 'la Poké Flauta' : 'una Baya Zreza'} y Snorlax se aparta.`;
      anim = 'wake';
    }
    // Las bayas sin Pokémon propio las "come" el Pokémon del jugador
    const useMine = !monId;
    if (useMine) monId = seat.mon.id;
    stage.className = `stage ev ev-${ev.kind} anim-${anim} show`;
    clearTimeout(stageTimer);
    stageTimer = setTimeout(() => stage.classList.remove('show'), 3600);
    stage.innerHTML = `<div class="ev-art"><canvas class="ev-mon"></canvas>${ev.kind === 'safari' ? `<span class="safari-balls">${ev.throws.map((t, k) => `<i class="${t ? 'hit' : ''}" style="animation-delay:${k * 0.45}s"></i>`).join('')}</span>` : ''}${ev.kind === 'berry' ? '<span class="berry"></span>' : ''}${anim === 'sleep' ? '<span class="zzz">Z<i>z</i><b>z</b></span>' : ''}${anim === 'coins' ? '<span class="coins"><i></i><i></i><i></i><i></i></span>' : ''}${anim === 'item' ? '<span class="sparkle">✦</span>' : ''}</div>
      <div class="ev-body"><div class="ev-title">${escapeHtml(title)}</div><div class="ev-text">${escapeHtml(text)}</div></div>`;
    const sp = new MonSprite(stage.querySelector('.ev-mon'), monId, useMine ? seat.shiny : false, 'thumb');
    if (anim === 'attack' || anim === 'coins') sp.play('Attack', { loop: false, onDone: () => sp.play('Idle') });
    else if (anim === 'run' || anim === 'fly') sp.play('Walk', { dir: 2 });
    else if (anim === 'scare') sp.play('Attack', { loop: false, onDone: () => sp.play('Idle') });
    else if (anim === 'dizzy' || anim === 'smoke') sp.play('Hurt', { loop: false, onDone: () => sp.play('Idle') });
    else if (anim === 'sleep') sp.play(sp.duration('Sleep') ? 'Sleep' : 'Idle');
    // El Pokémon del jugador también reacciona en el tablero
    const tk = tokens.get(ev.p);
    if (tk && ['attack', 'dizzy', 'smoke', 'scare'].includes(anim)) tk.sprite.play('Hurt', { loop: false, onDone: () => tk.sprite.play('Idle', { dir: 0 }) });
  }

  // ---------- Panel lateral ----------
  function renderPanel(st) {
    const rs = st.rs;
    const me = myPlayer(st);
    const myTurn = me >= 0 && (rs.turn === me || (rs.debt && rs.debt.p === me)) && rs.phase !== 'over';
    const statusEl = $('status');
    statusEl.classList.toggle('end', rs.phase === 'over');
    statusEl.textContent = rs.phase === 'over' ? `🏆 Gana ${rs.players[rs.winner].name}: ${REASON[rs.reason]}`
      : myTurn ? (rs.debt && rs.debt.p === me ? '¡No te alcanza! Reúne dinero' : 'Te toca') : `Turno de ${rs.players[rs.turn].name}`;

    let panel = $('route-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'route-panel';
      $('status').after(panel);
    }
    const players = rs.players.map((pl, p) => {
      const seat = seatOfPlayer(st, p);
      const towns = Object.keys(rs.owners).filter((k) => rs.owners[k].owner === p).length;
      return `<div class="rplayer ${rs.turn === p && rs.phase !== 'over' ? 'turn' : ''} ${pl.out ? 'out' : ''}" style="--sc:${SEAT_COLORS[st.order[p]]}">
        ${thumb(seat.mon, seat.shiny)}
        <div class="rp-info"><b>${escapeHtml(pl.name)}${p === me ? ' (tú)' : ''}${seat.bot ? ' 🤖' : ''}</b>
          <span>${money(pl.money)} · ${towns} propiedad${towns === 1 ? '' : 'es'}${pl.safari.length ? ` · 🌴${pl.safari.length}` : ''}${pl.stuck ? ' · 💤 atascado' : ''}${pl.skip ? ' · pierde turno' : ''}${pl.out ? ' · retirado' : ''}</span>
          <span class="medals">${Array.from({ length: rs.target }, (_, k) => `<i class="${k < pl.medals.length ? 'got' : ''}"></i>`).join('')}
            ${pl.items.flute ? `<em title="Poké Flauta">🎵${pl.items.flute}</em>` : ''}${pl.items.zreza ? `<em title="Baya Zreza">🍒${pl.items.zreza}</em>` : ''}${pl.exp ? `<em title="Experiencia de gimnasio">+${pl.exp}</em>` : ''}</span></div>
      </div>`;
    }).join('');

    // Acciones
    let actions = '';
    const pl = rs.players[me];
    if (myTurn && !st.botThinking) {
      const btn = (label, action, cls = '') => `<button class="btn ${cls}" data-act='${JSON.stringify(action)}'>${label}</button>`;
      switch (rs.phase) {
        case 'roll':
          actions += btn(pl.stuck ? '🎲 Tirar (necesitas dobles)' : '🎲 Tirar dados', { type: 'roll' }, 'primary');
          if (pl.stuck && pl.items.flute) actions += btn('🎵 Usar Poké Flauta', { type: 'useItem', item: 'flute' });
          if (pl.stuck && pl.items.zreza) actions += btn('🍒 Usar Baya Zreza', { type: 'useItem', item: 'zreza' });
          break;
        case 'buy': {
          const sq = R.SQUARES[rs.pending.sq];
          actions += btn(`Reclamar ${sq.name} por ${money(sq.price)}`, { type: 'buy' }, 'primary') + btn('No reclamar', { type: 'skip' });
          break;
        }
        case 'battle':
          actions += rs.pending.rivals.map((r) => btn(`⚔ ¡Combate contra ${escapeHtml(rs.players[r].name)}!`, { type: 'battle', target: r }, 'primary')).join('') + btn('Pasar', { type: 'decline' });
          break;
        case 'shop':
          actions += btn(`🎵 Comprar Poké Flauta (${money(R.FLUTE_PRICE)})`, { type: 'shop', buy: true }, 'primary') + btn('No, gracias', { type: 'shop', buy: false });
          break;
        case 'corona':
          actions += btn('⛰ Cruzar la cueva (atajo arriesgado)', { type: 'cave', enter: true }, 'primary') + btn('Rodear la montaña', { type: 'cave', enter: false });
          break;
        case 'safari':
          actions += btn(`🌴 Entrar en la Zona Safari (${money(R.SAFARI_FEE)})`, { type: 'safari', enter: true }, 'primary') + btn('Pasar de largo', { type: 'safari', enter: false });
          break;
        case 'travel':
          actions += rs.pending.options.map((to) => btn(`${R.SQUARES[to].icon} Viajar a ${R.SQUARES[to].name}`, { type: 'travel', to }, 'primary')).join('') + btn('Quedarme aquí', { type: 'travel', to: null });
          break;
        case 'end':
          actions += btn(rs.extraRoll ? '🎲 ¡Vuelve a tirar!' : 'Terminar turno', { type: 'end' }, 'primary');
          break;
        case 'debt': {
          const to = rs.debt.to === null ? 'la Liga' : rs.players[rs.debt.to].name;
          actions += `<p class="debt">Debes <b>${money(rs.debt.amount)}</b> a ${escapeHtml(to)} y tienes ${money(pl.money)}. Deja pueblos en la Guardería, véndelos o retírate.</p>`;
          actions += btn('Retirarme', { type: 'retire' }, 'danger');
          break;
        }
        default: break;
      }
    }
    // Pokémon capturados en la Zona Safari (bonus de un uso)
    if (pl && pl.safari.length && !pl.out) {
      const dcOwned = Object.keys(rs.owners).map(Number).filter((k) => rs.owners[k].owner === me && rs.owners[k].daycare);
      const canEnd = myTurn && rs.phase === 'end' && !(rs.debt && rs.debt.p === me);
      actions += `<div class="safari-box"><b>Tus Pokémon del Safari</b>${pl.safari.map((id) => {
        const d = R.SAFARI_BY_ID[id];
        const usable = myTurn && !st.botThinking && (d.when === 'any' || (d.when === 'end' && canEnd)) && (id !== 'pinsir' || dcOwned.length);
        const action = id === 'pinsir' ? { type: 'useSafari', id, sq: dcOwned[0] } : { type: 'useSafari', id };
        return `<div class="sf"><canvas class="thumb" data-mon="${d.mon}" data-shiny="0"></canvas><span><b>${d.name}</b> <span class="muted small">${d.text}</span></span>
          ${d.when === 'passive' ? '<span class="tag">automático</span>' : `<button class="btn small" data-act='${JSON.stringify(action)}' ${usable ? '' : 'disabled'}>Usar</button>`}</div>`;
      }).join('')}</div>`;
    }
    // Ofertas que me hacen / que hice
    const offers = rs.offers.map((o) => {
      const sq = R.SQUARES[o.sq];
      if (o.to === me) return `<div class="offer">${escapeHtml(rs.players[o.from].name)} te ofrece <b>${sq.name}</b> por ${money(o.price)}
        <button class="btn small primary" data-act='${JSON.stringify({ type: 'answer', id: o.id, accept: true })}'>Aceptar</button>
        <button class="btn small" data-act='${JSON.stringify({ type: 'answer', id: o.id, accept: false })}'>Rechazar</button></div>`;
      if (o.from === me) return `<div class="offer mine">Ofreces <b>${sq.name}</b> a ${escapeHtml(rs.players[o.to].name)} por ${money(o.price)}
        <button class="btn small" data-act='${JSON.stringify({ type: 'cancelOffer', id: o.id })}'>Cancelar</button></div>`;
      return '';
    }).join('');

    // Mis pueblos: Guardería, recuperar, vender a la Tienda u ofrecer a otro jugador
    const myTowns = me >= 0 ? Object.keys(rs.owners).map(Number).filter((k) => rs.owners[k].owner === me) : [];
    const canManage = myTurn && !st.botThinking;
    const inDebt = rs.debt && rs.debt.p === me;
    const others = rs.players.map((q, k) => k).filter((k) => k !== me && !rs.players[k].out);
    const assets = myTowns.length ? `
      <details class="assets" ${showAssets || inDebt ? 'open' : ''}><summary>Mis propiedades (${myTowns.length})</summary>
        ${myTowns.map((k) => {
          const sq = R.SQUARES[k];
          const dc = rs.owners[k].daycare;
          const kind = sq.type === 'town' ? R.REGION_NAMES[sq.region] : sq.type === 'transport' ? 'Transporte' : 'Servicio';
          return `<div class="town"><span><b>${sq.name}</b> <span class="muted small">${kind} · vale ${money(sq.price)}${dc ? ' · 🥚 en la Guardería' : ''}</span></span>
            ${canManage ? `<span class="town-act">
              ${dc ? `<button class="btn small" data-act='${JSON.stringify({ type: 'redeem', sq: k })}' ${inDebt ? 'disabled' : ''}>Recuperar (${money(Math.round(sq.price * 0.6))})</button>`
                : `<button class="btn small" data-act='${JSON.stringify({ type: 'daycare', sq: k })}'>Guardería (+${money(Math.round(sq.price * 0.5))})</button>
                   <button class="btn small" data-act='${JSON.stringify({ type: 'sellBank', sq: k })}'>Vender a la Tienda (+${money(Math.round(sq.price * 0.4))})</button>`}
              ${others.length ? `<span class="sell-to"><select class="to">${others.map((o) => `<option value="${o}">${escapeHtml(rs.players[o].name)}</option>`).join('')}</select>
                <input class="price" type="number" min="1" value="${sq.price}"><button class="btn small offer-btn" data-sq="${k}">Ofrecer</button></span>` : ''}
            </span>` : ''}</div>`;
        }).join('')}
      </details>` : '';

    setHtml(panel, `<div class="rplayers">${players}</div>
      ${actions ? `<div class="ractions">${actions}</div>` : ''}${offers}${assets}`);
    panel.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
      const action = JSON.parse(b.dataset.act);
      if (action.type === 'retire' && !confirm('¿Seguro que te retiras?')) return;
      send({ type: 'route', action });
    }));
    panel.querySelectorAll('.offer-btn').forEach((b) => (b.onclick = () => {
      const box = b.closest('.sell-to');
      send({ type: 'route', action: { type: 'offer', sq: Number(b.dataset.sq), to: Number(box.querySelector('.to').value), price: Number(box.querySelector('.price').value) } });
    }));
    const det = panel.querySelector('details.assets');
    if (det) det.ontoggle = () => { showAssets = det.open; };
  }

  /** Limpia el tablero de esta modalidad (al cambiar de sala o volver al lobby). */
  function reset() {
    for (const t of tokens.values()) { t.sprite.destroy(); t.el.remove(); }
    tokens.clear();
    lastSeq = -1;
    prevRs = null;
    const b = $('board');
    if (b) delete b.dataset.built;
    const panel = $('route-panel');
    if (panel) panel.remove();
  }

  /** Pokémon de un asiento (para el Pokéreloj y las reacciones). */
  function tokenSprite(seat) {
    const st = S();
    if (!st || !st.rs) return null;
    const p = st.order.indexOf(seat);
    const t = tokens.get(p);
    return t ? t.sprite : null;
  }

  return { renderLobby, renderGame, reset, tokenSprite };
}
