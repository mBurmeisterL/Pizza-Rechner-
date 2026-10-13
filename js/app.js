'use strict';

/* =========================================================================
   Pizza-Rechner
   - Rezepte verwalten (localStorage)
   - Rezept auf beliebig viele Pizzen / Teiglingsgewicht umrechnen
   - Zeitplan rückwärts ab Essenszeit, berücksichtigt Schul-/Arbeitszeiten
   - Export als Kalender (.ics mit Alarmen) oder als Apple-Erinnerungen (Kurzbefehl)
   ========================================================================= */

const STORAGE_KEY = 'pizzaRechner.v1';
const SHORTCUT_NAME = 'Pizza Erinnerungen';
const FLEX_STEP_MIN = 15;     // Raster, in dem flexible Ruhezeiten verlängert werden
const PRESENCE_MIN = 5;       // so lange musst du bei passiven Schritten "da sein" (z. B. Teig in den Kühlschrank)
const MAX_PLAN_EVALS = 40000;  // Obergrenze für die Suche nach dem besten Zeitplan
// Früher mitgelieferte Beispielrezepte, die aus bestehenden Daten einmalig entfernt werden
const OLD_EXAMPLE_RECIPES = ['Neapolitanische Pizza (24 h kalte Gare)', 'Schnelle Pizza (am selben Tag)'];
const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------------------------------------------------------------- Daten */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultData() {
  return {
    examplesRemoved: true,
    recipes: [],
    busy: [
      { id: uid(), label: 'Schlafen', days: [0, 1, 2, 3, 4, 5, 6], from: '23:00', to: '07:00' }
    ],
    settings: { alarmMinutes: 0 },
    view: {} // pro Rezept: zuletzt gewählte Anzahl / Teiglingsgewicht / Essenszeit
  };
}

let data = load();
save();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeData(parsed);
    }
  } catch (e) {
    console.warn('Konnte gespeicherte Daten nicht lesen', e);
  }
  return defaultData();
}

function normalizeData(d) {
  const base = defaultData();
  let recipes = Array.isArray(d.recipes) ? d.recipes : base.recipes;
  if (!d.examplesRemoved) recipes = recipes.filter(r => !OLD_EXAMPLE_RECIPES.includes(r.name));
  return {
    examplesRemoved: true,
    recipes,
    busy: Array.isArray(d.busy) ? d.busy : base.busy,
    settings: Object.assign({}, base.settings, d.settings || {}),
    view: d.view && typeof d.view === 'object' ? d.view : {}
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    toast('Speichern nicht möglich (privater Modus?)');
  }
}

function getRecipe(id) {
  return data.recipes.find(r => r.id === id);
}

/* ---------------------------------------------------------------- Helfer */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function isWeightUnit(unit) {
  return ['g', 'ml'].includes(String(unit || '').trim().toLowerCase());
}

function fmtAmount(n) {
  if (!isFinite(n)) return '–';
  let digits = 0;
  if (n < 1) digits = 2;
  else if (n < 10) digits = 1;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function fmtDuration(min) {
  min = Math.round(min);
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts = [];
  if (d) parts.push(d + ' T');
  if (h) parts.push(h + ' h');
  if (m || !parts.length) parts.push(m + ' min');
  return parts.join(' ');
}

function fmtTime(date) {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(date) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(date) - today) / 86400000);
  const label = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : null;
  const dateStr = date.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
  return label ? `${label}, ${dateStr}` : dateStr;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addMin(date, min) {
  return new Date(date.getTime() + min * 60000);
}

function toLocalInputValue(date) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function parseHM(str) {
  const [h, m] = String(str || '0:0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function totalMinutes(recipe) {
  return recipe.steps.reduce((s, st) => s + (Number(st.minutes) || 0), 0);
}

/* ------------------------------------------------- Umrechnung (Mengen) */

function baseDoughWeight(recipe) {
  return recipe.ingredients
    .filter(i => isWeightUnit(i.unit))
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);
}

function baseBallWeight(recipe) {
  const total = baseDoughWeight(recipe);
  return total > 0 ? total / (Number(recipe.basePizzas) || 1) : 0;
}

function scaleFactor(recipe, count, ballWeight) {
  const base = Number(recipe.basePizzas) || 1;
  const total = baseDoughWeight(recipe);
  if (ballWeight && total > 0) return (count * ballWeight) / total;
  return count / base;
}

/* -------------------------------------------- Belegte Zeiten (Schule/Arbeit) */

// Liefert alle konkreten belegten Intervalle zwischen from und to
function busyIntervals(from, to) {
  const out = [];
  const day = startOfDay(addMin(from, -1440));
  const end = addMin(to, 1440);
  for (let d = new Date(day); d <= end; d.setDate(d.getDate() + 1)) {
    for (const b of data.busy) {
      if (!b.days || !b.days.includes(d.getDay())) continue;
      const s = parseHM(b.from);
      let e = parseHM(b.to);
      if (e <= s) e += 1440; // über Mitternacht
      const start = addMin(startOfDay(d), s);
      const stop = addMin(startOfDay(d), e);
      if (stop > from && start < to) out.push({ start, end: stop, label: b.label });
    }
  }
  return out;
}

function conflictsFor(start, end) {
  return busyIntervals(start, end).filter(b => b.start < end && b.end > start);
}

/* ------------------------------------------------------- Zeitplanung */

// Zeitraum, in dem du bei einem Schritt anwesend sein musst
function presence(step, start, end) {
  return step.active ? [start, end] : [start, addMin(start, PRESENCE_MIN)];
}

/**
 * Plant rückwärts ab der Essenszeit. Passive Schritte (Ruhezeiten) mit Spielraum
 * werden so verlängert, dass möglichst wenige Schritte in belegte Zeiten
 * (Schule, Arbeit, Schlaf …) fallen. Bei Gleichstand gewinnt die Variante,
 * bei der insgesamt am wenigsten verlängert wird.
 */
function planSchedule(recipe, eatAt) {
  const steps = recipe.steps.map(s => ({
    name: s.name,
    note: s.note || '',
    active: !!s.active,
    minutes: Math.max(0, Number(s.minutes) || 0),
    maxMinutes: Math.max(Number(s.minutes) || 0, Number(s.maxMinutes) || 0)
  }));
  const candidates = steps.map(s => {
    if (s.active || s.maxMinutes <= s.minutes) return [s.minutes];
    const list = [];
    for (let d = s.minutes; d < s.maxMinutes; d += FLEX_STEP_MIN) list.push(d);
    list.push(s.maxMinutes);
    return list;
  });

  const durs = steps.map(s => s.minutes);
  let best = null;
  let evals = 0;

  // Tiefensuche von hinten nach vorne; der erste Pfad ist immer "alles Minimum"
  (function search(i, T, conflicts, ext) {
    if (best && (conflicts > best.conflicts || (conflicts === best.conflicts && ext >= best.ext))) return;
    if (i < 0) {
      best = { conflicts, ext, durs: durs.slice() };
      return;
    }
    const s = steps[i];
    for (const d of candidates[i]) {
      if (++evals > MAX_PLAN_EVALS && best) return;
      const start = addMin(T, -d);
      const [a, b] = presence(s, start, T);
      durs[i] = d;
      search(i - 1, start, conflicts + (conflictsFor(a, b).length ? 1 : 0), ext + d - s.minutes);
      if (best && best.conflicts === 0 && best.ext === 0) return;
    }
  })(steps.length - 1, new Date(eatAt), 0, 0);

  const result = [];
  let T = new Date(eatAt);
  for (let i = steps.length - 1; i >= 0; i--) {
    const dur = best ? best.durs[i] : steps[i].minutes;
    const start = addMin(T, -dur);
    const r = Object.assign({}, steps[i], { start, end: new Date(T), duration: dur, extendedBy: dur - steps[i].minutes });
    const [a, b] = presence(r, start, T);
    r.conflicts = conflictsFor(a, b);
    result.unshift(r);
    T = start;
  }
  return result;
}

function defaultEatTime(recipe) {
  const minReady = addMin(new Date(), totalMinutes(recipe) + 30);
  const d = startOfDay(minReady);
  d.setHours(19, 0, 0, 0);
  while (d < minReady) d.setDate(d.getDate() + 1);
  return d;
}

/* ------------------------------------------------- Export: Kalender (.ics) */

function icsEscape(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsDate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

function icsUtc(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function icsFold(line) {
  // Zeilen > 75 Zeichen umbrechen (RFC 5545)
  const out = [];
  while (line.length > 74) {
    out.push(line.slice(0, 74));
    line = ' ' + line.slice(74);
  }
  out.push(line);
  return out.join('\r\n');
}

function buildIcs(recipe, plan, count, alarmMinutes) {
  const now = icsUtc(new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pizza-Rechner//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ];
  plan.forEach((st, idx) => {
    // Passive Schritte nur als kurzer Termin am Anfang (z. B. "Teig in den Kühlschrank"),
    // damit der Kalender nicht mit tagelangen Blöcken zugestellt wird.
    const end = st.active ? st.end : addMin(st.start, Math.min(st.duration, 15) || 5);
    const desc = [
      `${recipe.name} – ${count} Pizza${count === 1 ? '' : 's'}`,
      `Schritt ${idx + 1}/${plan.length}, Dauer: ${fmtDuration(st.duration)}`,
      `Nächster Schritt um ${fmtTime(st.end)} (${fmtDay(st.end)})`,
      st.note
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid()}-${idx}@pizza-rechner`,
      `DTSTAMP:${now}`,
      `DTSTART:${icsDate(st.start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape('🍕 ' + st.name)}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${icsEscape('🍕 ' + st.name)}`,
      `TRIGGER:-PT${Math.max(0, alarmMinutes)}M`,
      'END:VALARM',
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c]))
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pizza';
}

/* ------------------------------------ Export: Apple-Erinnerungen (Kurzbefehl) */

function shortcutPayload(plan, alarmMinutes) {
  const p = n => String(n).padStart(2, '0');
  return plan
    .filter(st => st.start > new Date())
    .map(st => {
      const d = addMin(st.start, -alarmMinutes);
      const when = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
      return `🍕 ${st.name.replace(/[|\n]/g, ' ')}|${when}`;
    })
    .join('\n');
}

function shortcutUrl(text) {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(text)}`;
}

/* ================================================================ Views */

const app = $('#app');

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  window.scrollTo(0, 0);
  if (page === 'rezept' && getRecipe(id)) return renderRecipe(getRecipe(id));
  if (page === 'neu') return renderEditor(null);
  if (page === 'bearbeiten' && getRecipe(id)) return renderEditor(getRecipe(id));
  if (page === 'einstellungen') return renderSettings();
  renderHome();
}

window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------- Startseite */

function renderHome() {
  document.title = 'Pizza-Rechner';
  const cards = data.recipes.map(r => {
    const ball = baseBallWeight(r);
    return `
      <a class="recipe-card" href="#/rezept/${esc(r.id)}">
        <h2>${esc(r.name)}</h2>
        ${r.description ? `<p class="muted small">${esc(r.description)}</p>` : ''}
        <div class="chips">
          <span class="chip">⏱ ${fmtDuration(totalMinutes(r))}</span>
          <span class="chip">🍕 Basis: ${esc(r.basePizzas)} Pizza${r.basePizzas == 1 ? '' : 's'}</span>
          ${ball ? `<span class="chip">⚖️ ${fmtAmount(ball)} g / Teigling</span>` : ''}
          <span class="chip">📋 ${r.steps.length} Schritte</span>
        </div>
      </a>`;
  }).join('');

  app.innerHTML = `
    <div class="row between">
      <h1>Meine Rezepte</h1>
      <a class="btn primary" href="#/neu">＋ Neues Rezept</a>
    </div>
    ${data.recipes.length ? `<div class="recipe-list">${cards}</div>` : `
      <div class="card empty">
        <div class="big">🍕</div>
        <p>Noch keine Rezepte. Leg dein erstes Teigrezept an!</p>
        <a class="btn primary" href="#/neu">＋ Neues Rezept</a>
      </div>`}
    <p class="muted small">Tipp: In Safari über <b>Teilen → Zum Home-Bildschirm</b> wird der Pizza-Rechner zur App auf deinem iPhone.</p>
  `;
}

/* ---------------------------------------------------------------- Rezept */

function renderRecipe(recipe) {
  document.title = recipe.name + ' – Pizza-Rechner';
  const v = data.view[recipe.id] || {};
  const state = {
    count: v.count || Number(recipe.basePizzas) || 1,
    ballWeight: v.ballWeight || null,
    eatAt: v.eatAt && new Date(v.eatAt) > new Date() ? new Date(v.eatAt) : defaultEatTime(recipe)
  };
  const baseBall = baseBallWeight(recipe);

  app.innerHTML = `
    <a class="back" href="#/">‹ Alle Rezepte</a>
    <h1>${esc(recipe.name)}</h1>
    ${recipe.description ? `<p class="muted">${esc(recipe.description)}</p>` : ''}
    <div class="btn-row" style="margin:0 0 16px">
      <a class="btn small" href="#/bearbeiten/${esc(recipe.id)}">✏️ Bearbeiten</a>
      <button class="btn small" id="dup">📄 Duplizieren</button>
      <button class="btn small danger" id="del">🗑 Löschen</button>
    </div>

    <section class="card">
      <h2>Wie viele Pizzen?</h2>
      <div class="stepper">
        <button class="btn icon" id="minus" aria-label="Weniger">−</button>
        <input type="number" id="count" min="1" max="200" inputmode="numeric" value="${state.count}" aria-label="Anzahl Pizzen">
        <button class="btn icon" id="plus" aria-label="Mehr">＋</button>
      </div>
      ${baseBall ? `
        <div class="field" style="margin-top:14px">
          <label for="ball">Gewicht pro Teigling (g)</label>
          <div class="row">
            <input type="number" id="ball" class="grow" min="50" max="1000" step="5" inputmode="numeric"
              value="${Math.round(state.ballWeight || baseBall)}" style="max-width:140px">
            <button class="btn small" id="ballReset" title="Auf Rezept-Wert zurücksetzen">↺ ${fmtAmount(baseBall)} g</button>
          </div>
          <p class="muted small" style="margin-top:4px">Neapolitanisch ca. 250–280 g, große Blechpizza eher 350–450 g.</p>
        </div>` : ''}
      <h3>Zutaten</h3>
      <table><tbody id="ingBody"></tbody><tfoot id="ingFoot"></tfoot></table>
    </section>

    <section class="card">
      <h2>Zeitplan</h2>
      <div class="field">
        <label for="eatAt">Wann wollt ihr essen?</label>
        <input type="datetime-local" id="eatAt" value="${toLocalInputValue(state.eatAt)}">
      </div>
      <div id="planNotice"></div>
      <ol class="timeline" id="timeline"></ol>

      <h3>Erinnerungen</h3>
      <div class="field">
        <label for="alarm">Erinnern …</label>
        <select id="alarm">
          ${[0, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${data.settings.alarmMinutes == m ? 'selected' : ''}>${m === 0 ? 'zum Zeitpunkt des Schritts' : m + ' Minuten vorher'}</option>`).join('')}
        </select>
      </div>
      <div class="btn-row">
        <button class="btn primary" id="ics">📅 In Apple Kalender übernehmen</button>
        <button class="btn" id="reminders">⏰ In Apple Erinnerungen</button>
      </div>
      <p class="muted small" style="margin-top:8px">
        <b>Kalender:</b> lädt eine .ics-Datei – auf dem iPhone „Alle hinzufügen“ tippen, jeder Schritt bekommt einen Alarm.<br>
        <b>Erinnerungen:</b> braucht einmalig den Kurzbefehl „${SHORTCUT_NAME}“ – <a href="#/einstellungen">Anleitung</a>.
      </p>
    </section>
  `;

  const countEl = $('#count');
  const ballEl = $('#ball');

  function persist() {
    data.view[recipe.id] = {
      count: state.count,
      ballWeight: state.ballWeight,
      eatAt: state.eatAt.toISOString()
    };
    save();
  }

  function renderIngredients() {
    const f = scaleFactor(recipe, state.count, state.ballWeight);
    $('#ingBody').innerHTML = recipe.ingredients.map(i => `
      <tr><td>${esc(i.name)}</td><td class="num">${fmtAmount((Number(i.amount) || 0) * f)} ${esc(i.unit)}</td></tr>
    `).join('') || '<tr><td class="muted">Keine Zutaten eingetragen.</td></tr>';
    const total = baseDoughWeight(recipe) * f;
    $('#ingFoot').innerHTML = total ? `
      <tr><td>Teig gesamt</td><td class="num">${fmtAmount(total)} g</td></tr>
      <tr><td>pro Pizza</td><td class="num">${fmtAmount(total / state.count)} g</td></tr>` : '';
  }

  let currentPlan = [];

  function renderPlan() {
    const plan = planSchedule(recipe, state.eatAt);
    currentPlan = plan;
    const now = new Date();
    const notices = [];

    if (plan.length && plan[0].start < now) {
      const earliest = addMin(now, totalMinutes(recipe));
      notices.push(`<div class="notice warn">⚠️ Der erste Schritt läge in der Vergangenheit (${fmtDay(plan[0].start)}, ${fmtTime(plan[0].start)}).
        Frühestens möglich: <b>${fmtDay(earliest)}, ${fmtTime(earliest)}</b>.
        <button class="btn small" id="setEarliest" style="margin-top:6px">Frühesten Termin übernehmen</button></div>`);
    }
    const conflicted = plan.filter(p => p.conflicts.length);
    if (conflicted.length) {
      notices.push(`<div class="notice warn">⚠️ ${conflicted.length === 1 ? 'Ein Schritt fällt' : conflicted.length + ' Schritte fallen'} in deine belegten Zeiten.
        Verschiebe die Essenszeit, gib Ruhezeiten mehr Spielraum oder passe deine <a href="#/einstellungen">Zeiten</a> an.</div>`);
    } else if (plan.length && data.busy.length) {
      notices.push(`<div class="notice ok">✅ Alle Schritte passen zu deinen Schul-/Arbeitszeiten.</div>`);
    }
    $('#planNotice').innerHTML = notices.join('');
    const se = $('#setEarliest');
    if (se) se.addEventListener('click', () => {
      const d = addMin(new Date(), totalMinutes(recipe) + 5);
      d.setSeconds(0, 0);
      d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
      state.eatAt = d;
      $('#eatAt').value = toLocalInputValue(d);
      persist();
      renderPlan();
    });

    const items = plan.map((st, idx) => {
      const isNow = st.start <= now && now < st.end;
      const isDone = st.end <= now;
      const badges = [];
      badges.push(st.active ? '<span class="badge info">👐 Arbeit</span>' : '<span class="badge info">💤 Ruhezeit</span>');
      if (st.extendedBy > 0) badges.push(`<span class="badge ok">↔ +${fmtDuration(st.extendedBy)} verlängert, damit es in deinen Tag passt</span>`);
      for (const c of st.conflicts) badges.push(`<span class="badge warn">⚠️ Kollision: ${esc(c.label)} (${fmtTime(c.start)}–${fmtTime(c.end)})</span>`);
      if (isNow) badges.push('<span class="badge ok">● läuft gerade</span>');
      return `
        <li class="${st.active ? '' : 'passive'} ${isDone ? 'done' : ''} ${isNow ? 'now' : ''}">
          <div class="when">${fmtDay(st.start)} · ${fmtTime(st.start)}</div>
          <div class="what">${idx + 1}. ${esc(st.name)}</div>
          <div class="meta">Dauer ${fmtDuration(st.duration)} · bis ${fmtTime(st.end)}${st.note ? ' · ' + esc(st.note) : ''}</div>
          <div>${badges.join('')}</div>
        </li>`;
    });
    items.push(`
      <li class="final">
        <div class="when">${fmtDay(state.eatAt)} · ${fmtTime(state.eatAt)}</div>
        <div class="what">🍕 Guten Appetit!</div>
      </li>`);
    $('#timeline').innerHTML = items.join('');
  }

  function setCount(n) {
    n = Math.max(1, Math.min(200, Math.round(Number(n) || 1)));
    state.count = n;
    countEl.value = n;
    renderIngredients();
    persist();
  }

  $('#minus').addEventListener('click', () => setCount(state.count - 1));
  $('#plus').addEventListener('click', () => setCount(state.count + 1));
  countEl.addEventListener('input', () => {
    if (countEl.value === '') return;
    state.count = Math.max(1, Math.min(200, Math.round(Number(countEl.value) || 1)));
    renderIngredients();
    persist();
  });
  countEl.addEventListener('blur', () => setCount(countEl.value));

  if (ballEl) {
    ballEl.addEventListener('input', () => {
      const w = Number(ballEl.value);
      state.ballWeight = w > 0 && Math.abs(w - baseBall) > 0.5 ? w : null;
      renderIngredients();
      persist();
    });
    $('#ballReset').addEventListener('click', () => {
      state.ballWeight = null;
      ballEl.value = Math.round(baseBall);
      renderIngredients();
      persist();
    });
  }

  $('#eatAt').addEventListener('change', e => {
    const d = new Date(e.target.value);
    if (!isNaN(d)) {
      state.eatAt = d;
      persist();
      renderPlan();
    }
  });

  $('#alarm').addEventListener('change', e => {
    data.settings.alarmMinutes = Number(e.target.value);
    save();
  });

  $('#ics').addEventListener('click', () => {
    const upcoming = currentPlan.filter(st => st.start > new Date());
    if (!upcoming.length) return toast('Alle Schritte liegen in der Vergangenheit.');
    const ics = buildIcs(recipe, upcoming, state.count, data.settings.alarmMinutes);
    downloadFile(`pizza-${slug(recipe.name)}.ics`, ics, 'text/calendar;charset=utf-8');
    toast('Kalenderdatei erstellt 📅');
  });

  $('#reminders').addEventListener('click', () => {
    const text = shortcutPayload(currentPlan, data.settings.alarmMinutes);
    if (!text) return toast('Alle Schritte liegen in der Vergangenheit.');
    const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
    if (!isApple) toast('Funktioniert nur auf iPhone, iPad oder Mac.');
    location.href = shortcutUrl(text);
  });

  $('#del').addEventListener('click', () => {
    if (!confirm(`Rezept „${recipe.name}“ wirklich löschen?`)) return;
    data.recipes = data.recipes.filter(r => r.id !== recipe.id);
    delete data.view[recipe.id];
    save();
    toast('Rezept gelöscht');
    location.hash = '#/';
  });

  $('#dup').addEventListener('click', () => {
    const copy = JSON.parse(JSON.stringify(recipe));
    copy.id = uid();
    copy.name = recipe.name + ' (Kopie)';
    data.recipes.push(copy);
    save();
    location.hash = '#/bearbeiten/' + copy.id;
  });

  renderIngredients();
  renderPlan();
}

/* ---------------------------------------------------------------- Editor */

function renderEditor(recipe) {
  const isNew = !recipe;
  const r = recipe ? JSON.parse(JSON.stringify(recipe)) : {
    id: uid(),
    name: '',
    description: '',
    basePizzas: 4,
    ingredients: [
      { name: 'Mehl', amount: '', unit: 'g' },
      { name: 'Wasser', amount: '', unit: 'g' },
      { name: 'Salz', amount: '', unit: 'g' },
      { name: 'Hefe', amount: '', unit: 'g' }
    ],
    steps: [
      { name: 'Teig kneten', minutes: 15, active: true, maxMinutes: 15, note: '' },
      { name: 'Teig gehen lassen', minutes: 120, active: false, maxMinutes: 120, note: '' },
      { name: 'Pizzen formen & backen', minutes: 30, active: true, maxMinutes: 30, note: '' }
    ]
  };
  document.title = (isNew ? 'Neues Rezept' : 'Rezept bearbeiten') + ' – Pizza-Rechner';

  app.innerHTML = `
    <a class="back" href="${isNew ? '#/' : '#/rezept/' + esc(r.id)}">‹ Zurück</a>
    <h1>${isNew ? 'Neues Rezept' : 'Rezept bearbeiten'}</h1>
    <form id="form" novalidate>
      <section class="card">
        <div class="field">
          <label for="name">Name</label>
          <input id="name" required placeholder="z. B. Pizza Napoletana 48 h" value="${esc(r.name)}">
        </div>
        <div class="field">
          <label for="desc">Beschreibung (optional)</label>
          <textarea id="desc" placeholder="Mehlsorte, Hydration, Besonderheiten …">${esc(r.description)}</textarea>
        </div>
        <div class="field" style="margin:0">
          <label for="base">Das Rezept ergibt … Pizzen</label>
          <input id="base" type="number" min="1" inputmode="numeric" value="${esc(r.basePizzas)}" style="max-width:120px">
        </div>
      </section>

      <section class="card">
        <h2>Zutaten</h2>
        <p class="muted small">Mengen für die oben angegebene Anzahl Pizzen. Zutaten in g oder ml zählen zum Teiggewicht.</p>
        <div id="ings"></div>
        <button type="button" class="btn small" id="addIng">＋ Zutat</button>
      </section>

      <section class="card">
        <h2>Arbeitsschritte</h2>
        <p class="muted small">In Reihenfolge. <b>Arbeit</b> = du musst dabei sein. <b>Ruhezeit</b> = der Teig arbeitet allein.
          Bei Ruhezeiten kannst du eine <b>maximale Dauer</b> angeben – dann verschiebt der Zeitplan die Arbeitsschritte automatisch aus deinen Schul-/Arbeitszeiten heraus.</p>
        <div id="steps"></div>
        <button type="button" class="btn small" id="addStep">＋ Schritt</button>
      </section>

      <div class="btn-row">
        <button type="submit" class="btn primary">💾 Speichern</button>
        <a class="btn" href="${isNew ? '#/' : '#/rezept/' + esc(r.id)}">Abbrechen</a>
      </div>
    </form>
  `;

  const units = ['g', 'ml', 'TL', 'EL', 'Stk', 'Prise'];

  function ingRow(i) {
    const unitOptions = units.includes(i.unit) ? units : [i.unit, ...units];
    return `
      <div class="edit-row ing-row">
        <input class="ing-name" placeholder="Zutat" value="${esc(i.name)}" aria-label="Zutat">
        <input class="ing-amount" type="number" step="any" min="0" inputmode="decimal" placeholder="Menge" value="${esc(i.amount)}" aria-label="Menge">
        <select class="ing-unit" aria-label="Einheit">${unitOptions.map(u => `<option ${u === i.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        <button type="button" class="btn icon danger remove" aria-label="Zutat entfernen">×</button>
      </div>`;
  }

  function stepRow(s) {
    const h = Math.floor((s.minutes || 0) / 60), m = (s.minutes || 0) % 60;
    const max = Math.max(s.maxMinutes || 0, s.minutes || 0);
    const mh = Math.floor(max / 60), mm = max % 60;
    return `
      <div class="edit-row step-row">
        <div class="line">
          <input class="st-name" placeholder="Schritt, z. B. Stockgare" value="${esc(s.name)}" aria-label="Schritt">
          <button type="button" class="btn icon danger remove" aria-label="Schritt entfernen">×</button>
        </div>
        <div class="row">
          <select class="st-type grow" aria-label="Art" style="width:auto">
            <option value="active" ${s.active ? 'selected' : ''}>👐 Arbeit</option>
            <option value="passive" ${!s.active ? 'selected' : ''}>💤 Ruhezeit</option>
          </select>
          <button type="button" class="btn small up" aria-label="Nach oben">↑</button>
          <button type="button" class="btn small down" aria-label="Nach unten">↓</button>
        </div>
        <div>
          <p class="inline-label">Dauer (bei Ruhezeiten: mindestens)</p>
          <div class="dur">
            <label class="unit"><input class="st-h" type="number" min="0" inputmode="numeric" value="${h}" aria-label="Stunden" placeholder="Std."><span>Std.</span></label>
            <label class="unit"><input class="st-m" type="number" min="0" max="59" inputmode="numeric" value="${m}" aria-label="Minuten" placeholder="Min."><span>Min.</span></label>
          </div>
        </div>
        <div class="flexbox" ${s.active ? 'hidden' : ''}>
          <p class="inline-label">Darf maximal dauern (Spielraum)</p>
          <div class="flex">
            <label class="unit"><input class="st-mh" type="number" min="0" inputmode="numeric" value="${mh}" aria-label="Maximal Stunden" placeholder="Std."><span>Std.</span></label>
            <label class="unit"><input class="st-mm" type="number" min="0" max="59" inputmode="numeric" value="${mm}" aria-label="Maximal Minuten" placeholder="Min."><span>Min.</span></label>
          </div>
        </div>
        <input class="st-note" placeholder="Notiz (optional)" value="${esc(s.note)}" aria-label="Notiz">
      </div>`;
  }

  function readForm() {
    r.name = $('#name').value.trim();
    r.description = $('#desc').value.trim();
    r.basePizzas = Math.max(1, Math.round(Number($('#base').value) || 1));
    r.ingredients = $$('#ings .ing-row').map(row => ({
      name: $('.ing-name', row).value.trim(),
      amount: $('.ing-amount', row).value === '' ? '' : Number($('.ing-amount', row).value),
      unit: $('.ing-unit', row).value
    }));
    r.steps = $$('#steps .step-row').map(row => {
      const minutes = (Number($('.st-h', row).value) || 0) * 60 + (Number($('.st-m', row).value) || 0);
      const active = $('.st-type', row).value === 'active';
      const maxRaw = (Number($('.st-mh', row).value) || 0) * 60 + (Number($('.st-mm', row).value) || 0);
      return {
        name: $('.st-name', row).value.trim(),
        minutes,
        active,
        maxMinutes: active ? minutes : Math.max(minutes, maxRaw),
        note: $('.st-note', row).value.trim()
      };
    });
  }

  function draw() {
    $('#ings').innerHTML = r.ingredients.map(ingRow).join('');
    $('#steps').innerHTML = r.steps.map(stepRow).join('');
  }

  draw();

  $('#addIng').addEventListener('click', () => {
    readForm();
    r.ingredients.push({ name: '', amount: '', unit: 'g' });
    draw();
    $$('#ings .ing-name').pop().focus();
  });

  $('#addStep').addEventListener('click', () => {
    readForm();
    r.steps.push({ name: '', minutes: 30, active: false, maxMinutes: 30, note: '' });
    draw();
    $$('#steps .st-name').pop().focus();
  });

  $('#ings').addEventListener('click', e => {
    const btn = e.target.closest('.remove');
    if (!btn) return;
    readForm();
    const idx = $$('#ings .ing-row').indexOf(btn.closest('.ing-row'));
    r.ingredients.splice(idx, 1);
    draw();
  });

  $('#steps').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    readForm();
    const idx = $$('#steps .step-row').indexOf(btn.closest('.step-row'));
    if (btn.classList.contains('remove')) r.steps.splice(idx, 1);
    else if (btn.classList.contains('up') && idx > 0) [r.steps[idx - 1], r.steps[idx]] = [r.steps[idx], r.steps[idx - 1]];
    else if (btn.classList.contains('down') && idx < r.steps.length - 1) [r.steps[idx + 1], r.steps[idx]] = [r.steps[idx], r.steps[idx + 1]];
    else return;
    draw();
  });

  $('#steps').addEventListener('change', e => {
    if (!e.target.classList.contains('st-type')) return;
    const row = e.target.closest('.step-row');
    $('.flexbox', row).hidden = e.target.value === 'active';
  });

  $('#form').addEventListener('submit', e => {
    e.preventDefault();
    readForm();
    if (!r.name) {
      $('#name').focus();
      return toast('Bitte gib dem Rezept einen Namen.');
    }
    r.ingredients = r.ingredients.filter(i => i.name || i.amount !== '');
    r.ingredients.forEach(i => { i.amount = Number(i.amount) || 0; });
    r.steps = r.steps.filter(s => s.name || s.minutes);
    r.steps.forEach((s, i) => { if (!s.name) s.name = 'Schritt ' + (i + 1); });

    const idx = data.recipes.findIndex(x => x.id === r.id);
    if (idx >= 0) data.recipes[idx] = r;
    else data.recipes.push(r);
    save();
    toast('Rezept gespeichert ✅');
    location.hash = '#/rezept/' + r.id;
  });
}

/* ---------------------------------------------------------------- Einstellungen */

function renderSettings() {
  document.title = 'Einstellungen – Pizza-Rechner';

  app.innerHTML = `
    <a class="back" href="#/">‹ Zurück</a>
    <h1>Einstellungen</h1>

    <section class="card">
      <h2>🏫 Meine belegten Zeiten</h2>
      <p class="muted small">Schule, Arbeit, Training, Schlaf … In diesen Zeiten plant der Pizza-Rechner keine Arbeitsschritte ein
        und warnt dich, wenn es nicht anders geht.</p>
      <div id="busyList"></div>

      <h3>Neue Zeit hinzufügen</h3>
      <form id="busyForm" novalidate>
        <div class="field">
          <label for="bLabel">Bezeichnung</label>
          <input id="bLabel" placeholder="z. B. Schule, Arbeit" required>
        </div>
        <div class="field">
          <label>Tage</label>
          <div class="days">
            ${WEEK_ORDER.map(d => `<label><input type="checkbox" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}> ${DAY_NAMES[d]}</label>`).join('')}
          </div>
        </div>
        <div class="row">
          <div class="field grow">
            <label for="bFrom">Von</label>
            <input id="bFrom" type="time" value="08:00">
          </div>
          <div class="field grow">
            <label for="bTo">Bis</label>
            <input id="bTo" type="time" value="16:00">
          </div>
        </div>
        <button class="btn primary" type="submit">＋ Hinzufügen</button>
      </form>
    </section>

    <section class="card">
      <h2>⏰ Apple Erinnerungen einrichten</h2>
      <p class="small">Websites dürfen aus Sicherheitsgründen nicht direkt in die Erinnerungen-App schreiben.
        Mit einem kleinen <b>Kurzbefehl</b> (einmalig, ca. 2 Minuten) klappt es trotzdem:</p>
      <ol class="howto small">
        <li>Öffne die App <b>Kurzbefehle</b> und tippe auf <b>＋</b>.</li>
        <li>Nenne den Kurzbefehl genau <code>${SHORTCUT_NAME}</code>.</li>
        <li>Aktion <b>„Text teilen“</b> hinzufügen: Eingabe = <i>Kurzbefehleingabe</i>, teilen bei <b>Neue Zeilen</b>.</li>
        <li>Aktion <b>„Wiederholen mit jedem Objekt“</b> hinzufügen (in „Geteilter Text“).</li>
        <li>Darin: <b>„Text teilen“</b> mit <i>Wiederholungsobjekt</i>, Trennzeichen <b>Eigene</b> → <code>|</code></li>
        <li>Darin: <b>„Objekt aus Liste abrufen“</b> → <b>Erstes Objekt</b> (das ist der Titel).</li>
        <li>Darin: noch einmal <b>„Objekt aus Liste abrufen“</b> aus „Geteilter Text“ → <b>Letztes Objekt</b> (das ist die Uhrzeit).</li>
        <li>Darin: <b>„Erinnerung hinzufügen“</b> – als Titel das <i>erste Objekt</i>, bei <b>Erinnern</b> → „Zu einem Zeitpunkt“ das <i>letzte Objekt</i> auswählen (als Datum).</li>
        <li>Fertig! Ab jetzt öffnet der Knopf <b>„In Apple Erinnerungen“</b> beim Rezept den Kurzbefehl und legt alle Schritte als Erinnerungen an.</li>
      </ol>
      <p class="muted small">Alternativ funktioniert <b>„In Apple Kalender übernehmen“</b> ohne Einrichtung – jeder Schritt wird ein Termin mit Alarm.</p>
      <button class="btn small" id="testShortcut">Kurzbefehl testen</button>
    </section>

    <section class="card">
      <h2>💾 Sicherung</h2>
      <p class="muted small">Deine Rezepte werden nur auf diesem Gerät im Browser gespeichert. Mit einer Sicherung kannst du sie auf ein anderes Gerät übertragen.</p>
      <div class="btn-row">
        <button class="btn" id="export">⬇️ Sicherung herunterladen</button>
        <label class="btn" style="margin:0">⬆️ Sicherung laden
          <input type="file" id="import" accept="application/json,.json" hidden>
        </label>
      </div>
      <details>
        <summary>Alles zurücksetzen</summary>
        <p class="small">Löscht alle Rezepte und eingetragenen Zeiten.</p>
        <button class="btn small danger" id="reset">Zurücksetzen</button>
      </details>
    </section>
  `;

  function drawBusy() {
    const list = $('#busyList');
    if (!data.busy.length) {
      list.innerHTML = '<p class="muted small">Noch keine Zeiten eingetragen.</p>';
      return;
    }
    list.innerHTML = data.busy.map(b => {
      const days = WEEK_ORDER.filter(d => b.days.includes(d)).map(d => DAY_NAMES[d]);
      const dayStr = days.length === 7 ? 'täglich' : days.join(', ');
      const overnight = parseHM(b.to) <= parseHM(b.from) ? ' (über Nacht)' : '';
      return `
        <div class="busy-item">
          <div>
            <div><b>${esc(b.label)}</b></div>
            <div class="muted small">${dayStr} · ${esc(b.from)}–${esc(b.to)}${overnight}</div>
          </div>
          <button class="btn icon danger" data-id="${esc(b.id)}" aria-label="${esc(b.label)} löschen">×</button>
        </div>`;
    }).join('');
  }
  drawBusy();

  $('#busyList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    data.busy = data.busy.filter(b => b.id !== btn.dataset.id);
    save();
    drawBusy();
  });

  $('#busyForm').addEventListener('submit', e => {
    e.preventDefault();
    const label = $('#bLabel').value.trim();
    const days = $$('#busyForm .days input:checked').map(i => Number(i.value));
    const from = $('#bFrom').value, to = $('#bTo').value;
    if (!label) { $('#bLabel').focus(); return toast('Bitte eine Bezeichnung eingeben.'); }
    if (!days.length) return toast('Bitte mindestens einen Tag auswählen.');
    if (!from || !to || from === to) return toast('Bitte gültige Uhrzeiten eingeben.');
    data.busy.push({ id: uid(), label, days, from, to });
    save();
    drawBusy();
    $('#bLabel').value = '';
    toast('Zeit hinzugefügt');
  });

  $('#testShortcut').addEventListener('click', () => {
    const d = addMin(new Date(), 2);
    const p = n => String(n).padStart(2, '0');
    location.href = shortcutUrl(`🍕 Test vom Pizza-Rechner|${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`);
  });

  $('#export').addEventListener('click', () => {
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(`pizza-rechner-sicherung-${date}.json`, JSON.stringify(data, null, 2), 'application/json');
  });

  $('#import').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.recipes)) throw new Error('Keine Rezepte gefunden');
      if (!confirm(`Sicherung mit ${parsed.recipes.length} Rezept(en) laden? Die aktuellen Daten werden ersetzt.`)) return;
      data = normalizeData(parsed);
      save();
      toast('Sicherung geladen ✅');
      renderSettings();
    } catch (err) {
      toast('Datei konnte nicht gelesen werden.');
    }
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Wirklich alle Daten löschen?')) return;
    data = defaultData();
    save();
    toast('Zurückgesetzt');
    location.hash = '#/';
  });
}

/* ---------------------------------------------------------------- Start */

route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
