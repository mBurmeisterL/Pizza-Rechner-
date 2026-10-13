# 🍕 Pizza-Rechner

Web-App, um Pizzateig-Rezepte zu verwalten, auf beliebig viele Pizzen umzurechnen
und einen Zeitplan mit Erinnerungen zu erstellen. Läuft komplett im Browser, ohne Server
und ohne Anmeldung. Die Daten bleiben auf deinem Gerät (localStorage).

## Funktionen

- **Startseite mit Rezepten**: eigene Rezepte anlegen, bearbeiten, duplizieren, löschen
- **Umrechnen**: Anzahl Pizzen wählen und optional das Gewicht pro Teigling, alle Zutaten werden angepasst
- **Zeitplan**: Essenszeit wählen, die App rechnet rückwärts aus, wann du was machen musst
- **Schul-/Arbeitszeiten**: unter ⚙️ Einstellungen belegte Zeiten eintragen (z. B. Schule Mo–Fr 7:45–15:30, Schlafen).
  Ruhezeiten mit Spielraum (z. B. Kühlschrank 24–48 h) werden automatisch so gelegt,
  dass die Arbeitsschritte nicht in diese Zeiten fallen. Wenn das nicht geht, warnt die App.
- **Apple Kalender**: Zeitplan als `.ics` exportieren, jeder Schritt bekommt einen Alarm
- **Apple Erinnerungen**: über einen Kurzbefehl (Anleitung in den Einstellungen)
- **Als App auf dem iPhone**: Safari → Teilen → „Zum Home-Bildschirm“, funktioniert auch offline
- **Sicherung**: Rezepte als JSON exportieren/importieren (z. B. zum Übertragen auf ein anderes Gerät)

## Starten

Lokal: im Ordner `python3 -m http.server` ausführen und <http://localhost:8000> öffnen.

Online (kostenlos, mit GitHub Pages): im Repository unter **Settings → Pages** als Quelle
„Deploy from a branch“, den Branch und den Ordner `/ (root)` wählen. Danach ist die App unter
`https://<benutzername>.github.io/<repository>/` erreichbar.
