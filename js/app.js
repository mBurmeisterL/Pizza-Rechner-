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
// Fest eingebaute Rezepte: werden einmalig zu den eigenen Rezepten hinzugefügt.
// Wer eines löscht, bekommt es nicht wieder (gemerkt in data.seeded).
const BUILTIN_RECIPES = [
  {
    id: 'builtin-48h-biga',
    name: '48-Stunden-Pizzateig mit Biga',
    description: '1 kg Mehl, 75 % Hydration. Biga als Vorteig, dann Hauptteig – insgesamt rund 48 Stunden Fermentation. Teiglinge 250–300 g.',
    basePizzas: 6,
    ingredients: [
      { name: 'Mehl (Biga)', amount: 500, unit: 'g' },
      { name: 'Wasser (Biga)', amount: 250, unit: 'g' },
      { name: 'Trockenhefe (Biga)', amount: 0.3, unit: 'g' },
      { name: 'Mehl (Hauptteig)', amount: 500, unit: 'g' },
      { name: 'Wasser (Hauptteig)', amount: 500, unit: 'g' },
      { name: 'Trockenhefe (Hauptteig)', amount: 0.7, unit: 'g' },
      { name: 'Salz (Hauptteig)', amount: 30, unit: 'g' }
    ],
    steps: [
      { name: 'Biga mischen', minutes: 10, active: true, maxMinutes: 10, note: 'Mehl, Wasser und Trockenhefe kurz vermischen – nicht komplett glatt kneten.' },
      { name: 'Biga bei Raumtemperatur', minutes: 110, active: false, maxMinutes: 110, note: 'Abgedeckt stehen lassen.' },
      { name: 'Biga in den Kühlschrank', minutes: 1200, active: false, maxMinutes: 1440, note: 'Abdecken und kalt stellen (ca. 20 Stunden).' },
      { name: 'Hauptteig kneten', minutes: 15, active: true, maxMinutes: 15, note: 'Zur Biga: Mehl, Wasser, Trockenhefe und Salz. Gründlich verkneten, bis der Teig elastisch ist.' },
      { name: 'Teig ruhen lassen', minutes: 15, active: false, maxMinutes: 15, note: 'Bei Raumtemperatur.' },
      { name: 'Teiglinge formen', minutes: 15, active: true, maxMinutes: 15, note: 'Kugeln mit 250–300 g formen.' },
      { name: 'Teiglinge in den Kühlschrank', minutes: 1200, active: false, maxMinutes: 1440, note: 'Abgedeckt ca. 20 Stunden kalt fermentieren lassen.' },
      { name: 'Teiglinge akklimatisieren', minutes: 120, active: false, maxMinutes: 180, note: 'Aus dem Kühlschrank nehmen und bei Raumtemperatur stehen lassen. Ofen rechtzeitig vorheizen.' },
      { name: 'Pizza machen', minutes: 30, active: true, maxMinutes: 30, note: 'Formen, belegen, backen. 🍕' }
    ]
  }
];
const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

/* ---------------------------------------------------------------- Daten */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultData() {
  return {
    examplesRemoved: true,
    seeded: [],
    recipes: [],
    busy: [
      { id: uid(), label: 'Schlafen', days: [0, 1, 2, 3, 4, 5, 6], from: '23:00', to: '07:00' }
    ],
    settings: { alarmMinutes: 0 },
    view: {} // pro Rezept: zuletzt gewählte Anzahl / Teiglingsgewicht / Essenszeit
  };
}

let data; // wird beim Start geladen (siehe ganz unten)

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
  return normalizeData(defaultData());
}

// Prüft und repariert geladene Daten (z. B. aus einer alten oder fremden Sicherung)
function normalizeData(d) {
  const base = defaultData();
  const num = (v, fallback = 0) => (isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
  let recipes = Array.isArray(d.recipes) ? d.recipes : base.recipes;
  if (!d.examplesRemoved) recipes = recipes.filter(r => !OLD_EXAMPLE_RECIPES.includes(r && r.name));
  recipes = recipes.filter(r => r && typeof r === 'object').map(r => ({
    id: String(r.id || uid()),
    name: String(r.name || 'Rezept'),
    description: String(r.description || ''),
    basePizzas: Math.max(1, Math.round(num(r.basePizzas, 1))),
    ingredients: (Array.isArray(r.ingredients) ? r.ingredients : []).filter(Boolean).map(i => ({
      name: String(i.name || ''),
      amount: Math.max(0, num(i.amount)),
      unit: String(i.unit || 'g')
    })),
    steps: (Array.isArray(r.steps) ? r.steps : []).filter(Boolean).map(st => {
      const minutes = Math.max(0, Math.round(num(st.minutes)));
      return {
        name: String(st.name || 'Schritt'),
        minutes,
        active: !!st.active,
        maxMinutes: st.active ? minutes : Math.max(minutes, Math.round(num(st.maxMinutes))),
        note: String(st.note || '')
      };
    })
  }));
  // Eingebaute Rezepte einmalig hinzufügen
  const seeded = Array.isArray(d.seeded) ? d.seeded.map(String) : [];
  for (const b of BUILTIN_RECIPES) {
    if (seeded.includes(b.id)) continue;
    if (!recipes.some(r => r.id === b.id)) recipes.push(JSON.parse(JSON.stringify(b)));
    seeded.push(b.id);
  }
  const busy = (Array.isArray(d.busy) ? d.busy : base.busy)
    .filter(b => b && Array.isArray(b.days) && /^\d{1,2}:\d{2}$/.test(b.from) && /^\d{1,2}:\d{2}$/.test(b.to))
    .map(b => ({ id: String(b.id || uid()), label: String(b.label || 'Belegt'), days: b.days.map(Number).filter(x => x >= 0 && x <= 6), from: b.from, to: b.to }));
  return {
    examplesRemoved: true,
    seeded,
    recipes,
    busy,
    settings: Object.assign({}, base.settings, d.settings && typeof d.settings === 'object' ? d.settings : {}),
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
  if (d) parts.push(d === 1 ? '1 Tag' : d + ' Tage');
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

function pizzaWord(n) {
  return `${n} ${Number(n) === 1 ? 'Pizza' : 'Pizzen'}`;
}

// Zeitspanne bis zu einem Zeitpunkt, z. B. "in 2 h 15 min"
function fmtUntil(date) {
  const min = Math.round((date - new Date()) / 60000);
  if (min <= 0) return 'jetzt';
  return 'in ' + fmtDuration(min);
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

// Frühestmögliche Essenszeit (auf 15 min gerundet), bei der der erste Schritt nicht in der Vergangenheit liegt
function earliestEatTime(recipe) {
  const d = addMin(new Date(), totalMinutes(recipe) + 5);
  d.setSeconds(0, 0);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15);
  // Verlängerte Ruhezeiten können den Start nach vorne schieben – dann weiter nach hinten rücken
  for (let i = 0; i < 96; i++) {
    const plan = planSchedule(recipe, d);
    if (!plan.length || plan[0].start >= new Date()) break;
    d.setMinutes(d.getMinutes() + 15);
  }
  return d;
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
  // Zeilen nach max. 75 Bytes umbrechen (RFC 5545), ohne Zeichen wie 🍕 oder ä zu zerschneiden
  const enc = new TextEncoder();
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > 75) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
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
      `${recipe.name} – ${pizzaWord(count)}`,
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
  clearInterval(liveTimer);
  if (page === 'rezept' && getRecipe(id)) return renderRecipe(getRecipe(id));
  if (page === 'neu') return renderEditor(null);
  if (page === 'bearbeiten' && getRecipe(id)) return renderEditor(getRecipe(id));
  if (page === 'einstellungen') return renderSettings();
  renderHome();
}

window.addEventListener('hashchange', route);

/* ---------------------------------------------------------------- Startseite */

const PIZZA_SVG = `
  <svg class="hero-pizza" viewBox="0 0 100 100" aria-hidden="true">
    <circle cx="50" cy="50" r="48" fill="#f2c27b"/>
    <circle cx="50" cy="50" r="40" fill="#e0482f"/>
    <g fill="#fff4dc">
      <circle cx="36" cy="34" r="8"/><circle cx="62" cy="30" r="7"/><circle cx="66" cy="58" r="9"/>
      <circle cx="40" cy="64" r="8"/><circle cx="52" cy="47" r="6"/>
    </g>
    <g fill="#2f7d4f">
      <ellipse cx="48" cy="30" rx="5" ry="3" transform="rotate(-30 48 30)"/>
      <ellipse cx="30" cy="50" rx="5" ry="3" transform="rotate(40 30 50)"/>
      <ellipse cx="56" cy="70" rx="5" ry="3" transform="rotate(-10 56 70)"/>
      <ellipse cx="72" cy="42" rx="5" ry="3" transform="rotate(60 72 42)"/>
    </g>
  </svg>`;

function renderHome() {
  document.title = 'Pizza-Rechner';
  const now = new Date();
  const cards = data.recipes.map(r => {
    const ball = baseBallWeight(r);
    const v = data.view[r.id];
    const planned = v && v.eatAt && new Date(v.eatAt) > now ? new Date(v.eatAt) : null;
    return `
      <a class="recipe-card" href="#/rezept/${esc(r.id)}">
        <div class="recipe-avatar" aria-hidden="true">🍕</div>
        <div class="body">
          <h3>${esc(r.name)}</h3>
          ${r.description ? `<p class="muted small">${esc(r.description)}</p>` : ''}
          <div class="chips">
            ${planned ? `<span class="chip accent">🗓 ${esc(fmtDay(planned))}, ${fmtTime(planned)}</span>` : ''}
            <span class="chip">⏱ ${fmtDuration(totalMinutes(r))}</span>
            <span class="chip">${pizzaWord(r.basePizzas)}</span>
            ${ball ? `<span class="chip">⚖️ ${fmtAmount(ball)} g</span>` : ''}
          </div>
        </div>
        <span class="chev" aria-hidden="true">›</span>
      </a>`;
  }).join('');

  app.innerHTML = `
    <section class="hero">
      ${PIZZA_SVG}
      <h1>Pizzateig, perfekt geplant.</h1>
      <p>Rezept wählen, Anzahl Pizzen eingeben – der Rest wird ausgerechnet. Inklusive Zeitplan mit Erinnerungen.</p>
      <a class="btn" href="#/neu">＋ Neues Rezept</a>
    </section>

    ${data.recipes.length ? `
      <div class="section-title">
        <h2>Meine Rezepte</h2>
        <span class="muted small">${data.recipes.length} ${data.recipes.length === 1 ? 'Rezept' : 'Rezepte'}</span>
      </div>
      <div class="recipe-list">${cards}</div>` : `
      <div class="card empty">
        <div class="big">👩‍🍳</div>
        <h2>Noch keine Rezepte</h2>
        <p class="muted">Leg dein erstes Teigrezept an: Zutaten, Arbeitsschritte und Ruhezeiten.</p>
        <a class="btn primary" href="#/neu">＋ Erstes Rezept anlegen</a>
      </div>`}

    <div class="tip"><span aria-hidden="true">📱</span>
      <div>In Safari über <b>Teilen → Zum Home-Bildschirm</b> wird der Pizza-Rechner zur App auf deinem iPhone.
      Deine <a href="#/einstellungen">Schul- und Arbeitszeiten</a> trägst du in den Einstellungen ein.</div>
    </div>
  `;
}

/* ---------------------------------------------------------------- Rezept */

let liveTimer = null; // aktualisiert den Zeitplan jede Minute ("läuft gerade", "in 2 h")

function renderRecipe(recipe) {
  document.title = recipe.name + ' – Pizza-Rechner';
  const v = data.view[recipe.id] || {};
  const state = {
    count: Math.max(1, Math.round(Number(v.count) || Number(recipe.basePizzas) || 1)),
    ballWeight: Number(v.ballWeight) > 0 ? Number(v.ballWeight) : null,
    eatAt: v.eatAt && new Date(v.eatAt) > new Date() ? new Date(v.eatAt) : defaultEatTime(recipe)
  };
  const baseBall = baseBallWeight(recipe);

  app.innerHTML = `
    <a class="back" href="#/">‹ Alle Rezepte</a>
    <h1>${esc(recipe.name)}</h1>
    ${recipe.description ? `<p class="lead">${esc(recipe.description)}</p>` : ''}
    <div class="actions">
      <a class="btn small" href="#/bearbeiten/${esc(recipe.id)}">✏️ Bearbeiten</a>
      <button class="btn small" id="dup">📄 Duplizieren</button>
      <button class="btn small danger" id="del">🗑 Löschen</button>
    </div>

    <div class="stats" id="stats"></div>
    <div id="nextStep"></div>

    <section class="card">
      <div class="card-head"><span class="card-icon" aria-hidden="true">🍕</span><h2>Wie viele Pizzen?</h2></div>
      <div class="stepper">
        <button class="btn icon" id="minus" aria-label="Eine Pizza weniger">−</button>
        <input type="number" id="count" min="1" max="200" inputmode="numeric" value="${state.count}" aria-label="Anzahl Pizzen">
        <button class="btn icon" id="plus" aria-label="Eine Pizza mehr">＋</button>
      </div>
      <div class="stepper-label" id="countLabel"></div>
      ${baseBall ? `
        <div class="ball-row">
          <div>
            <label for="ball">Gewicht pro Teigling</label>
            <div class="muted small">Neapolitanisch ca. 250–280 g, Blechpizza 350–450 g</div>
          </div>
          <div class="ball-input">
            <input type="number" id="ball" min="50" max="2000" step="5" inputmode="numeric" value="${Math.round(state.ballWeight || baseBall)}">
            <span class="muted">g</span>
            <button class="btn small ghost" id="ballReset" title="Auf den Wert aus dem Rezept zurücksetzen" aria-label="Zurücksetzen">↺</button>
          </div>
        </div>` : ''}
      <h3>Zutaten</h3>
      <table><tbody id="ingBody"></tbody><tfoot id="ingFoot"></tfoot></table>
    </section>

    <section class="card">
      <div class="card-head"><span class="card-icon" aria-hidden="true">🗓</span><h2>Zeitplan</h2></div>
      ${recipe.steps.length ? `
        <div class="field" style="margin-bottom:0">
          <label for="eatAt">Wann wollt ihr essen?</label>
          <input type="datetime-local" id="eatAt" value="${toLocalInputValue(state.eatAt)}">
        </div>
        <div id="planNotice"></div>
        <ol class="timeline" id="timeline"></ol>

        <div class="export">
          <h3>Erinnerungen aufs iPhone</h3>
          <label for="alarm" class="small">Erinnern</label>
          <select id="alarm">
            ${[0, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${Number(data.settings.alarmMinutes) === m ? 'selected' : ''}>${m === 0 ? 'zum Zeitpunkt des Schritts' : m + ' Minuten vorher'}</option>`).join('')}
          </select>
          <div class="btn-row">
            <button class="btn primary" id="ics">📅 In Apple Kalender</button>
            <button class="btn" id="reminders">⏰ In Apple Erinnerungen</button>
          </div>
          <p class="muted small" style="margin:10px 0 0">
            <b>Kalender</b> klappt sofort: Datei öffnen, „Alle hinzufügen“ tippen – jeder Schritt bekommt einen Alarm.
            <b>Erinnerungen</b> brauchen einmalig einen Kurzbefehl – <a href="#/einstellungen">zur Anleitung</a>.
          </p>
        </div>` : `
        <p class="muted">Dieses Rezept hat noch keine Arbeitsschritte. <a href="#/bearbeiten/${esc(recipe.id)}">Jetzt Schritte hinzufügen</a>, dann erscheint hier dein Zeitplan.</p>`}
    </section>
  `;

  const countEl = $('#count');
  const ballEl = $('#ball');
  let currentPlan = [];

  function persist() {
    data.view[recipe.id] = {
      count: state.count,
      ballWeight: state.ballWeight,
      eatAt: state.eatAt.toISOString()
    };
    save();
  }

  function renderStats() {
    const total = baseDoughWeight(recipe) * scaleFactor(recipe, state.count, state.ballWeight);
    const stats = [
      [total ? fmtAmount(total) + ' g' : '–', 'Teig gesamt'],
      [total ? fmtAmount(total / state.count) + ' g' : '–', 'pro Pizza'],
      [fmtDuration(currentPlan.length ? (state.eatAt - currentPlan[0].start) / 60000 : totalMinutes(recipe)), 'Gesamtzeit']
    ];
    $('#stats').innerHTML = stats.map(([val, label]) => `<div class="stat"><div class="v">${val}</div><div class="l">${label}</div></div>`).join('');
    $('#countLabel').textContent = state.count === 1 ? 'Pizza' : 'Pizzen';
  }

  function renderIngredients() {
    const f = scaleFactor(recipe, state.count, state.ballWeight);
    $('#ingBody').innerHTML = recipe.ingredients.map(i => `
      <tr><td>${esc(i.name)}</td><td class="num">${fmtAmount((Number(i.amount) || 0) * f)}<span class="unit-s">${esc(i.unit)}</span></td></tr>
    `).join('') || `<tr><td class="muted">Keine Zutaten eingetragen.</td></tr>`;
    const total = baseDoughWeight(recipe) * f;
    $('#ingFoot').innerHTML = total ? `<tr><td>Teig gesamt</td><td class="num">${fmtAmount(total)}<span class="unit-s">g</span></td></tr>` : '';
    renderStats();
  }

  function renderNextStep() {
    const now = new Date();
    const box = $('#nextStep');
    const running = currentPlan.find(st => st.start <= now && now < st.end);
    const next = currentPlan.find(st => st.start > now);
    if (!currentPlan.length || (!running && !next && state.eatAt <= now)) {
      box.innerHTML = '';
      return;
    }
    const target = next || { name: 'Guten Appetit!', start: state.eatAt };
    box.innerHTML = `
      <div class="next-step">
        <span class="ico" aria-hidden="true">${running ? '⏳' : '👉'}</span>
        <div>
          ${running ? `<div class="s">Läuft gerade: <b>${esc(running.name)}</b></div>` : ''}
          <div class="t">Als Nächstes: ${esc(target.name)}</div>
          <div class="s">${esc(fmtDay(target.start))}, ${fmtTime(target.start)} Uhr · ${fmtUntil(target.start)}</div>
        </div>
      </div>`;
  }

  function renderPlan() {
    if (!recipe.steps.length) {
      renderNextStep();
      return;
    }
    const plan = planSchedule(recipe, state.eatAt);
    currentPlan = plan;
    const now = new Date();
    const notices = [];

    if (plan.length && plan[0].start < now) {
      notices.push(`<div class="notice warn"><span aria-hidden="true">⚠️</span><div>Dafür hättest du schon <b>${esc(fmtDay(plan[0].start))}, ${fmtTime(plan[0].start)} Uhr</b> anfangen müssen.
        <br><button class="btn small" id="setEarliest">Frühestmöglichen Termin wählen</button></div></div>`);
    }
    const conflicted = plan.filter(p => p.conflicts.length);
    if (conflicted.length) {
      notices.push(`<div class="notice warn"><span aria-hidden="true">⚠️</span><div>${conflicted.length === 1 ? 'Ein Schritt fällt' : conflicted.length + ' Schritte fallen'} in deine belegten Zeiten.
        Verschieb die Essenszeit, gib Ruhezeiten mehr Spielraum oder pass deine <a href="#/einstellungen">Zeiten</a> an.</div></div>`);
    } else if (data.busy.length && plan[0].start >= now) {
      notices.push(`<div class="notice ok"><span aria-hidden="true">✅</span><div>Alles passt zu deinen Schul-, Arbeits- und Schlafenszeiten.</div></div>`);
    }
    $('#planNotice').innerHTML = notices.join('');
    const se = $('#setEarliest');
    if (se) se.addEventListener('click', () => {
      state.eatAt = earliestEatTime(recipe);
      $('#eatAt').value = toLocalInputValue(state.eatAt);
      persist();
      renderPlan();
    });

    const items = [];
    let lastDay = '';
    const dayHeader = date => {
      const day = fmtDay(date);
      if (day !== lastDay) {
        lastDay = day;
        items.push(`<li class="tl-day">${esc(day)}</li>`);
      }
    };
    plan.forEach((st, idx) => {
      dayHeader(st.start);
      const isNow = st.start <= now && now < st.end;
      const isDone = st.end <= now;
      const badges = [st.active ? '<span class="badge info">👐 Arbeit</span>' : '<span class="badge info">💤 Ruhezeit</span>'];
      if (st.extendedBy > 0) badges.push(`<span class="badge ok">↔ ${fmtDuration(st.extendedBy)} länger, damit es in deinen Tag passt</span>`);
      for (const c of st.conflicts) badges.push(`<span class="badge warn">⚠️ ${esc(c.label)} ${fmtTime(c.start)}–${fmtTime(c.end)}</span>`);
      if (isNow) badges.push('<span class="badge ok">● läuft gerade</span>');
      items.push(`
        <li class="tl-item ${st.active ? '' : 'passive'} ${isDone ? 'done' : ''} ${isNow ? 'now' : ''}">
          <div class="tl-time">${fmtTime(st.start)}</div>
          <div class="tl-rail"><span class="tl-dot"></span></div>
          <div class="tl-body">
            <div class="tl-what">${idx + 1}. ${esc(st.name)}</div>
            <div class="tl-meta">${fmtDuration(st.duration)} · bis ${fmtTime(st.end)} Uhr${fmtDay(st.end) !== fmtDay(st.start) ? ' (' + esc(fmtDay(st.end)) + ')' : ''}</div>
            ${st.note ? `<div class="tl-note">${esc(st.note)}</div>` : ''}
            <div class="badges">${badges.join('')}</div>
          </div>
        </li>`);
    });
    dayHeader(state.eatAt);
    items.push(`
      <li class="tl-item final last">
        <div class="tl-time">${fmtTime(state.eatAt)}</div>
        <div class="tl-rail"><span class="tl-dot"></span></div>
        <div class="tl-body"><div class="tl-what">🍕 Guten Appetit!</div></div>
      </li>`);
    $('#timeline').innerHTML = items.join('');
    renderNextStep();
    renderStats();
  }

  function setCount(n) {
    state.count = Math.max(1, Math.min(200, Math.round(Number(n) || 1)));
    countEl.value = state.count;
    renderIngredients();
    persist();
  }

  $('#minus').addEventListener('click', () => setCount(state.count - 1));
  $('#plus').addEventListener('click', () => setCount(state.count + 1));
  countEl.addEventListener('input', () => {
    if (countEl.value === '' || Number(countEl.value) < 1) return;
    state.count = Math.min(200, Math.round(Number(countEl.value)));
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

  if (recipe.steps.length) {
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
      const ics = buildIcs(recipe, upcoming, state.count, Number(data.settings.alarmMinutes) || 0);
      downloadFile(`pizza-${slug(recipe.name)}.ics`, ics, 'text/calendar;charset=utf-8');
      toast('Kalenderdatei erstellt 📅');
    });

    $('#reminders').addEventListener('click', () => {
      const text = shortcutPayload(currentPlan, Number(data.settings.alarmMinutes) || 0);
      if (!text) return toast('Alle Schritte liegen in der Vergangenheit.');
      if (!/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) return toast('Funktioniert nur auf iPhone, iPad oder Mac.');
      location.href = shortcutUrl(text);
    });
  }

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

  liveTimer = setInterval(() => {
    // nicht neu zeichnen, während jemand gerade etwas eintippt
    if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    renderPlan();
  }, 60000);
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
        <div class="card-head"><span class="card-icon" aria-hidden="true">📝</span><h2>Allgemein</h2></div>
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
        <div class="card-head"><span class="card-icon" aria-hidden="true">🧂</span><h2>Zutaten</h2></div>
        <p class="muted small">Mengen für die oben angegebene Anzahl Pizzen. Zutaten in g oder ml zählen zum Teiggewicht.</p>
        <div id="ings"></div>
        <button type="button" class="btn small" id="addIng">＋ Zutat</button>
      </section>

      <section class="card">
        <div class="card-head"><span class="card-icon" aria-hidden="true">⏱</span><h2>Arbeitsschritte</h2></div>
        <p class="muted small">In Reihenfolge. <b>Arbeit</b> = du musst dabei sein. <b>Ruhezeit</b> = der Teig arbeitet allein.
          Bei Ruhezeiten kannst du eine <b>maximale Dauer</b> angeben – dann verschiebt der Zeitplan die Arbeitsschritte automatisch aus deinen Schul-/Arbeitszeiten heraus.</p>
        <div id="steps"></div>
        <button type="button" class="btn small" id="addStep">＋ Schritt</button>
      </section>

      <div class="sticky-save">
        <a class="btn" href="${isNew ? '#/' : '#/rezept/' + esc(r.id)}">Abbrechen</a>
        <button type="submit" class="btn primary">💾 Speichern</button>
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

  function stepRow(s, idx) {
    const h = Math.floor((s.minutes || 0) / 60), m = (s.minutes || 0) % 60;
    const max = Math.max(s.maxMinutes || 0, s.minutes || 0);
    const mh = Math.floor(max / 60), mm = max % 60;
    return `
      <div class="edit-row step-row">
        <div class="line">
          <span class="step-num" aria-hidden="true">${idx + 1}</span>
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
      amount: $('.ing-amount', row).value === '' ? '' : Math.max(0, Number($('.ing-amount', row).value) || 0),
      unit: $('.ing-unit', row).value
    }));
    r.steps = $$('#steps .step-row').map(row => {
      const val = sel => Math.max(0, Number($(sel, row).value) || 0);
      const minutes = Math.round(val('.st-h') * 60 + val('.st-m'));
      const active = $('.st-type', row).value === 'active';
      const maxRaw = Math.round(val('.st-mh') * 60 + val('.st-mm'));
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
    $('#ings').innerHTML = r.ingredients.map(ingRow).join('') || '<p class="muted small">Noch keine Zutaten.</p>';
    $('#steps').innerHTML = r.steps.map(stepRow).join('') || '<p class="muted small">Noch keine Schritte.</p>';
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
    if (!r.ingredients.length && !r.steps.length && !confirm('Das Rezept hat weder Zutaten noch Schritte. Trotzdem speichern?')) return;

    const idx = data.recipes.findIndex(x => x.id === r.id);
    if (idx >= 0) data.recipes[idx] = r;
    else data.recipes.push(r);
    save();
    toast('Rezept gespeichert ✅');
    location.hash = '#/rezept/' + r.id;
  });
}

/* ---------------------------------------------------------------- Einstellungen */

function busyIcon(label) {
  const l = String(label).toLowerCase();
  if (/schlaf|nacht/.test(l)) return '😴';
  if (/schul|uni|vorlesung|kurs/.test(l)) return '🏫';
  if (/arbeit|job|büro|schicht|dienst/.test(l)) return '💼';
  if (/sport|training|verein/.test(l)) return '⚽️';
  return '📌';
}

function renderSettings() {
  document.title = 'Einstellungen – Pizza-Rechner';

  app.innerHTML = `
    <a class="back" href="#/">‹ Zurück</a>
    <h1>Einstellungen</h1>

    <section class="card">
      <div class="card-head"><span class="card-icon" aria-hidden="true">🏫</span><h2>Meine belegten Zeiten</h2></div>
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
          <label id="daysLabel">Tage</label>
          <div class="days" role="group" aria-labelledby="daysLabel">
            ${WEEK_ORDER.map(d => `<label><input type="checkbox" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}
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
      <div class="card-head"><span class="card-icon" aria-hidden="true">⏰</span><h2>Apple Erinnerungen einrichten</h2></div>
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
      <div class="card-head"><span class="card-icon" aria-hidden="true">💾</span><h2>Sicherung</h2></div>
      <p class="muted small">Deine Rezepte werden nur auf diesem Gerät im Browser gespeichert. Mit einer Sicherung kannst du sie auf ein anderes Gerät übertragen.</p>
      <div class="btn-row">
        <button class="btn" id="export">⬇️ Sicherung herunterladen</button>
        <label class="btn" style="margin:0">⬆️ Sicherung laden
          <input type="file" id="import" accept="application/json,.json" hidden>
        </label>
      </div>
      <details>
        <summary>Alles zurücksetzen</summary>
        <p class="small">Löscht alle Rezepte und eingetragenen Zeiten. Das eingebaute 48-Stunden-Rezept kommt danach wieder.</p>
        <button class="btn small danger" id="reset">Zurücksetzen</button>
      </details>
    </section>
    <p class="footer">🍕 Pizza-Rechner · Alle Daten bleiben auf diesem Gerät.</p>
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
          <span class="ico" aria-hidden="true">${busyIcon(b.label)}</span>
          <div class="grow">
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
      data = normalizeData(Object.assign({}, parsed, { examplesRemoved: true }));
      save();
      toast('Sicherung geladen ✅');
      renderSettings();
    } catch (err) {
      toast('Datei konnte nicht gelesen werden.');
    }
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Wirklich alle Daten löschen?')) return;
    data = normalizeData(defaultData());
    save();
    toast('Zurückgesetzt');
    location.hash = '#/';
  });
}

/* ---------------------------------------------------------------- Start */

data = load();
save();
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
