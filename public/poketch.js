/**
 * Pokéreloj: chat de la sala con forma de reloj pixel art (inspirado en el de Sinnoh).
 * Tres pantallas que se cambian con el botón lateral:
 *   - Chat: mensajes con el mini sprite de cada jugador y aviso de "escribiendo…".
 *   - Reacciones: un toque y el Pokémon de quien la manda actúa sobre el tablero.
 *   - Registro: lo que va pasando en la partida.
 * Plegado muestra cuántos mensajes nuevos hay.
 */
import { MonSprite } from './sprites.js';

const REACTIONS = [
  ['gg', '¡GG!'], ['nice', '¡Bien jugado!'], ['wow', '¡Increíble!'], ['lol', '¡Jajaja!'],
  ['ouch', '¡Eso dolió!'], ['noo', '¡Noooo!'], ['turn', '¡Te toca!'],
];
// Animación del Pokémon según la reacción
const REACT_ANIM = { gg: 'Walk', nice: 'Attack', wow: 'Attack', lol: 'Walk', ouch: 'Hurt', noo: 'Faint', turn: 'Walk' };
const SCREENS = ['chat', 'react', 'log'];
const SCREEN_NAME = { chat: 'CHAT', react: 'REACC.', log: 'REGISTRO' };

export function createPoketch({ send, getLog, escapeHtml, getStage, tokenSprite }) {
  const root = document.createElement('div');
  root.className = 'poketch folded hidden';
  root.innerHTML = `
    <button class="pk-fold" aria-label="Abrir el Pokéreloj"><span class="pk-mini">Pokéreloj</span><span class="pk-badge hidden">0</span></button>
    <div class="pk-body">
      <div class="pk-case">
        <div class="pk-screen">
          <div class="pk-top"><span class="pk-title">CHAT</span><span class="pk-clock"></span></div>
          <div class="pk-view pk-chat"><ul class="pk-msgs"></ul><div class="pk-typing"></div>
            <form class="pk-form"><input maxlength="200" placeholder="Escribe…" aria-label="Mensaje"><button>▶</button></form></div>
          <div class="pk-view pk-react hidden">${REACTIONS.map(([k, t]) => `<button data-k="${k}">${t}</button>`).join('')}</div>
          <div class="pk-view pk-log hidden"><ul></ul></div>
        </div>
      </div>
      <button class="pk-side" aria-label="Cambiar pantalla"></button>
      <button class="pk-close" aria-label="Plegar">–</button>
    </div>`;
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);

  let screen = 'chat';
  let unread = 0;
  let typingTimer = null;
  let lastTypingSent = 0;
  const typers = new Map();

  function setScreen(s) {
    screen = s;
    for (const v of SCREENS) root.querySelector(`.pk-${v}`).classList.toggle('hidden', v !== s);
    $('.pk-title').textContent = SCREEN_NAME[s];
    if (s === 'log') renderLog();
    root.classList.add('flash');
    setTimeout(() => root.classList.remove('flash'), 180);
  }
  function setFolded(f) {
    root.classList.toggle('folded', f);
    if (!f) { unread = 0; updateBadge(); if (screen === 'chat') $('.pk-form input').focus({ preventScroll: true }); }
  }
  function updateBadge() {
    const b = $('.pk-badge');
    b.textContent = unread > 9 ? '9+' : String(unread);
    b.classList.toggle('hidden', unread === 0);
    root.classList.toggle('blink', unread > 0);
  }

  $('.pk-fold').onclick = () => setFolded(false);
  $('.pk-close').onclick = () => setFolded(true);
  $('.pk-side').onclick = () => setScreen(SCREENS[(SCREENS.indexOf(screen) + 1) % SCREENS.length]);
  $('.pk-form').onsubmit = (e) => {
    e.preventDefault();
    const input = $('.pk-form input');
    const text = input.value.trim();
    if (!text) return;
    send({ type: 'chat', text });
    input.value = '';
  };
  $('.pk-form input').oninput = () => {
    const now = Date.now();
    if (now - lastTypingSent > 1500) { lastTypingSent = now; send({ type: 'typing' }); }
  };
  root.querySelectorAll('.pk-react button').forEach((b) => (b.onclick = () => send({ type: 'react', kind: b.dataset.k })));

  // Reloj de la pantalla
  const tick = () => { $('.pk-clock').textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 15000);

  function addMessage(item, animateIt = true) {
    const li = document.createElement('li');
    li.className = `pk-msg ${item.kind === 'react' ? 'react' : ''} ${animateIt ? 'new' : ''}`;
    li.innerHTML = `<canvas class="pk-mon"></canvas><div><b>${escapeHtml(item.name)}</b> <span>${escapeHtml(item.text)}</span></div>`;
    $('.pk-msgs').appendChild(li);
    if (item.mon) new MonSprite(li.querySelector('canvas'), item.mon.id, item.mon.shiny, 'thumb', { still: !animateIt });
    while ($('.pk-msgs').children.length > 50) $('.pk-msgs').firstChild.remove();
    $('.pk-msgs').scrollTop = $('.pk-msgs').scrollHeight;
    typers.delete(item.name);
    renderTyping();
  }

  /** La reacción se ve sobre el tablero: el Pokémon de quien la manda actúa con un bocadillo. */
  function showReaction(item) {
    const stage = getStage();
    if (!stage || !item.mon) return;
    const card = document.createElement('div');
    card.className = `reaction-pop r-${item.react}`;
    card.innerHTML = `<canvas></canvas><span class="bubble">${escapeHtml(item.text)}</span><small>${escapeHtml(item.name)}</small>`;
    stage.appendChild(card);
    const sp = new MonSprite(card.querySelector('canvas'), item.mon.id, item.mon.shiny, 'thumb');
    const anim = REACT_ANIM[item.react] || 'Idle';
    sp.play(anim, { dir: anim === 'Walk' ? 0 : 0, loop: anim === 'Walk' });
    // En Ruta de Medallas también actúa la ficha del jugador en el tablero
    const tk = tokenSprite && tokenSprite(item.seat);
    if (tk && anim !== 'Walk') tk.play(anim, { loop: false, onDone: () => tk.play('Idle', { dir: 0 }) });
    setTimeout(() => card.classList.add('out'), 2300);
    setTimeout(() => { sp.destroy(); card.remove(); }, 2700);
  }

  function renderTyping() {
    const names = [...typers.keys()];
    $('.pk-typing').textContent = names.length ? `${names.join(', ')} está${names.length > 1 ? 'n' : ''} escribiendo…` : '';
  }

  function renderLog() {
    const lines = getLog();
    $('.pk-log ul').innerHTML = lines.slice(-40).map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    $('.pk-log ul').scrollTop = $('.pk-log ul').scrollHeight;
  }

  return {
    /** Mostrar u ocultar (solo dentro de una sala). */
    setVisible(v) { root.classList.toggle('hidden', !v); },
    history(items) { $('.pk-msgs').innerHTML = ''; for (const it of items) addMessage(it, false); },
    message(item) {
      addMessage(item, true);
      if (item.kind === 'react') showReaction(item);
      if (root.classList.contains('folded') || screen !== 'chat') { unread++; updateBadge(); }
      root.classList.add('beep');
      setTimeout(() => root.classList.remove('beep'), 400);
    },
    typing(name) {
      typers.set(name, true);
      renderTyping();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => { typers.clear(); renderTyping(); }, 3000);
    },
    refreshLog() { if (screen === 'log') renderLog(); },
  };
}
