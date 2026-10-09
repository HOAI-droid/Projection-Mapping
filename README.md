# Projection Mapping

Projection Mapping im Browser, für zu Hause und **komplett auf einem MacBook**. Auf dem Mac-Display steuerst du, der Beamer hängt als zweiter Bildschirm dran und zeigt die Ausgabe. Ecken und Masken setzt du mit Maus oder Trackpad, wahlweise auf der Vorschau oder **direkt auf der Projektion**. Alles läuft lokal, ohne Cloud und ohne Konten.

> **Stand: v0.3.** Neu sind Masken auf Masken (Masken-Stapel pro Fläche mit Hinzufügen/Ausschneiden/Schnittmenge), Masken-Ebenen, die Flächen aus Flächen ausschneiden, Freihand-Zeichnen von Masken, Snap (abschaltbar), ein Raster mit einstellbarer Linienstärke zum Prüfen der Verzerrung und 31 Effekte (Feuer, Stroboskop, Discokugel, Lichtkegel, Kantenlauf, Lauflicht, Wasser, Fenster und mehr) mit Reglern. Ältere Stände liegen auf den Branches `v0.2` usw. Was noch kommt, steht in [SPEC.md](SPEC.md).

---

## 1. Installation (macOS)

Gebraucht werden [Google Chrome](https://www.google.com/chrome/) und [Homebrew](https://brew.sh). Im Terminal:

```bash
brew install node ffmpeg git
git clone https://github.com/HOAI-droid/Projection-Mapping.git
cd Projection-Mapping
npm install
```

## 2. Starten

```bash
npm start
```

Der Befehl baut die App, startet den Server und öffnet die **Steuerung** in Chrome (`http://localhost:8080/control`). Beenden mit `Ctrl+C` im Terminal. Zertifikate oder HTTPS braucht es nicht: `localhost` gilt im Browser als sicher, auch für Kamera und Mikrofon in späteren Versionen.

## 3. Beamer anschließen

1. Beamer per **USB-C-auf-HDMI-Adapter** anschließen.
2. **Systemeinstellungen → Displays:** Der Beamer muss als **erweiterter Bildschirm** laufen, nicht gespiegelt. Steht er auf „Spiegeln“, auf „Als erweiterter Bildschirm verwenden“ umstellen.
3. **Auflösung des Beamers:** Wenn möglich die native Auflösung einstellen (HY300 Pro+: 1280×720). Sonst rechnet der Beamer das Bild um, und es wird weicher. Fehlt sie in der Liste, rechts neben dem Beamer auf „Erweitert …“ klicken bzw. „Alle Auflösungen anzeigen“ aktivieren.
4. **Am Beamer:** Trapezkorrektur (Keystone, auch die automatische), 4-Punkt-Korrektur und digitalen Zoom ausschalten bzw. auf neutral stellen. Sonst verzerrt der Beamer das Bild ein zweites Mal. Scharfstellen ist natürlich erlaubt.

## 4. Ausgabe auf den Beamer bringen

1. In der Steuerung oben rechts auf **„Ausgabe öffnen“** klicken.
2. Beim ersten Mal fragt Chrome: **„Fenster auf allen Bildschirmen verwalten?“** → **Zulassen.** Das Ausgabefenster erscheint dann direkt auf dem Beamer.
   (Ohne Erlaubnis öffnet es sich als normales Fenster; dann von Hand auf den Beamer ziehen.)
3. **Einmal in das Ausgabefenster klicken und `F` drücken** → Vollbild.

Die Steuerung zeigt oben „Ausgabe 1280×720 · 60 fps“, sobald alles verbunden ist.

## 5. Mappen

**Bearbeiten- und Show-Modus** (Taste `E` oder Knopf oben): Im Bearbeitungsmodus zeigt die Ausgabe Umrisse, Ecken, Masken und den Mauszeiger. Im Show-Modus ist nur das Bild zu sehen.

### Ebenen

Links stehen alle **Ebenen**: Flächen und Masken-Ebenen. Was in der Liste **oben** steht, liegt im Bild **vorne**. ↑/↓ ändern die Reihenfolge, 👁 blendet aus, 🔒 sperrt gegen versehentliches Verschieben, ein Doppelklick benennt um.

### Flächen (Werkzeug „Fläche“, Taste `V`)

- **„+ Fläche“** legt eine neue Fläche an (Viereck mit Corner Pin).
- **Ecken ziehen:** auf der Bühne in der Steuerung oder **direkt auf der Projektion**. Dafür den Mauszeiger auf den Beamer-Bildschirm bewegen und die Ecke dort ziehen, wo du sie auf dem Objekt siehst.
- **Feinjustierung:** Ecke anklicken (oder `Tab` für die nächste Ecke), dann **Pfeiltasten** = 1 Beamer-Pixel, mit **⇧** = 10 Pixel.
- **Ganze Fläche:** hineinklicken und ziehen = verschieben, **Trackpad-Pinch** = skalieren, **⌥ + Scrollen** = drehen. Ohne gewählte Ecke (`Esc`) verschieben die Pfeiltasten die ganze Fläche.

### Snap (Taste `S`, standardmäßig an)

Gezogene Ecken und Maskenpunkte **rasten ein**: an Ecken anderer Flächen, an Maskenpunkten, auf Kanten und am Bildrand. Ein gelbes Fadenkreuz zeigt den Fangpunkt. So schließen zwei Flächen lückenlos aneinander an. Abschalten mit dem 🧲-Knopf oder `S`. Für einen einzelnen Zug ohne Snap beim Ziehen **⌥** gedrückt halten.

### Raster zum Prüfen der Verzerrung (Taste `G`)

**▦ Raster** legt ein Gitter über die Flächen und folgt dabei genau der Perspektive. So siehst du sofort, ob Linien gerade laufen und die Kästchen gleichmäßig wirken. Einstellbar sind Spalten, Zeilen, **Linienstärke (1–30 px)**, Farbe, Diagonalen und „nur gewählte Fläche“. Die Linienstärke bleibt auf dem Beamer überall gleich, auch in stark verzerrten Ecken. Auf dunklen oder weit entfernten Objekten einfach dicker stellen.
(`⇧G` bzw. „Testbild: Gitter“ projiziert dagegen ein Testgitter über das ganze Beamerbild, um den Beamer selbst auszurichten.)

### Inhalte (rechte Seitenleiste)

**Leer, Testgitter, Farbe, Bild, Video oder Effekt.** Dazu kommen Deckkraft, Mischmodus (Normal, Additiv, Bildschirm, Multiplizieren) und bei Bild/Video die Einpassung (strecken, füllen, einpassen).

### Effekte ✨

Inhalt **„Effekt“** wählen, dann eine Kategorie und einen Effekt. Alle Regler wirken sofort, ein Doppelklick auf einen Regler stellt den Standardwert her.

| Kategorie | Effekte |
| --- | --- |
| Licht | Stroboskop ⚠, Pulsieren, Lichtkegel (Moving Heads), Lichtwelle |
| Disco & Party | Farb-Strobe ⚠, Discokugel, Disco-Spots, Equalizer, Konfetti |
| Kontur | **Kantenlauf** (Licht fährt den Rand entlang), Lauflicht (Glühbirnen), Neon-Rahmen |
| Natur | Feuer, Wasser, Nebel, Sternenhimmel, Regen |
| Muster | Linienmuster, Schachbrett, Ringe, Kaleidoskop |
| Farbe | Plasma, Farbverlauf, Regenbogen |
| Digital | Glitch, Matrix-Regen, Scanlines |
| Architektur | Fenster (gehen nacheinander an), Sonnenlauf, Bauphasen, Aufbau/Wipe |

⚠ Stroboskop-Effekte sind auf 12 Hz begrenzt. Blitzlicht kann bei fotosensiblen Menschen Anfälle auslösen.

Eigene Effekte: In `shared/effects.ts` einen Eintrag mit GLSL-Funktion `vec4 effect(vec2 uv)` und Parameterliste ergänzen. Regler und Prüfung entstehen automatisch.

### Masken (Werkzeug „Maske“, Taste `M`)

Masken bestimmen, wo Licht hinfällt, z. B. nur auf das Objekt und nicht auf die Wand. Es gibt zwei Arten:

**1. Masken einer Fläche (Masken-Stapel, links unten).** Sie gehören zur Fläche und wandern mit, wenn du deren Ecken änderst. Jede Maske hat eine **Wirkung**:
- **＋ Hinzufügen:** Das Innere wird sichtbar. Steht diese Maske ganz oben, ist *nur* ihr Inneres zu sehen.
- **− Ausschneiden:** Das Innere wird herausgeschnitten.
- **∩ Schnittmenge:** Sichtbar bleibt nur, was auch in dieser Maske liegt.

Die Masken werden von oben nach unten verrechnet, so entstehen **Masken auf Masken**. Beispiel Haus: Maske 1 „Hinzufügen“ = Umriss der Fassade, Maske 2 „Ausschneiden“ = ein Fenster, Maske 3 „Hinzufügen“ = das Fensterkreuz wieder sichtbar machen. Die Reihenfolge änderst du mit ↑/↓.

**2. Masken-Ebenen ✂ (in der Ebenenliste).** Sie liegen fest im Beamerbild und wirken auf **alle Ebenen darunter**. „Ausschneiden“ stanzt ein Loch in alles darunter, „Nur Inneres“ lässt nur das Innere übrig. So schneidest du **Flächen aus Flächen** aus. Für die exakte Form einer Fläche: Fläche wählen → rechts **„✂ Form aus Ebenen darunter ausschneiden“**.

**Zeichnen:**
- Fläche wählen → **„+ Maske zeichnen“** (bzw. **„+ Maske ✂“** für eine Masken-Ebene).
- **Freihand:** mit gedrückter Maustaste den Umriss nachfahren, aus dem Pfad werden automatisch Punkte. **Oder** Punkt für Punkt klicken. Am besten direkt auf der Projektion um das Objekt herum.
- **Enter** schließt die Maske ab. Der nächste Klick beginnt eine neue, auch innerhalb einer bestehenden.
- **Bearbeiten:** Punkte ziehen (mit Snap), Klick auf eine Kante fügt einen Punkt ein, **Entf/⌫** löscht den gewählten Punkt, Pfeiltasten verschieben ihn pixelgenau. Eine Maske wählst du über einen ihrer Punkte oder in der Liste.
- **Weiche Kante:** sanfter Rand in Pixeln.
- Farben auf der Bühne: grün = hinzufügen, rot = ausschneiden, gelb = Schnittmenge.

### Tastenkürzel (in Steuerung und Ausgabe)

| Taste | Funktion |
| --- | --- |
| `E` | Bearbeiten ↔ Show |
| `F` | Vollbild (nur im Ausgabefenster) |
| `V` / `M` | Werkzeug Fläche / Maske |
| `S` | Snap an/aus (⌥ beim Ziehen: einmalig ohne Snap) |
| `G` / `⇧G` | Raster auf den Flächen / Testgitter über das ganze Bild |
| Pfeile, ⇧+Pfeile | 1 px / 10 px verschieben |
| `Tab`, ⇧`Tab` | nächste/vorige Ecke bzw. Maskenpunkt |
| `Enter` | Maske abschließen |
| `Entf`, `⌫` | Maskenpunkt löschen |
| `Esc` | Auswahl aufheben |
| `⌘Z`, `⇧⌘Z` | Rückgängig / Wiederherstellen |
| `⌘S` | Projekt speichern |
| Pinch, ⌥+Scrollen | Fläche skalieren / drehen |

## 6. Medien und Projekte

- **Medien:** Videos und Bilder in den Bereich „Medien“ ziehen oder „+ Hochladen“ klicken. iPhone-Fotos im HEIC-Format gehen auch. Videos werden in H.264 umgewandelt (max. 1280×720, ohne Ton, iPhone-HDR wird angepasst), auf dem Mac mit dem Hardware-Encoder, also schnell. „Zuweisen“ legt das Medium auf die gewählte Fläche.
- **Projekte:** Speichern (`⌘S`), Speichern unter, über „Projekte …“ laden, umbenennen, löschen und neu anlegen. Ungespeicherte Änderungen überstehen auch einen Neustart.
- Alle Daten liegen im Ordner `data/` im Projektverzeichnis.

## 7. Tipps für den Mac

- **Netzteil anschließen**, wenn länger projiziert wird. Die Ausgabe hält den Bildschirm wach (Wake Lock), solange das Fenster sichtbar ist.
- **Nicht stören** einschalten, damit keine Mitteilungen aufs Bild kommen.
- **Menüleiste auf dem Beamer:** Fährt die Maus im Vollbild an den oberen Rand, blendet macOS die Menüleiste ein. Ecken ganz oben dann über die Pfeiltasten justieren.
- **„Getrennte Spaces für Displays“** (Systemeinstellungen → Schreibtisch & Dock → Mission Control) eingeschaltet lassen, sonst funktioniert das Vollbild auf dem zweiten Bildschirm nicht richtig.

## 8. Fehlerbehebung

| Problem | Lösung |
| --- | --- |
| „Ausgabe öffnen“ tut nichts | Chrome hat das Pop-up blockiert: In der Adressleiste das Pop-up-Symbol anklicken → immer erlauben. Dann erneut klicken. |
| Ausgabe erscheint nicht auf dem Beamer | Erlaubnis „Fenster verwalten“ prüfen (Schloss-Symbol in der Adressleiste → Website-Einstellungen). Oder Fenster von Hand rüberziehen und `F` drücken. |
| Beamer zeigt das Mac-Display gespiegelt | Systemeinstellungen → Displays → Beamer „als erweiterten Bildschirm“ verwenden. |
| Bild verzerrt, obwohl die Ecken stimmen | Keystone, Zoom und 4-Punkt-Korrektur am Beamer abschalten. Mit `G` (Gitter) prüfen: Der Kreis muss rund sein. |
| Bild unscharf | Mac-Auflösung für den Beamer auf dessen native Auflösung stellen (Abschnitt 3). |
| Steuerung zeigt „Ausgabe einmal anklicken“ | Ins Ausgabefenster klicken. Danach darf der Browser Videos starten. |
| Video bleibt bei „Umwandeln …“ | Mit `ffmpeg -version` prüfen, ob ffmpeg installiert ist. Die Fehlermeldung steht in der Medienliste und im Terminal. |
| Port belegt | `HTTP_PORT=8090 npm start` |

Einstellungen über Umgebungsvariablen: `HTTP_PORT` (8080), `DATA_DIR` (`./data`), `MAX_UPLOAD_MB` (4096), `NO_OPEN=1` (Chrome nicht automatisch öffnen).

## Anhang: iPhone als Fernbedienung (optional)

Die Steuerung lässt sich zusätzlich vom iPhone aus bedienen. Starte dafür den Server mit `HOST=0.0.0.0 npm start` und öffne `http://<Mac-Name>.local:8080/control`. Für spätere Funktionen mit Kamera oder Mikrofon am iPhone braucht es HTTPS: `brew install mkcert nss`, `npm run certs`, danach das Root-Zertifikat unter `http://<Mac-Name>.local:8080/` auf dem iPhone installieren und unter Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen aktivieren. Die App läuft dann auf Port 8443.

## Technik und Entwicklung

```
server/   Node.js + TypeScript: Express, WebSocket (ws), Upload (multer), ffmpeg/sips
shared/   Datentypen, Zustands-Reducer, Homographie, Geometrie (+ Unit-Tests)
client/   Vite + React: /control (Steuerung), /output (Ausgabe)
          lib/render  WebGL2-Renderer, Medien, Masken (von Vorschau und Ausgabe gemeinsam genutzt)
          lib/editor  Bearbeitungsebene (Ecken, Masken) + Tastenkürzel, ebenfalls gemeinsam
```

- **Zustand:** Der Server ist die einzige Quelle der Wahrheit. Fenster schicken Operationen (z. B. `setCorner`), der Server prüft sie, wendet sie mit demselben Reducer an und verteilt sie in fester Reihenfolge. Jedes Fenster wendet seine eigenen Operationen sofort an (optimistisch) und gleicht sie mit dem Echo ab. Schnelle Klicks und Tastenwiederholungen gehen so nicht verloren. Rückgängig/Wiederherstellen läuft auf dem Server, eine Ziehbewegung zählt als ein Schritt.
- **Renderer:** WebGL2 ohne Bibliothek. Der Fragment-Shader rechnet jeden Pixel mit der inversen Homographie in die Inhaltskoordinate zurück. Das ergibt pixelgenaue Perspektive ohne Knick an der Diagonalen. Der Ebenenstapel wird von unten nach oben gezeichnet; Masken-Ebenen verrechnen das bisher Gezeichnete. Flächenmasken werden per Canvas 2D (Weichzeichner, Compositing für Hinzufügen/Ausschneiden/Schnittmenge) in eine Alpha-Textur im Inhaltsraum der Fläche gerastert. Effekte sind eigene Shader-Programme, die bei Bedarf kompiliert werden. Die Rasterlinien werden über `fwidth` in Bildschirmpixeln berechnet und haben deshalb überall dieselbe Dicke.
- Die Steuerung zeigt eine Live-Vorschau mit demselben Renderer.

```bash
npm run dev        # Entwicklungsmodus mit Hot Reload
npm test           # Unit-Tests (Homographie, Geometrie, Zustand, Effekte, Rückgängig)
npm run typecheck  # TypeScript strikt prüfen
npm run build      # Produktions-Build nach dist/
```
