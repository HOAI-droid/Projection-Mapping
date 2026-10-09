# Projection-Mapping-App – Spezifikation für Claude Code

Du baust eine Projection-Mapping-Web-App für den Heimgebrauch. Lies diese Spezifikation vollständig. Erstelle zuerst einen kurzen Umsetzungsplan und setze dann Phase 1 um. Halte nach jeder Phase an, damit ich auf echter Hardware testen kann. UI-Sprache: Deutsch.

## 1. Ziel

Mit einem Mini-Beamer (Magcubic HY300 Pro+) Videos, Bilder und Effekte passgenau auf reale Oberflächen projizieren: Objekte, Kisten, Möbel, Architekturmodelle, Hausfassade/Fenster, Party-Visuals. Bedient wird vom iPhone, die Ausgabe läuft auf einem zweiten Gerät, das am Beamer hängt.

## 2. Hardware und Umgebung

- Beamer: Magcubic HY300 Pro+ (Android-basiert, Ausgabe standardmäßig 1280×720, aber die App ist auflösungsunabhängig).
- Ausgabegerät (Output): iPad Air M1, per USB-C→HDMI-Adapter oder kabellos per AirPlay/Bildschirmspiegelung am Beamer. Alternativ läuft die Ausgabe direkt im Browser des Beamers.
- Steuergerät (Control): iPhone 17 Pro (optional zusätzlich das iPad).
- Server: iMac mit Zorin OS (Linux) im Heimnetz; muss auch auf einem Raspberry Pi laufen können.
- Kein Mac/Xcode vorhanden, keine native App. Alles läuft im Browser (Safari auf iOS/iPadOS, Chromium-Browser auf dem Beamer).
- Alles lokal, keine Cloud, keine Konten.

## 3. Architektur

- Server: Node.js (aktuelle LTS) + TypeScript. Liefert das Frontend aus, hält den Zustand (Single Source of Truth), synchronisiert per WebSocket, speichert Projekte und Medien.
- Frontend: Vite + TypeScript. Steuer-UI mit React. Renderer mit WebGL2 (direkt oder mit einer schlanken Bibliothek wie regl/Three.js, bitte begründen).
- Zwei Ansichten:
  - `/output`: Vollbild, schwarzer Hintergrund, keine Bedienelemente, kein Cursor. Rendert nur die gemappten Flächen.
  - `/control`: touch-optimierte Bedienoberfläche für iPhone (Hoch- und Querformat) und iPad.
- Mehrere Control-Clients gleichzeitig möglich. Änderungen erscheinen ohne spürbare Verzögerung auf dem Output.
- HTTPS ist Pflicht, weil iOS Kamera und Mikrofon nur im sicheren Kontext freigibt. Lokale Zertifizierungsstelle mit `mkcert` einrichten. Im README Schritt für Schritt beschreiben, wie man das Root-Zertifikat auf iPhone und iPad installiert und vertraut.
- Output- und Control-Ansicht als PWA installierbar („Zum Home-Bildschirm“), damit die Browserleiste wegfällt.

## 4. Funktionen

### 4.1 Flächen (Surfaces)

- Beliebig viele Flächen pro Projekt, jede mit Name, Reihenfolge (Ebene), sichtbar/unsichtbar, sperren, duplizieren, löschen.
- Ecken-Verzerrung (Corner Pin): 4 Eckpunkte per Finger ziehen.
- Korrekte perspektivische Abbildung über Homographie (3×3-Matrix aus 4 Punkten), nicht über zwei affine Dreiecke, damit keine Knickkante in der Diagonale entsteht. Homographie-Mathematik mit Unit-Tests absichern.
- Feinjustierung: ausgewählten Eckpunkt mit Pfeiltasten in 1-px- und 10-px-Schritten verschieben, Lupe beim Ziehen, Rückgängig/Wiederherstellen.
- Ganze Fläche verschieben, skalieren, drehen.

### 4.2 Masken

- Freiform-Polygone: Punkte setzen, verschieben, einfügen, löschen.
- Maske global (im Ausgaberaum) oder pro Fläche.
- Invertieren, weiche Kante (Feather) einstellbar.
- Zweck: Nur das Objekt anleuchten, nicht die Wand dahinter.

### 4.3 Inhalte pro Fläche

- Video (Schleife, Geschwindigkeit, Start/Pause), Bild, Farbfläche, generativer Effekt, Live-Kamera.
- Einpassung: strecken / füllen / einpassen; Deckkraft; Mischmodus (normal, additiv, multiplizieren, Bildschirm).
- Medien-Upload vom iPhone (Fotos/Videos aus der Mediathek) an den Server, mit Vorschaubildern.
- Server transkodiert per ffmpeg in ein sicher abspielbares Format (H.264/MP4, max. 1280×720, ohne Ton). Grund: iPhone-Videos sind oft HEVC/MOV und laufen nicht in jedem Browser; die Beamer-Hardware ist schwach.
- Videos auf iOS: `muted`, `playsinline`, Start erst nach Benutzer-Tipp („Tippen zum Starten“ auf dem Output).

### 4.4 Generative Effekte

Als GLSL-Fragment-Shader mit Parametern (Farbe, Geschwindigkeit, Intensität usw.), die in der Steuer-UI als Regler erscheinen. Plugin-artig aufbauen, damit ich später leicht neue Effekte ergänzen kann. Startset:

- Kantenlauf: Licht fährt die Umrisslinie der Fläche entlang (der klassische Mapping-Wow-Effekt).
- Aufbau/Wipe: Fläche füllt sich von einer Seite, von der Mitte oder als Raster.
- Wireframe/Gitter, Scanlines, Farbverlauf, Plasma/Noise.
- Feuer, Wasser/Wellen, Partikel.
- Glitch, Stroboskop (Frequenz begrenzen, Warnhinweis).
- Sonnenstand/Schattenwurf: Licht wandert über die Fläche (für Architekturmodelle).
- Bauphasen: Inhalte bzw. Farben Schritt für Schritt einblenden (für Modelle).
- Für Fassaden: Fenster-Effekte (Fenster leuchten nacheinander auf, Vorhang, Silhouetten).

### 4.5 Audio-Reaktivität

- Web Audio API mit FFT: Pegel sowie Bänder Bass / Mitten / Höhen, plus einfache Beat-Erkennung.
- Audioquelle wählbar: Mikrofon des Output-Geräts oder Mikrofon des iPhones. Im zweiten Fall werden nur die Analysewerte per WebSocket gesendet, kein Audiostream.
- Modulation: Jeder Effektparameter kann an ein Audioband gekoppelt werden (Stärke, Glättung, Schwelle).
- Optional: Szenenwechsel auf den Beat.

### 4.6 Live-Kamera

- Kamera des Output-Geräts (`getUserMedia`) als Inhalt einer Fläche.
- Erweiterung (spätere Phase): Kamera des iPhones per WebRTC zum Output streamen; Signalisierung über den eigenen Server.

### 4.7 Szenen und Show

- Projekt = Geometrie (Flächen + Masken) + Medien + Szenen.
- Szene = Zuordnung von Inhalten und Parametern zu allen Flächen. Die Geometrie bleibt über alle Szenen gleich.
- Szenenliste mit Tipp zum Auslösen, Überblendung mit einstellbarer Dauer, Schwarzblende.
- Automatische Playlist mit Dauer pro Szene, Schleife.
- Großer Not-Aus/Blackout-Knopf in der Steuerung.

### 4.8 Projekte

- Speichern, laden, umbenennen, duplizieren auf dem Server (JSON + Medienordner).
- Export/Import als ZIP.

### 4.9 Kalibrier-Hilfen

- Testgitter, volle Weißfläche, Fadenkreuz am gewählten Eckpunkt.
- Umrisse und Nummern aller Flächen auf dem Output einblenden (Bearbeitungsmodus) und im Show-Modus ausblenden.
- Hinweis im README: Trapezkorrektur/Keystone und Zoom des Beamers auf neutral stellen, sonst wird doppelt verzerrt.

### 4.10 Verbindung und Robustheit

- Verbindungsstatus in der Steuerung (Output online? Bildrate?).
- Automatischer Reconnect; Output zeigt nach Reconnect sofort wieder den letzten Zustand.
- Screen Wake Lock auf dem Output; Medien vorladen.
- Ziel 60 fps. Leistungsmodus für schwache Hardware (Beamer-Browser): geringere Renderauflösung, aufwendige Effekte vereinfachen.

## 5. Nicht-funktionale Anforderungen

- Dunkles, ruhiges UI; Touch-Ziele mindestens 44 px; einhändig auf dem iPhone bedienbar.
- Saubere Projektstruktur, TypeScript strikt, kurze Kommentare auf Deutsch oder Englisch.
- `README.md` auf Deutsch: Installation auf Zorin OS (Node, ffmpeg, mkcert), Start, Zertifikat auf iOS vertrauen, Beamer per Kabel bzw. AirPlay verbinden, `/output` auf dem iPad als PWA öffnen, `/control` auf dem iPhone öffnen, Fehlerbehebung.
- Start mit einem einzigen Befehl (`npm start`), optional systemd-Dienst für Autostart.

## 6. Phasen

1. MVP: Server + HTTPS + WebSocket-Sync, `/output` und `/control`, eine Fläche mit Corner Pin (Homographie), ein Video per Upload inkl. Transkodierung, Testgitter, Projekt speichern/laden.
2. Mapping komplett: mehrere Flächen, Masken, Bilder, Farbflächen, Feinjustierung, Undo/Redo, Mischmodi.
3. Effekte: Shader-Plugin-System und Startset aus 4.4 mit Reglern.
4. Show: Szenen, Überblendungen, Playlist, Blackout.
5. Audio und Kamera: Audio-Reaktivität mit Modulation, Live-Kamera, danach WebRTC vom iPhone.
6. Feinschliff: PWA, Leistungsmodus, ZIP-Export/Import, Autostart.

Bevor du loslegst: Nenne mir offene Fragen oder technische Risiken (z. B. iOS-Safari-Eigenheiten), die die Umsetzung betreffen.
