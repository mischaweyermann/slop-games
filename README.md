# Slope Games 🎮

Gratis Bewegungsspiele für den Fernseher. Das Handy ist die Kamera, der Körper ist der Controller – ohne App, ohne eigenen Server.

| Pfad | Inhalt |
|---|---|
| `/` | Startseite mit allen Spielen |
| `/ballon-platzer/` | 🎈 Ballon-Platzer (1 Spieler, stehend) |
| `/kurvenflitzer/` | 🏎️ Kurvenflitzer (1–4 Spieler am TV + online) |
| `/controller.html` | Handy-Seite für alle Spiele (Kamera + Körpererkennung) |
| `js/`, `css/` | Gemeinsamer Code (Sound, Charakter, Handy-Seite, Stile) |

Die Verbindung läuft direkt zwischen Handy und TV (WebRTC über den kostenlosen PeerJS-Vermittlungsserver). Das Kamerabild verlässt das Handy nie.

## Online stellen mit GitHub Pages (gratis, mit HTTPS)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Danach läuft alles unter `https://<name>.github.io/<repo>/`. HTTPS ist Pflicht, sonst gibt der Handy-Browser die Kamera nicht frei.

# 🎈 Ballon-Platzer – `ballon-platzer/`

## Spielen

1. Seite auf dem TV (oder Laptop per HDMI) öffnen → QR-Code erscheint.
2. QR-Code mit dem Handy scannen → **Kamera starten**.
3. Handy hinstellen (2–3 m Abstand, man muss ganz im Bild sein).
4. Beide Arme über den Kopf → Countdown → 60 Sekunden Ballone platzen.

## Charakter

8 fertige Figuren (Mia, Leo, Opa Ruedi, Nala, Kai, Zoe, Ben, Königin Lu) plus Zufall. Alles lässt sich einzeln ändern:
Hautfarbe, Frisur (7), Haarfarbe, Kopfbedeckung (Cap, Mütze, Fischerhut, Partyhut, Krone), Brille, Bart, Oberteil (T-Shirt, Pulli, Hoodie, Jacke), Hose (lang/Shorts) und Schuhe – jeweils mit Farben.

- **Auf dem Handy:** Karte «Dein Charakter» unten auf der Seite. Änderungen erscheinen sofort auf dem TV.
- **Auf dem TV/Laptop:** Button «Charakter anpassen» oder Taste `C`.
- Die Wahl wird im Browser gespeichert. Figur und Kleidung werden komplett im Code erzeugt (`js/avatar.js`), es braucht keine 3D-Dateien.

Die Figur übernimmt nur die *Richtungen* deiner Arme und Beine, die Längen kommen von der Figur. So bleibt der Chibi-Look erhalten, egal wie gross du bist. Ballone platzen mit den Händen und mit dem Kopf.

## Punkte

| Objekt | Punkte |
|---|---|
| Ballon | +10 |
| Goldener Ballon | +50 |
| Gewitterwolke berühren (nur Hände zählen) | −10, Combo weg, danach 1,5 s Schutz |
| Combo (Treffer kurz hintereinander) | ×2 ab 4, ×3 ab 9, ×4 ab 14 |

**Gewitterwolken:** Sie kommen erst nach 10 Sekunden, schauen zuerst kurz am Bildrand herein («⚡ Hände weg!») und fliegen dann vor dir durch, entweder auf Höhe der erhobenen Hände oder auf Brusthöhe. Wer die Arme rechtzeitig senkt, ist sicher. Gleichzeitig gibt es höchstens eine Wolke, gegen Schluss zwei.

**Tasten auf dem TV/Laptop:** `D` Maus-Testmodus · `C` Charakter · `F` Vollbild · `M` Ton an/aus · `Leertaste`/`OK` Start

## 🏎️ Kurvenflitzer – `kurvenflitzer/`

Go-Kart-Rennen in der Ich-Perspektive. Du hältst ein **unsichtbares Lenkrad** vor der Brust und drehst es: Der Winkel zwischen deinen Händen ist der Lenkeinschlag. Gas gibt das Kart von selbst.

- 3 Runden auf einem 1,1 km Rundkurs, mindestens 4 Karts (fehlende Plätze fahren KI-Gegner)
- Münzen sammeln: 5 Münzen = 3 Sekunden **Turbo**
- Wiese bremst, Reifenstapel schubsen zurück, Zusammenstösse kosten Tempo
- **Start:** Alle halten die Hände ruhig vor der Brust, bis ihr Balken voll ist. Danach läuft «Start in …» (allein 8 s, zu mehreren 3 s), damit weitere Personen noch scannen können – jede neue Person verlängert die Wartezeit.
- **Neues Rennen:** im Ziel beide Hände über den Kopf

### Mehrspieler am gleichen TV (bis 4)
Jede Person scannt den QR-Code mit ihrem eigenen Handy. Der Bildschirm teilt sich automatisch (2 = nebeneinander, 3–4 = Viertel). Jede/r hat eigenes Cockpit, eigene Münzen und eigene Anzeige; die anderen sieht man als Karts in ihren Charakterfarben. Wer während eines Rennens dazukommt, fährt ab dem nächsten Rennen mit.

### Online (mehrere TVs)
1. TV B: **Online spielen** → den Code von TV A eingeben (steht auf TV A in der QR-Karte) → **Beitreten**
2. TV A wird automatisch Gastgeber – dort muss nichts gedrückt werden
3. An jedem TV können zusätzlich 1–4 Handys mitspielen (max. 8 Karts insgesamt)

Der Gastgeber-TV steuert Start und KI-Gegner; alle TVs tauschen 15× pro Sekunde ihre Positionen aus (direkt per WebRTC, kein eigener Server). Der Start erfolgt, wenn an allen TVs alle bereit sind.

### Weitere Eingaben
- **Kamera dieses Geräts** – z. B. Laptop-Webcam
- **Tastatur** zum Testen: Spieler 1 mit ← →, Spieler 2 mit A / D, Leertaste = bereit

## Lokal testen

```bash
npx serve .            # oder: python3 -m http.server 8080
```

Am Laptop `http://localhost:8080` öffnen und ein Spiel wählen. Ohne Handy: im Ballon-Platzer **«Ohne Handy testen (Maus)»**, im Kurvenflitzer **«⌨️ Tastatur»**. Für den Handy-Test braucht es HTTPS, also am einfachsten direkt über GitHub Pages.

## Technik

| Teil | Bibliothek |
|---|---|
| 3D | Three.js 0.170 (CDN) |
| Körpererkennung | MediaPipe Pose Landmarker 0.10.14, Modell full (Fallback lite), läuft auf dem Handy |
| Verbindung | PeerJS 1.5.4 (WebRTC) |
| QR-Code | qrcode-generator 1.4.4 |
| Sound | eigene WebAudio-Synth (`js/audio.js`), keine Dateien |

**Performance:** Die TV-Seite reduziert automatisch Auflösung und Schatten, wenn das Gerät ruckelt. Eingebaute Smart-TV-Browser sind oft schwach. Am flüssigsten läuft es auf einem Laptop, Chromecast/Google TV oder Fire-TV-Stick.

**Datenschutz:** Das Kamerabild verlässt das Handy nie. Übertragen werden nur 15 Körperpunkte (x/y-Koordinaten) pro Bild.

## Ideen für später

- Weitere Spiele: «Loch in der Wand», Torwart, Tanz-Posen
- Eigene 3D-Modelle aus Blender (als `.glb` laden)
- Mehrspieler auch für den Ballon-Platzer
- Eigener PeerJS-Server, falls der Gratis-Server einmal überlastet ist (`?peer=host:port`)
