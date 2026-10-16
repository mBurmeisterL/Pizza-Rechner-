---
name: apple-ui-designer
description: Gestaltet Web-Oberflächen so, dass sie sich wie eine native iPhone-/iPad-App nach Apples Human Interface Guidelines anfühlen (iOS-Systemschrift, Dynamic-Type-Größen, Systemfarben hell/dunkel, gruppierte Listen, große Titel, Tab-Leiste, Sheets, Safe Areas, PWA-Details). Verwenden, wenn der Nutzer ein „Apple-Design“, „iOS-Look“, „wie eine iPhone-App“, „Apple UI“ oder „HIG“ möchte, oder wenn eine Web-App/PWA für iPhone gestaltet oder überarbeitet wird – auch wenn nur „schöner“ oder „wie Apple“ gesagt wird.
---

# Apple UI Designer

Ziel: Eine Web-App (HTML/CSS/JS, oft als PWA auf dem Home-Bildschirm) soll sich auf dem iPhone anfühlen
wie eine App von Apple – ruhig, klar, viel Weißraum, Inhalte im Vordergrund. Nicht „Apple nachmachen“
durch Logos oder Markenzeichen, sondern die Gestaltungsprinzipien übernehmen.

## Vorgehen

1. **Bestand ansehen.** Vorhandenes CSS/HTML lesen, Screenshots in 390 × 844 (iPhone 14/15) hell und dunkel machen.
   Notieren, was nicht iOS-typisch ist (bunte Verläufe überall, viele Schatten, eckige Buttons, kleine Tippflächen,
   Inhalte ohne Gruppierung).
2. **Design-Tokens zuerst.** Farben, Schriftgrößen, Abstände und Radien als CSS-Variablen auf `:root` definieren
   (siehe unten), Dunkelmodus über `@media (prefers-color-scheme: dark)`. Erst danach Komponenten umbauen.
3. **Komponenten umbauen** (Navigationsleiste, Listen, Buttons, Formulare, Tab-Leiste, Sheets) – Logik und Daten nicht anfassen,
   außer es ist für die Bedienung nötig.
4. **Prüfen.** Screenshots hell + dunkel, Tippflächen ≥ 44 px, kein horizontales Scrollen, Kontrast, Funktionen
   per Playwright durchklicken. Ergebnis-Screenshots dem Nutzer zeigen.

## Prinzipien (HIG)

- **Klarheit:** Text gut lesbar, Symbole eindeutig, Funktion vor Dekoration.
- **Zurückhaltung:** Die Oberfläche tritt hinter den Inhalt. Farbe sparsam – eine Akzentfarbe (Tint) für Interaktives.
- **Tiefe:** Ebenen über Hintergrundfarben und durchscheinende Materialien, kaum harte Schatten.
- **Konsistenz:** Gleiche Dinge sehen überall gleich aus und stehen an derselben Stelle.

## Schrift

```css
--font: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif;
--font-rounded: ui-rounded, "SF Pro Rounded", -apple-system, sans-serif; /* nur für Zahlen/Werte, sparsam */
```

Dynamic-Type-Stufen (Standardgröße „Large“), in px:

| Stil | Größe / Zeilenhöhe | Gewicht |
|---|---|---|
| Large Title | 34 / 41 | 700 |
| Title 1 | 28 / 34 | 700 |
| Title 2 | 22 / 28 | 700 |
| Title 3 | 20 / 25 | 600 |
| Headline | 17 / 22 | 600 |
| Body | 17 / 22 | 400 |
| Callout | 16 / 21 | 400 |
| Subheadline | 15 / 20 | 400 |
| Footnote | 13 / 18 | 400 |
| Caption 1 | 12 / 16 | 400 |

- Body ist **17 px**, nicht 16. Eingabefelder mindestens 16 px, sonst zoomt Safari.
- Zahlen: `font-variant-numeric: tabular-nums;`
- Laufweite bei großen Titeln leicht negativ (`letter-spacing: -0.02em`), bei Body nicht verändern.
- Optional echtes Dynamic Type: `font: -apple-system-body;` auf `html` und alles in `rem` – dann wächst die
  App mit der Schriftgröße aus den iOS-Einstellungen.

## Farben (iOS-Systemfarben)

```css
:root {
  --tint: #FF3B30;                 /* Akzentfarbe: systemRed, systemBlue #007AFF, systemOrange #FF9500 … */
  --bg: #F2F2F7;                   /* systemGroupedBackground */
  --bg-elevated: #FFFFFF;          /* secondarySystemGroupedBackground (Zellen, Karten) */
  --bg-tertiary: #F2F2F7;          /* tertiarySystemGroupedBackground */
  --fill: rgba(120,120,128,.12);   /* tertiarySystemFill: Segment-Hintergründe, Stepper */
  --label: #000000;
  --label-2: rgba(60,60,67,.60);   /* secondaryLabel */
  --label-3: rgba(60,60,67,.30);   /* tertiaryLabel, Platzhalter */
  --separator: rgba(60,60,67,.29);
  --green: #34C759; --orange: #FF9500; --red: #FF3B30; --blue: #007AFF; --yellow: #FFCC00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --tint: #FF453A;
    --bg: #000000;
    --bg-elevated: #1C1C1E;
    --bg-tertiary: #2C2C2E;
    --fill: rgba(118,118,128,.24);
    --label: #FFFFFF;
    --label-2: rgba(235,235,245,.60);
    --label-3: rgba(235,235,245,.30);
    --separator: rgba(84,84,88,.60);
    --green: #30D158; --orange: #FF9F0A; --red: #FF453A; --blue: #0A84FF; --yellow: #FFD60A;
  }
}
```

- Interaktive Texte, Links, Symbole in Navigation und Tab-Leiste: `--tint`. Destruktives (Löschen): `--red`.
- Status: Grün = ok, Orange = Warnung, Rot = Fehler – immer zusätzlich mit Text/Symbol, nie nur Farbe.
- Keine großen Verläufe als Flächen; höchstens ein dezenter Akzent (z. B. App-Icon, ein Hero-Bild).

## Abstände, Radien, Tippflächen

- 8-px-Raster (4, 8, 12, 16, 20, 24, 32). Seitenränder **16 px** (iPhone), bei breiteren Fenstern 20 px.
- Tippflächen **mindestens 44 × 44 px**.
- Radien: gruppierte Liste/Karte 10–12 px, große Karten 16–20 px, Buttons „capsule“ (999 px) oder 12 px,
  Eingabefelder 10 px. Ecken möglichst „continuous“ wirken lassen (lieber etwas größer als zu klein).
- Safe Areas: `viewport-fit=cover` im Viewport-Meta und `env(safe-area-inset-*)` für oben (Notch/Dynamic Island),
  unten (Home-Indikator) und seitlich (Querformat).

## Komponenten

**Navigationsleiste mit großem Titel**
- Oben eine durchscheinende Leiste (`background: color-mix(in srgb, var(--bg) 80%, transparent); backdrop-filter: saturate(180%) blur(20px);`),
  Höhe 44 px + `env(safe-area-inset-top)`, Haarlinie unten (`0.5px solid var(--separator)`) erst beim Scrollen einblenden.
- Darunter der **Large Title** (34 px, fett) linksbündig. Beim Scrollen kann der kleine Titel (17 px, 600, zentriert)
  in der Leiste erscheinen (per `IntersectionObserver` auf den großen Titel).
- Zurück-Button links: Chevron „‹“ + Titel der vorherigen Seite in `--tint`, Aktionen rechts als Text („Bearbeiten“, „Fertig“) oder Symbol.

**Gruppierte Listen (Inset Grouped) – das wichtigste Muster**
- Abschnittstitel klein darüber (13 px, `--label-2`, Großbuchstaben optional), Fußnote darunter (13 px, `--label-2`).
- Zellen auf `--bg-elevated`, gemeinsamer Radius 10–12 px, Zellen 44 px+ hoch, Innenabstand 16 px.
- Trennlinien 0.5 px `--separator`, **eingerückt** ab dem Textanfang (nicht über die ganze Breite), letzte Zelle ohne Linie.
- Zeile: links optional ein Symbol in einem farbigen 29 × 29-Quadrat (Radius 7), dann Titel, rechts Wert in `--label-2`
  und Chevron `›` in `--label-3` für Navigation.

**Buttons**
- Primär: gefüllt mit `--tint`, weiße Schrift 17 px/600, Höhe 50 px, volle Breite unten im Formular oder als Capsule.
- Sekundär: getönt (`background: color-mix(in srgb, var(--tint) 15%, transparent); color: var(--tint)`).
- Plain: nur Text in `--tint`. Destruktiv: Text oder Fläche in `--red`.
- Gedrückt-Zustand: Deckkraft 0.6 oder leicht abdunkeln; `-webkit-tap-highlight-color: transparent`.

**Formulare**
- Eingaben als Zeilen in einer gruppierten Liste: Beschriftung links, Eingabe rechtsbündig ohne Rahmen – oder Feld mit
  `--fill`-Hintergrund ohne Rahmen, Radius 10 px.
- **Stepper** (− | +): zwei Segmente auf `--fill`, 94 × 32 px, Trennstrich in der Mitte.
- **Schalter** (Switch): 51 × 31 px, an = `--green`. Als `<input type="checkbox" role="switch">` mit CSS.
- **Segmented Control**: Container `--fill`, Radius 9 px, Höhe 32 px; aktives Segment `--bg-elevated` mit leichtem Schatten.
- Datum/Uhrzeit: native `<input type="datetime-local">` / `type="time"` nutzen – iOS zeigt dann seine eigenen Räder/Kalender.
- Auswahl: native `<select>` (iOS zeigt das Auswahlrad).

**Tab-Leiste** (bei 2–5 Hauptbereichen)
- Unten fixiert, durchscheinend mit Blur, Höhe 49 px + `env(safe-area-inset-bottom)`, Haarlinie oben.
- Symbol (ca. 25 px) über Beschriftung (10 px, 500); aktiver Tab in `--tint`, inaktive in `--label-2`.

**Sheets & Dialoge**
- Modal von unten: Radius oben 12–16 px, Griff (36 × 5 px, `--label-3`) oben, abgedunkelter Hintergrund.
- Destruktive Bestätigungen als Action Sheet (Liste mit „Löschen“ in Rot + separatem „Abbrechen“) statt `confirm()`,
  wenn es der Aufwand wert ist; `confirm()` ist auf iOS aber akzeptabel.

**Symbole**
- SF Symbols sind auf Websites nicht als Font nutzbar. Stattdessen einfache, gleichmäßige Inline-SVG-Strichsymbole
  (Strichstärke ~1.75–2, runde Enden, `currentColor`) oder sparsam Emoji. Nicht beides wild mischen.

**Leere Zustände**
- Zentriert: großes Symbol in `--label-3`, Title-3-Überschrift, ein Satz in `--label-2`, ein Button.

## Bewegung

- Kurz und federnd: `transition: 0.25s cubic-bezier(0.25, 0.1, 0.25, 1)`; für „Spring“-Gefühl
  `cubic-bezier(0.34, 1.3, 0.64, 1)` sparsam.
- Seitenwechsel optional als leichtes Hereinschieben von rechts (`translateX(24px)` → 0 mit Einblenden).
- Immer `@media (prefers-reduced-motion: reduce)` beachten und Animationen dann abschalten.

## PWA / iPhone-Details

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`
- `<meta name="apple-mobile-web-app-capable" content="yes">`, `apple-mobile-web-app-status-bar-style`
  (`default` bei hellem Kopf, `black-translucent` wenn der Inhalt unter die Statusleiste laufen soll),
  `apple-touch-icon` als 180 × 180 PNG ohne Transparenz.
- `theme-color` getrennt für hell und dunkel (`media="(prefers-color-scheme: dark)"`).
- `html { -webkit-text-size-adjust: 100%; } body { overscroll-behavior-y: none; }` nur wenn Pull-to-refresh stört.
- Im Standalone-Modus (`@media (display-mode: standalone)`) fehlt Safaris Zurück-Button – eigene Zurück-Navigation ist Pflicht.
- `user-select: none` nur für Bedienelemente, nie für Inhalte.

## Barrierefreiheit

- Kontrast mindestens 4.5:1 für Text (3:1 für großen Text/Symbole), auch im Dunkelmodus prüfen.
- Echte `<button>`/`<a>`, `aria-label` für reine Symbol-Buttons, sichtbarer Fokus (`:focus-visible`).
- Nichts nur über Farbe oder nur über Wischgesten erreichbar machen.

## Prüfliste vor dem Abschluss

- [ ] Hell und dunkel per Screenshot (390 × 844) angesehen
- [ ] Alle Tippflächen ≥ 44 px, kein horizontales Scrollen bei 320 px Breite
- [ ] Body 17 px, Eingaben ≥ 16 px, Large Titles 34 px
- [ ] Nur eine Akzentfarbe, Systemfarben für Status
- [ ] Safe Areas oben/unten berücksichtigt (Notch, Home-Indikator)
- [ ] Gruppierte Listen mit eingerückten 0.5-px-Trennlinien
- [ ] Alle bisherigen Funktionen funktionieren noch (durchklicken), keine JS-Fehler in der Konsole
- [ ] Dem Nutzer Vorher/Nachher-Screenshots gezeigt
