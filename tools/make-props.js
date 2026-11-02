/**
 * Genera los elementos del escenario de "Ruta de Medallas" en pixel art de 16×16
 * (public/img/props/*.svg). Dibujos propios inspirados en el estilo de PokéSurvivor:
 * contorno oscuro, sombreado en dos tonos y sus paletas de bioma (bosque, cueva, agua).
 *
 * Uso: node tools/make-props.js
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'img', 'props');
fs.mkdirSync(OUT, { recursive: true });

// Paletas (tomadas del bioma "bosque" de PokéSurvivor y ajustadas)
const C = {
  out: '#1c2a17', g1: '#5f9d50', g2: '#44813d', g3: '#3e7a39', g4: '#2f5f2b',
  bark: '#6b4a2b', bark2: '#4a321c', d1: '#86704a', d2: '#7d6742', d3: '#735e3b',
  rock1: '#b3a89a', rock2: '#8f8475', rock3: '#6b6156', rockOut: '#2b2620',
  wall: '#fff3dc', wall2: '#e3d3b4', door: '#7a4b25', win: '#9fdcf5', winOut: '#2b2620',
  red: '#e0202a', red2: '#a8141c', blue: '#2a75bb', blue2: '#1d4f86', white: '#f4f8ff',
  yellow: '#f4d65c', pink: '#f39ac0', berryR: '#d1307a', berryB: '#3f6fd1',
  water1: '#5fb7ea', water2: '#3f97d1', water3: '#9fdcf5', cave1: '#5a4a40', cave2: '#4a3b33', cave3: '#2b211c',
  rail: '#8a8f99', tie: '#6b4a2b', lamp: '#ffe066', post: '#3a3f4a', mask: '#ffffff',
};

/** Lienzo de 16×16: set(x, y, color) y luego svg(). */
function canvas() {
  const px = new Map();
  const api = {
    set(x, y, c) { if (x >= 0 && x < 16 && y >= 0 && y < 16 && c) px.set(`${x},${y}`, c); return api; },
    get(x, y) { return px.get(`${x},${y}`); },
    rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) api.set(x, y, c); return api; },
    /** Rellena con fn(x, y) -> color|null dentro de una elipse. */
    ellipse(cx, cy, rx, ry, fn) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d <= 1) api.set(x, y, fn(x, y, d));
      }
      return api;
    },
    /** Contorno de 1 píxel alrededor de todo lo pintado (en los huecos vacíos). */
    outline(c = C.out) {
      const add = [];
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        if (px.has(`${x},${y}`)) continue;
        if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => px.has(`${x + dx},${y + dy}`))) add.push([x, y]);
      }
      for (const [x, y] of add) px.set(`${x},${y}`, c);
      return api;
    },
    svg(title) {
      let r = '';
      for (const [k, c] of px) { const [x, y] = k.split(','); r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; }
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">\n  <!-- ${title} -->\n  ${r}\n</svg>\n`;
    },
  };
  return api;
}

const props = {};

// Árbol frondoso: copa con luz arriba a la izquierda y sombra abajo a la derecha
props.tree = () => canvas()
  .rect(7, 10, 8, 14, C.bark).rect(8, 10, 8, 14, C.bark2)
  .ellipse(8, 6.5, 6.5, 5.8, (x, y) => (x + y < 9 ? C.g1 : x + y > 15 ? C.g4 : (x * 3 + y) % 7 === 0 ? C.g2 : C.g3))
  .outline();

// Árbol de bayas: como el árbol, con bayas de colores
props.berrytree = () => {
  const c = props.tree();
  [[5, 5, C.berryR], [10, 4, C.berryR], [8, 8, C.berryB], [4, 8, C.yellow], [11, 8, C.berryR], [7, 3, C.pink]].forEach(([x, y, col]) => c.set(x, y, col));
  return c;
};

// Hierba alta: matas de hojas puntiagudas en dos tonos
props.grass = () => {
  const c = canvas();
  const blades = [[2, 6], [4, 9], [6, 5], [8, 8], [10, 4], [12, 7], [14, 6]];
  for (const [x, top] of blades) {
    for (let y = top; y <= 13; y++) {
      c.set(x, y, y < top + 2 ? C.g1 : y > 10 ? C.g4 : C.g3);
      if (y > top + 1) c.set(x - 1, y, y > 10 ? C.g4 : C.g2);
    }
  }
  c.rect(1, 12, 14, 13, C.g4);
  return c.outline();
};

// Flores: tres flores pequeñas con tallo
props.flowers = () => {
  const c = canvas();
  [[4, 6, C.yellow], [10, 4, C.pink], [12, 10, C.white], [6, 11, C.pink]].forEach(([x, y, col]) => {
    c.rect(x, y + 2, x, y + 4, C.g3);
    c.set(x - 1, y, col).set(x + 1, y, col).set(x, y - 1, col).set(x, y + 1, col).set(x, y, C.yellow === col ? '#e08a1e' : C.yellow);
  });
  return c.outline(C.g4);
};

// Roca
props.rock = () => canvas()
  .ellipse(8, 10, 6, 4.5, (x, y) => (x + y < 14 ? C.rock1 : x + y > 19 ? C.rock3 : C.rock2))
  .set(6, 8, C.white).set(7, 8, C.rock1)
  .outline(C.rockOut);

// Casa de pueblo (paredes); el tejado va en roof.svg para teñirlo con el color del dueño
props.house = () => canvas()
  .rect(3, 8, 12, 14, C.wall).rect(3, 13, 12, 14, C.wall2)
  .rect(7, 10, 8, 14, C.door).set(8, 12, C.yellow)
  .rect(4, 9, 5, 10, C.win).rect(10, 9, 11, 10, C.win)
  .outline();
props.roof = () => {
  const c = canvas();
  for (let y = 2; y <= 8; y++) { const w = y - 1; c.rect(Math.max(0, 7 - w), y, Math.min(15, 8 + w), y, C.mask); }
  return c;
};

// Centro Pokémon: techo rojo, paredes blancas y una Poké Ball en la fachada
props.pokecenter = () => {
  const c = canvas().rect(1, 4, 14, 7, C.red).rect(1, 7, 14, 7, C.red2).rect(2, 8, 13, 14, C.white).rect(2, 13, 13, 14, C.wall2);
  c.rect(6, 10, 9, 14, C.win).rect(7, 10, 8, 14, C.water3);
  c.ellipse(8, 2.6, 2.4, 2.4, (x, y) => (y < 2 ? C.red : y === 2 ? C.out : C.white));
  return c.outline();
};

// Tienda: techo azul y escaparate
props.shop = () => {
  const c = canvas().rect(1, 4, 14, 7, C.blue).rect(1, 7, 14, 7, C.blue2).rect(2, 8, 13, 14, C.white).rect(2, 13, 13, 14, C.wall2);
  c.rect(3, 9, 7, 12, C.win).rect(10, 10, 11, 14, C.door);
  for (let x = 1; x <= 14; x += 2) c.set(x, 4, C.white);
  return c.outline();
};

// Entrada de cueva en la roca
props.cave = () => {
  const c = canvas().ellipse(8, 11, 7.5, 6.5, (x, y) => (x + y < 13 ? C.rock1 : x + y > 19 ? C.rock3 : C.rock2));
  c.ellipse(8, 13.5, 3.5, 4, () => C.cave3);
  c.set(4, 6, C.white).set(11, 8, C.rock1);
  return c.outline(C.rockOut);
};

// Valla de madera (Zona Safari)
props.fence = () => {
  const c = canvas();
  for (const x of [2, 7, 12]) c.rect(x, 5, x + 1, 14, C.bark).set(x + 1, 5, C.d1);
  c.rect(1, 7, 14, 8, C.d1).rect(1, 11, 14, 12, C.d1).rect(1, 8, 14, 8, C.d3).rect(1, 12, 14, 12, C.d3);
  return c.outline();
};

// Vías del tren (transportes)
props.rails = () => {
  const c = canvas();
  for (let y = 1; y <= 14; y += 3) c.rect(2, y, 13, y + 1, C.tie);
  c.rect(4, 0, 4, 15, C.rail).rect(11, 0, 11, 15, C.rail);
  return c;
};

// Cartel de madera (salida)
props.sign = () => canvas().rect(7, 9, 8, 14, C.bark).rect(2, 3, 13, 8, C.d1).rect(2, 8, 13, 8, C.d3)
  .rect(4, 5, 11, 5, C.d3).rect(4, 6, 9, 6, C.d3).outline();

// Farol (se enciende de noche)
props.lamp = () => canvas().rect(7, 6, 8, 14, C.post).rect(5, 2, 10, 5, C.post).rect(6, 3, 9, 4, C.lamp).rect(6, 14, 9, 14, C.post).outline('#11131a');

// Baldosas del suelo (se repiten como fondo)
props.tileGrass = () => {
  const c = canvas().rect(0, 0, 15, 15, C.g3);
  [[2, 3], [9, 1], [13, 6], [5, 10], [11, 12], [1, 14], [7, 7]].forEach(([x, y]) => c.set(x, y, C.g4).set(x + 1, y, C.g2));
  [[4, 5], [12, 2], [8, 13], [14, 10]].forEach(([x, y]) => c.set(x, y, C.g1));
  return c;
};
props.tileDirt = () => {
  const c = canvas().rect(0, 0, 15, 15, C.d2);
  [[3, 2], [10, 5], [6, 11], [13, 13], [1, 8]].forEach(([x, y]) => c.set(x, y, C.d3).set(x + 1, y, C.d1));
  return c;
};
props.tileCave = () => {
  const c = canvas().rect(0, 0, 15, 15, C.cave2);
  [[2, 2], [9, 4], [5, 9], [12, 12], [14, 6]].forEach(([x, y]) => c.set(x, y, C.cave1).set(x + 1, y + 1, C.cave3));
  return c;
};
props.tileWater = () => {
  const c = canvas().rect(0, 0, 15, 15, C.water2);
  [[2, 3], [9, 9]].forEach(([x, y]) => c.rect(x, y, x + 3, y, C.water3).rect(x + 1, y + 1, x + 4, y + 1, C.water1));
  return c;
};

for (const [name, draw] of Object.entries(props)) {
  fs.writeFileSync(path.join(OUT, `${name}.svg`), draw().svg(`${name} · PokéChess (pixel art propio, estilo PokéSurvivor)`));
}
console.log('generados:', Object.keys(props).join(', '));
