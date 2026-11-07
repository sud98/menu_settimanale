// Livello dati. Come in GE WoodArt: se config.js ha i dati di Supabase, tutto va
// direttamente sul database (stessi dati su ogni telefono, niente login).
// Se config.js è vuoto, i dati restano nel browser di questo dispositivo.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { SEED_DISHES } from './seed.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.58.0/+esm';
const LS_KEY = 'menu-di-casa:v1';

export const remoteConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const DEFAULT_SETTINGS = {
  people: 2,
  // 0 = lunedì … 6 = domenica
  plan: [0, 1, 2, 3, 4, 5, 6].map(d => ({ pranzo: d >= 5, cena: true })),
  maxTimeWeekday: 30,
  maxTimeWeekend: 60,
  diet: 'onnivoro',
  exclude: [],
  pantry: ['olio', 'sale', 'pepe', 'aglio', 'olio per friggere'],
  novelty: 0.5,
  sideWithSecondo: true,
};

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);

const fresh = () => ({
  settings: structuredClone(DEFAULT_SETTINGS),
  dishes: structuredClone(SEED_DISHES),
  menus: {},
  events: [],
});

function readLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const now = () => new Date().toISOString();
const eventRow = e => ({ dish_id: e.dish, type: e.type, value: e.value ?? null, ref: e.ref ?? null, created_at: e.at });

class Store {
  state = fresh();
  db = null;
  online = false; // true = sto usando Supabase
  initError = null;
  onError = () => {};

  async init() {
    const local = readLocal();
    if (local) this.state = { ...fresh(), ...local, settings: { ...DEFAULT_SETTINGS, ...local.settings } };

    if (remoteConfigured) {
      try {
        const { createClient } = await import(SUPABASE_JS);
        this.db = createClient(SUPABASE_URL, SUPABASE_KEY);
        await this.loadRemote();
        this.online = true;
        return;
      } catch (err) {
        console.error(err);
        this.initError = err;
      }
    }
    this.writeLocal();
  }

  writeLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.state));
    } catch (err) {
      this.onError(err);
    }
  }

  async loadRemote() {
    const db = this.db;
    const res = await Promise.all([
      db.from('impostazioni').select('data').eq('id', 1).maybeSingle(),
      db.from('piatti').select('id,data'),
      db.from('menu').select('settimana,data'),
      db.from('eventi').select('dish_id,type,value,ref,created_at').order('created_at').range(0, 49999),
    ]);
    for (const r of res) if (r.error) throw r.error;
    const [s, d, m, e] = res.map(r => r.data);

    if (!s && d.length === 0) {
      // Database vuoto: ci carico quello che c'è su questo dispositivo (o il ricettario iniziale).
      await this.pushAll();
      return;
    }
    this.state = {
      settings: { ...DEFAULT_SETTINGS, ...(s?.data ?? {}) },
      dishes: d.map(r => ({ ...r.data, id: r.id })),
      menus: Object.fromEntries(m.map(r => [r.settimana, r.data])),
      events: e.map(r => ({ dish: r.dish_id, type: r.type, value: r.value, ref: r.ref, at: r.created_at })),
    };
  }

  async pushAll() {
    const { db, state } = this;
    const ops = [
      db.from('impostazioni').upsert({ id: 1, data: state.settings }),
      db.from('piatti').upsert(state.dishes.map(d => ({ id: d.id, data: d }))),
    ];
    const menus = Object.values(state.menus);
    if (menus.length) ops.push(db.from('menu').upsert(menus.map(m => ({ settimana: m.week, data: m }))));
    if (state.events.length) ops.push(db.from('eventi').insert(state.events.map(eventRow)));
    for (const r of await Promise.all(ops)) if (r.error) throw r.error;
  }

  // Applica la modifica: in locale salva tutto nel browser, online esegue la query su Supabase.
  async commit(remote) {
    if (!this.online) return this.writeLocal();
    try {
      const r = await remote(this.db);
      if (r?.error) throw r.error;
    } catch (err) {
      console.error(err);
      this.onError(err);
    }
  }

  saveSettings(settings) {
    this.state.settings = settings;
    return this.commit(db => db.from('impostazioni').upsert({ id: 1, data: settings, updated_at: now() }));
  }

  upsertDish(dish) {
    const i = this.state.dishes.findIndex(d => d.id === dish.id);
    if (i >= 0) this.state.dishes[i] = dish;
    else this.state.dishes.push(dish);
    return this.commit(db => db.from('piatti').upsert({ id: dish.id, data: dish, updated_at: now() }));
  }

  deleteDish(id) {
    this.state.dishes = this.state.dishes.filter(d => d.id !== id);
    return this.commit(db => db.from('piatti').delete().eq('id', id));
  }

  saveMenu(menu) {
    this.state.menus[menu.week] = menu;
    return this.commit(db => db.from('menu').upsert({ settimana: menu.week, data: menu, updated_at: now() }));
  }

  addEvent(e) {
    const ev = { at: now(), ...e };
    this.state.events.push(ev);
    return this.commit(db => db.from('eventi').insert(eventRow(ev)));
  }

  // Sostituisce l'evento con la stessa ref (es. cambiare un voto), oppure lo toglie se e è null.
  setEventByRef(ref, e) {
    this.state.events = this.state.events.filter(x => x.ref !== ref);
    const ev = e ? { at: now(), ...e, ref } : null;
    if (ev) this.state.events.push(ev);
    return this.commit(async db => {
      const del = await db.from('eventi').delete().eq('ref', ref);
      if (del.error || !ev) return del;
      return db.from('eventi').insert(eventRow(ev));
    });
  }

  resetLearning() {
    this.state.events = [];
    return this.commit(db => db.from('eventi').delete().gte('id', 0));
  }
}

export const store = new Store();
