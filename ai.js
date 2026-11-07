// Assistente AI (Google Gemini, piano gratuito) chiamato tramite la Edge Function "menu-ai" su Supabase.
import { store, uid } from './store.js';
import * as E from './engine.js';

export const aiAvailable = () => store.online;

const profile = s => ({
  persone: s.people,
  alimentazione: s.diet,
  ingredientiDaEvitare: s.exclude,
  minutiMaxFeriali: s.maxTimeWeekday,
  minutiMaxWeekend: s.maxTimeWeekend,
  contornoConISecondi: s.sideWithSecondo,
  richiestePassate: (s.aiHistory || []).map(h => h.text),
});

function tastes(state) {
  const t = E.tasteSummary(state);
  return {
    piace: t.likes.map(f => f.label),
    piaceMeno: t.dislikes.map(f => f.label),
    piattiPreferiti: t.topDishes.map(d => d.name),
    piattiPocoGraditi: t.bottomDishes.map(d => d.name),
  };
}

const catalog = state =>
  state.dishes
    .filter(d => E.allowed(d, state.settings))
    .map(d => ({ id: d.id, name: d.name, category: d.category, protein: d.protein, time: d.time }));

async function call(mode, payload) {
  const { data, error } = await store.db.functions.invoke('menu-ai', { body: { mode, payload } });
  if (error) {
    let msg = error.message;
    if (/Failed to send/i.test(msg)) msg = 'assistente non raggiungibile (la funzione "menu-ai" è pubblicata su Supabase?)';
    try {
      const body = await error.context.json();
      if (body?.error) msg = body.error;
    } catch {
      /* risposta senza dettagli */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

// Controllo quello che arriva dall'AI prima di salvarlo come piatto.
const str = (v, max) => String(v ?? '').trim().slice(0, max);
export function toDish(raw) {
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const list = (v, max) => (Array.isArray(v) ? v : []).map(x => str(x, 60).toLowerCase()).filter(Boolean).slice(0, max);
  const meals = list(raw.meals, 2).filter(m => E.MEALS.includes(m));
  return {
    id: 'ai-' + uid(),
    name: str(raw.name, 80) || 'Piatto senza nome',
    category: pick(raw.category, Object.keys(E.CATEGORIES), 'unico'),
    protein: pick(raw.protein, Object.keys(E.PROTEINS), 'vegetale'),
    time: Math.min(300, Math.max(5, Math.round(Number(raw.time) || 30))),
    meals: meals.length ? meals : ['pranzo', 'cena'],
    seasons: list(raw.seasons, 4).filter(s => s in E.SEASONS),
    ingredients: list(raw.ingredients, 25),
    tags: list(raw.tags, 6),
    notes: str(raw.recipe, 1500),
    source: 'ai',
  };
}

export function askMenu(state, menu, request) {
  const slots = E.slotList(state.settings, menu.week).map(sl => {
    const s = menu.slots[sl.key] || {};
    const d = state.dishes.find(x => x.id === s.dish);
    return { key: sl.key, day: E.DAYS[sl.day], meal: sl.meal, dish: s.skip ? 'fuori casa' : d?.name, locked: Boolean(s.locked) };
  });
  return call('modifica', { profile: profile(state.settings), tastes: tastes(state), catalog: catalog(state), slots, request });
}

export async function askIdeas(state, request, count = 5) {
  const res = await call('idee', {
    profile: profile(state.settings),
    tastes: tastes(state),
    catalog: catalog(state),
    season: E.seasonOf(new Date()),
    request,
    count,
  });
  return { message: res.message, dishes: (res.dishes || []).map(toDish) };
}
