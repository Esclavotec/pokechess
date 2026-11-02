/**
 * Bot de "Ruta de Medallas". Decide UNA acción para el jugador `p`.
 *
 * - Fácil:   compra casi siempre que puede, acepta combates al azar.
 * - Normal:  guarda una reserva de dinero, compra la Poké Flauta y la usa.
 * - Difícil: además prioriza completar regiones, solo combate si le conviene,
 *            recupera pueblos de la Guardería y negocia ofertas con más cuidado.
 * Lo nuevo: cruza el Monte Corona si le conviene, entra en la Zona Safari si le sobra
 * dinero, viaja entre sus transportes y usa los Pokémon capturados en el Safari.
 * En deuda: primero la Guardería (los pueblos que menos rinden y sin romper
 * regiones completas), luego la Tienda, y si no queda nada, se retira.
 */
const R = require('../shared/route');

const mine = (st, p) => Object.keys(st.owners).map(Number).filter((i) => st.owners[i].owner === p);

/** ¿Completa esta propiedad una región (pueblos) o un grupo (transportes/servicios) para p? */
function completesRegion(st, p, sq) {
  const t = R.SQUARES[sq].type;
  const region = t === 'transport' ? R.TRANSPORTS : t === 'service' ? R.SERVICES : R.REGIONS[R.SQUARES[sq].region];
  return region.every((i) => i === sq || (st.owners[i] && st.owners[i].owner === p));
}
function inFullRegion(st, p, sq) {
  const t = R.SQUARES[sq].type;
  const region = t === 'transport' ? R.TRANSPORTS : t === 'service' ? R.SERVICES : R.REGIONS[R.SQUARES[sq].region];
  return region.every((i) => st.owners[i] && st.owners[i].owner === p);
}
/** Entrenamiento más caro del tablero que podría tocarle pagar (para la reserva). */
function maxRent(st, p) {
  let m = 0;
  for (const sq of Object.keys(st.owners).map(Number)) if (st.owners[sq].owner !== p) m = Math.max(m, R.rentOf(st, sq));
  return m;
}

/** Cómo reunir dinero en una deuda. */
function raiseMoney(st, p) {
  const towns = mine(st, p);
  // Guardería: primero los que no forman región completa y rinden menos
  const free = towns.filter((sq) => !st.owners[sq].daycare)
    .sort((a, b) => (inFullRegion(st, p, a) - inFullRegion(st, p, b)) || R.SQUARES[a].price - R.SQUARES[b].price);
  if (free.length) return { type: 'daycare', sq: free[0] };
  return { type: 'retire' };
}

/** Respuesta a una oferta de compra que le hacen al bot. */
function answerOffer(st, p, offer, level) {
  const sq = R.SQUARES[offer.sq];
  const money = st.players[p].money;
  const reserve = level === 'easy' ? 50 : 150;
  let fair = sq.price * (level === 'hard' ? 1.0 : 1.2);
  if (completesRegion(st, p, offer.sq)) fair *= 1.5; // le interesa mucho
  if (st.owners[offer.sq] && st.owners[offer.sq].daycare) fair *= 0.5;
  return { type: 'answer', id: offer.id, accept: offer.price <= fair && money - offer.price >= reserve };
}

/**
 * Acción del bot `p` o null si no le toca hacer nada.
 * @param {object} st     estado (shared/route.js)
 * @param {number} p      índice del jugador
 * @param {string} level  'easy' | 'normal' | 'hard'
 * @param {function} rand azar (para pruebas)
 */
function decide(st, p, level = 'normal', rand = Math.random) {
  if (st.phase === 'over' || st.players[p].out) return null;
  const pl = st.players[p];
  const offer = st.offers.find((o) => o.to === p);
  if (offer) return answerOffer(st, p, offer, level);
  if (st.debt) {
    if (st.debt.p !== p) return null;
    if (pl.safari.includes('kangaskhan')) return { type: 'useSafari', id: 'kangaskhan' };
    return raiseMoney(st, p);
  }
  if (st.turn !== p) return null;

  const reserve = level === 'easy' ? 0 : level === 'normal' ? 150 : 100 + maxRent(st, p);
  switch (st.phase) {
    case 'roll':
      if (pl.stuck && level !== 'easy') {
        if (pl.items.zreza) return { type: 'useItem', item: 'zreza' };
        if (pl.items.flute) return { type: 'useItem', item: 'flute' };
      }
      return { type: 'roll' };
    case 'buy': {
      const sq = st.pending.sq;
      const price = R.SQUARES[sq].price;
      if (level === 'easy') return { type: rand() < 0.8 ? 'buy' : 'skip' };
      const want = pl.money - price >= reserve || (level === 'hard' && completesRegion(st, p, sq) && pl.money >= price);
      return { type: want ? 'buy' : 'skip' };
    }
    case 'battle': {
      const rivals = st.pending.rivals;
      if (level === 'easy') return rand() < 0.5 ? { type: 'battle', target: rivals[0] } : { type: 'decline' };
      // Combate al rival más peligroso (más medallas); en Difícil solo si va por delante de él
      const target = [...rivals].sort((a, b) => st.players[b].medals.length - st.players[a].medals.length)[0];
      const fight = level === 'normal' ? rand() < 0.6 : st.players[target].medals.length >= pl.medals.length;
      return fight ? { type: 'battle', target } : { type: 'decline' };
    }
    case 'corona': {
      // Cruzar ahorra ~15 casillas; Difícil cruza si le faltan medallas
      const enter = level === 'easy' ? rand() < 0.5 : level === 'normal' ? rand() < 0.6 : pl.medals.length < st.target;
      return { type: 'cave', enter };
    }
    case 'safari':
      return { type: 'safari', enter: pl.money - R.SAFARI_FEE >= (level === 'easy' ? 0 : reserve + 100) };
    case 'travel': {
      // Viaja al transporte que deja más cerca un gimnasio sin medalla
      const gymsLeft = R.GYMS.filter((g) => !pl.medals.includes(g));
      const score = (t) => Math.min(...gymsLeft.map((g) => (g - t + R.N) % R.N));
      const best = [...st.pending.options].sort((a, b) => score(a) - score(b))[0];
      return { type: 'travel', to: level === 'easy' && rand() < 0.5 ? null : best };
    }
    case 'shop':
      return { type: 'shop', buy: level !== 'easy' && !pl.items.flute && pl.money - R.FLUTE_PRICE >= reserve + 100 };
    case 'end': {
      // Pokémon del Safari: Dratini y Exeggcute en cuanto puede, Tauros a veces, Pinsir si hay algo en la Guardería
      if (pl.safari.includes('dratini')) return { type: 'useSafari', id: 'dratini' };
      if (pl.safari.includes('exeggcute') && !st.extraRoll) return { type: 'useSafari', id: 'exeggcute' };
      if (pl.safari.includes('tauros') && rand() < 0.3) return { type: 'useSafari', id: 'tauros' };
      const dcAny = mine(st, p).find((sq) => st.owners[sq].daycare);
      if (pl.safari.includes('pinsir') && dcAny !== undefined) return { type: 'useSafari', id: 'pinsir', sq: dcAny };
      if (level === 'hard') {
        const dc = mine(st, p).filter((sq) => st.owners[sq].daycare)
          .find((sq) => pl.money - Math.round(R.SQUARES[sq].price * 0.6) >= reserve + 100);
        if (dc !== undefined) return { type: 'redeem', sq: dc };
      }
      return { type: 'end' };
    }
    default:
      return null;
  }
}

module.exports = { decide };
