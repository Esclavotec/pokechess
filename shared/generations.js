/**
 * Datos de las generaciones: qué Pokémon representa a cada pieza de ajedrez.
 *
 * Claves de pieza (las mismas que usa chess.js):
 *   p = peón, n = caballo, b = alfil, r = torre, q = reina, k = rey
 *
 * Cada pieza es una lista de opciones. Si hay más de una, cada jugador
 * elige la suya en el lobby (p. ej. caballo Tauros o Rapidash).
 *
 * `linked` une piezas que se eligen en pareja: { q: 'k' } significa que la reina
 * usa siempre la misma opción que el rey (p. ej. Groudon+Kyogre o Latios+Latias).
 * `checkers` son los 10 Pokémon de las fichas en las damas chinas.
 * `draughts` son la ficha y la dama (su evolución) de las damas clásicas.
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
      checkers: [
        { id: 25, name: 'Pikachu' }, { id: 1, name: 'Bulbasaur' }, { id: 4, name: 'Charmander' },
        { id: 7, name: 'Squirtle' }, { id: 133, name: 'Eevee' }, { id: 39, name: 'Jigglypuff' },
        { id: 54, name: 'Psyduck' }, { id: 52, name: 'Meowth' }, { id: 35, name: 'Clefairy' }, { id: 94, name: 'Gengar' },
      ],
      draughts: { man: { id: 129, name: 'Magikarp' }, king: { id: 130, name: 'Gyarados' } },
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
      checkers: [
        { id: 152, name: 'Chikorita' }, { id: 155, name: 'Cyndaquil' }, { id: 158, name: 'Totodile' },
        { id: 175, name: 'Togepi' }, { id: 183, name: 'Marill' }, { id: 172, name: 'Pichu' },
        { id: 179, name: 'Mareep' }, { id: 215, name: 'Sneasel' }, { id: 216, name: 'Teddiursa' }, { id: 197, name: 'Umbreon' },
      ],
      draughts: { man: { id: 170, name: 'Chinchou' }, king: { id: 171, name: 'Lanturn' } },
    },
    3: {
      name: 'Generación III',
      region: 'Hoenn',
      pieces: {
        p: [{ id: 265, name: 'Wurmple' }],
        n: [{ id: 232, name: 'Donphan' }, { id: 203, name: 'Girafarig' }],
        b: [{ id: 367, name: 'Huntail' }],
        r: [{ id: 379, name: 'Registeel' }],
        q: [{ id: 382, name: 'Kyogre' }, { id: 380, name: 'Latias' }],
        k: [{ id: 383, name: 'Groudon' }, { id: 381, name: 'Latios' }],
      },
      linked: { q: 'k' }, // rey y reina en pareja: Groudon+Kyogre o Latios+Latias
      checkers: [
        { id: 252, name: 'Treecko' }, { id: 255, name: 'Torchic' }, { id: 258, name: 'Mudkip' },
        { id: 280, name: 'Ralts' }, { id: 300, name: 'Skitty' }, { id: 303, name: 'Mawile' },
        { id: 304, name: 'Aron' }, { id: 311, name: 'Plusle' }, { id: 312, name: 'Minun' }, { id: 359, name: 'Absol' },
      ],
      draughts: { man: { id: 371, name: 'Bagon' }, king: { id: 373, name: 'Salamence' } },
    },
    4: {
      name: 'Generación IV',
      region: 'Sinnoh',
      pieces: {
        p: [{ id: 399, name: 'Bidoof' }],
        n: [{ id: 405, name: 'Luxray' }],
        b: [{ id: 350, name: 'Milotic' }],
        r: [{ id: 476, name: 'Probopass' }],
        q: [{ id: 483, name: 'Dialga' }],
        k: [{ id: 484, name: 'Palkia' }],
      },
      checkers: [
        { id: 387, name: 'Turtwig' }, { id: 390, name: 'Chimchar' }, { id: 393, name: 'Piplup' },
        { id: 403, name: 'Shinx' }, { id: 427, name: 'Buneary' }, { id: 417, name: 'Pachirisu' },
        { id: 431, name: 'Glameow' }, { id: 447, name: 'Riolu' }, { id: 446, name: 'Munchlax' }, { id: 443, name: 'Gible' },
      ],
      draughts: { man: { id: 443, name: 'Gible' }, king: { id: 445, name: 'Garchomp' } },
    },
  };

  const PIECE_NAMES = { p: 'Peón', n: 'Caballo', b: 'Alfil', r: 'Torre', q: 'Reina', k: 'Rey' };

  /** URL pública del sprite (PokeAPI). Las negras usan la versión shiny. */
  function spriteUrl(id, shiny) {
    return shiny ? `${SPRITE_BASE}/shiny/${id}.png` : `${SPRITE_BASE}/${id}.png`;
  }

  /** Piezas que el jugador puede elegir (más de una opción y que no dependan de otra). */
  function choosablePieces(gen) {
    const g = GENERATIONS[gen];
    if (!g) return [];
    const linked = g.linked || {};
    return Object.keys(g.pieces).filter((t) => g.pieces[t].length > 1 && !linked[t]);
  }

  /** Pieza que va en pareja con `type` (p. ej. 'q' para el rey en Gen III), o null. */
  function partnerOf(gen, type) {
    const linked = (GENERATIONS[gen] && GENERATIONS[gen].linked) || {};
    return Object.keys(linked).find((t) => linked[t] === type) || null;
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
    const g = GENERATIONS[gen];
    const opts = g.pieces[type];
    const key = (g.linked && g.linked[type]) || type; // la pieza enlazada sigue a su pareja
    const i = (choices && choices[key]) || 0;
    return opts[i] || opts[0];
  }

  const api = { GENERATIONS, PIECE_NAMES, spriteUrl, choosablePieces, partnerOf, defaultChoices, sanitizeChoices, pokemonFor };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeGenerations = api;
})(typeof window !== 'undefined' ? window : globalThis);
