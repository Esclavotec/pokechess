/**
 * Sprites animados estilo Mundo Misterioso (SpriteCollab, vía pokesurvivor).
 *
 * Cada animación es una hoja PNG: columnas = fotogramas, filas = 8 direcciones
 * (0 abajo, 1 abajo-der, 2 der, 3 arriba-der, 4 arriba, 5 arriba-izq, 6 izq, 7 abajo-izq).
 * /assets/sprite-meta.json da, por Pokémon y animación:
 *   w,h = tamaño de fotograma · n = nº fotogramas · r = filas · d = duración de cada
 *   fotograma (en 1/60 s) · ax,ay = punto de anclaje (los pies).
 *
 * Para que todas las piezas ocupen lo mismo, se mide la caja visible del primer
 * fotograma de reposo y se escala cada Pokémon para que esa caja llene la casilla.
 */

let META = null;
const images = new Map();   // url -> HTMLImageElement
const boxes = new Map();    // id -> caja visible del reposo, relativa al ancla
const active = new Set();   // sprites que se dibujan en el bucle
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export async function loadMeta() {
  if (!META) META = await fetch('/assets/sprite-meta.json').then((r) => r.json());
  return META;
}

export function sheetUrl(id, shiny, anim) {
  return `/assets/pokemon/${id}/${shiny ? 's/' : ''}${anim}.png`;
}

function image(url) {
  let img = images.get(url);
  if (!img) {
    img = new Image();
    img.onload = () => { for (const s of active) s.dirty = true; };
    img.src = url;
    images.set(url, img);
  }
  return img;
}

/** Caja de píxeles visibles del primer fotograma de reposo (mirando abajo). */
function visibleBox(id) {
  if (boxes.has(id)) return boxes.get(id);
  const m = META[id].a.Idle;
  const img = image(sheetUrl(id, false, 'Idle'));
  if (!img.complete || !img.naturalWidth) return null;
  const c = document.createElement('canvas');
  c.width = m.w; c.height = m.h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, m.w, m.h, 0, 0, m.w, m.h);
  const data = ctx.getImageData(0, 0, m.w, m.h).data;
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
    if (data[(y * m.w + x) * 4 + 3] > 20) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = m.w - 1; y1 = m.h - 1; }
  const box = {
    w: x1 - x0 + 1,
    h: y1 - y0 + 1,
    // pies (abajo-centro de la caja) respecto al ancla de la animación
    footX: (x0 + x1 + 1) / 2 - m.ax,
    footY: y1 + 1 - m.ay,
  };
  boxes.set(id, box);
  return box;
}

/**
 * Un Pokémon animado dibujado en un <canvas>.
 * layout 'board': el canvas mide 2×2 casillas centrado en la suya (para que el
 * ataque pueda salirse); el Pokémon llena ~75 % de la casilla.
 * layout 'thumb': miniatura que llena el canvas.
 */
export class MonSprite {
  constructor(canvas, id, shiny, layout = 'thumb') {
    this.canvas = canvas;
    this.id = id;
    this.shiny = shiny;
    this.layout = layout;
    this.anim = 'Idle';
    this.dir = 0;
    this.frame = 0;
    this.acc = 0;
    this.loop = true;
    this.onDone = null;
    this.dirty = true;
    image(sheetUrl(id, false, 'Idle')); // la versión normal sirve para medir la caja
    image(sheetUrl(id, shiny, 'Idle'));
    active.add(this);
  }

  /** Cambia de animación. opts: { dir, loop, onDone } */
  play(anim, { dir = this.dir, loop = true, onDone = null } = {}) {
    if (!META[this.id].a[anim]) anim = 'Idle';
    image(sheetUrl(this.id, this.shiny, anim));
    this.anim = anim;
    this.dir = dir;
    this.frame = 0;
    this.acc = 0;
    this.loop = loop;
    this.onDone = onDone;
    this.done = false;
    this.dirty = true;
  }

  /** Duración total de una animación en milisegundos. */
  duration(anim) {
    const m = META[this.id].a[anim];
    return m ? (m.d.reduce((a, b) => a + b, 0) * 1000) / 60 : 0;
  }

  step(ticks) {
    const m = META[this.id].a[this.anim];
    if (this.done || (m.n <= 1 && this.loop)) return;
    this.acc += ticks;
    while (this.acc >= m.d[this.frame]) {
      this.acc -= m.d[this.frame];
      this.frame++;
      this.dirty = true;
      if (this.frame >= m.n) {
        if (this.loop) this.frame = 0;
        else {
          // Animación de una sola vez: se queda en el último fotograma
          this.frame = m.n - 1;
          this.done = true;
          const cb = this.onDone;
          this.onDone = null;
          if (cb) cb();
          return;
        }
      }
    }
  }

  draw() {
    const cv = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth;
    const cssH = cv.clientHeight;
    if (!cssW || !cssH) return;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, W, H);

    const box = visibleBox(this.id);
    const m = META[this.id].a[this.anim];
    let img = image(sheetUrl(this.id, this.shiny, this.anim));
    // Algunas hojas shiny de origen no cuadran con sus metadatos (p. ej. Faint de
    // Girafarig): en ese caso se usa la hoja normal de esa animación.
    if (this.shiny && img.complete && img.naturalWidth && (img.naturalWidth !== m.w * m.n || img.naturalHeight !== m.h * m.r)) {
      img = image(sheetUrl(this.id, false, this.anim));
    }
    if (!box || !img.complete || !img.naturalWidth) return; // se redibuja al cargar
    this.dirty = false;

    // Escala y posición de los pies según el tipo de canvas
    let scale, footX, footY;
    if (this.layout === 'board') {
      const sq = W / 2; // el canvas mide 2 casillas
      scale = Math.min((sq * 0.76) / box.w, (sq * 0.74) / box.h);
      footX = W / 2;
      footY = sq * 0.5 + sq * 0.8; // pies al 80 % de la casilla, justo sobre la insignia
    } else {
      scale = Math.min((W * 0.9) / box.w, (H * 0.9) / box.h);
      footX = W / 2;
      footY = H * 0.95;
    }
    const row = m.r > 1 ? this.dir : 0;
    const dx = footX - (m.ax + box.footX) * scale;
    const dy = footY - (m.ay + box.footY) * scale;
    ctx.drawImage(img, this.frame * m.w, row * m.h, m.w, m.h, dx, dy, m.w * scale, m.h * scale);
  }

  destroy() { active.delete(this); }
}

/** Convierte un desplazamiento en pantalla (dx, dy) en una de las 8 direcciones. */
export function dirFromDelta(dx, dy) {
  const k = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return { 0: 2, 1: 1, 2: 0, 3: 7, 4: 6, '-4': 6, '-1': 3, '-2': 4, '-3': 5 }[k];
}

/** Dibuja como miniaturas animadas todos los <canvas data-mon> de un contenedor. */
export function hydrateThumbs(root) {
  root.querySelectorAll('canvas[data-mon]').forEach((cv) => {
    if (cv._sprite) return;
    cv._sprite = new MonSprite(cv, Number(cv.dataset.mon), cv.dataset.shiny === '1', 'thumb');
  });
}

// Bucle de animación único para todos los sprites
let last = performance.now();
function tick(now) {
  const ticks = Math.min(((now - last) / 1000) * 60, 30); // en fotogramas de 1/60 s
  last = now;
  for (const s of active) {
    if (!s.canvas.isConnected) { active.delete(s); continue; }
    if (!reduceMotion.matches || !s.loop) s.step(ticks);
    if (s.dirty) s.draw();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// Al cambiar el tamaño de la ventana hay que redibujar a la nueva resolución
window.addEventListener('resize', () => { for (const s of active) s.dirty = true; });
