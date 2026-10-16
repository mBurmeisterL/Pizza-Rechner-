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
  },
  {
    id: 'builtin-65-kuehlschrank',
    name: 'Pizzateig 65 % – Kühlschrank 12–16 h',
    description: '1 kg Mehl 00, kaltes Wasser, 65 % Hydration. 6 Teiglinge à ca. 280 g, über Nacht im Kühlschrank.',
    basePizzas: 6,
    ingredients: [
      { name: 'Mehl Tipo 00', amount: 1000, unit: 'g' },
      { name: 'Wasser (kalt)', amount: 650, unit: 'g' },
      { name: 'Trockenhefe', amount: 2.5, unit: 'g' },
      { name: 'Salz', amount: 25, unit: 'g' }
    ],
    steps: [
      { name: 'Teig kneten', minutes: 15, active: true, maxMinutes: 15, note: 'Mit kaltem Wasser kneten, bis der Teig glatt ist.' },
      { name: 'Teig ruhen lassen', minutes: 15, active: false, maxMinutes: 15, note: '' },
      { name: 'Teiglinge formen', minutes: 15, active: true, maxMinutes: 15, note: 'In 6 gleich große Bälle formen.' },
      { name: 'Bei Raumtemperatur gehen lassen', minutes: 120, active: false, maxMinutes: 120, note: '' },
      { name: 'Teiglinge in den Kühlschrank', minutes: 720, active: false, maxMinutes: 960, note: '12 bis 16 Stunden abgedeckt kalt stellen.' },
      { name: 'Aus dem Kühlschrank nehmen', minutes: 240, active: false, maxMinutes: 360, note: '4 bis 6 Stunden vor dem Backen bei Raumtemperatur akklimatisieren lassen.' },
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

/* ------------------------------------------------------------ Symbole & Illustration */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M7 7l10 10M17 7 7 17"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  scale: '<path d="M12 4v16M6 20h12M4 8h16M7 8l-3 7h6L7 8ZM17 8l-3 7h6l-3-7Z"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="m8 12.3 2.7 2.7L16 9.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  school: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11v5c3.5 2.5 7.5 2.5 11 0v-5M21.5 9v5"/>',
  work: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M3 13h18"/>',
  sport: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17M6 6c3 2.5 3 9.5 0 12M18 6c-3 2.5-3 9.5 0 12"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  pizza: '<path d="M12 3 3.5 19.2a1 1 0 0 0 .9 1.3h15.2a1 1 0 0 0 .9-1.3L12 3Z"/><path d="M5.6 16.5c4.2-1.6 8.6-1.6 12.8 0"/><circle cx="11" cy="12" r="1.3"/><circle cx="13.6" cy="15.6" r="1.1"/><circle cx="9.4" cy="16.4" r="1"/>'
};
const icon = (name, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICONS[name] || ''}</svg>`;

let artSeq = 0;
// Große Pizza-Illustration (wird von einem 2:1-Rahmen auf die obere Hälfte zugeschnitten)
function pizzaArt() {
  const id = 'pz' + (++artSeq);
  const cheese = [[140, 120, 30], [255, 105, 26], [300, 200, 32], [200, 190, 24], [120, 230, 28], [235, 285, 30], [320, 300, 22], [170, 320, 22], [90, 160, 18]];
  const basil = [[200, 120, -30], [110, 195, 40], [255, 240, -10], [330, 150, 60], [185, 270, 20], [280, 330, -40]];
  const olives = [[175, 155], [290, 155], [230, 225], [150, 280], [320, 250]];
  return `
    <svg viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id="${id}c" cx="50%" cy="45%" r="55%"><stop offset="78%" stop-color="#f6c477"/><stop offset="92%" stop-color="#e3a052"/><stop offset="100%" stop-color="#c47a35"/></radialGradient>
        <radialGradient id="${id}s" cx="45%" cy="40%" r="60%"><stop offset="0%" stop-color="#ef5a36"/><stop offset="100%" stop-color="#c9321f"/></radialGradient>
      </defs>
      <circle cx="200" cy="200" r="196" fill="url(#${id}c)"/>
      <circle cx="200" cy="200" r="164" fill="url(#${id}s)"/>
      <g fill="#fff6e3" opacity=".97">${cheese.map(([x, y, r]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .82}"/>`).join('')}</g>
      <g fill="#2f2a26">${olives.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7"/><circle cx="${x}" cy="${y}" r="2.6" fill="#c9321f"/>`).join('')}</g>
      <g fill="#2e8a4e">${basil.map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="17" ry="8" transform="rotate(${a} ${x} ${y})"/>`).join('')}</g>
      <g stroke="#b5642a" stroke-width="2" opacity=".35"><path d="M200 4v392M4 200h392M61 61l278 278M339 61 61 339"/></g>
    </svg>`;
}

/* ------------------------------------------------------------ Gerüst */

let revealObserver = null;

function setNav(active) {
  $$('.gn-links a').forEach(a => {
    const on = a.dataset.nav === active;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function localNav(title, actions = '') {
  return `
    <div class="localnav">
      <div class="wrap ln-inner">
        <div class="ln-title">${title}</div>
        <div class="ln-actions">${actions}</div>
      </div>
    </div>`;
}

// Inhalte beim Scrollen einblenden – nur wenn möglich und gewünscht, sonst sofort sichtbar
const canReveal = 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (canReveal) document.documentElement.classList.add('js-reveal');

function armReveal() {
  if (!canReveal) return;
  if (revealObserver) revealObserver.disconnect();
  revealObserver = new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('is-visible');
        revealObserver.unobserve(e.target);
      }
    }
  }, { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal', app).forEach(el => revealObserver.observe(el));
}

function render(html) {
  app.innerHTML = `<div class="page">${html}</div>`;
  armReveal();
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const offset = $('#globalnav').offsetHeight + ($('.localnav') ? $('.localnav').offsetHeight : 0);
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset + 1, behavior: 'smooth' });
}

// Schaltflächen mit data-scroll="id" springen zu einem Abschnitt (Hash bleibt für den Router frei)
app.addEventListener('click', e => {
  const t = e.target.closest('[data-scroll]');
  if (t) { e.preventDefault(); scrollToId(t.dataset.scroll); }
});

function fmtDayLong(date) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(date) - today) / 86400000);
  const rel = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : null;
  const str = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return rel ? `${rel}, ${str}` : str;
}

/* ------------------------------------------------------------ Modal */

const sheet = $('#sheet');
let sheetOnDone = null;
let sheetReturnFocus = null;

function openSheet({ title, doneLabel = 'Fertig', body, onOpen, onDone }) {
  $('#sheetTitle').textContent = title;
  $('#sheetDone').textContent = doneLabel;
  $('#sheetBody').innerHTML = body;
  sheetOnDone = onDone;
  sheetReturnFocus = document.activeElement;
  sheet.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  document.body.style.overflow = 'hidden';
  if (onOpen) onOpen($('#sheetBody'));
}

function closeSheet() {
  sheet.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 380);
  if (sheetReturnFocus && sheetReturnFocus.focus) sheetReturnFocus.focus();
}

sheet.addEventListener('click', e => {
  if (e.target === sheet || e.target.closest('[data-sheet-close]')) closeSheet();
});
$('#sheetDone').addEventListener('click', () => {
  if (!sheetOnDone || sheetOnDone() !== false) closeSheet();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
});

/* ------------------------------------------------------------ Router */

function route() {
  const hash = location.hash.replace(/^#\/?/, '');
  const [page, id] = hash.split('/');
  window.scrollTo(0, 0);
  clearInterval(liveTimer);
  if (sheet.classList.contains('open')) closeSheet();
  if (page === 'rezept' && getRecipe(id)) return renderRecipe(getRecipe(id));
  if (page === 'neu') return renderEditor(null);
  if (page === 'bearbeiten' && getRecipe(id)) return renderEditor(getRecipe(id));
  if (page === 'einstellungen') return renderSettings();
  renderHome();
}

window.addEventListener('hashchange', route);

/* ------------------------------------------------------------ Startseite */

function renderHome() {
  document.title = 'Pizza-Rechner';
  setNav('rezepte');
  const now = new Date();

  const tiles = data.recipes.map(r => {
    const ball = baseBallWeight(r);
    const v = data.view[r.id];
    const planned = v && v.eatAt && new Date(v.eatAt) > now ? new Date(v.eatAt) : null;
    return `
      <a class="tile reveal" href="#/rezept/${esc(r.id)}">
        ${planned ? `<p class="eyebrow">Geplant: ${esc(fmtDay(planned))}, ${fmtTime(planned)} Uhr</p>` : ''}
        <h3 class="tile-title">${esc(r.name)}</h3>
        ${r.description ? `<p class="tile-sub">${esc(r.description)}</p>` : ''}
        <div class="tile-stats">
          <div><b>${fmtDuration(totalMinutes(r))}</b><span>Dauer</span></div>
          <div><b>${esc(r.basePizzas)}</b><span>Pizzen</span></div>
          ${ball ? `<div><b>${fmtAmount(ball)} g</b><span>pro Teigling</span></div>` : ''}
        </div>
        <span class="more">Rezept öffnen</span>
        <div class="tile-art">${pizzaArt()}</div>
      </a>`;
  }).join('');

  render(`
    <section class="hero">
      <div class="wrap">
        <p class="eyebrow">Pizza-Rechner</p>
        <h1 class="hero-title">Pizzateig.<br>Perfekt geplant.</h1>
        <p class="sub">Rezept wählen, Anzahl eingeben. Zutaten und Zeitplan rechnen sich von selbst.</p>
        <div class="ctas">
          <a class="pill" href="#/neu">Neues Rezept</a>
          ${data.recipes.length ? '<button type="button" class="more" data-scroll="rezepte">Rezepte ansehen</button>' : ''}
        </div>
      </div>
      <div class="hero-art">${pizzaArt()}</div>
    </section>

    <section class="sec alt" id="rezepte">
      <div class="wrap wide center">
        <h2 class="sec-title reveal">${data.recipes.length ? 'Deine Rezepte.' : 'Noch keine Rezepte.'}</h2>
        <p class="sub reveal">${data.recipes.length
          ? `${data.recipes.length} ${data.recipes.length === 1 ? 'Rezept' : 'Rezepte'}, bereit für den nächsten Pizzaabend.`
          : 'Leg dein erstes Teigrezept an – mit Zutaten, Arbeitsschritten und Ruhezeiten.'}</p>
        <div class="tiles">
          ${tiles}
          <a class="tile dark new reveal" href="#/neu">
            <h3 class="tile-title">Dein eigenes Rezept.</h3>
            <p class="tile-sub">Zutaten für eine beliebige Anzahl Pizzen, Schritte mit Ruhezeiten und Spielraum.</p>
            <span class="more">Rezept anlegen</span>
            <div class="plus-art">${icon('plus')}</div>
          </a>
        </div>
      </div>
    </section>

    <section class="sec dark on-dark">
      <div class="wrap center">
        <p class="eyebrow reveal">So funktioniert’s</p>
        <h2 class="sec-title reveal">Einmal eingeben.<br>Immer richtig.</h2>
        <div class="features">
          <div class="feature reveal">${icon('scale', 'f-ico')}<h3>Umrechnen.</h3><p>Für 2 oder 20 Pizzen, mit dem Teiglingsgewicht, das du willst. Jede Zutat aufs Gramm.</p></div>
          <div class="feature reveal">${icon('clock', 'f-ico')}<h3>Planen.</h3><p>Sag, wann ihr essen wollt. Der Zeitplan rechnet rückwärts – und weicht Schule, Arbeit und Schlaf aus.</p></div>
          <div class="feature reveal">${icon('bell', 'f-ico')}<h3>Erinnern.</h3><p>Jeder Schritt als Termin mit Alarm im Kalender oder als Erinnerung auf deinem iPhone.</p></div>
        </div>
      </div>
    </section>
  `);
}

/* ------------------------------------------------------------ Rezept */

let liveTimer = null; // aktualisiert den Zeitplan jede Minute ("läuft gerade", "in 2 h")

function renderRecipe(recipe) {
  document.title = recipe.name + ' – Pizza-Rechner';
  setNav('rezepte');

  const v = data.view[recipe.id] || {};
  const state = {
    count: Math.max(1, Math.round(Number(v.count) || Number(recipe.basePizzas) || 1)),
    ballWeight: Number(v.ballWeight) > 0 ? Number(v.ballWeight) : null,
    eatAt: v.eatAt && new Date(v.eatAt) > new Date() ? new Date(v.eatAt) : defaultEatTime(recipe)
  };
  const baseBall = baseBallWeight(recipe);
  const hasSteps = recipe.steps.length > 0;
  let currentPlan = [];

  render(`
    ${localNav(esc(recipe.name), `
      <button type="button" class="ln-link hide-sm" data-scroll="zutaten">Zutaten</button>
      <button type="button" class="ln-link hide-sm" data-scroll="zeitplan">Zeitplan</button>
      <a class="pill small" href="#/bearbeiten/${esc(recipe.id)}">Bearbeiten</a>`)}

    <section class="page-hero center">
      <div class="wrap">
        <p class="eyebrow">Rezept</p>
        <h1 class="hero-title">${esc(recipe.name)}</h1>
        ${recipe.description ? `<p class="sub">${esc(recipe.description)}</p>` : ''}
      </div>
    </section>

    <section class="sec tight" style="padding-top:8px">
      <div class="wrap"><div class="stats" id="stats"></div></div>
    </section>

    <section class="sec alt center" id="menge">
      <div class="wrap">
        <h2 class="sec-title reveal">Wie viele Pizzen?</h2>
        <div class="counter">
          <button type="button" class="round" id="countMinus" aria-label="Eine Pizza weniger">${icon('minus')}</button>
          <span class="num" id="countVal" aria-live="polite">${state.count}</span>
          <button type="button" class="round" id="countPlus" aria-label="Eine Pizza mehr">${icon('plus')}</button>
        </div>
        <p class="counter-label" id="countLabel"></p>
        ${baseBall ? `
          <div class="ball-box">
            <div style="text-align:left">
              <div class="lbl">Gewicht pro Teigling</div>
              <div class="hint">Neapolitanisch 250–280 g, Blechpizza 350–450 g</div>
            </div>
            <div class="ball-in">
              <label class="field num compact" style="margin:0;width:120px">
                <input type="number" id="ball" min="50" max="2000" step="5" inputmode="numeric" value="${Math.round(state.ballWeight || baseBall)}" aria-label="Gewicht pro Teigling in Gramm">
                <span class="unit" style="bottom:13px">g</span>
              </label>
              <button type="button" class="more-btn" id="ballReset" ${state.ballWeight ? '' : 'hidden'}>Zurücksetzen</button>
            </div>
          </div>` : ''}
      </div>
    </section>

    <section class="sec" id="zutaten">
      <div class="wrap narrow">
        <h2 class="sec-title reveal">Zutaten.</h2>
        <p class="sub reveal" id="ingSub" style="margin-left:0"></p>
        <div class="specs" id="ingTable"></div>
      </div>
    </section>

    ${hasSteps ? `
      <section class="sec dark on-dark center" id="zeitplan">
        <div class="wrap">
          <p class="eyebrow reveal">Zeitplan</p>
          <h2 class="sec-title reveal">Wann wollt ihr essen?</h2>
          <p class="sub reveal">Der Plan rechnet rückwärts und legt jeden Schritt in deinen Tag.</p>
          <div class="plan-controls">
            <label for="eatAt">Essenszeit</label>
            <input type="datetime-local" id="eatAt" value="${toLocalInputValue(state.eatAt)}">
          </div>
          <div class="notices" id="planNotice"></div>
          <div id="nextStep"></div>
          <div class="plan" id="timeline"></div>
          <p class="fine" id="planFooter" style="margin-top:28px;color:var(--text-on-dark-2)"></p>
        </div>
      </section>

      <section class="sec alt center" id="erinnerungen">
        <div class="wrap">
          <h2 class="sec-title reveal">Nichts verpassen.</h2>
          <p class="sub reveal">Hol dir jeden Schritt aufs iPhone.</p>
          <div class="field" style="max-width:320px;margin:32px auto 0;text-align:left">
            <select id="alarm" aria-label="Zeitpunkt der Erinnerung">
              ${[0, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${Number(data.settings.alarmMinutes) === m ? 'selected' : ''}>${m === 0 ? 'Zum Zeitpunkt des Schritts' : m + ' Minuten vorher'}</option>`).join('')}
            </select>
            <span>Erinnern</span>
          </div>
          <div class="features two">
            <div class="feature reveal">${icon('calendar', 'f-ico')}<h3>Kalender.</h3><p class="grow">Jeder Schritt wird ein Termin mit Alarm. Datei öffnen, „Alle hinzufügen“ tippen – fertig.</p><button type="button" class="pill" id="ics">In Kalender übernehmen</button></div>
            <div class="feature reveal">${icon('bell', 'f-ico')}<h3>Erinnerungen.</h3><p class="grow">Alle Schritte in der Erinnerungen-App. Braucht einmalig einen Kurzbefehl.</p><button type="button" class="pill" id="reminders">In Erinnerungen übernehmen</button><a class="more" href="#/einstellungen">Kurzbefehl einrichten</a></div>
          </div>
        </div>
      </section>` : `
      <section class="sec dark on-dark center" id="zeitplan">
        <div class="wrap">
          <p class="eyebrow">Zeitplan</p>
          <h2 class="sec-title">Noch keine Schritte.</h2>
          <p class="sub">Trag Arbeitsschritte und Ruhezeiten ein, dann erscheint hier dein Zeitplan.</p>
          <div class="ctas"><a class="pill" href="#/bearbeiten/${esc(recipe.id)}">Arbeitsschritte hinzufügen</a></div>
        </div>
      </section>`}

    <section class="sec tight center">
      <div class="wrap ctas" style="margin-top:0">
        <button type="button" class="more" id="dup">Rezept duplizieren</button>
        <button type="button" class="more-btn danger" id="del">Rezept löschen</button>
      </div>
    </section>
  `);

  const ballEl = $('#ball');

  function persist() {
    data.view[recipe.id] = { count: state.count, ballWeight: state.ballWeight, eatAt: state.eatAt.toISOString() };
    save();
  }

  function renderStats() {
    const total = baseDoughWeight(recipe) * scaleFactor(recipe, state.count, state.ballWeight);
    const dur = currentPlan.length ? (state.eatAt - currentPlan[0].start) / 60000 : totalMinutes(recipe);
    $('#stats').innerHTML = [
      [total ? fmtAmount(total) + ' g' : '–', 'Teig gesamt'],
      [total ? fmtAmount(total / state.count) + ' g' : '–', 'pro Pizza'],
      [fmtDuration(dur), 'vom ersten Schritt bis zum Essen']
    ].map(([val, label]) => `<div><div class="stat-v">${val}</div><div class="stat-l">${label}</div></div>`).join('');
  }

  function renderIngredients() {
    const f = scaleFactor(recipe, state.count, state.ballWeight);
    const total = baseDoughWeight(recipe) * f;
    $('#ingTable').innerHTML = (recipe.ingredients.map(i => `
      <div class="spec-row"><div class="k">${esc(i.name)}</div><div class="v">${fmtAmount((Number(i.amount) || 0) * f)} ${esc(i.unit)}</div></div>`).join('') +
      (total ? `<div class="spec-row total"><div class="k">Teig gesamt</div><div class="v">${fmtAmount(total)} g</div></div>` : '')) ||
      '<div class="spec-row"><div class="k" style="color:var(--text-2);font-weight:400">Keine Zutaten eingetragen.</div></div>';
    $('#ingSub').textContent = total ? `Für ${pizzaWord(state.count)} à ${fmtAmount(total / state.count)} g.` : `Für ${pizzaWord(state.count)}.`;
    $('#countVal').textContent = state.count;
    $('#countLabel').textContent = state.count === 1 ? 'Pizza' : 'Pizzen';
    $('#countMinus').disabled = state.count <= 1;
    $('#countPlus').disabled = state.count >= 200;
    renderStats();
  }

  function renderNextStep() {
    const box = $('#nextStep');
    if (!box) return;
    const now = new Date();
    const running = currentPlan.find(st => st.start <= now && now < st.end);
    const next = currentPlan.find(st => st.start > now);
    if (!currentPlan.length || (!running && !next && state.eatAt <= now)) {
      box.innerHTML = '';
      return;
    }
    const target = next || { name: 'Pizza essen', start: state.eatAt };
    box.innerHTML = `
      <div class="next-up">
        <div class="k">${running ? `Läuft gerade: ${esc(running.name)} · ` : ''}Als Nächstes</div>
        <div class="t">${esc(target.name)}</div>
        <div class="s">${esc(fmtDay(target.start))}, ${fmtTime(target.start)} Uhr · ${fmtUntil(target.start)}</div>
      </div>`;
  }

  function renderPlan() {
    if (!hasSteps) return;
    const plan = planSchedule(recipe, state.eatAt);
    currentPlan = plan;
    const now = new Date();

    const notices = [];
    if (plan[0].start < now) {
      notices.push(`<div class="notice warn">${icon('alert')}<div>Dafür hättest du schon ${esc(fmtDay(plan[0].start))} um ${fmtTime(plan[0].start)} Uhr anfangen müssen.<br>
        <button type="button" class="more-btn" id="setEarliest">Frühestmöglichen Termin wählen</button></div></div>`);
    }
    const conflicted = plan.filter(p => p.conflicts.length);
    if (conflicted.length) {
      notices.push(`<div class="notice warn">${icon('alert')}<div>${conflicted.length === 1 ? 'Ein Schritt fällt' : conflicted.length + ' Schritte fallen'} in deine belegten Zeiten.
        Wähle eine andere Essenszeit, gib Ruhezeiten mehr Spielraum oder passe deine <a href="#/einstellungen">Zeiten</a> an.</div></div>`);
    } else if (data.busy.length && plan[0].start >= now) {
      notices.push(`<div class="notice ok">${icon('check')}<div>Passt zu deinen Schul-, Arbeits- und Schlafenszeiten.</div></div>`);
    }
    $('#planNotice').innerHTML = notices.join('');
    $('#planFooter').textContent = `Start ${fmtDay(plan[0].start)}, ${fmtTime(plan[0].start)} Uhr · Gesamtdauer ${fmtDuration((state.eatAt - plan[0].start) / 60000)}`;
    const se = $('#setEarliest');
    if (se) se.addEventListener('click', () => {
      state.eatAt = earliestEatTime(recipe);
      $('#eatAt').value = toLocalInputValue(state.eatAt);
      persist();
      renderPlan();
    });

    const days = [];
    const pushTo = (date, html) => {
      const key = startOfDay(date).getTime();
      let d = days.find(x => x.key === key);
      if (!d) days.push(d = { key, date, rows: [] });
      d.rows.push(html);
    };
    plan.forEach((st, idx) => {
      const isNow = st.start <= now && now < st.end;
      const isDone = st.end <= now;
      const tags = [];
      if (st.extendedBy > 0) tags.push(`<div class="tag ok">${fmtDuration(st.extendedBy)} länger, damit es in deinen Tag passt</div>`);
      for (const c of st.conflicts) tags.push(`<div class="tag warn">Überschneidet sich mit ${esc(c.label)} (${fmtTime(c.start)}–${fmtTime(c.end)})</div>`);
      if (isNow) tags.push('<div class="tag ok">Läuft gerade</div>');
      const endsOtherDay = startOfDay(st.end).getTime() !== startOfDay(st.start).getTime();
      pushTo(st.start, `
        <div class="plan-step ${isDone ? 'done' : ''} ${isNow ? 'now' : ''}">
          <div class="time">${fmtTime(st.start)}</div>
          <div>
            <div class="name">${esc(st.name)}</div>
            <div class="meta"><span class="kind ${st.active ? 'active' : 'passive'}">${st.active ? 'Arbeit' : 'Ruhezeit'}</span>${fmtDuration(st.duration)} · bis ${fmtTime(st.end)} Uhr${endsOtherDay ? ' (' + esc(fmtDay(st.end)) + ')' : ''}</div>
            ${st.note ? `<div class="note">${esc(st.note)}</div>` : ''}
            ${tags.join('')}
          </div>
        </div>`);
      void idx;
    });
    pushTo(state.eatAt, `
      <div class="plan-step final">
        <div class="time">${fmtTime(state.eatAt)}</div>
        <div><div class="name">Guten Appetit.</div></div>
      </div>`);
    $('#timeline').innerHTML = days.map(d => `<div class="plan-day"><h3>${esc(fmtDayLong(d.date))}</h3>${d.rows.join('')}</div>`).join('');

    renderNextStep();
    renderStats();
  }

  function setCount(n) {
    state.count = Math.max(1, Math.min(200, Math.round(Number(n) || 1)));
    renderIngredients();
    persist();
  }

  $('#countMinus').addEventListener('click', () => setCount(state.count - 1));
  $('#countPlus').addEventListener('click', () => setCount(state.count + 1));

  if (ballEl) {
    ballEl.addEventListener('input', () => {
      const w = Number(ballEl.value);
      state.ballWeight = w > 0 && Math.abs(w - baseBall) > 0.5 ? w : null;
      $('#ballReset').hidden = !state.ballWeight;
      renderIngredients();
      persist();
    });
    $('#ballReset').addEventListener('click', () => {
      state.ballWeight = null;
      ballEl.value = Math.round(baseBall);
      $('#ballReset').hidden = true;
      renderIngredients();
      persist();
    });
  }

  if (hasSteps) {
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
      toast('Kalenderdatei erstellt');
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
    // nicht neu zeichnen, während gerade etwas eingegeben wird
    if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
    renderPlan();
  }, 60000);
}

/* ------------------------------------------------------------ Editor */

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
  const backHref = isNew ? '#/' : '#/rezept/' + esc(r.id);
  const title = isNew ? 'Neues Rezept' : 'Rezept bearbeiten';
  document.title = title + ' – Pizza-Rechner';
  setNav(isNew ? 'neu' : 'rezepte');

  const units = ['g', 'ml', 'TL', 'EL', 'Stk', 'Prise'];

  function ingRow(i) {
    const unitOptions = units.includes(i.unit) ? units : [i.unit, ...units];
    return `
      <div class="ing-row">
        <label class="field"><input class="ing-name" placeholder=" " value="${esc(i.name)}"><span>Zutat</span></label>
        <label class="field num amount-f"><input class="ing-amount" type="number" step="any" min="0" inputmode="decimal" placeholder="0" value="${esc(i.amount)}"><span>Menge</span></label>
        <label class="field unit-f"><select class="ing-unit">${unitOptions.map(u => `<option ${u === i.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select><span>Einheit</span></label>
        <button type="button" class="x-btn remove" aria-label="Zutat entfernen">${icon('close')}</button>
      </div>`;
  }

  function durFields(cls, minutes) {
    const h = Math.floor((minutes || 0) / 60), m = (minutes || 0) % 60;
    return `
      <div class="grid-2">
        <label class="field num"><input class="${cls}-h" type="number" min="0" inputmode="numeric" value="${h}"><span>Stunden</span><span class="unit">Std.</span></label>
        <label class="field num"><input class="${cls}-m" type="number" min="0" max="59" inputmode="numeric" value="${m}"><span>Minuten</span><span class="unit">Min.</span></label>
      </div>`;
  }

  function stepCard(s, idx, total) {
    const max = Math.max(s.maxMinutes || 0, s.minutes || 0);
    return `
      <div class="step-card step-row">
        <div class="step-head">
          <span class="n">Schritt ${idx + 1}</span>
          <span class="btns">
            <button type="button" class="x-btn up" aria-label="Schritt nach oben" ${idx === 0 ? 'disabled' : ''}>${icon('up')}</button>
            <button type="button" class="x-btn down" aria-label="Schritt nach unten" ${idx === total - 1 ? 'disabled' : ''}>${icon('down')}</button>
            <button type="button" class="x-btn remove" aria-label="Schritt löschen">${icon('close')}</button>
          </span>
        </div>
        <label class="field"><input class="st-name" placeholder=" " value="${esc(s.name)}"><span>Name, z. B. Stockgare</span></label>
        <div class="choice" role="radiogroup" aria-label="Art des Schritts">
          <label><input type="radio" name="type${idx}" value="active" class="st-type" ${s.active ? 'checked' : ''}><span><b>Arbeit</b><small>Du musst dabei sein.</small></span></label>
          <label><input type="radio" name="type${idx}" value="passive" class="st-type" ${!s.active ? 'checked' : ''}><span><b>Ruhezeit</b><small>Der Teig arbeitet allein.</small></span></label>
        </div>
        <p class="dur-label st-dur-label">${s.active ? 'Dauer' : 'Mindestens'}</p>
        ${durFields('st', s.minutes)}
        <div class="flexbox" ${s.active ? 'hidden' : ''}>
          <p class="dur-label">Höchstens (Spielraum für deinen Tag)</p>
          ${durFields('st-max', max)}
        </div>
        <label class="field" style="margin-top:14px;margin-bottom:0"><input class="st-note" placeholder=" " value="${esc(s.note)}"><span>Notiz (optional)</span></label>
      </div>`;
  }

  render(`
    ${localNav(title, `<a class="ln-link" href="${backHref}">Abbrechen</a><button type="button" class="pill small" id="saveBtn">Sichern</button>`)}

    <section class="page-hero center" style="padding-bottom:0">
      <div class="wrap">
        <h1 class="hero-title">${isNew ? 'Neues Rezept.' : 'Rezept bearbeiten.'}</h1>
        <p class="sub">Einmal eintragen – danach rechnet der Pizza-Rechner jede Menge und jeden Zeitplan aus.</p>
      </div>
    </section>

    <div class="wrap narrow">
      <section class="form-sec">
        <h2>Allgemein.</h2>
        <label class="field"><input id="name" placeholder=" " value="${esc(r.name)}"><span>Name des Rezepts</span></label>
        <label class="field"><textarea id="desc" placeholder=" ">${esc(r.description)}</textarea><span>Beschreibung (optional)</span></label>
        <div class="count-row">
          <div><span class="lbl">Das Rezept ergibt</span><span class="val" id="baseVal"></span></div>
          <div class="btns">
            <button type="button" class="round sm" id="baseMinus" aria-label="Eine Pizza weniger">${icon('minus')}</button>
            <button type="button" class="round sm" id="basePlus" aria-label="Eine Pizza mehr">${icon('plus')}</button>
          </div>
        </div>
      </section>

      <section class="form-sec">
        <h2>Zutaten.</h2>
        <p class="lead">Mengen für die oben angegebene Anzahl Pizzen. Zutaten in g oder ml zählen zum Teiggewicht.</p>
        <div id="ings"></div>
        <button type="button" class="add-link" id="addIng">${icon('plus')}Zutat hinzufügen</button>
      </section>

      <section class="form-sec">
        <h2>Arbeitsschritte.</h2>
        <p class="lead">In der richtigen Reihenfolge. Gibst du bei Ruhezeiten einen Spielraum an, legt der Zeitplan die Arbeitsschritte automatisch außerhalb deiner Schul-, Arbeits- und Schlafenszeiten.</p>
        <div id="steps"></div>
        <button type="button" class="add-link" id="addStep">${icon('plus')}Schritt hinzufügen</button>
      </section>
    </div>

    <div class="save-bar">
      <div class="wrap narrow">
        <a class="more-btn" href="${backHref}">Abbrechen</a>
        <button type="button" class="pill" id="saveBtn2">Sichern</button>
      </div>
    </div>
  `);

  function readForm() {
    r.name = $('#name').value.trim();
    r.description = $('#desc').value.trim();
    r.ingredients = $$('#ings .ing-row').map(row => ({
      name: $('.ing-name', row).value.trim(),
      amount: $('.ing-amount', row).value === '' ? '' : Math.max(0, Number($('.ing-amount', row).value) || 0),
      unit: $('.ing-unit', row).value
    }));
    r.steps = $$('#steps .step-row').map(row => {
      const val = sel => Math.max(0, Number($(sel, row).value) || 0);
      const minutes = Math.round(val('.st-h') * 60 + val('.st-m'));
      const active = $('.st-type:checked', row).value === 'active';
      const maxRaw = Math.round(val('.st-max-h') * 60 + val('.st-max-m'));
      return {
        name: $('.st-name', row).value.trim(),
        minutes,
        active,
        maxMinutes: active ? minutes : Math.max(minutes, maxRaw),
        note: $('.st-note', row).value.trim()
      };
    });
  }

  function drawBase() {
    $('#baseVal').textContent = pizzaWord(r.basePizzas);
    $('#baseMinus').disabled = r.basePizzas <= 1;
    $('#basePlus').disabled = r.basePizzas >= 100;
  }

  function draw() {
    $('#ings').innerHTML = r.ingredients.map(ingRow).join('');
    $('#steps').innerHTML = r.steps.map((s, i) => stepCard(s, i, r.steps.length)).join('');
  }

  drawBase();
  draw();

  $('#baseMinus').addEventListener('click', () => { r.basePizzas = Math.max(1, r.basePizzas - 1); drawBase(); });
  $('#basePlus').addEventListener('click', () => { r.basePizzas = Math.min(100, r.basePizzas + 1); drawBase(); });

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
    r.ingredients.splice($$('#ings .ing-row').indexOf(btn.closest('.ing-row')), 1);
    draw();
  });

  $('#steps').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
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
    const active = e.target.value === 'active';
    $('.flexbox', row).hidden = active;
    $('.st-dur-label', row).textContent = active ? 'Dauer' : 'Mindestens';
  });

  function submit() {
    readForm();
    if (!r.name) {
      $('#name').focus();
      return toast('Bitte gib dem Rezept einen Namen.');
    }
    r.ingredients = r.ingredients.filter(i => i.name || i.amount !== '');
    r.ingredients.forEach(i => { i.amount = Number(i.amount) || 0; });
    r.steps = r.steps.filter(s => s.name || s.minutes);
    r.steps.forEach((s, i) => { if (!s.name) s.name = 'Schritt ' + (i + 1); });
    if (!r.ingredients.length && !r.steps.length && !confirm('Das Rezept hat weder Zutaten noch Schritte. Trotzdem sichern?')) return;

    const idx = data.recipes.findIndex(x => x.id === r.id);
    if (idx >= 0) data.recipes[idx] = r;
    else data.recipes.push(r);
    save();
    toast('Rezept gesichert');
    location.hash = '#/rezept/' + r.id;
  }

  $('#saveBtn').addEventListener('click', submit);
  $('#saveBtn2').addEventListener('click', submit);
}

/* ------------------------------------------------------------ Einstellungen */

function busyKind(label) {
  const l = String(label).toLowerCase();
  if (/schlaf|nacht/.test(l)) return 'moon';
  if (/schul|uni|vorlesung|kurs/.test(l)) return 'school';
  if (/arbeit|job|büro|schicht|dienst/.test(l)) return 'work';
  if (/sport|training|verein/.test(l)) return 'sport';
  return 'pin';
}

function renderSettings() {
  document.title = 'Einstellungen – Pizza-Rechner';
  setNav('einstellungen');

  render(`
    ${localNav('Einstellungen', `
      <button type="button" class="ln-link hide-sm" data-scroll="zeiten">Zeiten</button>
      <button type="button" class="ln-link hide-sm" data-scroll="kurzbefehl">Erinnerungen</button>
      <button type="button" class="ln-link hide-sm" data-scroll="daten">Daten</button>`)}

    <section class="page-hero center">
      <div class="wrap">
        <p class="eyebrow">Einstellungen</p>
        <h1 class="hero-title">Dein Tag.<br>Deine Regeln.</h1>
        <p class="sub">Trag ein, wann du keine Zeit hast. Der Zeitplan richtet sich danach.</p>
      </div>
    </section>

    <section class="sec alt center" id="zeiten">
      <div class="wrap narrow">
        <h2 class="sec-title reveal">Belegte Zeiten.</h2>
        <p class="sub reveal">Schule, Arbeit, Training, Schlaf – in diesen Zeiten plant der Pizza-Rechner keine Arbeitsschritte ein.</p>
        <div class="list-card" id="busyList"></div>
        <div class="ctas"><button type="button" class="pill" id="addBusy">Zeit hinzufügen</button></div>
      </div>
    </section>

    <section class="sec center" id="kurzbefehl">
      <div class="wrap narrow">
        <p class="eyebrow reveal">Apple Erinnerungen</p>
        <h2 class="sec-title reveal">Ein Kurzbefehl.<br>Einmal einrichten.</h2>
        <p class="sub reveal">Websites dürfen nicht direkt in die Erinnerungen-App schreiben – ein kleiner Kurzbefehl übernimmt das.</p>
        <ol class="howto">
          <li><div>Öffne die App <b>Kurzbefehle</b> und tippe auf <b>＋</b>.</div></li>
          <li><div>Nenne den Kurzbefehl genau <code>${SHORTCUT_NAME}</code>.</div></li>
          <li><div>Aktion <b>„Text teilen“</b> hinzufügen: Eingabe = <i>Kurzbefehleingabe</i>, teilen bei <b>Neue Zeilen</b>.</div></li>
          <li><div>Aktion <b>„Wiederholen mit jedem Objekt“</b> hinzufügen (in „Geteilter Text“).</div></li>
          <li><div>Darin: <b>„Text teilen“</b> mit <i>Wiederholungsobjekt</i>, Trennzeichen <b>Eigene</b> → <code>|</code></div></li>
          <li><div>Darin: <b>„Objekt aus Liste abrufen“</b> → <b>Erstes Objekt</b> (der Titel).</div></li>
          <li><div>Darin: noch einmal <b>„Objekt aus Liste abrufen“</b> aus „Geteilter Text“ → <b>Letztes Objekt</b> (die Uhrzeit).</div></li>
          <li><div>Darin: <b>„Erinnerung hinzufügen“</b> – Titel = <i>erstes Objekt</i>, bei <b>Erinnern</b> → „Zu einem Zeitpunkt“ das <i>letzte Objekt</i> wählen.</div></li>
          <li><div>Fertig. „In Erinnerungen übernehmen“ beim Rezept legt jetzt alle Schritte als Erinnerungen an.</div></li>
        </ol>
        <div class="ctas"><button type="button" class="pill outline" id="testShortcut">Kurzbefehl testen</button></div>
      </div>
    </section>

    <section class="sec dark on-dark center" id="daten">
      <div class="wrap">
        <p class="eyebrow reveal">Daten</p>
        <h2 class="sec-title reveal">Deine Rezepte.<br>Auf deinem Gerät.</h2>
        <p class="sub reveal">Alles bleibt in diesem Browser. Mit einer Sicherung nimmst du es auf ein anderes Gerät mit.</p>
        <div class="features">
          <div class="feature reveal"><h3>Sichern.</h3><p class="grow">Alle Rezepte, Zeiten und Einstellungen als Datei.</p><button type="button" class="pill" id="export">Sicherung exportieren</button></div>
          <div class="feature reveal"><h3>Laden.</h3><p class="grow">Eine Sicherung einspielen. Die aktuellen Daten werden ersetzt.</p>
            <label class="pill" style="align-self:flex-start;margin-top:8px">Sicherung laden<input type="file" id="import" accept="application/json,.json" hidden></label></div>
          <div class="feature reveal"><h3>Neu anfangen.</h3><p class="grow">Löscht alle Rezepte und Zeiten. Die eingebauten Rezepte kommen danach wieder.</p><button type="button" class="more-btn danger" id="reset" style="align-self:flex-start">Alles zurücksetzen</button></div>
        </div>
      </div>
    </section>
  `);

  function drawBusy() {
    const list = $('#busyList');
    if (!data.busy.length) {
      list.innerHTML = '<div class="list-empty">Noch keine Zeiten eingetragen.</div>';
      return;
    }
    list.innerHTML = data.busy.map(b => {
      const days = WEEK_ORDER.filter(d => b.days.includes(d)).map(d => DAY_NAMES[d]);
      const dayStr = days.length === 7 ? 'Täglich' : days.length === 5 && !b.days.includes(0) && !b.days.includes(6) ? 'Mo–Fr' : days.join(', ');
      const overnight = parseHM(b.to) <= parseHM(b.from) ? ' (über Nacht)' : '';
      return `
        <div class="list-row">
          <span class="ico">${icon(busyKind(b.label))}</span>
          <div class="main"><div class="t">${esc(b.label)}</div><div class="s">${dayStr} · ${esc(b.from)}–${esc(b.to)}${overnight}</div></div>
          <button type="button" class="more-btn danger" data-id="${esc(b.id)}" aria-label="${esc(b.label)} entfernen">Entfernen</button>
        </div>`;
    }).join('');
  }
  drawBusy();

  $('#busyList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const b = data.busy.find(x => x.id === btn.dataset.id);
    if (!b || !confirm(`„${b.label}“ entfernen?`)) return;
    data.busy = data.busy.filter(x => x.id !== b.id);
    save();
    drawBusy();
  });

  $('#addBusy').addEventListener('click', () => {
    openSheet({
      title: 'Neue Zeit.',
      doneLabel: 'Hinzufügen',
      body: `
        <label class="field"><input id="bLabel" placeholder=" "><span>Bezeichnung, z. B. Schule</span></label>
        <p class="dur-label">Wiederholen</p>
        <div class="days" role="group" aria-label="Wochentage">
          ${WEEK_ORDER.map(d => `<label><input type="checkbox" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}
        </div>
        <div class="grid-2">
          <label class="field"><input id="bFrom" type="time" value="08:00" style="min-width:0;width:100%;padding:26px 16px 8px"><span>Von</span></label>
          <label class="field"><input id="bTo" type="time" value="16:00" style="min-width:0;width:100%;padding:26px 16px 8px"><span>Bis</span></label>
        </div>
        <p class="fine" style="margin-top:12px">Liegt „Bis“ vor „Von“, geht die Zeit über Mitternacht – z. B. Schlafen 23:00–07:00.</p>`,
      onOpen: body => setTimeout(() => $('#bLabel', body).focus(), 380),
      onDone: () => {
        const label = $('#bLabel').value.trim();
        const days = $$('#sheetBody .days input:checked').map(i => Number(i.value));
        const from = $('#bFrom').value, to = $('#bTo').value;
        if (!label) { $('#bLabel').focus(); toast('Bitte eine Bezeichnung eingeben.'); return false; }
        if (!days.length) { toast('Bitte mindestens einen Tag auswählen.'); return false; }
        if (!from || !to || from === to) { toast('Bitte gültige Uhrzeiten eingeben.'); return false; }
        data.busy.push({ id: uid(), label, days, from, to });
        save();
        drawBusy();
        toast('Zeit hinzugefügt');
      }
    });
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
      toast('Sicherung geladen');
      renderSettings();
    } catch (err) {
      toast('Datei konnte nicht gelesen werden.');
    }
  });

  $('#reset').addEventListener('click', () => {
    if (!confirm('Wirklich alle Rezepte und Zeiten löschen?')) return;
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
