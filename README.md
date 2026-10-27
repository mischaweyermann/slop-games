# Slop Games 🎮

Gratis Bewegungsspiele für den Fernseher. Das Handy ist die Kamera, der Körper ist der Controller – ohne App, ohne eigenen Server.

| Pfad | Inhalt |
|---|---|
| `/` | Startseite mit allen Spielen |
| `/kurvenflitzer/` | 🏎️ Kurvenflitzer (1–4 Spieler am gleichen TV) |
| `/controller.html` | Handy-Seite (Kamera + Körpererkennung) |
| `js/`, `css/` | Gemeinsamer Code (Sound, Charakter, Handy-Seite, Stile) |

Die Verbindung läuft direkt zwischen Handy und TV (WebRTC über den kostenlosen PeerJS-Vermittlungsserver). Das Kamerabild verlässt das Handy nie.

## Online stellen mit GitHub Pages (gratis, mit HTTPS)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Danach läuft alles unter `https://<name>.github.io/<repo>/`. HTTPS ist Pflicht, sonst gibt der Handy-Browser die Kamera nicht frei.

## 🏎️ Kurvenflitzer – `kurvenflitzer/`

Go-Kart-Rennen in der Ich-Perspektive. Du hältst ein **unsichtbares Lenkrad** vor der Brust und drehst es: Der Winkel zwischen deinen Händen ist der Lenkeinschlag. Gas gibt das Kart von selbst.

- 3 Runden auf einem 1,1 km Rundkurs, mindestens 4 Karts (fehlende Plätze fahren KI-Gegner)
- Münzen sammeln: 5 Münzen = 3 Sekunden **Turbo**
- Wiese bremst, Reifenstapel schubsen zurück, Zusammenstösse kosten Tempo
- **Start:** Alle halten die Hände ruhig vor der Brust, bis ihr Balken voll ist. Danach läuft «Start in …» (allein 8 s, zu mehreren 3 s), damit weitere Personen noch scannen können – jede neue Person verlängert die Wartezeit.
- **Neues Rennen:** im Ziel beide Hände über den Kopf

### Items
Auf der Strecke stehen vier Reihen **?-Boxen**. Wer durchfährt, bekommt ein Item – aber **nur 1 Item pro Runde**; ab der Ziellinie gibt es wieder eins (höchstens 2 auf Vorrat, links oben angezeigt).

1. **Beide Arme nach unten hängen lassen** → das Item-Menü öffnet sich, ein **Autopilot** fährt weiter.
2. Mit der Hand das Item greifen (bei nur einem Item ist es schon in der Hand) und auf eine Person ziehen – kurz darüber halten, bis der Balken voll ist → Wurf.
3. Danach zählt **3-2-1** herunter, so lange fährt der Autopilot noch, dann wieder selbst lenken. (Beide Arme nochmals runter = Menü ohne Wurf schliessen.)

| Item | Wirkung beim Getroffenen |
|---|---|
| 🔀 Spiegel-Lenkung | links und rechts vertauscht (7 s) |
| ↩️ Rückwärtsgang | Kart dreht sich um, fährt rückwärts in Fahrtrichtung, Blick nach hinten (6 s) |
| ⛔ Vollbremse | sofortiger Stillstand (ca. 2,5 s) |
| 🔧 Motorausfall | Motor aus, bis die getroffene Person **3× beide Arme über den Kopf** hebt (Tastatur: ← → abwechselnd) |

Wer getroffen wurde, ist **20 Sekunden geschützt** (im Menü ausgegraut; ein Wurf in dieser Zeit prallt ab und das Item kommt zurück). Über getroffenen Karts schwebt das Symbol, damit alle sehen, wen es erwischt hat. KI-Gegner sammeln und werfen auch.

### Mehrspieler am gleichen TV (bis 4)
Zwei Wege, auch gemischt:
- **Jede Person mit eigenem Handy:** QR-Code scannen, auf dem Handy «Nur ich» wählen.
- **Mehrere vor einer Kamera:** Ein Handy (oder die Laptop-Kamera über «Kamera dieses Geräts») filmt bis zu 4 Personen nebeneinander. Auf dem Handy «Mehrere» wählen (Standard). Jede erkannte Person bekommt automatisch einen eigenen Platz; wer das Bild verlässt, wird in der Lobby nach ein paar Sekunden wieder entfernt.

**Fahrer & Name:** Jede erkannte Person bekommt einen Namensvorschlag und fährt sofort mit. Ändern auf dem Kamera-Handy unter **Spieler**: pro Person eine Karte mit Namensfeld, Fahrer-Auswahl und «Charakter genau einstellen». Wer allein spielt, wird beim nächsten Mal mit gespeichertem Namen übernommen.

Der Bildschirm teilt sich automatisch (2 = nebeneinander, 3–4 = Viertel). Wer während eines Rennens dazukommt, fährt ab dem nächsten Rennen mit.

### Weitere Eingaben
- **Kamera dieses Geräts** – z. B. Laptop-Webcam
- **Tastatur** zum Testen: Spieler 1 mit ← →, Spieler 2 mit A / D, Leertaste = bereit, ↑ / W = Item-Menü & werfen, ↓ / S = zurück

## Verbindung Handy ↔ TV

Handy und TV verbinden sich direkt (WebRTC). Am zuverlässigsten ist es, wenn beide im **gleichen WLAN** sind.

## Lokal testen

```bash
npx serve .            # oder: python3 -m http.server 8080
```

Am Laptop `http://localhost:8080` öffnen und ein Spiel wählen. Ohne Handy: im Kurvenflitzer **«⌨️ Tastatur»**. Für den Handy-Test braucht es HTTPS, also am einfachsten direkt über GitHub Pages.

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
- Eigener PeerJS-Server, falls der Gratis-Server einmal überlastet ist (`?peer=host:port`)
