# Projection Mapping

Projection Mapping im Browser, für zu Hause. Ein Server im Heimnetz (Zorin OS oder Raspberry Pi) hält den Zustand und speichert alles. Das iPhone steuert, ein zweites Gerät am Beamer (iPad oder der Browser des Beamers) zeigt das Bild. Alles läuft lokal, ohne Cloud und ohne Konten.

> **Stand: Phase 1 (MVP).** Vorhanden sind HTTPS-Server mit WebSocket-Sync, `/output` und `/control`, Corner Pin mit echter Homographie, Video-Upload mit Transkodierung, Testgitter sowie Projekte speichern und laden. Was später kommt, steht in [SPEC.md](SPEC.md), Abschnitt 6.

---

## Inhalt

1. [Installation auf Zorin OS](#1-installation-auf-zorin-os)
2. [HTTPS-Zertifikat erzeugen](#2-https-zertifikat-erzeugen)
3. [Starten](#3-starten)
4. [Zertifikat auf iPhone und iPad vertrauen](#4-zertifikat-auf-iphone-und-ipad-vertrauen)
5. [Beamer anschließen](#5-beamer-anschließen)
6. [Ausgabe auf dem iPad öffnen](#6-ausgabe-auf-dem-ipad-öffnen)
7. [Steuerung auf dem iPhone](#7-steuerung-auf-dem-iphone)
8. [Fehlerbehebung](#8-fehlerbehebung)
9. [Technik und Entwicklung](#9-technik-und-entwicklung)

---

## 1. Installation auf Zorin OS

Zorin OS 17 basiert auf Ubuntu 22.04. Dessen eigenes Node.js ist zu alt, daher kommt Node 22 LTS aus dem NodeSource-Paketarchiv:

```bash
sudo apt update
sudo apt install -y curl git ffmpeg mkcert libnss3-tools
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # sollte v22.x zeigen
```

Projekt holen und Abhängigkeiten installieren:

```bash
git clone https://github.com/HOAI-droid/Projection-Mapping.git
cd Projection-Mapping
npm install
```

**Raspberry Pi** (Raspberry Pi OS 64 bit): dieselben Befehle. Die Transkodierung dauert dort spürbar länger, siehe [Fehlerbehebung](#8-fehlerbehebung).

**Firewall:** Ist `ufw` aktiv, die Ports freigeben:

```bash
sudo ufw allow 8443/tcp   # App (HTTPS)
sudo ufw allow 8080/tcp   # Zertifikat-Download und Weiterleitung (HTTP)
```

## 2. HTTPS-Zertifikat erzeugen

iOS gibt Kamera und Mikrofon nur über HTTPS frei. Mit `mkcert` entsteht eine lokale Zertifizierungsstelle (CA) und ein Zertifikat für alle IP-Adressen und Namen des Servers:

```bash
npm run certs
```

Das Skript legt `certs/cert.pem`, `certs/key.pem` und `certs/rootCA.pem` an. Weitere Namen oder IPs lassen sich anhängen, z. B. `npm run certs -- 192.168.178.50`.

> **Wichtig:** Das Zertifikat gilt nur für die IP-Adressen, die der Server beim Erzeugen hatte. Am besten im Router eine **feste IP** für den Server vergeben (bei der FRITZ!Box: Heimnetz → Netzwerk → Gerät bearbeiten → „Diesem Netzwerkgerät immer die gleiche IPv4-Adresse zuweisen“). Ändert sich die IP trotzdem, `npm run certs` erneut ausführen. Die CA bleibt gleich, iPhone und iPad müssen also nichts neu installieren.

Ohne Zertifikate läuft der Server auch, dann aber nur per HTTP auf Port 8080. Für Phase 1 reicht das, ab Phase 5 (Kamera, Mikrofon) braucht es HTTPS.

## 3. Starten

```bash
npm start
```

Der Befehl baut das Frontend und startet den Server. Danach stehen die Adressen im Terminal, etwa so:

```
Steuerung: https://192.168.178.50:8443/control
Ausgabe:   https://192.168.178.50:8443/output
Zertifikat fürs iPhone/iPad: http://192.168.178.50:8080/
```

Statt der IP funktioniert meist auch `https://<rechnername>.local:8443`.

Konfiguration über Umgebungsvariablen (optional):

| Variable        | Standard   | Bedeutung                              |
| --------------- | ---------- | -------------------------------------- |
| `HTTPS_PORT`    | `8443`     | Port der App                           |
| `HTTP_PORT`     | `8080`     | Zertifikat-Download und Weiterleitung  |
| `DATA_DIR`      | `./data`   | Projekte und Medien                    |
| `CERT_DIR`      | `./certs`  | Zertifikate                            |
| `MAX_UPLOAD_MB` | `4096`     | Maximale Uploadgröße                   |

Ein Autostart per systemd folgt in Phase 6.

## 4. Zertifikat auf iPhone und iPad vertrauen

Die Schritte einmal pro Gerät ausführen, **in Safari** (andere Browser können keine Profile installieren):

1. `http://<server-ip>:8080/` öffnen. Die Adresse steht im Terminal. Wichtig: **http**, nicht https.
2. Auf **„1. Zertifikat herunterladen“** tippen und dann auf **„Zulassen“**. Es erscheint „Profil wurde geladen“.
3. **Einstellungen** öffnen. Oben steht **„Profil geladen“** (alternativ: Allgemein → VPN und Geräteverwaltung). Das Profil „mkcert …“ wählen, dann **Installieren**, Code eingeben, **Installieren** bestätigen.
4. **Einstellungen → Allgemein → Info → Zertifikatsvertrauenseinstellungen** (ganz unten). Den Schalter beim mkcert-Zertifikat **einschalten** und bestätigen.
5. Zurück in Safari auf **„2. Zur App (HTTPS)“** tippen. Das Schloss erscheint, ohne Warnung.

Der Beamer-Browser (Android) braucht kein Zertifikat, solange er nur `/output` ohne Kamera zeigt. Die Warnung lässt sich dort wegklicken („Erweitert → Weiter“).

## 5. Beamer anschließen

**Zuerst die Beamer-Korrekturen neutral stellen:** Trapezkorrektur (Keystone, auch die automatische), 4-Punkt-Korrektur und digitalen Zoom am Magcubic HY300 Pro+ ausschalten bzw. auf 100 % setzen. Sonst verzerrt der Beamer das Bild ein zweites Mal, und die Ecken lassen sich nie sauber treffen. Scharf stellen ist erlaubt.

Es gibt drei Wege zum Beamer:

- **Kabel (empfohlen):** iPad → USB-C-auf-HDMI-Adapter → HDMI-Eingang des Beamers. Das bietet die geringste Latenz und die beste Bildqualität.
  *Seitenverhältnis:* Im Spiegelmodus überträgt das iPad sein eigenes Format (≈ 4:3). Auf dem 16:9-Beamer entstehen dann schwarze Ränder links und rechts. Das Mapping funktioniert trotzdem, nur bleibt ein Teil der Beamerfläche ungenutzt. Mit Stage Manager (iPadOS 16.2+, iPad Air M1) lässt sich der externe Bildschirm **erweitern** statt spiegeln. Dann das Safari-Fenster mit `/output` auf den Beamer ziehen und auf Vollbild stellen.
- **AirPlay/Bildschirmspiegelung:** funktioniert, wenn der Beamer AirPlay empfängt. Rechne mit Kompression und etwas Verzögerung. Für feine Videos lieber das Kabel nehmen.
- **Direkt im Beamer-Browser:** `/output` im Chromium-Browser des Beamers öffnen. Dann ist kein iPad nötig, die Leistung ist aber schwächer (Leistungsmodus kommt in Phase 6).

## 6. Ausgabe auf dem iPad öffnen

1. In Safari `https://<server-ip>:8443/output` öffnen.
2. **Teilen → Zum Home-Bildschirm.** Wird die App künftig vom Home-Bildschirm gestartet, gibt es keine Browserleiste.
3. Die App öffnen und **einmal auf den Bildschirm tippen** („Tippen zum Starten“). Erst danach erlaubt iOS Videowiedergabe, Vollbild und „Bildschirm bleibt an“.
4. Zur Sicherheit: **Einstellungen → Anzeige & Helligkeit → Automatische Sperre → Nie**, solange gemappt wird.

Die Ausgabe zeigt nur die gemappten Flächen auf Schwarz, ohne Bedienelemente. Bricht die Verbindung zum Server ab, bleibt das letzte Bild stehen und die Ausgabe verbindet sich selbst neu.

## 7. Steuerung auf dem iPhone

`https://<server-ip>:8443/control` öffnen, am besten ebenfalls zum Home-Bildschirm hinzufügen. Oben steht der Status: Server verbunden, Ausgabe online und deren Bildrate.

- **Mapping:** Irgendwo auf die verkleinerte Ausgabe tippen und ziehen. Der **nächstgelegene Eckpunkt** bewegt sich relativ mit, so verdeckt der Finger die Stelle nicht. **Fein** verlangsamt die Bewegung auf ein Fünftel. Mit den Tasten **1–4** wählst du einen Eckpunkt, mit den **Pfeilen** schiebst du ihn um 1 oder 10 Ausgabepixel (gedrückt halten wiederholt). Auf dem iPad mit Tastatur gehen auch die Pfeiltasten, mit Shift in 10-px-Schritten.
  Auf der Ausgabe erscheinen Umrisse, nummerierte Ecken und ein Fadenkreuz am gewählten Eckpunkt. Mit **„Umrisse auf Ausgabe“** blendest du sie aus. **Testbild** projiziert ein Gitter oder eine weiße Fläche über die ganze Ausgabe.
- **Inhalt:** Leer, Testgitter oder Video. Für Videos gibt es Abspielen/Pause, Schleife und Tempo.
- **Medien:** **„Video hochladen“** öffnet die Mediathek. Der Server wandelt das Video in H.264 um (max. 1280×720, ohne Ton, iPhone-HDR wird nach SDR umgerechnet) und erstellt ein Vorschaubild.
- **Projekt:** Speichern, Speichern unter, Neu, Laden, Umbenennen und Löschen. Auch ungespeicherte Änderungen überstehen einen Neustart des Servers.

Die Farben der Ecken sind überall gleich: 1 rot (oben links), 2 grün (oben rechts), 3 blau (unten rechts), 4 gelb (unten links).

## 8. Fehlerbehebung

| Problem | Lösung |
| --- | --- |
| Safari meldet „Diese Verbindung ist nicht privat“ | Zertifikat installieren **und** unter Zertifikatsvertrauenseinstellungen aktivieren (Abschnitt 4). Hat sich die Server-IP geändert, `npm run certs` erneut ausführen und den Server neu starten. |
| Seite lädt gar nicht | Sind iPhone/iPad im selben WLAN (nicht im Gast-WLAN)? Firewall-Ports freigegeben? Läuft `npm start` noch? |
| Steuerung zeigt „Keine Ausgabe“ | `/output` ist auf keinem Gerät offen oder das iPad ist gesperrt. Wird die Ausgabe-App wieder in den Vordergrund geholt, verbindet sie sich automatisch neu. |
| Hinweis „Auf der Ausgabe einmal Tippen zum Starten antippen“ | Wie beschrieben auf dem iPad tippen. Ohne diesen Tipp spielt iOS keine Videos ab. |
| Video bleibt bei „Umwandeln …“ hängen oder zeigt einen Fehler | Ist `ffmpeg -version` installiert? Die Fehlermeldung steht in der Medienliste und im Server-Terminal. Lange 4K-Videos dauern auf dem Raspberry Pi mehrere Minuten, also vorher in der Fotos-App kürzen. |
| Upload bricht ab | Sehr große Dateien: `MAX_UPLOAD_MB` erhöhen oder Video kürzen. iOS wandelt Videos beim Hochladen manchmal schon selbst um, das dauert einen Moment. |
| Bild ist auf dem Beamer verzerrt, obwohl die Ecken stimmen | Keystone, Zoom und 4-Punkt-Korrektur am Beamer abschalten (Abschnitt 5). Mit dem Testbild „Gitter“ prüfen: Der Kreis muss rund sein. |
| Ruckeln | In der Steuerung die fps der Ausgabe prüfen. AirPlay durch Kabel ersetzen. Auf dem Beamer-Browser hilft später der Leistungsmodus (Phase 6). |
| iPad geht nach einiger Zeit aus | Automatische Sperre auf „Nie“ stellen. Der Wake Lock funktioniert erst ab iPadOS 16.4 und nach dem Start-Tipp. |

## 9. Technik und Entwicklung

### Aufbau

```
server/     Node.js + TypeScript: Express (HTTPS), WebSocket (ws), Upload (multer), ffmpeg
shared/     Gemeinsamer Code: Datentypen, Zustands-Reducer, Homographie (+ Tests)
client/     Vite: /control (React), /output (WebGL2, ohne Framework)
scripts/    certs.mjs (mkcert)
data/       Laufzeitdaten: current.json, projects/*.json, media/<id>/{video.mp4,thumb.jpg,meta.json}
```

- **Zustand:** Der Server ist die einzige Quelle der Wahrheit. Clients schicken *Operationen* (z. B. `setCorner`). Der Server prüft sie, wendet sie mit demselben Reducer (`shared/state.ts`) an und verteilt sie an alle. So sehen alle Clients dieselbe Reihenfolge. Beim Verbinden oder Wiederverbinden schickt der Server einen vollständigen Snapshot.
- **Renderer:** WebGL2 direkt, ohne Bibliothek. Pro Fläche wird nur ihr Begrenzungsrechteck gezeichnet. Der Fragment-Shader rechnet jeden Pixel mit der **inversen Homographie** zurück in die Inhaltskoordinate. Damit ist die Perspektive pixelgenau, ohne Knick an der Diagonalen. Die Kanten werden um 1 px geglättet.
  *Warum ohne Three.js/regl?* Gebraucht werden ein Shader-Programm pro Effekt, Texturen und ein Rechteck. Three.js brächte ~600 kB Szenengraph, Kamera und Materialsystem mit, die hier nur im Weg stünden, besonders auf dem schwachen Beamer-Browser. regl zielt auf WebGL 1 und wird kaum noch gepflegt. Das eigene Gerüst ist ~150 Zeilen lang, und die Effekte (Phase 3) sind einfach weitere Fragment-Shader.
- **Video:** Ein `<video muted playsinline>` pro Medium, Upload in die Textur nur bei neuem Bild (`requestVideoFrameCallback`).

### Befehle

```bash
npm run dev        # Entwicklungsmodus mit Hot Reload (gleiche Ports, HTTPS falls Zertifikate da)
npm test           # Unit-Tests (Homographie, Zustand)
npm run typecheck  # TypeScript strikt prüfen
npm run build      # Produktions-Build nach dist/
npm run serve      # Gebaute Version starten (ohne neu zu bauen)
```
