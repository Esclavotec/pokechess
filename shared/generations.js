/**
 * Datos de las generaciones: qué Pokémon representa a cada pieza de ajedrez.
 *
 * Claves de pieza (las mismas que usa chess.js):
 *   p = peón, n = caballo, b = alfil, r = torre, q = reina, k = rey
 *
 * Cada pieza es una lista de opciones. Si hay más de una, cada jugador
 * elige la suya en el lobby (p. ej. caballo Tauros o Rapidash).
 *
 * Para añadir una generación nueva basta con añadir otra entrada aquí.
 *
 * Este archivo funciona tanto en Node (require) como en el navegador
 * (queda disponible como window.PokeGenerations).
 */
(function (root) {
  const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';

  const GENERATIONS = {
    1: {
      name: 'Generación I',
      region: 'Kanto',
      pieces: {
        p: [{ id: 10, name: 'Caterpie' }],
        n: [{ id: 128, name: 'Tauros' }, { id: 78, name: 'Rapidash' }],
        b: [{ id: 24, name: 'Arbok' }, { id: 95, name: 'Onix' }],
        r: [{ id: 143, name: 'Snorlax' }],
        q: [{ id: 151, name: 'Mew' }],
        k: [{ id: 150, name: 'Mewtwo' }],
      },
    },
    2: {
      name: 'Generación II',
      region: 'Johto',
      pieces: {
        p: [{ id: 13, name: 'Weedle' }],
        n: [{ id: 59, name: 'Arcanine' }, { id: 38, name: 'Ninetales' }],
        b: [{ id: 230, name: 'Kingdra' }],
        r: [{ id: 248, name: 'Tyranitar' }],
        q: [{ id: 249, name: 'Lugia' }],
        k: [{ id: 250, name: 'Ho-Oh' }],
      },
    },
  };

  const PIECE_NAMES = { p: 'Peón', n: 'Caballo', b: 'Alfil', r: 'Torre', q: 'Reina', k: 'Rey' };

  /** URL pública del sprite (PokeAPI). Las negras usan la versión shiny. */
  function spriteUrl(id, shiny) {
    return shiny ? `${SPRITE_BASE}/shiny/${id}.png` : `${SPRITE_BASE}/${id}.png`;
  }

  /** Piezas que el jugador puede elegir en esta generación (las que tienen >1 opción). */
  function choosablePieces(gen) {
    const g = GENERATIONS[gen];
    if (!g) return [];
    return Object.keys(g.pieces).filter((t) => g.pieces[t].length > 1);
  }

  /** Elección por defecto: la primera opción de cada pieza elegible. */
  function defaultChoices(gen) {
    const out = {};
    for (const t of choosablePieces(gen)) out[t] = 0;
    return out;
  }

  /** Normaliza una elección recibida del cliente: solo índices válidos. */
  function sanitizeChoices(gen, choices) {
    const out = defaultChoices(gen);
    const g = GENERATIONS[gen];
    if (!g || !choices || typeof choices !== 'object') return out;
    for (const t of Object.keys(out)) {
      const i = Number(choices[t]);
      if (Number.isInteger(i) && i >= 0 && i < g.pieces[t].length) out[t] = i;
    }
    return out;
  }

  /** Pokémon concreto para una pieza según la generación y la elección del jugador. */
  function pokemonFor(gen, type, choices) {
    const opts = GENERATIONS[gen].pieces[type];
    const i = (choices && choices[type]) || 0;
    return opts[i] || opts[0];
  }

  const api = { GENERATIONS, PIECE_NAMES, spriteUrl, choosablePieces, defaultChoices, sanitizeChoices, pokemonFor };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeGenerations = api;
})(typeof window !== 'undefined' ? window : globalThis);
