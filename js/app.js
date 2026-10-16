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

/* ------------------------------------------------------------ Symbole (SVG) */

const ICONS = {
  back: '<path d="M11 2 2 11l9 9"/>',
  chevron: '<path d="m1.5 1.5 5 5.5-5 5.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  pizza: '<path d="M12 3 3.5 19.2a1 1 0 0 0 .9 1.3h15.2a1 1 0 0 0 .9-1.3L12 3Z"/><path d="M5.6 16.5c4.2-1.6 8.6-1.6 12.8 0"/><circle cx="11" cy="12" r="1.3"/><circle cx="13.6" cy="15.6" r="1.1"/><circle cx="9.4" cy="16.4" r="1"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.5M12 17.2v.1"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10Z"/>',
  school: '<path d="M2.5 9 12 4.5 21.5 9 12 13.5 2.5 9Z"/><path d="M6.5 11v5c3.5 2.5 7.5 2.5 11 0v-5M21.5 9v5"/>',
  work: '<rect x="3" y="7.5" width="18" height="12" rx="2.5"/><path d="M8.5 7.5V5.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M3 13h18"/>',
  sport: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17M6 6c3 2.5 3 9.5 0 12M18 6c-3 2.5-3 9.5 0 12"/>',
  pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/>',
  upload: '<path d="M12 15.5v-11M7 9l5-5 5 5M5 19.5h14"/>',
  reset: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 3.5v5h5"/>',
  arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  play: '<path d="M7 4.5v15l12-7.5-12-7.5Z"/>',
  scale: '<path d="M12 4v16M6 20h12M4 8h16M7 8l-3 7h6L7 8ZM17 8l-3 7h6l-3-7Z"/>',
  wand: '<path d="m4 20 11-11M14 4v3M12.5 5.5h3M19 9v3M17.5 10.5h3M18 3.5v1.5M17.25 4.25h1.5"/>'
};

function icon(name, cls = '') {
  return `<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}
const CHEV = '<svg class="chev" viewBox="0 0 8 14" aria-hidden="true"><path d="m1.5 1.5 5 5.5-5 5.5"/></svg>';
const BACK = '<svg viewBox="0 0 13 22" aria-hidden="true"><path d="M11 2 2 11l9 9"/></svg>';

/* ------------------------------------------------------------ Gerüst */

const navbar = $('#navbar');
const tabbar = $('#tabbar');
let titleObserver = null;

// Setzt Navigationsleiste und Tab-Leiste für die aktuelle Seite
function setChrome({ title = '', left = '', right = '', tab = null, solid = false }) {
  $('#navTitle').textContent = title;
  $('#navLeft').innerHTML = left;
  $('#navRight').innerHTML = right;
  navbar.classList.toggle('solid', solid);
  navbar.classList.remove('scrolled');
  tabbar.hidden = !tab;
  document.body.classList.toggle('no-tabbar', !tab);
  $$('a', tabbar).forEach(a => {
    const active = a.dataset.tab === tab;
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

// Kleiner Titel in der Leiste erscheint, sobald der große Titel weggescrollt ist
function watchLargeTitle() {
  if (titleObserver) titleObserver.disconnect();
  const lt = $('.large-title', app);
  if (!lt || !('IntersectionObserver' in window)) return;
  titleObserver = new IntersectionObserver(([e]) => {
    navbar.classList.toggle('scrolled', !e.isIntersecting);
  }, { rootMargin: `-${navbar.offsetHeight}px 0px 0px 0px` });
  titleObserver.observe(lt);
}

function render(html, { modal = false } = {}) {
  app.innerHTML = `<div class="page ${modal ? 'modal' : ''}">${html}</div>`;
  watchLargeTitle();
}

function section({ header = '', footer = '', body, id = '' }) {
  return `
    <div class="section" ${id ? `id="${id}"` : ''}>
      ${header ? `<div class="section-header">${header}</div>` : ''}
      <div class="group">${body}</div>
      ${footer ? `<div class="section-footer">${footer}</div>` : ''}
    </div>`;
}

// Eine Listenzeile. tag: 'div' | 'a' | 'button'
function cell({ tag = 'div', attrs = '', cls = '', lead = '', title = '', sub = '', note = '', extra = '', trail = '', chevron = false }) {
  return `
    <${tag} class="cell ${cls}" ${attrs}>
      ${lead}
      <div class="cell-body">
        <div class="cell-main">
          ${title ? `<div class="cell-title">${title}</div>` : ''}
          ${sub ? `<div class="cell-sub">${sub}</div>` : ''}
          ${note ? `<div class="cell-note">${note}</div>` : ''}
          ${extra}
        </div>
        ${trail}
        ${chevron ? CHEV : ''}
      </div>
    </${tag}>`;
}

const ico = (name, color, lg = false) => `<span class="ico ${color} ${lg ? 'lg' : ''}">${icon(name)}</span>`;

function stepperHtml(id, value, min = 1, max = 200) {
  return `
    <div class="stepper" role="group" aria-label="Anzahl ändern">
      <button type="button" id="${id}Minus" aria-label="Weniger" ${value <= min ? 'disabled' : ''}>${icon('minus')}</button>
      <span class="sep" aria-hidden="true"></span>
      <button type="button" id="${id}Plus" aria-label="Mehr" ${value >= max ? 'disabled' : ''}>${icon('plus')}</button>
    </div>`;
}

function fmtDayLong(date) {
  const today = startOfDay(new Date());
  const diff = Math.round((startOfDay(date) - today) / 86400000);
  const rel = diff === 0 ? 'Heute' : diff === 1 ? 'Morgen' : diff === -1 ? 'Gestern' : null;
  const str = date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
  return rel ? `${rel} · ${str}` : str;
}

/* ------------------------------------------------------------ Sheet */

const sheet = $('#sheet');
let sheetOnDone = null;

function openSheet({ title, doneLabel = 'Fertig', body, onOpen, onDone }) {
  $('#sheetTitle').textContent = title;
  $('#sheetDone').textContent = doneLabel;
  $('#sheetBody').innerHTML = body;
  sheetOnDone = onDone;
  sheet.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  document.body.style.overflow = 'hidden';
  if (onOpen) onOpen($('#sheetBody'));
}

function closeSheet() {
  sheet.classList.remove('open');
  document.body.style.overflow = '';
  setTimeout(() => { if (!sheet.classList.contains('open')) sheet.hidden = true; }, 360);
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
  setChrome({
    title: 'Rezepte',
    tab: 'rezepte',
    right: `<a class="nav-btn icon-only" href="#/neu" aria-label="Neues Rezept">${icon('plus')}</a>`
  });
  const now = new Date();

  const rows = data.recipes.map(r => {
    const ball = baseBallWeight(r);
    const v = data.view[r.id];
    const planned = v && v.eatAt && new Date(v.eatAt) > now ? new Date(v.eatAt) : null;
    const facts = [fmtDuration(totalMinutes(r)), pizzaWord(r.basePizzas)];
    if (ball) facts.push(fmtAmount(ball) + ' g');
    return cell({
      tag: 'a',
      attrs: `href="#/rezept/${esc(r.id)}"`,
      lead: ico('pizza', 'pizza', true),
      title: esc(r.name),
      sub: facts.join(' · '),
      extra: planned ? `<div class="tag ok">${icon('calendar', 'inline-icon')}Geplant: ${esc(fmtDay(planned))}, ${fmtTime(planned)} Uhr</div>` : '',
      chevron: true
    });
  }).join('');

  render(`
    <h1 class="large-title">Rezepte</h1>
    ${data.recipes.length ? section({
      body: rows,
      footer: `${data.recipes.length} ${data.recipes.length === 1 ? 'Rezept' : 'Rezepte'}. Tippe auf ein Rezept, um es für deine Anzahl Pizzen umzurechnen und zu planen.`
    }) : `
      <div class="empty">
        <svg class="big-ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS.pizza}</svg>
        <h2>Keine Rezepte</h2>
        <p>Leg dein erstes Teigrezept mit Zutaten, Arbeitsschritten und Ruhezeiten an.</p>
        <a class="btn capsule" href="#/neu">${icon('plus')}Neues Rezept</a>
      </div>`}
    ${section({
      body: cell({ tag: 'a', attrs: 'href="#/neu"', cls: 'action', lead: ico('plus', 'green'), title: 'Neues Rezept' }),
      footer: 'Tipp: In Safari über <b>Teilen → Zum Home-Bildschirm</b> wird der Pizza-Rechner zur App auf deinem iPhone.'
    })}
  `);
}

/* ------------------------------------------------------------ Rezept */

let liveTimer = null; // aktualisiert den Zeitplan jede Minute ("läuft gerade", "in 2 h")

function renderRecipe(recipe) {
  document.title = recipe.name + ' – Pizza-Rechner';
  setChrome({
    title: recipe.name,
    tab: 'rezepte',
    left: `<a class="nav-btn back" href="#/">${BACK}Rezepte</a>`,
    right: `<a class="nav-btn" href="#/bearbeiten/${esc(recipe.id)}">Bearbeiten</a>`
  });

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
    <h1 class="large-title">${esc(recipe.name)}</h1>
    ${recipe.description ? `<p class="subtitle">${esc(recipe.description)}</p>` : ''}
    <div id="nextStep"></div>

    ${section({
      header: 'Menge',
      body: cell({
        title: 'Pizzen',
        trail: `<span class="big-count" id="countVal" aria-live="polite">${state.count}</span>${stepperHtml('count', state.count)}`
      }) + (baseBall ? cell({
        title: 'Gewicht pro Teigling',
        trail: `
          <button type="button" class="text-btn" id="ballReset" ${state.ballWeight ? '' : 'hidden'} aria-label="Gewicht auf Rezeptwert zurücksetzen">Zurücksetzen</button>
          <input type="number" id="ball" class="num-in pill-in" min="50" max="2000" step="5" inputmode="numeric" value="${Math.round(state.ballWeight || baseBall)}" aria-label="Gewicht pro Teigling in Gramm">
          <span class="unit-lbl">g</span>`
      }) : ''),
      footer: baseBall ? 'Neapolitanisch ca. 250–280 g, Blechpizza eher 350–450 g.' : ''
    })}

    <div class="section">
      <div class="section-header">Zutaten</div>
      <div class="group" id="ingGroup"></div>
      <div class="section-footer" id="ingFooter"></div>
    </div>

    ${hasSteps ? `
      ${section({
        header: 'Zeitplan',
        body: cell({
          cls: 'eat-cell',
          title: 'Essen um',
          trail: `<input type="datetime-local" id="eatAt" value="${toLocalInputValue(state.eatAt)}" aria-label="Essenszeit">`
        }) + '<div id="planNotice"></div>',
        footer: '<span id="planFooter"></span>'
      })}
      <div id="timeline"></div>

      ${section({
        header: 'Erinnerungen',
        body: cell({
          title: 'Erinnern',
          trail: `<select id="alarm" class="cell-select" aria-label="Erinnerung">
            ${[0, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${Number(data.settings.alarmMinutes) === m ? 'selected' : ''}>${m === 0 ? 'Zum Zeitpunkt' : m + ' Min. vorher'}</option>`).join('')}
          </select>`
        }) +
          cell({ tag: 'button', attrs: 'type="button" id="ics"', lead: ico('calendar', 'red'), title: 'In Kalender übernehmen', chevron: true }) +
          cell({ tag: 'button', attrs: 'type="button" id="reminders"', lead: ico('bell', 'orange'), title: 'In Erinnerungen übernehmen', chevron: true }),
        footer: `<b>Kalender</b> funktioniert sofort: Datei öffnen und „Alle hinzufügen“ tippen – jeder Schritt bekommt einen Alarm.
          Für <b>Erinnerungen</b> brauchst du einmalig einen Kurzbefehl, siehe <a href="#/einstellungen">Einstellungen</a>.`
      })}` : section({
        header: 'Zeitplan',
        body: cell({ tag: 'a', attrs: `href="#/bearbeiten/${esc(recipe.id)}"`, cls: 'action', lead: ico('plus', 'green'), title: 'Arbeitsschritte hinzufügen', chevron: true }),
        footer: 'Dieses Rezept hat noch keine Arbeitsschritte. Sobald du welche einträgst, erscheint hier dein Zeitplan.'
      })}

    ${section({
      body: cell({ tag: 'button', attrs: 'type="button" id="dup"', cls: 'action', title: 'Rezept duplizieren' }) +
        cell({ tag: 'button', attrs: 'type="button" id="del"', cls: 'destructive', title: 'Rezept löschen' })
    })}
  `);

  const ballEl = $('#ball');

  function persist() {
    data.view[recipe.id] = { count: state.count, ballWeight: state.ballWeight, eatAt: state.eatAt.toISOString() };
    save();
  }

  function renderIngredients() {
    const f = scaleFactor(recipe, state.count, state.ballWeight);
    const total = baseDoughWeight(recipe) * f;
    $('#ingGroup').innerHTML = recipe.ingredients.map(i => cell({
      title: esc(i.name),
      trail: `<span class="cell-value strong">${fmtAmount((Number(i.amount) || 0) * f)} ${esc(i.unit)}</span>`
    })).join('') + (total ? cell({
      title: '<span style="color:var(--label-2)">Teig gesamt</span>',
      trail: `<span class="cell-value">${fmtAmount(total)} g</span>`
    }) : '') || cell({ title: '<span style="color:var(--label-2)">Keine Zutaten eingetragen.</span>' });
    $('#ingFooter').textContent = total
      ? `${pizzaWord(state.count)} à ${fmtAmount(total / state.count)} g.`
      : '';
    $('#countVal').textContent = state.count;
    $('#countMinus').disabled = state.count <= 1;
    $('#countPlus').disabled = state.count >= 200;
  }

  function renderNextStep() {
    const box = $('#nextStep');
    const now = new Date();
    const running = currentPlan.find(st => st.start <= now && now < st.end);
    const next = currentPlan.find(st => st.start > now);
    if (!currentPlan.length || (!running && !next && state.eatAt <= now)) {
      box.innerHTML = '';
      return;
    }
    const target = next || { name: 'Pizza essen', start: state.eatAt };
    box.innerHTML = section({
      body: cell({
        cls: 'next-card',
        lead: ico('clock', 'green'),
        title: `Als Nächstes: ${esc(target.name)}`,
        sub: `${esc(fmtDay(target.start))}, ${fmtTime(target.start)} Uhr · ${fmtUntil(target.start)}`,
        note: running ? `Läuft gerade: ${esc(running.name)}` : ''
      })
    });
  }

  function renderPlan() {
    if (!hasSteps) return;
    const plan = planSchedule(recipe, state.eatAt);
    currentPlan = plan;
    const now = new Date();

    // Hinweise
    const notices = [];
    if (plan[0].start < now) {
      notices.push(cell({
        cls: 'notice-cell',
        lead: ico('alert', 'orange'),
        title: `Dafür hättest du schon ${esc(fmtDay(plan[0].start))} um ${fmtTime(plan[0].start)} Uhr anfangen müssen.`,
        extra: '<button type="button" class="text-btn" id="setEarliest" style="padding-left:0">Frühestmöglichen Termin wählen</button>'
      }));
    }
    const conflicted = plan.filter(p => p.conflicts.length);
    if (conflicted.length) {
      notices.push(cell({
        cls: 'notice-cell',
        lead: ico('alert', 'orange'),
        title: `${conflicted.length === 1 ? 'Ein Schritt fällt' : conflicted.length + ' Schritte fallen'} in deine belegten Zeiten.`,
        sub: 'Wähle eine andere Essenszeit, gib Ruhezeiten mehr Spielraum oder passe deine <a href="#/einstellungen">Zeiten</a> an.'
      }));
    } else if (data.busy.length && plan[0].start >= now) {
      notices.push(cell({ cls: 'notice-cell', lead: ico('check', 'green'), title: 'Passt zu deinen Schul-, Arbeits- und Schlafenszeiten.' }));
    }
    $('#planNotice').innerHTML = notices.join('');
    $('#planFooter').textContent = `Gesamtdauer ${fmtDuration((state.eatAt - plan[0].start) / 60000)}. Start: ${fmtDay(plan[0].start)}, ${fmtTime(plan[0].start)} Uhr.`;
    const se = $('#setEarliest');
    if (se) se.addEventListener('click', () => {
      state.eatAt = earliestEatTime(recipe);
      $('#eatAt').value = toLocalInputValue(state.eatAt);
      persist();
      renderPlan();
    });

    // Schritte nach Tagen gruppiert
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
      if (st.extendedBy > 0) tags.push(`<div class="tag ok">${icon('wand', 'inline-icon')}${fmtDuration(st.extendedBy)} länger, damit es in deinen Tag passt</div>`);
      for (const c of st.conflicts) tags.push(`<div class="tag warn">${icon('alert', 'inline-icon')}Überschneidet sich mit ${esc(c.label)} (${fmtTime(c.start)}–${fmtTime(c.end)})</div>`);
      if (isNow) tags.push(`<div class="tag ok">${icon('play', 'inline-icon')}Läuft gerade</div>`);
      const endsOtherDay = startOfDay(st.end).getTime() !== startOfDay(st.start).getTime();
      pushTo(st.start, `
        <div class="cell step-cell ${isDone ? 'done' : ''} ${isNow ? 'now' : ''}">
          <div class="cell-body">
            <span class="step-time">${fmtTime(st.start)}</span>
            <span class="step-dot ${st.active ? '' : 'passive'}" aria-hidden="true"></span>
            <div class="cell-main">
              <div class="cell-title">${idx + 1}. ${esc(st.name)}</div>
              <div class="cell-sub">${st.active ? 'Arbeit' : 'Ruhezeit'} · ${fmtDuration(st.duration)} · bis ${fmtTime(st.end)} Uhr${endsOtherDay ? ' (' + esc(fmtDay(st.end)) + ')' : ''}</div>
              ${st.note ? `<div class="cell-note">${esc(st.note)}</div>` : ''}
              ${tags.join('')}
            </div>
          </div>
        </div>`);
    });
    pushTo(state.eatAt, `
      <div class="cell step-cell final">
        <div class="cell-body">
          <span class="step-time">${fmtTime(state.eatAt)}</span>
          <span class="step-dot" aria-hidden="true" style="background:var(--green)"></span>
          <div class="cell-main"><div class="cell-title">Guten Appetit! 🍕</div></div>
        </div>
      </div>`);
    $('#timeline').innerHTML = days.map(d => section({ header: esc(fmtDayLong(d.date)), body: d.rows.join('') })).join('');

    renderNextStep();
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
  setChrome({
    title,
    solid: true,
    left: `<a class="nav-btn" href="${backHref}">Abbrechen</a>`,
    right: '<button type="button" class="nav-btn bold" id="saveBtn">Sichern</button>'
  });

  const units = ['g', 'ml', 'TL', 'EL', 'Stk', 'Prise'];

  function ingRow(i) {
    const unitOptions = units.includes(i.unit) ? units : [i.unit, ...units];
    return `
      <div class="cell ing-row">
        <button type="button" class="round-btn minus remove" aria-label="Zutat entfernen">${icon('minus')}</button>
        <div class="cell-body">
          <input class="ing-name field-full" placeholder="Zutat" value="${esc(i.name)}" aria-label="Zutat">
          <input class="ing-amount num-in field-right" type="number" step="any" min="0" inputmode="decimal" placeholder="0" value="${esc(i.amount)}" aria-label="Menge">
          <select class="ing-unit cell-select unit-select" aria-label="Einheit">${unitOptions.map(u => `<option ${u === i.unit ? 'selected' : ''}>${esc(u)}</option>`).join('')}</select>
        </div>
      </div>`;
  }

  function durInputs(cls, minutes) {
    const h = Math.floor((minutes || 0) / 60), m = (minutes || 0) % 60;
    return `
      <input class="${cls}-h num-in small pill-in" type="number" min="0" inputmode="numeric" value="${h}" aria-label="Stunden"><span class="unit-lbl">Std.</span>
      <input class="${cls}-m num-in small pill-in" type="number" min="0" max="59" inputmode="numeric" value="${m}" aria-label="Minuten"><span class="unit-lbl">Min.</span>`;
  }

  function stepSection(s, idx, total) {
    const max = Math.max(s.maxMinutes || 0, s.minutes || 0);
    return `
      <div class="section step-row">
        <div class="section-header">
          <span>Schritt ${idx + 1}</span>
          <span class="hdr-actions">
            <button type="button" class="icon-btn up" aria-label="Schritt nach oben" ${idx === 0 ? 'disabled' : ''}>${icon('arrowUp')}</button>
            <button type="button" class="icon-btn down" aria-label="Schritt nach unten" ${idx === total - 1 ? 'disabled' : ''}>${icon('arrowDown')}</button>
            <button type="button" class="icon-btn red remove" aria-label="Schritt löschen">${icon('trash')}</button>
          </span>
        </div>
        <div class="group">
          <div class="cell"><div class="cell-body"><input class="st-name field-full" placeholder="Name, z. B. Stockgare" value="${esc(s.name)}" aria-label="Name des Schritts"></div></div>
          <div class="cell"><div class="cell-body">
            <div class="segmented" role="radiogroup" aria-label="Art des Schritts">
              <label><input type="radio" name="type${idx}" value="active" class="st-type" ${s.active ? 'checked' : ''}><span>Arbeit</span></label>
              <label><input type="radio" name="type${idx}" value="passive" class="st-type" ${!s.active ? 'checked' : ''}><span>Ruhezeit</span></label>
            </div>
          </div></div>
          <div class="cell"><div class="cell-body"><div class="cell-main cell-title st-dur-label">${s.active ? 'Dauer' : 'Mindestens'}</div>${durInputs('st', s.minutes)}</div></div>
          <div class="cell flexbox" ${s.active ? 'hidden' : ''}><div class="cell-body"><div class="cell-main cell-title">Höchstens</div>${durInputs('st-max', max)}</div></div>
          <div class="cell"><div class="cell-body"><input class="st-note field-full" placeholder="Notiz (optional)" value="${esc(s.note)}" aria-label="Notiz"></div></div>
        </div>
      </div>`;
  }

  render(`
    <div style="height:12px"></div>
    ${section({
      body: `
        <div class="cell"><div class="cell-body"><input id="name" class="field-full" placeholder="Name des Rezepts" value="${esc(r.name)}" aria-label="Name des Rezepts"></div></div>
        <div class="cell"><div class="cell-body"><textarea id="desc" class="field-full" placeholder="Beschreibung (optional)" aria-label="Beschreibung">${esc(r.description)}</textarea></div></div>
        <div class="cell"><div class="cell-body"><div class="cell-main cell-title">Ergibt</div><span class="cell-value" id="baseVal"></span>${stepperHtml('base', r.basePizzas, 1, 100)}</div></div>`
    })}

    <div class="section">
      <div class="section-header">Zutaten</div>
      <div class="group">
        <div id="ings"></div>
        ${cell({ tag: 'button', attrs: 'type="button" id="addIng"', cls: 'action', lead: `<span class="round-btn plus" aria-hidden="true">${icon('plus')}</span>`, title: 'Zutat hinzufügen' })}
      </div>
      <div class="section-footer">Mengen für die oben angegebene Anzahl Pizzen. Zutaten in g oder ml zählen zum Teiggewicht.</div>
    </div>

    <div id="steps"></div>
    ${section({
      body: cell({ tag: 'button', attrs: 'type="button" id="addStep"', cls: 'action', lead: `<span class="round-btn plus" aria-hidden="true">${icon('plus')}</span>`, title: 'Schritt hinzufügen' }),
      footer: '<b>Arbeit</b> = du musst dabei sein. <b>Ruhezeit</b> = der Teig arbeitet allein. Gibst du bei Ruhezeiten einen Spielraum (mindestens/höchstens) an, legt der Zeitplan die Arbeitsschritte automatisch außerhalb deiner Schul-, Arbeits- und Schlafenszeiten.'
    })}

    <button type="button" class="btn" id="saveBtn2">Sichern</button>
  `, { modal: true });

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
    $('#steps').innerHTML = r.steps.map((s, i) => stepSection(s, i, r.steps.length)).join('');
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
  if (/schlaf|nacht/.test(l)) return ['moon', 'indigo'];
  if (/schul|uni|vorlesung|kurs/.test(l)) return ['school', 'blue'];
  if (/arbeit|job|büro|schicht|dienst/.test(l)) return ['work', 'brown'];
  if (/sport|training|verein/.test(l)) return ['sport', 'green'];
  return ['pin', 'teal'];
}

function renderSettings() {
  document.title = 'Einstellungen – Pizza-Rechner';
  setChrome({ title: 'Einstellungen', tab: 'einstellungen' });

  render(`
    <h1 class="large-title">Einstellungen</h1>

    <div class="section">
      <div class="section-header">Belegte Zeiten</div>
      <div class="group">
        <div id="busyList"></div>
        ${cell({ tag: 'button', attrs: 'type="button" id="addBusy"', cls: 'action', lead: `<span class="round-btn plus" aria-hidden="true">${icon('plus')}</span>`, title: 'Zeit hinzufügen' })}
      </div>
      <div class="section-footer">Schule, Arbeit, Training, Schlaf … In diesen Zeiten plant der Pizza-Rechner keine Arbeitsschritte ein und warnt dich, wenn es nicht anders geht.</div>
    </div>

    <div class="section">
      <div class="section-header">Apple Erinnerungen</div>
      <div class="group">
        <details class="cell-wrap">
          <summary class="cell" style="cursor:pointer">
            ${ico('bell', 'orange')}
            <div class="cell-body"><div class="cell-main"><div class="cell-title">Kurzbefehl einrichten</div></div>${CHEV}</div>
          </summary>
          <ol class="howto">
            <li>Öffne die App <b>Kurzbefehle</b> und tippe auf <b>＋</b>.</li>
            <li>Nenne den Kurzbefehl genau <code>${SHORTCUT_NAME}</code>.</li>
            <li>Aktion <b>„Text teilen“</b> hinzufügen: Eingabe = <i>Kurzbefehleingabe</i>, teilen bei <b>Neue Zeilen</b>.</li>
            <li>Aktion <b>„Wiederholen mit jedem Objekt“</b> hinzufügen (in „Geteilter Text“).</li>
            <li>Darin: <b>„Text teilen“</b> mit <i>Wiederholungsobjekt</i>, Trennzeichen <b>Eigene</b> → <code>|</code></li>
            <li>Darin: <b>„Objekt aus Liste abrufen“</b> → <b>Erstes Objekt</b> (der Titel).</li>
            <li>Darin: noch einmal <b>„Objekt aus Liste abrufen“</b> aus „Geteilter Text“ → <b>Letztes Objekt</b> (die Uhrzeit).</li>
            <li>Darin: <b>„Erinnerung hinzufügen“</b> – Titel = <i>erstes Objekt</i>, bei <b>Erinnern</b> → „Zu einem Zeitpunkt“ das <i>letzte Objekt</i> wählen.</li>
            <li>Fertig! „In Erinnerungen übernehmen“ beim Rezept legt jetzt alle Schritte als Erinnerungen an.</li>
          </ol>
        </details>
        ${cell({ tag: 'button', attrs: 'type="button" id="testShortcut"', lead: ico('play', 'green'), title: 'Kurzbefehl testen', chevron: true })}
      </div>
      <div class="section-footer">Websites dürfen nicht direkt in die Erinnerungen-App schreiben – der Kurzbefehl übernimmt das. Ohne Einrichtung funktioniert „In Kalender übernehmen“.</div>
    </div>

    <div class="section">
      <div class="section-header">Daten</div>
      <div class="group">
        ${cell({ tag: 'button', attrs: 'type="button" id="export"', lead: ico('download', 'blue'), title: 'Sicherung exportieren', chevron: true })}
        <label class="cell" style="cursor:pointer;margin:0">
          ${ico('upload', 'blue')}
          <div class="cell-body"><div class="cell-main"><div class="cell-title">Sicherung laden</div></div>${CHEV}</div>
          <input type="file" id="import" accept="application/json,.json" hidden>
        </label>
        ${cell({ tag: 'button', attrs: 'type="button" id="reset"', cls: 'destructive', lead: ico('reset', 'red'), title: 'Alles zurücksetzen' })}
      </div>
      <div class="section-footer">Deine Rezepte werden nur auf diesem Gerät gespeichert. Mit einer Sicherung überträgst du sie auf ein anderes Gerät. Zurücksetzen löscht alle Rezepte und Zeiten; die eingebauten Rezepte kommen danach wieder.</div>
    </div>

    <p class="footer-note">Pizza-Rechner 🍕</p>
  `);

  function drawBusy() {
    const list = $('#busyList');
    list.innerHTML = data.busy.map(b => {
      const days = WEEK_ORDER.filter(d => b.days.includes(d)).map(d => DAY_NAMES[d]);
      const dayStr = days.length === 7 ? 'Täglich' : days.length === 5 && !b.days.includes(0) && !b.days.includes(6) ? 'Mo–Fr' : days.join(', ');
      const overnight = parseHM(b.to) <= parseHM(b.from) ? ' (über Nacht)' : '';
      const [ic, color] = busyKind(b.label);
      return cell({
        lead: ico(ic, color),
        title: esc(b.label),
        sub: `${dayStr} · ${esc(b.from)}–${esc(b.to)}${overnight}`,
        trail: `<button type="button" class="icon-btn red" data-id="${esc(b.id)}" aria-label="${esc(b.label)} löschen">${icon('trash')}</button>`
      });
    }).join('');
  }
  drawBusy();

  $('#busyList').addEventListener('click', e => {
    const btn = e.target.closest('button[data-id]');
    if (!btn) return;
    const b = data.busy.find(x => x.id === btn.dataset.id);
    if (!b || !confirm(`„${b.label}“ löschen?`)) return;
    data.busy = data.busy.filter(x => x.id !== b.id);
    save();
    drawBusy();
  });

  $('#addBusy').addEventListener('click', () => {
    openSheet({
      title: 'Neue Zeit',
      doneLabel: 'Hinzufügen',
      body: `
        ${section({ body: `<div class="cell"><div class="cell-body"><input id="bLabel" class="field-full" placeholder="Bezeichnung, z. B. Schule" aria-label="Bezeichnung"></div></div>` })}
        ${section({
          header: 'Wiederholen',
          body: `<div class="days" role="group" aria-label="Wochentage">
            ${WEEK_ORDER.map(d => `<label><input type="checkbox" value="${d}" ${d >= 1 && d <= 5 ? 'checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}
          </div>`
        })}
        ${section({
          header: 'Uhrzeit',
          body: cell({ title: 'Von', trail: '<input id="bFrom" type="time" value="08:00" aria-label="Von">' }) +
            cell({ title: 'Bis', trail: '<input id="bTo" type="time" value="16:00" aria-label="Bis">' }),
          footer: 'Liegt „Bis“ vor „Von“, geht die Zeit über Mitternacht (z. B. Schlafen 23:00–07:00).'
        })}`,
      onOpen: body => setTimeout(() => $('#bLabel', body).focus(), 350),
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
