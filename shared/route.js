/**
 * "Ruta de Medallas": juego de tablero original para 2-4 jugadores.
 *
 * Circuito de 44 casillas (el borde de una cuadrícula de 12×12) por cinco regiones:
 * Kanto, Johto, Hoenn, Sinnoh y Teselia. En tu turno tiras dos dados, tu Pokémon
 * camina y se resuelve la casilla:
 *   - Pueblo: se reclama con Pokédólares; quien cae en uno ajeno paga entrenamiento
 *     (×2 si el dueño tiene la región entera y ninguno está en la Guardería).
 *   - Transporte (4): entrenamiento según cuántos tenga el dueño (30/60/110/180). Si caes
 *     en uno tuyo puedes viajar gratis a otro de tus transportes.
 *   - Servicio (2): se paga lo que salió en los dados ×4 (×10 si el dueño tiene los dos).
 *   - Monte Corona: puedes cruzar la cueva por el centro del tablero (atajo arriesgado).
 *   - Zona Safari: pagas la entrada y tienes 3 Safari Balls para capturar un Pokémon
 *     que te da un bonus de un solo uso (ver SAFARI).
 *   - Gimnasio: si no tienes su medalla, desafías al líder (tus dados contra los suyos;
 *     el empate gana el retador). Las medallas son personales: todos pueden ganar las 8.
 *     Si ya tienes la medalla de ese gimnasio, el líder te recomienda y luchas por la
 *     siguiente medalla que te falte. Experiencia: cada desafío perdido suma +1 a tus próximos desafíos (máx. +3) y se
 *     reinicia al ganar una medalla.
 *   - Hierba alta y Árbol de Bayas: eventos al azar (ver GRASS y BERRY).
 *   - Equipo Galaxia: te roban dinero o un pueblo.
 *   - Centro Pokémon: bono. Tienda Pokémon: puedes comprar una Poké Flauta.
 *   - Snorlax dormido: si te mandan allí te quedas atascado hasta sacar dobles,
 *     usar una Poké Flauta / Baya Zreza, o pasar 3 turnos.
 * Si caes donde hay otro jugador puedes retarle a un combate de dados: el perdedor
 * vuelve a la casilla donde estaba antes. Dobles = vuelves a tirar (máx. 2 veces).
 * Si no puedes pagar: Guardería (50 %, recuperar 60 %), vender a otro jugador o a la
 * Tienda (40 %), o retirarte. Gana quien llegue a las medallas objetivo (3-8), el
 * último con dinero, o quien tenga más patrimonio al acabar las rondas (15 + 6 × objetivo).
 *
 * Motor puro y determinista: todo el azar viene de `rng` (el servidor usa Math.random).
 * Funciona en Node (require) y en el navegador (window.PokeRoute).
 */
(function (root) {
  const START_MONEY = 1500;
  const PASS_START = 200;
  const CENTER_BONUS = 50;
  const FLUTE_PRICE = 60;
  const GYM_LOSS_FEE = 30;
  const MAX_EXP = 3;
  const roundsFor = (target) => 15 + 6 * target; // 63 rondas con 8 medallas, 33 con 3
  const MEDAL_VALUE = 100; // para el desempate por patrimonio

  // ---------- Tablero ----------
  const T = (name, region, price) => ({ type: 'town', name, region, price, rent: Math.round(price / 4) });
  const G = (name, leader, monId) => ({ type: 'gym', name, leader, monId });
  const TR = (name, icon) => ({ type: 'transport', name, icon, price: 200 });
  const SV = (name, monId) => ({ type: 'service', name, monId, price: 150 });
  const SQUARES = [
    // Kanto (abajo)
    { type: 'start', name: 'Salida · Pueblo Paleta' },
    T('Ciudad Verde', 'kanto', 60),
    G('Gimnasio Plateado', 'Brock', 95),
    T('Ciudad Carmín', 'kanto', 70),
    { type: 'grass', name: 'Hierba alta' },
    TR('Magnetotren', '🚄'),
    G('Gimnasio Celeste', 'Misty', 121),
    T('Ciudad Azulona', 'kanto', 80),
    { type: 'berry', name: 'Árbol de Bayas' },
    SV('Central Eléctrica', 81),
    { type: 'safari', name: 'Zona Safari' },
    // Johto (izquierda)
    { type: 'center', name: 'Centro Pokémon' },
    T('Ciudad Malva', 'johto', 100),
    G('Gimnasio Malva', 'Pegaso', 18),
    T('Ciudad Trigal', 'johto', 110),
    { type: 'galaxy', name: 'Equipo Galaxia' },
    TR('Ferry S.S. Aqua', '⛴'),
    { type: 'corona', name: 'Monte Corona' },      // a media altura: la cueva cruza el centro
    T('Ciudad Olivo', 'johto', 120),
    { type: 'grass', name: 'Hierba alta' },
    G('Gimnasio Trigal', 'Blanca', 241),
    { type: 'berry', name: 'Árbol de Bayas' },
    // Hoenn (arriba)
    { type: 'snorlax', name: 'Snorlax dormido' },
    T('Ciudad Petalia', 'hoenn', 140),
    G('Gimnasio Férrico', 'Petra', 299),
    T('Ciudad Malvalona', 'hoenn', 150),
    TR('Teleférico', '🚡'),
    G('Gimnasio Azuliza', 'Marcial', 297),
    T('Ciudad Arborada', 'hoenn', 160),
    { type: 'grass', name: 'Hierba alta' },
    SV('Torre Radio', 239),
    G('Gimnasio Pirita', 'Roco', 409),
    { type: 'berry', name: 'Árbol de Bayas' },
    // Sinnoh y Teselia (derecha)
    { type: 'shop', name: 'Tienda Pokémon' },
    T('Ciudad Jubileo', 'sinnoh', 180),
    G('Gimnasio Vetusta', 'Gardenia', 407),
    T('Ciudad Corazón', 'sinnoh', 190),
    TR('Metro Batalla', '🚇'),
    T('Ciudad Rocavelo', 'sinnoh', 200),
    { type: 'galaxy', name: 'Equipo Galaxia' },
    T('Ciudad Esmalte', 'teselia', 210),
    T('Ciudad Porcelana', 'teselia', 220),
    G('Gimnasio Mayólica', 'Camila', 587),
    T('Ciudad Mayólica', 'teselia', 240),
  ];
  const N = SQUARES.length; // 44
  const SNORLAX = SQUARES.findIndex((s) => s.type === 'snorlax');
  const GYMS = SQUARES.map((s, i) => (s.type === 'gym' ? i : -1)).filter((i) => i >= 0);
  const REGIONS = {};
  SQUARES.forEach((s, i) => { if (s.type === 'town') (REGIONS[s.region] = REGIONS[s.region] || []).push(i); });
  const REGION_NAMES = { kanto: 'Kanto', johto: 'Johto', hoenn: 'Hoenn', sinnoh: 'Sinnoh', teselia: 'Teselia' };
  const PROPERTY = new Set(['town', 'transport', 'service']);
  const isProperty = (i) => PROPERTY.has(SQUARES[i] && SQUARES[i].type);
  const TRANSPORTS = SQUARES.map((s, i) => (s.type === 'transport' ? i : -1)).filter((i) => i >= 0);
  const SERVICES = SQUARES.map((s, i) => (s.type === 'service' ? i : -1)).filter((i) => i >= 0);
  const TRANSPORT_RENT = [0, 30, 60, 110, 180];
  // Monte Corona: la cueva cruza el centro del tablero (casillas 44-47, fuera del circuito)
  const CORONA = SQUARES.findIndex((s) => s.type === 'corona');
  const CAVE = [44, 45, 46, 47];
  const CAVE_EXIT = SQUARES.findIndex((s) => s.name === 'Ciudad Rocavelo'); // misma fila, lado derecho
  const SAFARI_FEE = 50;

  // ---------- Eventos (mon = Pokémon que aparece animado; anim = animación en el cliente) ----------
  const GRASS = [
    { id: 'snorlax', title: '¡Un Snorlax dormido!', text: 'Te bloquea el camino: vas a la casilla de Snorlax.', mon: 143, anim: 'sleep' },
    { id: 'ponyta', title: 'Un Ponyta te lleva', text: '¡Vuelves a tirar los dados!', mon: 77, anim: 'run' },
    { id: 'abra', title: 'Abra usa Teletransporte', text: 'Apareces en una casilla al azar.', mon: 63, anim: 'teleport' },
    { id: 'meowth', title: 'Meowth usa Día de Pago', text: 'Ganas 100 ₽.', mon: 52, anim: 'coins', money: 100 },
    { id: 'pidgey', title: 'Pidgey te lleva volando', text: 'Vas al Centro Pokémon más cercano.', mon: 16, anim: 'fly' },
    { id: 'geodude', title: 'Geodude rueda hacia ti', text: 'Retrocedes 3 casillas.', mon: 74, anim: 'attack', back: 3 },
    { id: 'gastly', title: 'Gastly te asusta', text: 'Pierdes tu siguiente turno.', mon: 92, anim: 'scare' },
    { id: 'chansey', title: 'Chansey te cuida', text: 'Ganas 80 ₽.', mon: 113, anim: 'heal', money: 80 },
    { id: 'flute', title: '¡Encuentras una Poké Flauta!', text: 'Sirve para despertar a Snorlax.', mon: null, anim: 'item', item: 'flute' },
    { id: 'zubat', title: 'Un Zubat salvaje', text: 'Pierdes 40 ₽.', mon: 41, anim: 'attack', money: -40 },
  ];
  const BERRY = [
    { id: 'aranja', title: 'Baya Aranja', text: 'Tu Pokémon la come: ganas 60 ₽.', anim: 'eat', money: 60 },
    { id: 'zreza', title: 'Baya Zreza', text: 'La guardas: te despierta de Snorlax cuando quieras.', anim: 'item', item: 'zreza' },
    { id: 'meloc', title: 'Baya Meloc', text: '¡Qué rica! Avanzas 2 casillas.', anim: 'hop', forward: 2 },
    { id: 'atania', title: 'Baya Atania', text: '¡Muy ácida! Retrocedes 2 casillas.', anim: 'dizzy', back: 2 },
    { id: 'zidra', title: 'Baya Zidra', text: 'Vas al Centro Pokémon más cercano.', anim: 'heal' },
    { id: 'todos', title: '¡Bayas para todos!', text: 'Heracross sacude el árbol: todos ganan 30 ₽.', mon: 214, anim: 'shake', everyone: 30 },
    { id: 'fiesta', title: 'Fiesta de bayas', text: 'Cada jugador te da 20 ₽.', anim: 'party', fromEach: 20 },
    { id: 'aipom', title: '¡Aipom te roba!', text: 'Pierdes 50 ₽.', mon: 190, anim: 'attack', money: -50 },
    { id: 'caquic', title: 'Baya Caquic', text: '¡Picante! Pierdes tu siguiente turno.', anim: 'smoke', skip: true },
  ];

  const CAVE_EVENTS = [
    { id: 'tunel', title: 'Un Onix cava un túnel', text: 'Cruzas la cueva sin problemas.', mon: 95, ok: true },
    { id: 'tesoro', title: '¡Objeto escondido!', text: 'Cruzas la cueva y encuentras 80 ₽.', mon: null, ok: true, money: 80 },
    { id: 'flauta', title: 'Una Poké Flauta entre las rocas', text: 'Cruzas la cueva y te la guardas.', mon: null, ok: true, item: 'flute' },
    { id: 'geodude', title: 'Un Geodude te bloquea', text: 'Vuelves a la entrada del Monte Corona.', mon: 74, ok: false },
    { id: 'zubats', title: 'Te pierdes entre Zubat', text: 'Vuelves a la entrada y pierdes 30 ₽.', mon: 41, ok: false, money: -30 },
    { id: 'bronzor', title: 'Bronzor te desorienta', text: 'Sales por la entrada y pierdes tu siguiente turno.', mon: 436, ok: false, skip: true },
  ];
  // Pokémon de la Zona Safari: w = lo frecuente que aparece, catch = probabilidad de cada Safari Ball
  const SAFARI = [
    { id: 'kangaskhan', mon: 115, name: 'Kangaskhan', text: 'Te da 120 ₽.', w: 3, catch: 0.5, when: 'any' },
    { id: 'tauros', mon: 128, name: 'Tauros', text: 'Avanzas 3 casillas.', w: 3, catch: 0.45, when: 'end' },
    { id: 'chansey', mon: 113, name: 'Chansey', text: 'Vas al Centro Pokémon más cercano.', w: 2, catch: 0.3, when: 'end' },
    { id: 'scyther', mon: 123, name: 'Scyther', text: 'Te protege una vez del Equipo Galaxia (automático).', w: 2, catch: 0.35, when: 'passive' },
    { id: 'pinsir', mon: 127, name: 'Pinsir', text: 'Recupera gratis una propiedad de la Guardería.', w: 2, catch: 0.35, when: 'any' },
    { id: 'exeggcute', mon: 102, name: 'Exeggcute', text: 'Vuelves a tirar los dados.', w: 3, catch: 0.5, when: 'end' },
    { id: 'dratini', mon: 147, name: 'Dratini', text: 'Desafías ahora por una medalla que te falte.', w: 1, catch: 0.2, when: 'end' },
  ];
  const SAFARI_BY_ID = Object.fromEntries(SAFARI.map((x) => [x.id, x]));

  // ---------- Utilidades ----------
  /** Registra un evento de la acción actual (el cliente los muestra uno tras otro). */
  function setEvent(st, ev) {
    st.event = ev;
    (st.events = st.events || []).push(ev);
  }
  const roll = (rng) => 1 + Math.floor(rng() * 6);
  const err = (msg) => { throw new Error(msg); };
  const alive = (st) => st.players.filter((p) => !p.out);
  const ownerOf = (st, sq) => (st.owners[sq] ? st.owners[sq].owner : null);

  function log(st, text) {
    st.log.push({ n: st.seq, text });
    if (st.log.length > 60) st.log.shift();
  }

  /**
   * Partida nueva para `n` jugadores (2-4). `names` opcional para el registro.
   * Estado: players[], owners{sq:{owner,daycare}}, turn, phase, dice, ...
   */
  function create({ n = 2, target = 8, names = [] } = {}) {
    if (n < 2 || n > 4) err('Hacen falta de 2 a 4 jugadores');
    target = Math.max(3, Math.min(8, Number(target) || 8));
    return {
      players: Array.from({ length: n }, (_, i) => ({
        name: names[i] || `Jugador ${i + 1}`, pos: 0, prev: 0, money: START_MONEY,
        medals: [], items: { flute: 0, zreza: 0 }, stuck: 0, skip: false, out: false, exp: 0,
        safari: [],          // Pokémon capturados en la Zona Safari (bonus de un uso)
      })),
      owners: {},
      turn: 0,
      phase: 'roll',      // roll · buy · battle · shop · corona · safari · travel · end · debt · over
      dice: null,
      doubles: 0,         // dobles seguidos en este turno
      extraRoll: false,   // el jugador vuelve a tirar (dobles o Ponyta)
      pending: null,      // datos de la fase actual (p. ej. rivales en la casilla)
      debt: null,         // { p, to, amount, resume }
      offers: [],         // ofertas de venta entre jugadores
      nextOfferId: 1,
      round: 1,
      maxRounds: roundsFor(target),
      target,
      winner: null,
      reason: null,
      seq: 0,             // aumenta con cada acción (el cliente anima a partir de aquí)
      moves: [],          // desplazamientos de la última acción: [{ p, path, kind }]
      event: null,        // último evento: { p, kind, ... }
      events: [],         // todos los eventos de la última acción, en orden (pueden encadenarse)
      battle: null,       // último combate: { a, b, rolls, winner, loser }
      log: [],
    };
  }

  // ---------- Dinero y deudas ----------
  /** Cobra `amount` a `p` para `to` (índice de jugador o null = banco). Si no alcanza, abre la deuda. */
  function charge(st, p, amount, to, resume = 'end') {
    const pl = st.players[p];
    if (pl.money >= amount) {
      pl.money -= amount;
      if (to !== null && to !== undefined) st.players[to].money += amount;
      return true;
    }
    st.debt = { p, to: to === undefined ? null : to, amount, resume };
    st.phase = 'debt';
    log(st, `${pl.name} debe ${amount} ₽ y no le alcanza.`);
    return false;
  }

  /** Si la deuda ya se puede pagar, se paga y la partida sigue donde estaba. */
  function settleDebt(st) {
    const d = st.debt;
    if (!d || st.players[d.p].money < d.amount) return false;
    st.players[d.p].money -= d.amount;
    if (d.to !== null) st.players[d.to].money += d.amount;
    log(st, `${st.players[d.p].name} paga su deuda de ${d.amount} ₽.`);
    st.debt = null;
    st.phase = d.resume;
    return true;
  }

  // ---------- Movimiento ----------
  /** Mueve a p `steps` casillas (negativo = atrás) caminando; cobra al pasar por la salida. */
  function walk(st, p, steps, kind = 'walk') {
    const pl = st.players[p];
    const path = [pl.pos];
    let pos = pl.pos;
    const dir = steps >= 0 ? 1 : -1;
    for (let i = 0; i < Math.abs(steps); i++) {
      pos = (pos + dir + N) % N;
      path.push(pos);
      if (dir > 0 && pos === 0) { pl.money += PASS_START; log(st, `${pl.name} pasa por la salida: +${PASS_START} ₽.`); }
    }
    pl.prev = pl.pos;
    pl.pos = pos;
    st.moves.push({ p, path, kind });
  }

  /** Salta directamente a una casilla (teletransporte, vuelo...). */
  function jump(st, p, to, kind) {
    const pl = st.players[p];
    st.moves.push({ p, path: [pl.pos, to], kind });
    pl.prev = pl.pos;
    pl.pos = to;
  }

  function nearestCenter(pos) {
    for (let i = 1; i <= N; i++) if (SQUARES[(pos + i) % N].type === 'center') return (pos + i) % N;
    return SQUARES.findIndex((s) => s.type === 'center');
  }

  function sendToSnorlax(st, p) {
    jump(st, p, SNORLAX, 'snorlax');
    st.players[p].stuck = 3;
    st.extraRoll = false;
    log(st, `${st.players[p].name} se queda atascado junto a Snorlax.`);
  }

  // ---------- Resolver la casilla ----------
  function landOn(st, p) {
    const pl = st.players[p];
    // ¿Hay otros jugadores aquí? Se ofrece combate antes de resolver la casilla
    const rivals = st.players.map((q, i) => i).filter((i) => i !== p && !st.players[i].out && st.players[i].pos === pl.pos && !(pl.pos === SNORLAX && st.players[i].stuck));
    if (rivals.length) {
      st.phase = 'battle';
      st.pending = { rivals };
      return;
    }
    resolveSquare(st, p);
  }

  function resolveSquare(st, p, rng) {
    const pl = st.players[p];
    const sq = SQUARES[pl.pos];
    st.phase = 'end';
    st.pending = null;
    switch (sq.type) {
      case 'town':
      case 'transport':
      case 'service': {
        const o = st.owners[pl.pos];
        if (!o) {
          if (pl.money >= sq.price) { st.phase = 'buy'; st.pending = { sq: pl.pos }; }
          else log(st, `${pl.name} no tiene dinero para ${sq.name}.`);
        } else if (o.owner !== p && !o.daycare) {
          const rent = rentOf(st, pl.pos);
          const what = sq.type === 'town' ? 'de entrenamiento' : sq.type === 'transport' ? 'de billete' : 'de servicio';
          log(st, `${pl.name} paga ${rent} ₽ ${what} a ${st.players[o.owner].name} en ${sq.name}.`);
          charge(st, p, rent, o.owner);
        } else if (o.owner === p && sq.type === 'transport' && !o.daycare) {
          // Transporte propio: puedes viajar gratis a otro de los tuyos
          const options = TRANSPORTS.filter((i) => i !== pl.pos && st.owners[i] && st.owners[i].owner === p && !st.owners[i].daycare);
          if (options.length) { st.phase = 'travel'; st.pending = { options }; }
        }
        break;
      }
      case 'corona':
        st.phase = 'corona';
        break;
      case 'safari':
        if (pl.money >= SAFARI_FEE) st.phase = 'safari';
        break;
      case 'gym': {
        // Si ya tienes esta medalla, el líder te recomienda: desafías por la siguiente que te falte
        const target = medalFor(pl, pl.pos);
        if (target !== null) { st.phase = 'gym'; st.pending = { gym: pl.pos, medal: target }; }
        break;
      }
      case 'center':
        pl.money += CENTER_BONUS;
        log(st, `${pl.name} descansa en el Centro Pokémon: +${CENTER_BONUS} ₽.`);
        break;
      case 'shop':
        if (pl.money >= FLUTE_PRICE) { st.phase = 'shop'; st.pending = { price: FLUTE_PRICE }; }
        break;
      case 'galaxy':
        st.phase = 'galaxy';
        break;
      case 'grass':
        st.phase = 'grass';
        break;
      case 'berry':
        st.phase = 'berry';
        break;
      default:
        break;
    }
  }

  /** Medalla por la que se lucha en el gimnasio `sq`: la suya o, si ya la tienes, la siguiente que te falte. */
  function medalFor(pl, sq) {
    if (!pl.medals.includes(sq)) return sq;
    const k = GYMS.indexOf(sq);
    for (let i = 1; i < GYMS.length; i++) {
      const g = GYMS[(k + i) % GYMS.length];
      if (!pl.medals.includes(g)) return g;
    }
    return null; // ya las tiene todas
  }

  /**
   * Lo que se paga al caer en una propiedad ajena:
   * pueblo = entrenamiento (×2 con la región completa) · transporte = según cuántos tenga el dueño
   * · servicio = dados ×4 (×10 si el dueño tiene los dos).
   */
  function rentOf(st, sqi, dice = st.dice) {
    const sq = SQUARES[sqi];
    const o = st.owners[sqi];
    if (!o || o.daycare) return 0;
    const owns = (list) => list.filter((i) => st.owners[i] && st.owners[i].owner === o.owner && !st.owners[i].daycare).length;
    if (sq.type === 'transport') return TRANSPORT_RENT[owns(TRANSPORTS)];
    if (sq.type === 'service') {
      const total = dice ? dice[0] + dice[1] : 7;
      return total * (owns(SERVICES) === SERVICES.length ? 10 : 4);
    }
    const full = REGIONS[sq.region].every((i) => st.owners[i] && st.owners[i].owner === o.owner && !st.owners[i].daycare);
    return full ? sq.rent * 2 : sq.rent;
  }

  // Las fases "gym", "galaxy", "grass" y "berry" se resuelven solas con el azar del servidor
  function autoResolve(st, p, rng) {
    let guard = 0;
    while (['gym', 'galaxy', 'grass', 'berry'].includes(st.phase) && guard++ < 10) {
      const pl = st.players[p];
      if (st.phase === 'gym') {
        const gym = SQUARES[st.pending.gym];
        const mine = [roll(rng), roll(rng)];
        const lead = [roll(rng), roll(rng)];
        const bonus = pl.exp;
        const win = mine[0] + mine[1] + bonus >= lead[0] + lead[1]; // el empate favorece al retador
        const medal = st.pending.medal;
        setEvent(st, { p, kind: 'gym', gym: st.pending.gym, medal, leader: gym.leader, mon: gym.monId, mine, lead, win, bonus });
        st.phase = 'end';
        st.pending = null;
        const shown = `${mine[0] + mine[1]}${bonus ? ` +${bonus}` : ''} contra ${lead[0] + lead[1]}`;
        if (win) {
          pl.medals.push(medal);
          pl.exp = 0;
          log(st, `${pl.name} vence a ${gym.leader} (${shown}) y gana la medalla de ${SQUARES[medal].name}.`);
        } else {
          pl.exp = Math.min(MAX_EXP, pl.exp + 1);
          log(st, `${pl.name} pierde contra ${gym.leader} (${shown}), paga ${GYM_LOSS_FEE} ₽ y gana experiencia (+${pl.exp}).`);
          charge(st, p, GYM_LOSS_FEE, null);
        }
      } else if (st.phase === 'galaxy') {
        const mine = Object.keys(st.owners).map(Number).filter((i) => st.owners[i].owner === p);
        st.phase = 'end';
        const guard = pl.safari.indexOf('scyther');
        if (guard >= 0) {
          pl.safari.splice(guard, 1);
          setEvent(st, { p, kind: 'galaxy', protected: true, mon: 123 });
          log(st, `¡El Scyther de ${pl.name} ahuyenta al Equipo Galaxia!`);
        } else if (mine.length && rng() < 0.4) {
          const sq = mine[Math.floor(rng() * mine.length)];
          delete st.owners[sq];
          setEvent(st, { p, kind: 'galaxy', stole: sq, mon: 434 });
          log(st, `¡El Equipo Galaxia le roba ${SQUARES[sq].name} a ${pl.name}!`);
        } else {
          setEvent(st, { p, kind: 'galaxy', money: 80, mon: 434 });
          log(st, `¡El Equipo Galaxia le quita 80 ₽ a ${pl.name}!`);
          charge(st, p, 80, null);
        }
      } else {
        const deckName = st.phase; // 'grass' o 'berry'
        const deck = deckName === 'grass' ? GRASS : BERRY;
        const ev = deck[Math.floor(rng() * deck.length)];
        st.phase = 'end';
        applyEvent(st, p, ev, deckName, rng);
      }
    }
  }

  function applyEvent(st, p, ev, deckName, rng) {
    const pl = st.players[p];
    setEvent(st, { p, kind: deckName, id: ev.id, title: ev.title, text: ev.text, mon: ev.mon || null, anim: ev.anim });
    log(st, `${pl.name}: ${ev.title}. ${ev.text}`);
    if (ev.item) pl.items[ev.item]++;
    if (ev.money > 0) pl.money += ev.money;
    if (ev.money < 0) charge(st, p, -ev.money, null);
    if (ev.everyone) for (const q of st.players) if (!q.out) q.money += ev.everyone;
    if (ev.fromEach) {
      for (let i = 0; i < st.players.length; i++) {
        if (i === p || st.players[i].out) continue;
        const pay = Math.min(ev.fromEach, st.players[i].money); // nadie entra en deuda por una fiesta
        st.players[i].money -= pay;
        pl.money += pay;
      }
    }
    if (ev.skip || ev.id === 'gastly') pl.skip = true;
    if (ev.id === 'snorlax') return sendToSnorlax(st, p);
    if (ev.id === 'ponyta') { st.extraRoll = true; return; }
    if (ev.id === 'abra') { jump(st, p, Math.floor(rng() * N), 'teleport'); return landOn(st, p) || autoResolve(st, p, rng); }
    if (ev.id === 'pidgey' || ev.id === 'zidra') { jump(st, p, nearestCenter(pl.pos), ev.id === 'pidgey' ? 'fly' : 'walk'); return resolveSquare(st, p, rng); }
    if (ev.forward) { walk(st, p, ev.forward, 'hop'); return landOn(st, p) || autoResolve(st, p, rng); }
    if (ev.back) { walk(st, p, -ev.back, 'back'); return landOn(st, p) || autoResolve(st, p, rng); }
  }

  // ---------- Turnos ----------
  function nextTurn(st) {
    st.extraRoll = false;
    st.doubles = 0;
    st.pending = null;
    const n = st.players.length;
    let t = st.turn;
    let wrapped = false;
    for (let i = 0; i < n; i++) {
      t = (t + 1) % n;
      if (t === 0) wrapped = true; // se completó una ronda
      if (!st.players[t].out) break;
    }
    if (wrapped || t <= st.turn) st.round++;
    st.turn = t;
    st.phase = 'roll';
    if (st.round > st.maxRounds) return finishByWorth(st);
    // Turno perdido (Gastly, Baya Caquic)
    const pl = st.players[t];
    if (pl.skip) {
      pl.skip = false;
      log(st, `${pl.name} pierde este turno.`);
      return nextTurn(st);
    }
  }

  function worth(st, p) {
    const pl = st.players[p];
    let w = pl.money + pl.medals.length * MEDAL_VALUE;
    for (const [sq, o] of Object.entries(st.owners)) if (o.owner === p) w += o.daycare ? SQUARES[sq].price / 2 : SQUARES[sq].price;
    return w;
  }

  function finishByWorth(st) {
    const ranking = st.players.map((p, i) => i).filter((i) => !st.players[i].out).sort((a, b) => worth(st, b) - worth(st, a));
    st.winner = ranking[0];
    st.reason = 'worth';
    st.phase = 'over';
    log(st, `Fin de las ${st.maxRounds} rondas: gana ${st.players[st.winner].name} por patrimonio.`);
  }

  function checkWin(st) {
    if (st.phase === 'over') return true;
    const left = alive(st);
    if (left.length === 1) {
      st.winner = st.players.indexOf(left[0]);
      st.reason = 'last';
      st.phase = 'over';
      log(st, `¡${left[0].name} es el último con dinero y gana!`);
      return true;
    }
    const champ = st.players.findIndex((p) => !p.out && p.medals.length >= st.target);
    if (champ >= 0) {
      st.winner = champ;
      st.reason = 'medals';
      st.phase = 'over';
      log(st, `¡${st.players[champ].name} consigue ${st.target} medallas y gana!`);
      return true;
    }
    return false;
  }

  function myTownsOk(st, p, sq) {
    const o = st.owners[sq];
    if (!o || o.owner !== p) err('Esa propiedad no es tuya');
    return o;
  }

  /**
   * Aplica una acción del jugador `p`. Lanza Error si no es válida.
   * Acciones: roll · buy · skip · battle {target} · decline · shop {buy} · useItem {item} · end
   *           daycare {sq} · redeem {sq} · sellBank {sq} · offer {sq,to,price} · answer {id,accept}
   *           cancelOffer {id} · retire
   */
  function act(st, p, action, rng = Math.random) {
    if (st.phase === 'over') err('La partida ha terminado');
    const pl = st.players[p];
    if (!pl || pl.out) err('No estás en la partida');
    const a = action || {};
    st.moves = [];
    st.event = null;
    st.events = [];
    st.battle = null;

    // Acciones que no dependen del turno
    if (a.type === 'answer') return answerOffer(st, p, a), finishAct(st);
    if (a.type === 'retire') return retire(st, p), finishAct(st); // te puedes rendir cuando quieras
    if (a.type === 'cancelOffer') {
      st.offers = st.offers.filter((o) => !(o.id === a.id && o.from === p));
      return finishAct(st);
    }

    const myTurn = st.turn === p || (st.debt && st.debt.p === p);
    if (!myTurn) err('No es tu turno');
    const inDebt = st.debt && st.debt.p === p;

    switch (a.type) {
      case 'roll': {
        if (st.phase !== 'roll' || inDebt) err('Ahora no puedes tirar');
        const dice = [roll(rng), roll(rng)];
        st.dice = dice;
        const doubles = dice[0] === dice[1];
        if (pl.stuck) {
          if (doubles) {
            pl.stuck = 0;
            log(st, `${pl.name} saca dobles (${dice[0]}+${dice[1]}) y Snorlax se aparta.`);
          } else {
            pl.stuck--;
            log(st, `${pl.name} no saca dobles (${dice[0]}+${dice[1]}); Snorlax sigue dormido.`);
            if (pl.stuck > 0) { st.phase = 'end'; return finishAct(st); }
            log(st, `${pl.name} se cansa de esperar y rodea a Snorlax.`);
          }
          st.extraRoll = false;
        } else {
          st.doubles = doubles ? st.doubles + 1 : 0;
          st.extraRoll = doubles && st.doubles <= 2;
        }
        log(st, `${pl.name} tira ${dice[0]} + ${dice[1]}${doubles ? ' (¡dobles!)' : ''}.`);
        walk(st, p, dice[0] + dice[1]);
        landOn(st, p);
        autoResolve(st, p, rng);
        break;
      }
      case 'buy':
      case 'skip': {
        if (st.phase !== 'buy') err('No hay nada que reclamar');
        const sq = st.pending.sq;
        if (a.type === 'buy') {
          const price = SQUARES[sq].price;
          if (pl.money < price) err('No te alcanza');
          pl.money -= price;
          st.owners[sq] = { owner: p, daycare: false };
          log(st, `${pl.name} reclama ${SQUARES[sq].name} por ${price} ₽.`);
        }
        st.phase = 'end';
        st.pending = null;
        break;
      }
      case 'battle':
      case 'decline': {
        if (st.phase !== 'battle') err('No hay combate');
        if (a.type === 'battle') {
          const rival = st.pending.rivals.includes(a.target) ? a.target : st.pending.rivals[0];
          const rolls = [];
          let me, them;
          do {
            me = [roll(rng), roll(rng)];
            them = [roll(rng), roll(rng)];
            rolls.push({ me, them });
          } while (me[0] + me[1] === them[0] + them[1] && rolls.length < 10);
          const iWin = me[0] + me[1] >= them[0] + them[1];
          const winner = iWin ? p : rival;
          const loser = iWin ? rival : p;
          st.battle = { a: p, b: rival, rolls, winner, loser };
          log(st, `¡Combate! ${pl.name} (${me[0] + me[1]}) contra ${st.players[rival].name} (${them[0] + them[1]}): gana ${st.players[winner].name}.`);
          // El perdedor vuelve a la casilla donde estaba antes
          const lp = st.players[loser];
          const back = lp.prev === lp.pos ? (lp.pos - 1 + N) % N : lp.prev;
          st.moves.push({ p: loser, path: [lp.pos, back], kind: 'knockback' });
          lp.prev = lp.pos;
          lp.pos = back;
          if (loser === p) { st.phase = 'end'; st.pending = null; st.extraRoll = false; break; }
        }
        resolveSquare(st, p, rng);
        autoResolve(st, p, rng);
        break;
      }
      case 'cave': {
        if (st.phase !== 'corona') err('No estás en el Monte Corona');
        st.phase = 'end';
        if (!a.enter) { log(st, `${pl.name} rodea el Monte Corona.`); break; }
        const ev = CAVE_EVENTS[Math.floor(rng() * CAVE_EVENTS.length)];
        setEvent(st, { p, kind: 'cave', id: ev.id, title: ev.title, text: ev.text, mon: ev.mon, ok: ev.ok });
        log(st, `${pl.name} entra en el Monte Corona: ${ev.title}. ${ev.text}`);
        if (ev.item) pl.items[ev.item]++;
        if (ev.money > 0) pl.money += ev.money;
        if (ev.skip) pl.skip = true;
        if (ev.ok) {
          st.moves.push({ p, path: [CORONA, ...CAVE, CAVE_EXIT], kind: 'cave' });
          pl.prev = pl.pos;
          pl.pos = CAVE_EXIT;
          landOn(st, p);
          autoResolve(st, p, rng);
        } else {
          st.moves.push({ p, path: [CORONA, CAVE[0], CAVE[1], CAVE[0], CORONA], kind: 'cave' });
          if (ev.money < 0) charge(st, p, -ev.money, null);
        }
        break;
      }
      case 'safari': {
        if (st.phase !== 'safari') err('No estás en la Zona Safari');
        st.phase = 'end';
        if (!a.enter) break;
        if (pl.money < SAFARI_FEE) err('No te alcanza para la entrada');
        pl.money -= SAFARI_FEE;
        // Aparece un Pokémon (según lo frecuente que es) y tienes 3 Safari Balls
        const total = SAFARI.reduce((t, x) => t + x.w, 0);
        let r = rng() * total;
        const wild = SAFARI.find((x) => (r -= x.w) < 0) || SAFARI[0];
        const throws = [];
        for (let i = 0; i < 3 && !throws.includes(true); i++) throws.push(rng() < wild.catch);
        const caught = throws.includes(true);
        if (caught) pl.safari.push(wild.id);
        setEvent(st, { p, kind: 'safari', id: wild.id, mon: wild.mon, name: wild.name, throws, caught, text: wild.text });
        log(st, `${pl.name} entra en la Zona Safari: aparece un ${wild.name} y ${caught ? `¡lo captura! (${wild.text})` : 'se escapa.'}`);
        break;
      }
      case 'travel': {
        if (st.phase !== 'travel') err('No puedes viajar ahora');
        const to = Number(a.to);
        st.phase = 'end';
        if (!st.pending.options.includes(to)) { st.pending = null; log(st, `${pl.name} se queda en ${SQUARES[pl.pos].name}.`); break; }
        st.pending = null;
        jump(st, p, to, 'train');
        log(st, `${pl.name} viaja gratis hasta ${SQUARES[to].name}.`);
        break;
      }
      case 'useSafari': {
        const k = pl.safari.indexOf(a.id);
        const def = SAFARI_BY_ID[a.id];
        if (k < 0 || !def) err('No tienes ese Pokémon de la Zona Safari');
        if (def.when === 'passive') err(`${def.name} actúa solo cuando hace falta`);
        if (def.when === 'end' && (st.phase !== 'end' || inDebt)) err('Úsalo después de tirar, antes de terminar el turno');
        if (a.id === 'pinsir') {
          const o = st.owners[a.sq];
          if (!o || o.owner !== p || !o.daycare) err('Elige una propiedad tuya que esté en la Guardería');
          o.daycare = false;
        }
        pl.safari.splice(k, 1);
        setEvent(st, { p, kind: 'safariUse', id: def.id, mon: def.mon, name: def.name, text: def.text });
        log(st, `${pl.name} usa a su ${def.name}: ${def.text}`);
        if (a.id === 'kangaskhan') pl.money += 120;
        else if (a.id === 'exeggcute') st.extraRoll = true;
        else if (a.id === 'tauros') { walk(st, p, 3, 'hop'); landOn(st, p); autoResolve(st, p, rng); }
        else if (a.id === 'chansey') { jump(st, p, nearestCenter(pl.pos), 'walk'); resolveSquare(st, p, rng); }
        else if (a.id === 'dratini') {
          const gym = GYMS.find((g) => !pl.medals.includes(g));
          if (gym !== undefined) { st.phase = 'gym'; st.pending = { gym, medal: gym }; autoResolve(st, p, rng); }
        }
        break;
      }
      case 'shop': {
        if (st.phase !== 'shop') err('No estás en la tienda');
        if (a.buy) {
          if (pl.money < FLUTE_PRICE) err('No te alcanza');
          pl.money -= FLUTE_PRICE;
          pl.items.flute++;
          log(st, `${pl.name} compra una Poké Flauta.`);
        }
        st.phase = 'end';
        st.pending = null;
        break;
      }
      case 'useItem': {
        if (!pl.stuck) err('No estás atascado');
        if (!['flute', 'zreza'].includes(a.item) || !pl.items[a.item]) err('No tienes ese objeto');
        pl.items[a.item]--;
        pl.stuck = 0;
        setEvent(st, { p, kind: 'wake', item: a.item, mon: 143, anim: 'wake' });
        log(st, `${pl.name} usa ${a.item === 'flute' ? 'la Poké Flauta' : 'una Baya Zreza'}: ¡Snorlax se despierta y se aparta!`);
        break;
      }
      case 'end': {
        if (st.phase !== 'end' || inDebt) err('Aún no puedes terminar el turno');
        if (st.extraRoll) { st.extraRoll = false; st.phase = 'roll'; log(st, `${pl.name} vuelve a tirar.`); break; }
        nextTurn(st);
        break;
      }
      case 'daycare': {
        const o = myTownsOk(st, p, a.sq);
        if (o.daycare) err('Ya está en la Guardería');
        o.daycare = true;
        const get = Math.round(SQUARES[a.sq].price * 0.5);
        pl.money += get;
        log(st, `${pl.name} deja ${SQUARES[a.sq].name} en la Guardería y recibe ${get} ₽.`);
        break;
      }
      case 'redeem': {
        const o = myTownsOk(st, p, a.sq);
        if (!o.daycare) err('Esa propiedad no está en la Guardería');
        const cost = Math.round(SQUARES[a.sq].price * 0.6);
        if (pl.money < cost) err('No te alcanza');
        if (inDebt) err('Primero paga tu deuda');
        pl.money -= cost;
        o.daycare = false;
        log(st, `${pl.name} recupera ${SQUARES[a.sq].name} de la Guardería por ${cost} ₽.`);
        break;
      }
      case 'sellBank': {
        const o = myTownsOk(st, p, a.sq);
        if (o.daycare) err('Está en la Guardería: recupérala antes de venderla a la Tienda');
        const get = Math.round(SQUARES[a.sq].price * 0.4);
        delete st.owners[a.sq];
        st.offers = st.offers.filter((x) => x.sq !== a.sq);
        pl.money += get;
        log(st, `${pl.name} vende ${SQUARES[a.sq].name} a la Tienda Pokémon por ${get} ₽.`);
        break;
      }
      case 'offer': {
        myTownsOk(st, p, a.sq);
        const to = Number(a.to);
        const price = Math.round(Number(a.price));
        if (!st.players[to] || st.players[to].out || to === p) err('Comprador no válido');
        if (!(price > 0)) err('Precio no válido');
        st.offers = st.offers.filter((o) => o.sq !== a.sq);
        st.offers.push({ id: st.nextOfferId++, from: p, to, sq: a.sq, price, at: Date.now() });
        log(st, `${pl.name} ofrece ${SQUARES[a.sq].name} a ${st.players[to].name} por ${price} ₽.`);
        break;
      }
      default:
        err('Acción desconocida');
    }
    return finishAct(st);
  }

  function finishAct(st) {
    if (st.debt) settleDebt(st);
    checkWin(st);
    st.seq++;
    return st;
  }

  function answerOffer(st, p, a) {
    const o = st.offers.find((x) => x.id === a.id);
    if (!o || o.to !== p) err('Esa oferta no es para ti');
    st.offers = st.offers.filter((x) => x.id !== o.id);
    const town = st.owners[o.sq];
    if (!town || town.owner !== o.from) err('Esa propiedad ya no está a la venta');
    if (!a.accept) { log(st, `${st.players[p].name} rechaza la oferta por ${SQUARES[o.sq].name}.`); return; }
    if (st.players[p].money < o.price) err('No te alcanza');
    st.players[p].money -= o.price;
    st.players[o.from].money += o.price;
    town.owner = p;
    log(st, `${st.players[p].name} compra ${SQUARES[o.sq].name} a ${st.players[o.from].name} por ${o.price} ₽.`);
  }

  /** Retirarse: el dinero y los pueblos pasan al acreedor (o al banco). */
  function retire(st, p) {
    const pl = st.players[p];
    const to = st.debt && st.debt.p === p ? st.debt.to : null;
    for (const [sq, o] of Object.entries(st.owners)) {
      if (o.owner !== p) continue;
      if (to === null) delete st.owners[sq];
      else o.owner = to;
    }
    if (to !== null) st.players[to].money += pl.money;
    pl.money = 0;
    pl.out = true;
    st.offers = st.offers.filter((o) => o.from !== p && o.to !== p);
    log(st, `${pl.name} se retira de la partida.`);
    const wasTurn = st.turn === p;
    st.debt = null;
    if (!checkWin(st) && wasTurn) nextTurn(st);
    else if (!wasTurn && st.phase === 'debt') st.phase = 'end';
  }

  /** Caducar ofertas (el servidor las llama cada pocos segundos). */
  function expireOffers(st, now = Date.now(), ms = 30000) {
    const before = st.offers.length;
    st.offers = st.offers.filter((o) => now - o.at < ms);
    return before !== st.offers.length;
  }

  /** Lo que se podría reunir vendiendo/dejando todo (para el bot y la interfaz). */
  function liquidValue(st, p) {
    let v = st.players[p].money;
    for (const [sq, o] of Object.entries(st.owners)) if (o.owner === p && !o.daycare) v += Math.round(SQUARES[sq].price * 0.5);
    return v;
  }

  const api = {
    SQUARES, N, SNORLAX, GYMS, REGIONS, REGION_NAMES, GRASS, BERRY, CAVE_EVENTS, SAFARI, SAFARI_BY_ID, START_MONEY, PASS_START, CENTER_BONUS,
    TRANSPORTS, SERVICES, TRANSPORT_RENT, CORONA, CAVE, CAVE_EXIT, SAFARI_FEE, isProperty,
    FLUTE_PRICE, GYM_LOSS_FEE, MAX_EXP, roundsFor, create, act, rentOf, worth, expireOffers, liquidValue, ownerOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PokeRoute = api;
})(typeof window !== 'undefined' ? window : globalThis);
