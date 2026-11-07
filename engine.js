// Motore: generazione del menu e apprendimento dei gusti. Tutto gira nel browser, gratis.

export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const MEALS = ['pranzo', 'cena'];
export const CATEGORIES = { primo: 'Primo', secondo: 'Secondo', unico: 'Piatto unico', contorno: 'Contorno' };
export const PROTEINS = {
  pesce: 'Pesce',
  legumi: 'Legumi',
  carne_bianca: 'Carne bianca',
  carne_rossa: 'Carne rossa',
  uova: 'Uova',
  formaggi: 'Formaggi',
  salumi: 'Salumi',
  vegetale: 'Vegetale',
};
export const SEASONS = { primavera: 'Primavera', estate: 'Estate', autunno: 'Autunno', inverno: 'Inverno' };
export const DIETS = { onnivoro: 'Onnivora', pescetariano: 'Pescetariana', vegetariano: 'Vegetariana' };

// Frequenze settimanali indicative (dieta mediterranea) per ~10 pasti; vengono scalate sul numero di pasti.
const WEEK_TARGETS = {
  pesce: [2, 3],
  legumi: [2, 4],
  carne_bianca: [1, 3],
  carne_rossa: [0, 1],
  uova: [0, 2],
  formaggi: [0, 2],
  salumi: [0, 1],
};
const MEAT = new Set(['carne_bianca', 'carne_rossa', 'salumi', 'carne']);

// Quanto pesa ogni gesto. Un voto in stelle va da -1.5 (1★) a +1.5 (5★).
const SIGNAL = { like: 1, dislike: -1.5, accept: 0.3, reject: -0.4, pick: 0.6 };
const HALF_LIFE_DAYS = 120; // i gusti cambiano: un voto di 4 mesi fa conta la metà

/* ---------- date ---------- */
const pad = n => String(n).padStart(2, '0');
export const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDate = s => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (s, n) => {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
export const weekKey = date => {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDate(d);
};
const dayDiff = (a, b) => Math.round((parseDate(a) - parseDate(b)) / 864e5);
export function seasonOf(date) {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'primavera';
  if (m >= 6 && m <= 8) return 'estate';
  if (m >= 9 && m <= 11) return 'autunno';
  return 'inverno';
}

export const norm = s => String(s).trim().toLowerCase();

/* ---------- slot della settimana ---------- */
export function slotList(settings, week) {
  const out = [];
  settings.plan.forEach((p, day) => {
    for (const meal of MEALS) {
      if (p[meal]) out.push({ key: `${day}-${meal}`, day, meal, date: addDays(week, day), idx: out.length });
    }
  });
  return out;
}

export function allowed(d, settings) {
  const flags = [d.protein, ...(d.tags || [])];
  if (settings.diet === 'vegetariano' && flags.some(f => MEAT.has(f) || f === 'pesce')) return false;
  if (settings.diet === 'pescetariano' && flags.some(f => MEAT.has(f))) return false;
  const ex = (settings.exclude || []).map(norm).filter(Boolean);
  if (ex.length) {
    const hay = [d.name, ...(d.ingredients || [])].map(norm);
    if (ex.some(x => hay.some(h => h.includes(x)))) return false;
  }
  return true;
}

const fitsMeal = (d, meal) => !d.meals?.length || d.meals.includes(meal);

/* ---------- apprendimento ---------- */
export function eventSignal(e) {
  if (e.type === 'rating') return (Number(e.value) - 3) * 0.75;
  return SIGNAL[e.type] ?? 0;
}

// Caratteristiche di un piatto: è su queste che si generalizzano i gusti
// (se vi piacciono tre piatti di pesce, il pesce in generale sale).
export function features(d) {
  const f = [['p:' + d.protein, 1], ['c:' + d.category, 0.4]];
  for (const t of d.tags || []) f.push(['t:' + norm(t), 0.8]);
  for (const i of d.ingredients || []) f.push(['i:' + norm(i), 0.5]);
  return f;
}

export function learn(state, now = Date.now()) {
  const byId = new Map(state.dishes.map(d => [d.id, d]));
  const dishAcc = new Map();
  const featAcc = new Map();
  const add = (m, k, s, w) => {
    const o = m.get(k) || { s: 0, w: 0, n: 0 };
    o.s += s;
    o.w += w;
    o.n += 1;
    m.set(k, o);
  };
  for (const e of state.events) {
    const sig = eventSignal(e);
    if (!sig) continue;
    const age = Math.max(0, (now - Date.parse(e.at)) / 864e5);
    const w = Math.pow(0.5, age / HALF_LIFE_DAYS);
    add(dishAcc, e.dish, sig * w, w);
    const d = byId.get(e.dish);
    if (d) for (const [k, fw] of features(d)) add(featAcc, k, sig * w * fw, w * fw);
  }
  // Media "prudente": con pochi dati l'affinità resta vicina a zero.
  const finish = (m, prior) => {
    const r = new Map();
    for (const [k, o] of m) r.set(k, { aff: o.s / (o.w + prior), n: o.n });
    return r;
  };
  return { dish: finish(dishAcc, 1.5), feat: finish(featAcc, 3) };
}

export const dishAffinity = (model, id) => model.dish.get(id)?.aff ?? 0;

export function featureAffinity(model, d) {
  let s = 0;
  let w = 0;
  for (const [k, fw] of features(d)) {
    const a = model.feat.get(k);
    if (a) s += a.aff * fw;
    w += fw;
  }
  return w ? Math.max(-1, Math.min(1, (2 * s) / w)) : 0;
}

/* ---------- generazione ---------- */
function buildContext(state, week) {
  const settings = state.settings;
  const byId = new Map(state.dishes.map(d => [d.id, d]));
  // Quando è stato servito ogni piatto nelle altre settimane (per non ripeterlo troppo presto).
  const served = new Map();
  for (const [wk, m] of Object.entries(state.menus)) {
    if (wk === week) continue;
    for (const [key, s] of Object.entries(m.slots || {})) {
      if (!s || s.skip) continue;
      const date = addDays(wk, Number(key.split('-')[0]));
      for (const id of [s.dish, s.side]) {
        if (!id) continue;
        if (!served.has(id)) served.set(id, []);
        served.get(id).push(date);
      }
    }
  }
  const slots = slotList(settings, week);
  const factor = slots.length / 10;
  const targets = {};
  for (const [p, [mn, mx]] of Object.entries(WEEK_TARGETS)) {
    const min = Math.round(mn * factor);
    targets[p] = [min, Math.max(min, Math.max(1, Math.round(mx * factor)))];
  }
  // "da provare" ha senso solo quando l'app conosce già un po' di piatti.
  const experienced = served.size >= 10;
  return { state, settings, byId, served, slots, targets, experienced, model: learn(state) };
}

function filledList(ctx, menu, exceptKey) {
  const out = [];
  for (const sl of ctx.slots) {
    if (sl.key === exceptKey) continue;
    const s = menu.slots[sl.key];
    const d = s && !s.skip && ctx.byId.get(s.dish);
    if (d) out.push({ slot: sl, dish: d, side: s.side ? ctx.byId.get(s.side) : null });
  }
  return out;
}

function recencyDays(ctx, id, date) {
  const dates = ctx.served.get(id);
  if (!dates) return Infinity;
  return Math.min(...dates.map(x => Math.abs(dayDiff(x, date))));
}

function scoreMain(ctx, d, slot, filled) {
  const st = ctx.settings;
  const why = [];
  let s = 0;

  const da = dishAffinity(ctx.model, d.id);
  const fa = featureAffinity(ctx.model, d);
  s += 1.4 * da + 0.9 * fa;
  if (da > 0.25) why.push('vi è piaciuto');
  else if (fa > 0.2) why.push('in linea con i vostri gusti');

  const recency = recencyDays(ctx, d.id, slot.date);
  if (recency === Infinity && !ctx.model.dish.has(d.id)) {
    s += 0.8 * st.novelty;
    if (st.novelty >= 0.3 && ctx.experienced) why.push('da provare');
  } else if (recency < 7) s -= 2.5;
  else if (recency < 14) s -= 1.2;
  else if (recency < 21) s -= 0.4;
  else if (recency >= 35 && recency !== Infinity && da > 0) {
    s += 0.3;
    why.push('non lo mangiate da un po’');
  }

  const season = seasonOf(parseDate(slot.date));
  if (d.seasons?.length) {
    if (d.seasons.includes(season)) {
      s += 0.3;
      why.push('di stagione');
    } else s -= 1.6;
  }

  const limit = slot.day >= 5 ? st.maxTimeWeekend : st.maxTimeWeekday;
  if (d.time > limit) s -= 1 + (d.time - limit) / 20;

  if (d.protein !== 'vegetale') {
    const count = filled.filter(f => f.dish.protein === d.protein).length;
    const [mn, mx] = ctx.targets[d.protein] || [0, 99];
    if (count >= mx) s -= 3;
    else if (count < mn) {
      s += 0.8;
      why.push('per variare');
    }
  }

  for (const f of filled) {
    if (Math.abs(f.slot.idx - slot.idx) !== 1) continue;
    if (f.dish.protein === d.protein && d.protein !== 'vegetale') s -= 0.9;
    if (f.dish.category === d.category) s -= 0.25;
    if (f.dish.tags?.includes('pasta') && d.tags?.includes('pasta')) s -= 0.4;
  }
  return { s, why };
}

function sample(scored, temperature = 0.45, top = 10) {
  const best = scored.sort((a, b) => b.s - a.s).slice(0, top);
  const max = best[0].s;
  const w = best.map(x => Math.exp((x.s - max) / temperature));
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < best.length; i++) {
    r -= w[i];
    if (r <= 0) return best[i];
  }
  return best[0];
}

function pickMain(ctx, slot, filled, avoid) {
  const used = new Set(filled.map(f => f.dish.id));
  const cands = ctx.state.dishes.filter(
    d => d.category !== 'contorno' && fitsMeal(d, slot.meal) && !used.has(d.id) && !avoid.has(d.id) && allowed(d, ctx.settings),
  );
  if (!cands.length) return null;
  return sample(cands.map(d => ({ d, ...scoreMain(ctx, d, slot, filled) })));
}

function pickSide(ctx, slot, filled, avoid) {
  const usedSides = filled.map(f => f.side?.id).filter(Boolean);
  const season = seasonOf(parseDate(slot.date));
  const limit = slot.day >= 5 ? ctx.settings.maxTimeWeekend : ctx.settings.maxTimeWeekday;
  const cands = ctx.state.dishes.filter(
    d => d.category === 'contorno' && fitsMeal(d, slot.meal) && !avoid.has(d.id) && allowed(d, ctx.settings),
  );
  if (!cands.length) return null;
  const scored = cands.map(d => {
    let s = 1.2 * dishAffinity(ctx.model, d.id) + 0.6 * featureAffinity(ctx.model, d);
    if (d.seasons?.length) s += d.seasons.includes(season) ? 0.4 : -1.6;
    s -= 1.5 * usedSides.filter(id => id === d.id).length;
    if (d.time > limit) s -= 1;
    return { d, s, why: [] };
  });
  return sample(scored, 0.5, 6).d;
}

function fillSlot(ctx, menu, slot, avoid = new Set()) {
  const filled = filledList(ctx, menu, slot.key);
  const r = pickMain(ctx, slot, filled, avoid);
  if (!r) {
    menu.slots[slot.key] = { dish: null };
    return;
  }
  const s = { dish: r.d.id, why: r.why.slice(0, 2).join(' · ') };
  if (r.d.category === 'secondo' && ctx.settings.sideWithSecondo) {
    const side = pickSide(ctx, slot, filled, new Set());
    if (side) s.side = side.id;
  }
  menu.slots[slot.key] = s;
}

export function emptyMenu(week) {
  return { week, status: 'bozza', slots: {}, checked: {}, extra: [] };
}

// Genera (o rigenera) la settimana tenendo i piatti bloccati e i pasti fuori casa.
export function generateMenu(state, week, existing) {
  const ctx = buildContext(state, week);
  const menu = existing ? structuredClone(existing) : emptyMenu(week);
  for (const sl of ctx.slots) {
    const s = menu.slots[sl.key];
    if (!(s && (s.locked || s.skip))) delete menu.slots[sl.key];
  }
  for (const sl of ctx.slots) if (!menu.slots[sl.key]) fillSlot(ctx, menu, sl);
  return menu;
}

export function replaceSlot(state, menu, key) {
  const ctx = buildContext(state, menu.week);
  const slot = ctx.slots.find(s => s.key === key);
  if (!slot) return;
  const old = menu.slots[key]?.dish;
  fillSlot(ctx, menu, slot, new Set(old ? [old] : []));
}

export function replaceSide(state, menu, key) {
  const ctx = buildContext(state, menu.week);
  const slot = ctx.slots.find(s => s.key === key);
  const s = menu.slots[key];
  if (!slot || !s) return;
  const side = pickSide(ctx, slot, filledList(ctx, menu, key), new Set(s.side ? [s.side] : []));
  if (side) s.side = side.id;
}

/* ---------- lista della spesa ---------- */
export function shoppingList(state, menu) {
  const byId = new Map(state.dishes.map(d => [d.id, d]));
  const pantry = new Set((state.settings.pantry || []).map(norm));
  const items = new Map();
  for (const sl of slotList(state.settings, menu.week)) {
    const s = menu.slots[sl.key];
    if (!s || s.skip) continue;
    for (const id of [s.dish, s.side]) {
      const d = byId.get(id);
      if (!d) continue;
      for (const ing of d.ingredients || []) {
        const k = norm(ing);
        if (!k || pantry.has(k)) continue;
        if (!items.has(k)) items.set(k, { name: ing, dishes: [] });
        items.get(k).dishes.push(d.name);
      }
    }
  }
  return [...items.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

/* ---------- cosa ho imparato ---------- */
function featureLabel(k) {
  const kind = k[0];
  const v = k.slice(2);
  if (kind === 'p') return { label: PROTEINS[v] || v, kind: 'tipo' };
  if (kind === 'c') return { label: CATEGORIES[v] || v, kind: 'portata' };
  if (kind === 't') return { label: v, kind: 'caratteristica' };
  return { label: v, kind: 'ingrediente' };
}

export function tasteSummary(state) {
  const model = learn(state);
  const feats = [...model.feat]
    .filter(([k, o]) => o.n >= 2 && Math.abs(o.aff) > 0.12 && !k.startsWith('c:'))
    .map(([k, o]) => ({ ...featureLabel(k), aff: o.aff }));
  const byId = new Map(state.dishes.map(d => [d.id, d]));
  const dishes = [...model.dish]
    .filter(([id]) => byId.has(id))
    .map(([id, o]) => ({ id, name: byId.get(id).name, aff: o.aff }));
  return {
    likes: feats.filter(f => f.aff > 0).sort((a, b) => b.aff - a.aff).slice(0, 10),
    dislikes: feats.filter(f => f.aff < 0).sort((a, b) => a.aff - b.aff).slice(0, 8),
    topDishes: dishes.filter(d => d.aff > 0.25).sort((a, b) => b.aff - a.aff).slice(0, 8),
    bottomDishes: dishes.filter(d => d.aff < -0.25).sort((a, b) => a.aff - b.aff).slice(0, 6),
    stats: {
      events: state.events.length,
      ratings: state.events.filter(e => e.type === 'rating').length,
      confirmed: Object.values(state.menus).filter(m => m.status === 'confermato').length,
    },
  };
}
