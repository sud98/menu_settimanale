import { store, remoteConfigured, uid } from './store.js';
import * as E from './engine.js';
import * as AI from './ai.js';

const view = document.getElementById('view');
const modal = document.getElementById('modal');
const S = () => store.state;
const ui = { week: E.weekKey(new Date()), q: '', cat: 'tutti', aiMsg: '', aiBusy: false, ideas: [] };

/* ---------- utilità ---------- */
const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const today = () => E.isoDate(new Date());
const dish = id => S().dishes.find(d => d.id === id);
const menuCopy = () => structuredClone(S().menus[ui.week]);
const splitList = v => String(v || '').split(/[,\n]/).map(s => s.trim()).filter(Boolean);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2400);
}
store.onError = err => toast('Errore di salvataggio: ' + (err.message || err));

function fmtRange(w) {
  const f = s => E.parseDate(s).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
  return `${f(w)} – ${f(E.addDays(w, 6))}`;
}

function weekHeader(title) {
  const isCurrent = ui.week === E.weekKey(new Date());
  return `<header class="head">
    <button class="icon-btn" data-act="week" data-d="-7" aria-label="Settimana precedente">‹</button>
    <div class="head-title"><h1>${title}</h1><p>${isCurrent ? 'Questa settimana · ' : ''}${fmtRange(ui.week)}</p></div>
    <button class="icon-btn" data-act="week" data-d="7" aria-label="Settimana successiva">›</button>
  </header>`;
}

/* ---------- router ---------- */
const views = { menu: renderMenu, spesa: renderSpesa, piatti: renderPiatti, gusti: renderGusti, profilo: renderProfilo };
const currentView = () => {
  const r = location.hash.replace(/^#\/?/, '');
  return views[r] ? r : 'menu';
};
function render() {
  const r = currentView();
  document.querySelectorAll('.tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === r));
  views[r]();
}
window.addEventListener('hashchange', () => {
  render();
  window.scrollTo(0, 0);
});

/* ---------- MENU ---------- */
function renderMenu() {
  const m = S().menus[ui.week];
  const slots = E.slotList(S().settings, ui.week);
  const t = today();
  let body;

  if (!slots.length) {
    body = `<div class="empty"><p>Nel profilo non ci sono pasti da pianificare.</p><a class="btn" href="#/profilo">Vai al profilo</a></div>`;
  } else if (!m || !slots.some(s => m.slots[s.key])) {
    body = `<div class="empty">
      <div class="empty-art" aria-hidden="true">🍝</div>
      <h2>Nessun menu per questa settimana</h2>
      <p>Preparo una proposta per ${slots.length} pasti in base al vostro profilo e a quello che ho imparato finora.</p>
      <button class="btn primary" data-act="generate">Genera il menu</button>
    </div>${aiBox('Oppure chiedi all’assistente, es. “fammi un menu leggero con tanta verdura”')}`;
  } else {
    const confirmed = m.status === 'confermato';
    body = `<div class="toolbar">
        <span class="pill ${confirmed ? 'ok' : ''}">${confirmed ? 'Confermato' : 'Bozza'}</span>
        <span class="spacer"></span>
        <button class="btn" data-act="generate">↻ Rigenera</button>
        ${confirmed ? '' : '<button class="btn primary" data-act="confirm">Conferma</button>'}
      </div>
      ${confirmed
        ? '<p class="hint">Dopo aver mangiato date le stelle: è il segnale più utile per imparare.</p>'
        : '<p class="hint">Cambiate quello che non vi convince e bloccate ciò che volete tenere, poi confermate. Ogni scelta mi insegna qualcosa.</p>'}
      ${aiBox('Es. “più leggero questa settimana”, “giovedì qualcosa di veloce”, “usiamo le zucchine”')}`;
    for (let day = 0; day < 7; day++) {
      const ds = slots.filter(s => s.day === day);
      if (!ds.length) continue;
      const date = E.addDays(ui.week, day);
      const cls = date === t ? 'today' : date < t ? 'past' : '';
      body += `<section class="day ${cls}">
        <h2>${E.DAYS[day]} <span>${E.parseDate(date).getDate()}</span>${date === t ? '<em>oggi</em>' : ''}</h2>
        ${ds.map(s => slotCard(m, s, date <= t)).join('')}
      </section>`;
    }
  }
  view.innerHTML = weekHeader('Menu') + body;
}

function aiBox(placeholder) {
  if (!AI.aiAvailable()) return '';
  return `<form id="ai-form" class="ai-box">
    <label for="ai-req">✨ Chiedi all’assistente</label>
    <textarea id="ai-req" name="request" rows="2" maxlength="1000" placeholder="${esc(placeholder)}" ${ui.aiBusy ? 'disabled' : ''}></textarea>
    <div class="ai-foot">
      <span class="ai-msg">${ui.aiBusy ? 'Ci penso un attimo…' : esc(ui.aiMsg)}</span>
      <button class="btn primary" type="submit" ${ui.aiBusy ? 'disabled' : ''}>Invia</button>
    </div>
  </form>`;
}

// Applica al menu i cambi proposti dall'assistente; i piatti nuovi entrano nel ricettario.
async function applyAiChanges(res) {
  const m = menuCopy() ?? E.emptyMenu(ui.week);
  const valid = new Set(E.slotList(S().settings, ui.week).map(s => s.key));
  const changed = [];
  for (const c of res.changes || []) {
    if (!valid.has(c.key)) continue;
    if (c.skip) {
      m.slots[c.key] = { skip: true };
      changed.push(c.key);
      continue;
    }
    let id = c.existingId && dish(c.existingId) ? c.existingId : null;
    if (!id && c.newDish?.name) {
      const same = S().dishes.find(d => E.norm(d.name) === E.norm(c.newDish.name));
      if (same) id = same.id;
      else {
        const d = AI.toDish(c.newDish);
        await store.upsertDish(d);
        id = d.id;
      }
    }
    if (!id) continue;
    m.slots[c.key] = { dish: id, why: dish(id).source === 'ai' ? 'nuova idea dell’assistente' : 'proposto dall’assistente' };
    if (dish(id).category === 'secondo' && S().settings.sideWithSecondo) E.replaceSide(S(), m, c.key);
    changed.push(c.key);
  }
  await saveAndRender(m, changed);
  return changed.length;
}

function slotCard(m, sl, isPastOrToday) {
  const s = m.slots[sl.key] || {};
  const k = sl.key;
  const meal = sl.meal === 'pranzo' ? 'Pranzo' : 'Cena';

  if (s.skip) {
    return `<article class="slot muted">
      <div class="slot-meal">${meal}</div>
      <div class="slot-body"><strong class="dish-name">Fuori casa</strong></div>
      <div class="slot-actions"><button class="chip" data-act="skip" data-k="${k}">Ripristina</button></div>
    </article>`;
  }
  const d = dish(s.dish);
  if (!d) {
    return `<article class="slot muted">
      <div class="slot-meal">${meal}</div>
      <div class="slot-body"><strong class="dish-name">Nessun piatto adatto</strong>
        <div class="meta">Controlla esclusioni e dieta nel profilo, o aggiungi piatti.</div></div>
      <div class="slot-actions">
        <button class="chip" data-act="pick" data-k="${k}">Scegli tu</button>
        <button class="chip" data-act="replace" data-k="${k}">Riprova</button>
      </div>
    </article>`;
  }
  const side = dish(s.side);
  const meta = [E.CATEGORIES[d.category], `${d.time} min`, E.PROTEINS[d.protein]].filter(Boolean).join(' · ');
  const stars =
    isPastOrToday && m.status === 'confermato'
      ? `<div class="stars" role="group" aria-label="Com'è andata?">${[1, 2, 3, 4, 5]
          .map(n => `<button data-act="rate" data-k="${k}" data-v="${n}" class="${(s.rating || 0) >= n ? 'on' : ''}" aria-label="${n} stelle">★</button>`)
          .join('')}</div>`
      : '';
  const btn = (act, label, title, on = false, extra = '') =>
    `<button class="ib ${on ? 'on' : ''}" data-act="${act}" data-k="${k}" ${extra} title="${title}" aria-label="${title}">${label}</button>`;

  return `<article class="slot ${s.locked ? 'locked' : ''}">
    <div class="slot-meal">${meal}${s.locked ? ' · bloccato' : ''}</div>
    <div class="slot-body">
      <button class="dish-name" data-act="edit-dish" data-id="${d.id}">${esc(d.name)}</button>
      <div class="meta">${meta}</div>
      ${side ? `<div class="side">+ ${esc(side.name)} <button class="link" data-act="side" data-k="${k}" aria-label="Cambia contorno">cambia</button></div>` : ''}
      ${s.why ? `<div class="why">${esc(s.why)}</div>` : ''}
      ${stars}
    </div>
    <div class="slot-actions">
      ${btn('vote', '👍', 'Ci piace', s.vote === 'like', 'data-v="like"')}
      ${btn('vote', '👎', 'Non ci piace', s.vote === 'dislike', 'data-v="dislike"')}
      <span class="spacer"></span>
      ${btn('replace', '↻', 'Proponi un altro piatto')}
      ${btn('pick', '✎', 'Scegli tu il piatto')}
      ${btn('lock', '🔒', s.locked ? 'Sblocca' : 'Blocca (non cambia rigenerando)', s.locked)}
      ${btn('skip', '✕', 'Fuori casa / salta')}
    </div>
  </article>`;
}

// Quando il menu è confermato, ogni piatto presente conta come "scelto".
async function syncAccepts(m, keys) {
  if (m.status !== 'confermato') return;
  for (const sl of E.slotList(S().settings, m.week)) {
    if (keys && !keys.includes(sl.key)) continue;
    const s = m.slots[sl.key];
    await store.setEventByRef(`${m.week}|${sl.key}|accept`, s?.dish && !s.skip ? { dish: s.dish, type: 'accept' } : null);
  }
}

async function saveAndRender(m, changedKeys) {
  await store.saveMenu(m);
  await syncAccepts(m, changedKeys);
  render();
}

/* ---------- SPESA ---------- */
function renderSpesa() {
  const m = S().menus[ui.week];
  if (!m) {
    view.innerHTML = weekHeader('Spesa') + `<div class="empty"><div class="empty-art" aria-hidden="true">🛒</div><h2>Nessun menu</h2><p>Genera il menu della settimana e qui trovi la lista della spesa.</p><a class="btn primary" href="#/menu">Vai al menu</a></div>`;
    return;
  }
  const checked = m.checked || {};
  const items = [...E.shoppingList(S(), m), ...(m.extra || []).map(name => ({ name, dishes: [], extra: true }))];
  items.sort((a, b) => Number(!!checked[a.name]) - Number(!!checked[b.name]));
  const left = items.filter(i => !checked[i.name]).length;

  view.innerHTML =
    weekHeader('Spesa') +
    `<div class="toolbar">
      <span class="pill">${left} da prendere</span><span class="spacer"></span>
      <button class="btn" data-act="share-list">Condividi</button>
      <button class="btn" data-act="uncheck-all">Azzera spunte</button>
    </div>
    <p class="hint">Esclusi i prodotti di dispensa (${esc(S().settings.pantry.join(', ') || 'nessuno')}), modificabili nel profilo.</p>
    <ul class="shop">
      ${items
        .map(
          i => `<li class="${checked[i.name] ? 'done' : ''}"><label>
            <input type="checkbox" data-shop="${esc(i.name)}" ${checked[i.name] ? 'checked' : ''}>
            <span class="shop-name">${esc(i.name)}</span>
            <span class="shop-for">${i.extra ? 'aggiunto da voi' : esc([...new Set(i.dishes)].join(', '))}</span>
          </label>${i.extra ? `<button class="link" data-act="remove-extra" data-name="${esc(i.name)}" aria-label="Rimuovi">✕</button>` : ''}</li>`,
        )
        .join('')}
    </ul>
    <form id="extra-form" class="inline-form">
      <input name="item" placeholder="Aggiungi altro (es. latte, caffè)" autocomplete="off">
      <button class="btn" type="submit">Aggiungi</button>
    </form>`;
}

/* ---------- PIATTI ---------- */
function renderPiatti() {
  view.innerHTML = `<header class="head">
      <div class="head-title left"><h1>Piatti</h1><p>${S().dishes.length} nel ricettario</p></div>
      ${AI.aiAvailable() ? '<button class="btn" data-act="ideas">✨ Idee</button>' : ''}
      <button class="btn primary" data-act="edit-dish">+ Nuovo</button>
    </header>
    <input type="search" class="search" placeholder="Cerca un piatto o un ingrediente" value="${esc(ui.q)}" data-filter="dishes">
    <div class="chips">${['tutti', ...Object.keys(E.CATEGORIES)]
      .map(c => `<button class="chip ${ui.cat === c ? 'on' : ''}" data-act="cat" data-c="${c}">${c === 'tutti' ? 'Tutti' : E.CATEGORIES[c]}</button>`)
      .join('')}</div>
    <ul class="dish-list" id="dish-list"></ul>`;
  renderDishList();
}

function renderDishList() {
  const model = E.learn(S());
  const q = E.norm(ui.q);
  const list = S()
    .dishes.filter(d => ui.cat === 'tutti' || d.category === ui.cat)
    .filter(d => !q || [d.name, ...(d.ingredients || []), ...(d.tags || [])].some(x => E.norm(x).includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  document.getElementById('dish-list').innerHTML =
    list
      .map(d => {
        const a = E.dishAffinity(model, d.id);
        const badge = a > 0.2 ? '<span class="badge up" title="Vi piace">♥</span>' : a < -0.2 ? '<span class="badge down" title="Poco gradito">↓</span>' : '';
        const off = !E.allowed(d, S().settings) ? '<span class="badge off">escluso</span>' : d.source === 'ai' ? '<span class="badge ai" title="Idea dell’assistente">✨</span>' : '';
        return `<li><button data-act="edit-dish" data-id="${d.id}">
          <span class="dl-name">${esc(d.name)} ${badge}${off}</span>
          <span class="meta">${E.CATEGORIES[d.category]} · ${d.time} min · ${E.PROTEINS[d.protein]}</span>
        </button></li>`;
      })
      .join('') || '<li class="empty small">Nessun piatto trovato.</li>';
}

function openDishForm(id) {
  const d = id ? dish(id) : { name: '', category: 'secondo', protein: 'vegetale', tags: [], meals: ['pranzo', 'cena'], seasons: [], time: 30, ingredients: [], notes: '' };
  const opts = (obj, sel) => Object.entries(obj).map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('');
  const checks = (name, obj, sel) =>
    Object.entries(obj).map(([v, l]) => `<label class="check"><input type="checkbox" name="${name}" value="${v}" ${sel.includes(v) ? 'checked' : ''}> ${l}</label>`).join('');

  modal.innerHTML = `<form id="dish-form" class="modal-card" data-id="${id || ''}">
    <header><h2>${id ? 'Modifica piatto' : 'Nuovo piatto'}</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="Chiudi">✕</button></header>
    <label class="field">Nome<input name="name" required value="${esc(d.name)}"></label>
    <div class="row">
      <label class="field">Portata<select name="category">${opts(E.CATEGORIES, d.category)}</select></label>
      <label class="field">Principale<select name="protein">${opts(E.PROTEINS, d.protein)}</select></label>
    </div>
    <div class="row">
      <label class="field">Minuti<input name="time" type="number" min="1" max="600" value="${d.time}"></label>
      <fieldset class="field"><legend>Pasto</legend>${checks('meals', { pranzo: 'Pranzo', cena: 'Cena' }, d.meals || [])}</fieldset>
    </div>
    <fieldset class="field"><legend>Stagioni (nessuna = sempre)</legend>${checks('seasons', E.SEASONS, d.seasons || [])}</fieldset>
    <label class="field">Ingredienti <small>separati da virgola</small><textarea name="ingredients" rows="3">${esc((d.ingredients || []).join(', '))}</textarea></label>
    <label class="field">Caratteristiche <small>es. veloce, forno, bambini</small><input name="tags" value="${esc((d.tags || []).join(', '))}"></label>
    <label class="field">Note<textarea name="notes" rows="2">${esc(d.notes)}</textarea></label>
    <footer>
      ${id ? '<button type="button" class="btn danger" data-act="delete-dish">Elimina</button>' : ''}
      <span class="spacer"></span>
      <button type="submit" class="btn primary">Salva</button>
    </footer>
  </form>`;
  modal.showModal();
}

/* ---------- idee di piatti nuovi dall'assistente ---------- */
function openIdeas() {
  ui.ideas = [];
  modal.innerHTML = `<div class="modal-card">
    <header><h2>✨ Idee nuove</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="Chiudi">✕</button></header>
    <form id="ideas-form" class="inline-form">
      <input name="request" maxlength="300" placeholder="Ispirazione (facoltativa): es. zucchine, veloce, per bambini">
      <button class="btn primary" type="submit">Proponi</button>
    </form>
    <div id="ideas-list"><p class="hint">L’assistente propone piatti che non avete ancora, adatti a stagione, profilo e gusti. Aggiungete al ricettario quelli che vi ispirano.</p></div>
  </div>`;
  modal.showModal();
}

function ideaCard(d, i) {
  const added = S().dishes.some(x => x.id === d.id);
  return `<article class="idea">
    <h3>${esc(d.name)}</h3>
    <div class="meta">${E.CATEGORIES[d.category]} · ${d.time} min · ${E.PROTEINS[d.protein]}</div>
    <p class="idea-ing">${esc(d.ingredients.join(', '))}</p>
    ${d.notes ? `<details><summary>Preparazione</summary><p>${esc(d.notes)}</p></details>` : ''}
    <button class="btn ${added ? '' : 'primary'}" data-act="add-idea" data-i="${i}" ${added ? 'disabled' : ''}>${added ? 'Aggiunto ✓' : '+ Aggiungi ai piatti'}</button>
  </article>`;
}

/* ---------- scelta manuale del piatto ---------- */
function openPicker(k) {
  const sl = E.slotList(S().settings, ui.week).find(s => s.key === k);
  const list = S()
    .dishes.filter(d => d.category !== 'contorno' && (!d.meals?.length || d.meals.includes(sl.meal)))
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
  modal.innerHTML = `<div class="modal-card">
    <header><h2>${E.DAYS[sl.day]}, ${sl.meal}</h2><button type="button" class="icon-btn" data-act="close-modal" aria-label="Chiudi">✕</button></header>
    <input type="search" class="search" placeholder="Cerca…" data-filter="pick">
    <ul class="pick-list">${list
      .map(d => `<li data-name="${esc(E.norm(d.name + ' ' + d.ingredients.join(' ')))}"><button type="button" data-act="pick-dish" data-k="${k}" data-id="${d.id}">${esc(d.name)}<span class="meta">${E.CATEGORIES[d.category]} · ${d.time} min</span></button></li>`)
      .join('')}</ul>
  </div>`;
  modal.showModal();
}

/* ---------- GUSTI ---------- */
function renderGusti() {
  const t = E.tasteSummary(S());
  const bars = arr =>
    arr.map(f => `<li><span>${esc(f.label)} <small>${f.kind}</small></span><span class="bar ${f.aff < 0 ? 'neg' : ''}"><i style="width:${Math.min(100, Math.abs(f.aff) * 100).toFixed(0)}%"></i></span></li>`).join('');
  const dishes = arr => arr.map(d => `<li><button class="link" data-act="edit-dish" data-id="${d.id}">${esc(d.name)}</button></li>`).join('');

  const learning = t.stats.events < 5;
  view.innerHTML = `<header class="head"><div class="head-title left"><h1>I vostri gusti</h1><p>Quello che ho imparato finora</p></div></header>
    <div class="stats">
      <div><b>${t.stats.confirmed}</b><span>menu confermati</span></div>
      <div><b>${t.stats.ratings}</b><span>piatti votati</span></div>
      <div><b>${t.stats.events}</b><span>segnali raccolti</span></div>
    </div>
    ${learning
      ? `<div class="card"><h2>Sto ancora imparando</h2><p>Imparo da quello che fate: confermare un menu, cambiare un piatto, scegliere voi, i 👍/👎 e soprattutto le stelle dopo aver mangiato. Dopo qualche settimana qui vedrete cosa vi piace, e i menu seguiranno.</p></div>`
      : ''}
    ${t.likes.length ? `<section class="card"><h2>Vi piace</h2><ul class="bars">${bars(t.likes)}</ul></section>` : ''}
    ${t.dislikes.length ? `<section class="card"><h2>Vi piace meno</h2><ul class="bars">${bars(t.dislikes)}</ul></section>` : ''}
    ${t.topDishes.length ? `<section class="card"><h2>Piatti preferiti</h2><ul class="plain">${dishes(t.topDishes)}</ul></section>` : ''}
    ${t.bottomDishes.length ? `<section class="card"><h2>Piatti poco graditi</h2><ul class="plain">${dishes(t.bottomDishes)}</ul></section>` : ''}
    ${t.stats.events ? '<button class="btn danger ghost" data-act="reset-learning">Azzera quello che ho imparato</button>' : ''}`;
}

/* ---------- PROFILO ---------- */
function renderProfilo() {
  const s = S().settings;
  const times = [15, 20, 30, 45, 60, 90, 120];
  const timeOpts = sel => times.map(t => `<option value="${t}" ${t === sel ? 'selected' : ''}>${t} min</option>`).join('');

  let account;
  if (store.online) {
    account = `<p><span class="pill ok">Collegato a Supabase</span></p><p>Piatti, menu e gusti sono sul database: li vedete uguali da tutti i telefoni.</p>`;
  } else if (remoteConfigured) {
    account = `<p class="error">Supabase non raggiungibile${store.initError ? `: ${esc(store.initError.message)}` : ''}.</p><p>Per ora uso i dati salvati su questo dispositivo.</p>`;
  } else {
    account = `<p>I dati sono salvati solo in questo browser. Per averli su tutti i telefoni inserite i dati di Supabase in <code>config.js</code> (vedi <code>README.md</code>).</p>`;
  }

  view.innerHTML = `<header class="head"><div class="head-title left"><h1>Profilo di casa</h1><p>Le regole di base per i menu</p></div></header>
  <form id="settings-form">
    <section class="card">
      <h2>Quali pasti pianificare</h2>
      <table class="plan"><thead><tr><th></th><th>Pranzo</th><th>Cena</th></tr></thead><tbody>
        ${E.DAYS.map((d, i) => `<tr><td>${d}</td>
          <td><input type="checkbox" name="p${i}" aria-label="${d} pranzo" ${s.plan[i].pranzo ? 'checked' : ''}></td>
          <td><input type="checkbox" name="c${i}" aria-label="${d} cena" ${s.plan[i].cena ? 'checked' : ''}></td></tr>`).join('')}
      </tbody></table>
    </section>
    <section class="card">
      <h2>Famiglia e cucina</h2>
      <div class="row">
        <label class="field">Persone<input type="number" name="people" min="1" max="20" value="${s.people}"></label>
        <label class="field">Alimentazione<select name="diet">${Object.entries(E.DIETS).map(([v, l]) => `<option value="${v}" ${v === s.diet ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row">
        <label class="field">Tempo max feriali<select name="tw">${timeOpts(s.maxTimeWeekday)}</select></label>
        <label class="field">Tempo max weekend<select name="te">${timeOpts(s.maxTimeWeekend)}</select></label>
      </div>
      <label class="field">Ingredienti da evitare <small>allergie o cose che proprio non mangiate</small>
        <input name="exclude" value="${esc(s.exclude.join(', '))}" placeholder="es. funghi, crostacei"></label>
      <label class="field">Sempre in dispensa <small>non finiscono nella lista della spesa</small>
        <input name="pantry" value="${esc(s.pantry.join(', '))}"></label>
      <label class="field">Voglia di novità: <output>${Math.round(s.novelty * 100)}%</output>
        <input type="range" name="novelty" min="0" max="1" step="0.1" value="${s.novelty}"></label>
      <label class="check"><input type="checkbox" name="side" ${s.sideWithSecondo ? 'checked' : ''}> Aggiungi un contorno ai secondi</label>
    </section>
  </form>
  <section class="card"><h2>Sincronizzazione</h2>${account}</section>
  <section class="card"><h2>Backup</h2><p>Scarica tutti i dati (piatti, menu, gusti) in un file.</p><button class="btn" data-act="export">Esporta dati</button></section>`;
}

async function saveSettingsForm(f) {
  const fd = new FormData(f);
  const s = {
    ...S().settings,
    people: Math.max(1, Number(fd.get('people')) || 1),
    diet: fd.get('diet'),
    plan: E.DAYS.map((_, i) => ({ pranzo: fd.has(`p${i}`), cena: fd.has(`c${i}`) })),
    maxTimeWeekday: Number(fd.get('tw')),
    maxTimeWeekend: Number(fd.get('te')),
    exclude: splitList(fd.get('exclude')),
    pantry: splitList(fd.get('pantry')),
    novelty: Number(fd.get('novelty')),
    sideWithSecondo: fd.has('side'),
  };
  await store.saveSettings(s);
  toast('Profilo salvato');
}

/* ---------- azioni ---------- */
const actions = {
  week(el) {
    ui.week = E.addDays(ui.week, Number(el.dataset.d));
    render();
  },
  async generate() {
    const m = S().menus[ui.week];
    if (m?.status === 'confermato' && !confirm('Il menu è già confermato. Rigenero i piatti non bloccati?')) return;
    await saveAndRender(E.generateMenu(S(), ui.week, m));
    toast('Ecco la proposta');
  },
  async confirm() {
    const m = menuCopy();
    m.status = 'confermato';
    await saveAndRender(m);
    toast('Menu confermato: ne terrò conto');
  },
  async replace(el) {
    const k = el.dataset.k;
    const m = menuCopy();
    const s = m.slots[k] || {};
    if (s.dish && s.vote !== 'like' && !s.locked) await store.addEvent({ dish: s.dish, type: 'reject' });
    E.replaceSlot(S(), m, k);
    await saveAndRender(m, [k]);
  },
  async side(el) {
    const m = menuCopy();
    E.replaceSide(S(), m, el.dataset.k);
    await saveAndRender(m, []);
  },
  async lock(el) {
    const m = menuCopy();
    const s = m.slots[el.dataset.k];
    s.locked = !s.locked;
    await saveAndRender(m, []);
  },
  async skip(el) {
    const k = el.dataset.k;
    const m = menuCopy();
    if (m.slots[k]?.skip) E.replaceSlot(S(), m, k);
    else m.slots[k] = { skip: true };
    await saveAndRender(m, [k]);
  },
  async vote(el) {
    const { k, v } = el.dataset;
    const m = menuCopy();
    const s = m.slots[k];
    s.vote = s.vote === v ? null : v;
    await store.setEventByRef(`${m.week}|${k}|${s.dish}|vote`, s.vote ? { dish: s.dish, type: s.vote } : null);
    await saveAndRender(m, []);
  },
  async rate(el) {
    const { k } = el.dataset;
    const n = Number(el.dataset.v);
    const m = menuCopy();
    const s = m.slots[k];
    s.rating = s.rating === n ? 0 : n;
    await store.setEventByRef(`${m.week}|${k}|${s.dish}|rating`, s.rating ? { dish: s.dish, type: 'rating', value: n } : null);
    await saveAndRender(m, []);
    if (s.rating) toast('Grazie, me lo segno');
  },
  pick(el) {
    openPicker(el.dataset.k);
  },
  async 'pick-dish'(el) {
    const { k, id } = el.dataset;
    const m = menuCopy();
    m.slots[k] = { dish: id, locked: true, why: 'scelto da voi' };
    if (dish(id)?.category === 'secondo' && S().settings.sideWithSecondo) E.replaceSide(S(), m, k);
    await store.setEventByRef(`${m.week}|${k}|${id}|pick`, { dish: id, type: 'pick' });
    modal.close();
    await saveAndRender(m, [k]);
  },
  'close-modal'() {
    modal.close();
    if (currentView() === 'piatti') renderDishList();
  },
  ideas() {
    openIdeas();
  },
  async 'add-idea'(el) {
    const d = ui.ideas[Number(el.dataset.i)];
    if (!d) return;
    await store.upsertDish(d);
    el.outerHTML = '<button class="btn" disabled>Aggiunto ✓</button>';
    toast(`"${d.name}" aggiunto ai piatti`);
  },
  'edit-dish'(el) {
    openDishForm(el.dataset.id);
  },
  async 'delete-dish'() {
    const id = document.getElementById('dish-form').dataset.id;
    if (!confirm(`Eliminare "${dish(id)?.name}" dal ricettario?`)) return;
    await store.deleteDish(id);
    modal.close();
    render();
  },
  cat(el) {
    ui.cat = el.dataset.c;
    renderPiatti();
  },
  async 'uncheck-all'() {
    const m = menuCopy();
    m.checked = {};
    await saveAndRender(m, []);
  },
  async 'remove-extra'(el) {
    const m = menuCopy();
    m.extra = (m.extra || []).filter(x => x !== el.dataset.name);
    delete m.checked?.[el.dataset.name];
    await saveAndRender(m, []);
  },
  async 'share-list'() {
    const m = S().menus[ui.week];
    const items = [...E.shoppingList(S(), m).map(i => i.name), ...(m.extra || [])].filter(n => !m.checked?.[n]);
    const text = `Spesa ${fmtRange(ui.week)}\n` + items.map(i => `• ${i}`).join('\n');
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        toast('Lista copiata');
      }
    } catch {
      /* condivisione annullata */
    }
  },
  async 'reset-learning'() {
    if (!confirm('Cancello tutti i voti e le scelte registrate? I piatti e i menu restano.')) return;
    await store.resetLearning();
    render();
  },
  export() {
    const blob = new Blob([JSON.stringify(S(), null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `menu-di-casa-${today()}.json` });
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !actions[el.dataset.act]) return;
  e.preventDefault();
  actions[el.dataset.act](el, e);
});

modal.addEventListener('click', e => {
  if (e.target === modal) modal.close();
});

document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset.filter === 'dishes') {
    ui.q = el.value;
    renderDishList();
  } else if (el.dataset.filter === 'pick') {
    const q = E.norm(el.value);
    modal.querySelectorAll('.pick-list li').forEach(li => (li.hidden = q && !li.dataset.name.includes(q)));
  } else if (el.name === 'novelty') {
    el.closest('label').querySelector('output').textContent = `${Math.round(el.value * 100)}%`;
  }
});

document.addEventListener('change', async e => {
  const el = e.target;
  if (el.form?.id === 'settings-form') return saveSettingsForm(el.form);
  if (el.dataset.shop !== undefined) {
    const m = menuCopy();
    m.checked = { ...(m.checked || {}), [el.dataset.shop]: el.checked };
    await saveAndRender(m, []);
  }
});

document.addEventListener('submit', async e => {
  const f = e.target;
  e.preventDefault();
  if (f.id === 'dish-form') {
    const fd = new FormData(f);
    const d = {
      ...(f.dataset.id ? dish(f.dataset.id) : {}),
      id: f.dataset.id || 'u-' + uid(),
      name: fd.get('name').trim(),
      category: fd.get('category'),
      protein: fd.get('protein'),
      time: Math.max(1, Number(fd.get('time')) || 30),
      meals: fd.getAll('meals'),
      seasons: fd.getAll('seasons'),
      ingredients: splitList(fd.get('ingredients')),
      tags: splitList(fd.get('tags')).map(E.norm),
      notes: fd.get('notes').trim(),
    };
    if (!d.meals.length) d.meals = ['pranzo', 'cena'];
    await store.upsertDish(d);
    modal.close();
    toast('Piatto salvato');
    render();
  } else if (f.id === 'ai-form') {
    const request = new FormData(f).get('request').trim() || 'Proponi il menu completo della settimana';
    ui.aiBusy = true;
    ui.aiMsg = '';
    render();
    try {
      const m = S().menus[ui.week] ?? E.emptyMenu(ui.week);
      const res = await AI.askMenu(S(), m, request);
      ui.aiBusy = false;
      const n = await applyAiChanges(res);
      ui.aiMsg = res.message || (n ? `Ho cambiato ${n} pasti.` : 'Non ho cambiato nulla.');
      // Ricordo le richieste: possono contenere gusti che valgono anche per le prossime settimane.
      const s = S().settings;
      await store.saveSettings({ ...s, aiHistory: [...(s.aiHistory || []), { at: today(), text: request.slice(0, 300) }].slice(-15) });
    } catch (err) {
      ui.aiMsg = 'Errore: ' + err.message;
    }
    ui.aiBusy = false;
    render();
  } else if (f.id === 'ideas-form') {
    const request = new FormData(f).get('request').trim();
    const box = document.getElementById('ideas-list');
    const btn = f.querySelector('button[type=submit]');
    btn.disabled = true;
    box.innerHTML = '<p class="hint">Ci penso un attimo…</p>';
    try {
      const res = await AI.askIdeas(S(), request);
      ui.ideas = res.dishes;
      box.innerHTML = (res.message ? `<p class="hint">${esc(res.message)}</p>` : '') + ui.ideas.map(ideaCard).join('');
    } catch (err) {
      box.innerHTML = `<p class="error">Errore: ${esc(err.message)}</p>`;
    }
    btn.disabled = false;
  } else if (f.id === 'extra-form') {
    const item = new FormData(f).get('item').trim();
    if (!item) return;
    const m = menuCopy();
    m.extra = [...new Set([...(m.extra || []), item])];
    await saveAndRender(m, []);
  }
});

/* ---------- installazione sul telefono (come GE WoodArt) ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(err => console.warn('Service worker non registrato:', err));
  });
  // Quando arriva una versione nuova dell'app ricarico la pagina una volta
  const hadController = Boolean(navigator.serviceWorker.controller);
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    location.reload();
  });
}

/* ---------- avvio ---------- */
(async () => {
  view.innerHTML = '<p class="loading">Caricamento…</p>';
  await store.init();
  if (store.initError) toast('Supabase non raggiungibile: uso i dati di questo dispositivo');
  render();
})();
