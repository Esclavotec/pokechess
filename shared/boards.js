/**
 * Tableros temáticos: lugares icónicos del mundo Pokémon.
 * Solo datos (id + nombre + generación de origen). El aspecto de cada uno
 * está en public/style.css bajo la clase .theme-<id>.
 *
 * Funciona en Node (require) y en el navegador (window.PokeBoards).
 */
(function (root) {
  const BOARDS = [
    { id: 'ruta1', name: 'Ruta 1 · Pueblo Paleta', region: 'Kanto' },
    { id: 'monte-moon', name: 'Monte Moon', region: 'Kanto' },
    { id: 'gimnasio-plateado', name: 'Gimnasio de Ciudad Plateada', region: 'Kanto' },
    { id: 'torre-campana', name: 'Torre Campana', region: 'Johto' },
    { id: 'islas-remolino', name: 'Islas Remolino', region: 'Johto' },
    { id: 'meseta-anil', name: 'Meseta Añil', region: 'Kanto · Johto' },
  ];

  const isBoard = (id) => id === 'random' || BOARDS.some((b) => b.id === id);

  /** Tablero al azar (se usa al empezar la partida cuando se eligió "aleatorio"). */
  function randomBoard(rand = Math.random) {
    return BOARDS[Math.floor(rand() * BOARDS.length)].id;
  }

  const api = { BOARDS, isBoard, randomBoard };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeBoards = api;
})(typeof window !== 'undefined' ? window : globalThis);
