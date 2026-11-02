// Comprueba que los sprites descargados y sus metadatos sirven para todas las piezas
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Gens = require('../shared/generations');

const ASSETS = path.join(__dirname, '..', 'assets');
const META = JSON.parse(fs.readFileSync(path.join(ASSETS, 'sprite-meta.json'), 'utf8'));
// Animaciones que usa el tablero: reposo, caminar, ataques y ser derrotado
const ANIMS = ['Idle', 'Walk', 'Attack', 'Shoot', 'Hurt', 'Faint'];

/** Ancho y alto de un PNG leyendo su cabecera. */
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Piezas de ajedrez y fichas de damas chinas de todas las generaciones
const pieceIds = [...new Set(Object.values(Gens.GENERATIONS)
  .flatMap((g) => [...Object.values(g.pieces).flat(), ...(g.checkers || [])].map((m) => m.id)))];

test('se descargó la colección completa de sprites', (t) => {
  const dirs = fs.readdirSync(path.join(ASSETS, 'pokemon'));
  // El .zip ligero solo trae los sprites de las piezas; la colección completa está en el repo
  if (dirs.length < 966) return t.skip('copia ligera: solo sprites de las piezas');
  assert.ok(dirs.length >= 966, `solo hay ${dirs.length} Pokémon`);
  assert.ok(Object.keys(META).length >= 966);
});

test('cada pieza tiene sus animaciones (normal y shiny) y cuadran con los metadatos', () => {
  for (const id of pieceIds) {
    for (const anim of ANIMS) {
      const m = META[id] && META[id].a[anim];
      assert.ok(m, `falta metadato ${anim} de #${id}`);
      for (const shiny of [false, true]) {
        const file = path.join(ASSETS, 'pokemon', String(id), shiny ? 's' : '', `${anim}.png`);
        assert.ok(fs.existsSync(file), `falta ${file}`);
        const { w, h } = pngSize(file);
        // La hoja normal debe cuadrar siempre; si una shiny no cuadra (fallo de origen,
        // p. ej. Faint de Girafarig), sprites.js usa la normal en su lugar.
        if (shiny && (w !== m.w * m.n || h !== m.h * m.r)) continue;
        assert.strictEqual(w, m.w * m.n, `ancho de ${anim} #${id}`);
        assert.strictEqual(h, m.h * m.r, `alto de ${anim} #${id}`);
      }
      assert.strictEqual(m.d.length, m.n, `duraciones de ${anim} #${id}`);
    }
  }
});
