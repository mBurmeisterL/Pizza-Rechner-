---
name: apple-ui-designer
description: Gestaltet Webseiten im Stil von Apples Webseiten (apple.com) – riesige, fette Headlines, viel Weißraum, Abschnitte abwechselnd weiß/hellgrau/schwarz, Produkt-Kacheln mit großen Bildern, blaue Pill-Buttons und „Mehr erfahren ›“-Links, große Kennzahlen, schlanke Navigationsleisten, Technische-Daten-Tabellen und sanfte Scroll-Animationen. Verwenden, wenn der Nutzer „wie die Apple-Webseite“, „apple.com-Stil“, „Apple-Design“, „wie Apple“ oder „Apple UI“ möchte oder eine Webseite edler, ruhiger und hochwertiger wirken soll – auch wenn nur „schöner“ gesagt wird und Apple vorher Thema war.
---

# Apple UI Designer – Stil von apple.com

Ziel: Eine Webseite soll sich anfühlen wie apple.com – reduziert, großzügig, selbstbewusst. Inhalte werden
inszeniert wie Produkte: eine klare Aussage pro Abschnitt, große Typografie, viel Luft, wenige Farben.
Nicht kopieren: kein Apple-Logo, keine Apple-Produktnamen oder -Bilder, keine Texte von apple.com.
Übernommen werden nur die Gestaltungsprinzipien.

## Vorgehen

1. **Bestand ansehen.** HTML/CSS/JS lesen, Screenshots machen: 390 × 844 (iPhone) und 1280 × 800 (Desktop), hell und dunkel.
2. **Inhalte als „Produktseite“ denken.** Was ist pro Seite die eine Hauptaussage (Hero)? Welche Kennzahlen lassen sich groß
   zeigen? Was sind „Produkte“ (→ Kacheln)? Was sind Details (→ Technische-Daten-Tabelle)?
3. **Design-Tokens** (unten) auf `:root` anlegen, dann Seiten Abschnitt für Abschnitt umbauen. Logik und Daten nicht anfassen.
4. **Prüfen:** Screenshots Mobil + Desktop, hell + dunkel, kein horizontales Scrollen bei 320 px, Tippflächen ≥ 44 px,
   alle Funktionen per Playwright durchklicken, keine Konsolenfehler. Vorher/Nachher-Screenshots zeigen.

## Typografie

```css
--font-display: "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
--font-text: "SF Pro Text", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif;
```
(Auf Apple-Geräten wählt `-apple-system` automatisch die richtige SF-Variante; Schrift nicht von extern laden.)

| Rolle | Desktop | Mobil | Gewicht | Laufweite |
|---|---|---|---|---|
| Hero-Headline | 80 / 84 px | 48 / 52 px | 600–700 | -0.015em |
| Abschnitts-Headline | 56 / 60 px | 32–40 px | 600 | -0.005em |
| Kachel-Headline | 40 px | 28 px | 600 | 0 |
| Eyebrow (Kicker über Headline) | 21 px | 17 px | 600, oft farbig | 0 |
| Subhead / Intro | 28 / 32 px | 21 / 25 px | 400–600 | 0.004em |
| Fließtext | 17 / 25 px | 17 / 25 px | 400 | -0.022em |
| Kleingedrucktes / Footer | 12 / 16 px | 12 px | 400 | -0.01em |
| Große Kennzahl | 64–96 px | 48 px | 600, ggf. Verlauf | -0.02em |

- Headlines kurz: zwei, drei Wörter, gern mit Punkt („Pizzateig. Perfekt geplant.“), Umbruch gezielt mit `<br>`.
- Text zentriert in Heros und Feature-Abschnitten, linksbündig in Tabellen, Formularen und langen Texten.
- Fluid: `font-size: clamp(48px, 7vw, 80px)`.

## Farben

```css
:root {
  --text: #1d1d1f;          /* fast schwarz – nie reines #000 für Text */
  --text-2: #6e6e73;        /* sekundär */
  --text-3: #86868b;        /* tertiär, Kleingedrucktes */
  --bg: #ffffff;
  --bg-alt: #f5f5f7;        /* hellgrau: Kacheln, abwechselnde Abschnitte, Footer */
  --bg-dark: #000000;       /* dunkle „Bühnen“-Abschnitte */
  --bg-dark-2: #161617;     /* Kacheln auf dunkel */
  --text-on-dark: #f5f5f7;
  --text-on-dark-2: #86868b;
  --link: #0066cc;          /* Links auf hell */
  --link-on-dark: #2997ff;  /* Links auf dunkel */
  --btn: #0071e3;           /* Pill-Button */
  --btn-hover: #0077ed;
  --line: #d2d2d7;          /* Trennlinien, Rahmen */
  --accent: …;              /* EINE Produktfarbe für Eyebrows/Verläufe, passend zum Inhalt */
}
```
- Dunkelmodus (`prefers-color-scheme: dark`): `--bg #000`, `--bg-alt #161617`, `--text #f5f5f7`, `--text-2 #a1a1a6`,
  `--line #424245`, `--link #2997ff`. Dunkle Abschnitte bleiben dunkel (ggf. `#1d1d1f` als Unterschied).
- Akzentfarbe sparsam: Eyebrow, eine Zahl mit Verlauf (`background: linear-gradient(...); -webkit-background-clip: text; color: transparent`), ein Icon.
- Keine bunten Flächen, keine Schatten auf Text, Schatten auf Kacheln höchstens beim Hover sehr weich.

## Layout

- Abschnitte sind volle Breite und wechseln den Hintergrund (weiß → `#f5f5f7` → schwarz …). Innen max. 980 px Inhaltsbreite
  (breite Kachelraster bis 1440 px), Seitenränder 22 px mobil.
- Vertikaler Rhythmus groß: Abschnitte 80–120 px oben/unten (mobil 56–72 px). Lieber zu viel Luft als zu wenig.
- Pro Abschnitt: Eyebrow → Headline → Subhead → 1–2 Aktionen → Bild/Inhalt.

## Komponenten

**Globale Navigationsleiste**
- 44–48 px hoch, `background: rgba(250,250,252,.8)` + `backdrop-filter: saturate(180%) blur(20px)` (dunkel: `rgba(22,22,23,.8)`).
- Links 12 px, `--text` mit 0.8 Deckkraft, gleichmäßig verteilt, mittig, max. 980 px. Logo/Marke links als kleines Symbol.
- Mobil: nur Logo + 1–2 Symbole rechts (oder Menü-Symbol, das ein Vollbild-Menü mit 28 px-Links öffnet).

**Lokale Navigationsleiste (pro Seite, sticky unter der globalen)**
- 52 px, Titel der Seite links (21 px, 600), rechts kleine Text-Links (12 px) und ein kleiner Pill-Button (12 px, `--btn`).
- Haarlinie unten (`1px solid rgba(0,0,0,.16)`), gleicher Blur wie oben.

**Hero**
- Eyebrow (Akzentfarbe) – riesige Headline – Subhead (`--text-2` oder `--text`) – Buttons – großes Bild/Illustration.
- Auf Mobil alles zentriert, Bild unten groß.

**Buttons und Links**
- Pill-Button: `background: var(--btn); color:#fff; border-radius: 980px; padding: 11px 21px; font-size: 17px; min-height: 44px`.
- Sekundär-Pill: transparent, `1px solid var(--btn)`, Text `--btn`.
- Text-Link mit Chevron: „Mehr erfahren ›“ in `--link`, 17–21 px, Unterstreichung nur beim Hover.
- Kleine Pill (Navigationsleisten): 12 px, `padding: 4px 11px`, Höhe 28 px – auf Touch-Geräten Tippfläche per Pseudo-Element auf 44 px erweitern.

**Kacheln (Tiles)**
- `background: var(--bg-alt)` (oder schwarz), `border-radius: 18–28px`, `overflow: hidden`, Inhalt zentriert:
  Headline 28–40 px, Subhead 17–21 px, Links, darunter großes Bild bis an den Rand.
- Raster: 1 Spalte mobil, 2 ab ~734 px, Abstand 12–20 px. Hover: Bild minimal skalieren (`scale(1.02)`), keine Ränder.

**Große Kennzahlen („So viel ist drin“)**
- Zahl riesig (48–96 px, 600), darunter kurze Erklärung 17 px `--text-2`. 3er-Reihe auf Desktop, gestapelt mobil.

**Technische Daten / Vergleichstabelle**
- Linksbündig, Zeilen mit `border-top: 1px solid var(--line)`, Label links (17 px, 600), Wert rechts oder darunter.
- Großzügige Zeilenhöhe (Padding 16–24 px), keine Hintergründe, keine Zebra-Streifen.

**Formulare (wie Apple-Account/Checkout)**
- Felder 56 px hoch, `border: 1px solid var(--line); border-radius: 12px`, Label schwebt im Feld (12 px oben, Placeholder 17 px).
- Fokus: `border-color: var(--btn); box-shadow: 0 0 0 4px rgba(0,125,250,.6)` – deutlich sichtbar.
- Auswahl als Pill-Optionen nebeneinander (aktiv: blauer 2-px-Rahmen), nicht als winzige Radio-Buttons.
- Hauptaktion als großer blauer Pill-Button; mobil gern als fixierte Leiste unten.

**Modal**
- Zentriert (Desktop) bzw. von unten (mobil), `border-radius: 18px`, weiß auf abgedunkeltem Hintergrund
  (`rgba(0,0,0,.48)` + Blur), runder Schließen-Knopf (×) oben rechts, 36 px, `background: #e8e8ed`.

**Footer**
- `background: var(--bg-alt)`, 12 px, `--text-2`, Spalten mit Links, Trennlinien `--line`, Kleingedrucktes ganz unten.

## Bewegung

- Inhalte beim Scrollen sanft einblenden: `opacity 0 → 1`, `translateY(32px) → 0`, 0.8–1 s, `cubic-bezier(.28,.11,.32,1)`,
  per `IntersectionObserver` (Klasse `.reveal.is-visible`). Nur einmal pro Element.
- Hover auf Kacheln/Buttons 0.3 s. Keine hüpfenden oder blinkenden Effekte.
- `@media (prefers-reduced-motion: reduce)`: alles sofort sichtbar, keine Bewegung.
- Inhalte müssen auch ohne JavaScript bzw. ohne Observer sichtbar sein (Klasse erst per JS setzen).

## Bilder und Symbole

- Große, freigestellte Illustrationen/Fotos sind der Star. Ohne echte Fotos: schlichte, große SVG-Illustrationen mit 2–3 Farben.
- Symbole dünn und gleichmäßig (Strich 1.5–2), `currentColor`, eher groß (32–56 px) in Feature-Abschnitten.

## Barrierefreiheit

- Kontrast ≥ 4.5:1 (auch `--text-2` auf `--bg-alt` prüfen), Links erkennbar, sichtbarer Fokus.
- Echte Überschriften-Hierarchie (`h1` pro Seite, dann `h2`), `aria-label` für Symbol-Buttons, Tippflächen ≥ 44 px.

## Prüfliste

- [ ] Mobil (390 px) und Desktop (1280 px), hell und dunkel angesehen
- [ ] Jede Seite hat einen klaren Hero mit kurzer, großer Headline
- [ ] Abschnitte wechseln den Hintergrund, viel vertikaler Abstand
- [ ] Nur eine Akzentfarbe, Links/Buttons im Apple-Blau
- [ ] Kein horizontales Scrollen bei 320 px, Tippflächen ≥ 44 px
- [ ] Scroll-Animationen respektieren `prefers-reduced-motion`, Inhalte ohne JS sichtbar
- [ ] Alle Funktionen getestet, keine Konsolenfehler, Vorher/Nachher gezeigt
