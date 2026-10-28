# Slop Games 🎮

Gratis Bewegungsspiele für den Fernseher. Das Handy ist die Kamera, der Körper ist der Controller – ohne App, ohne eigenen Server.

| Pfad | Inhalt |
|---|---|
| `/` | Startseite: Start, Spiele, So funktioniert’s, Deine Bewegung (Seiten über die Leiste links) |
| `/kurvenflitzer/` | 🏎️ Kurvenflitzer – Go-Kart-Rennen (1–4 Spieler am gleichen TV) |
| `/boxring/` | 🥊 Boxring – Boxen & Kickboxen (1–2 Spieler, allein gegen die KI) |
| `/skicross/` | ⛷️ Skicross – Ski-Rennen mit Schanzen (1–4 Spieler, KI füllt auf 4 auf) |
| `/controller.html?g=…` | Handy-Seite für **alle** Spiele (Kamera, Körpererkennung, Spieler-Karten) |
| `js/`, `css/` | Gemeinsamer Plattform-Code (siehe unten) |

### Plattform vs. Spiel
Gemeinsam für alle Spiele (nichts davon ist an ein Spiel gebunden):

| Datei | Aufgabe |
|---|---|
| `controller.html`, `js/controller.js`, `css/controller.css` | Handy: Kamera, MediaPipe, mehrere Personen, Name/Figur, «Bereit». Texte je Spiel in `GAMES` |
| `js/tracker.js` | Mehrere Personen in einem Kamerabild unterscheiden, Glättung, Tiefe (z) |
| `js/character.js`, `js/avatar2d.js`, `js/avatar3d.js` | Figuren-Daten, Editor, gezeichnete Figur (2D), Chibi-Figur (3D) |
| `js/net.js`, `js/audio.js` | Verbindung (PeerJS), Klänge |
| `css/tv.css`, `css/game.css` | Grundstil TV, Lobby mit Spielerplätzen, Banner, Resultate |
| `index.html` | Startseite; Spiele-Liste + Statistik je Spiel in `GAMES` |

Neues Spiel: eigener Ordner mit `index.html` + Spiel-Code, Eintrag in `GAMES` (Handy-Texte in `js/controller.js`, Statistik in `index.html`), Kachel auf der Startseite.

Die Verbindung läuft direkt zwischen Handy und TV (WebRTC über den kostenlosen PeerJS-Vermittlungsserver). Das Kamerabild verlässt das Handy nie.

## Online stellen mit GitHub Pages (gratis, mit HTTPS)

Repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**. Danach läuft alles unter `https://<name>.github.io/<repo>/`. HTTPS ist Pflicht, sonst gibt der Handy-Browser die Kamera nicht frei.

## 🏎️ Kurvenflitzer – `kurvenflitzer/`

Go-Kart-Rennen in der Ich-Perspektive. Du hältst ein **unsichtbares Lenkrad** vor der Brust und drehst es: Der Winkel zwischen deinen Händen ist der Lenkeinschlag. Gas gibt das Kart von selbst.

- 3 Runden auf einem 1,1 km Rundkurs, mindestens 4 Karts (fehlende Plätze fahren KI-Gegner)
- Münzen sammeln: 5 Münzen = 3 Sekunden **Turbo**
- Wiese bremst, Reifenstapel schubsen zurück, Zusammenstösse kosten Tempo
- **Start:** Jede Person stellt auf dem Handy Name und Fahrer ein und drückt **✓ Bereit**. Erst dann wird am TV ausgerichtet: Hände ruhig vor der Brust halten, bis der Balken voll ist. Danach läuft «Start in …» (allein 8 s, zu mehreren 3 s), damit weitere Personen noch scannen können – jede neue Person verlängert die Wartezeit.
- **Neues Rennen:** im Ziel beide Hände über den Kopf

### Items
Auf der Strecke stehen vier Reihen **?-Boxen**. Wer durchfährt, bekommt ein Item – aber **nur 1 Item pro Runde**; ab der Ziellinie gibt es wieder eins (höchstens 2 auf Vorrat, links oben angezeigt).

1. **Beide Arme nach unten hängen lassen** → das Item-Menü öffnet sich, ein **Autopilot** fährt weiter.
2. Mit der Hand das Item greifen (bei nur einem Item ist es schon in der Hand) und auf eine Person ziehen – kurz darüber halten, bis der Balken voll ist → Wurf.
3. Danach zählt **3-2-1** herunter, so lange fährt der Autopilot noch, dann wieder selbst lenken. (Beide Arme nochmals runter = Menü ohne Wurf schliessen.)

| Item | Wirkung beim Getroffenen |
|---|---|
| 🔀 Spiegel-Lenkung | links und rechts vertauscht (7 s) |
| ↩️ Rückwärtsgang | Kart dreht sich um, fährt rückwärts in Fahrtrichtung, Blick nach hinten, oben ein Rückspiegel zeigt die Strecke vor dir (6 s) |
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

## 🥊 Boxring – `boxring/`

Kampf im Ring. Die Figur folgt deinem Körper; was du Richtung Kamera machst, geht in der Figur nach vorne zum Gegner (MediaPipe liefert dafür die Tiefe).

- **Kampfart in der Lobby:** *Boxen* (nur Arme, auch sitzend) oder *Kickboxen* (auch Tritte – ganzer Körper im Bild, stehend)
- **Ansicht in der Lobby:** *Hinter dir* (über die Schulter, eigene Figur halb durchsichtig, Standard) · *Ich-Sicht* (nur die eigenen Handschuhe) · *Seitlich* (TV-Kamera). Zu zweit bekommt jede Person ihre Bildhälfte. Von hinten wird die Bewegung nicht gespiegelt: linke Hand = links im Bild.
- **Spieler:** 1 Person = gegen die KI, 2 Personen = gegeneinander (eigene Handys oder ein Handy für beide, nebeneinander stehen)
- **Schläge:** *Gerade* = Faust schnell Richtung Kamera (erkannt über Tiefe oder Verkürzung des Arms im Bild) · *Haken* = Ellbogen hoch, Faust schnell von aussen zur Mitte (×1,25 Schaden) · *Uppercut* = Faust schnell von unten nach oben (×1,5, geht teilweise durch die Deckung). Die Figur zeigt jeden erkannten Schlag als Animation mit Comic-Streckung der Arme.
- **Deckung:** beide Fäuste vors Gesicht, sichtbar als Schild + leuchtende Handschuhe (Kopftreffer ganz geblockt, Angreifer kurz ausser Tritt; Körper/Tritt teilweise) · **Ausweichen:** Oberkörper zur Seite (Kopftreffer gehen daneben) · **Tritt:** Fuss schnell nach vorne oder Knie hoch
- **Laufen (Joystick-Prinzip):** Schritt zur Kamera = vorwärts, weg = rückwärts (gemessen an der Schulterbreite), Schritt zur Seite = seitlich um den Gegner herum (Hüfte gegenüber der Grundstellung). Zurück in die Mitte = stehen bleiben. Die Figur dreht sich immer zum Gegner. Ausweichen = Oberkörper gegenüber der Hüfte lehnen. Grundstellung wird zu Beginn jeder Runde neu gemessen.
- **Reichweite:** Schläge treffen bis 2,8 m Abstand, Tritte bis 3,15 m – zurückweichen ist auch Verteidigung
- 100 Lebenspunkte, Runden à 60 s, wer zuerst 2 Runden gewinnt (K.O. oder mehr Lebenspunkte bei Zeitende). Kombos geben Bonus-Schaden, Dauerfeuer (Schläge kurz hintereinander) weniger. Schläge kommen nach 0,2 s an – Zeit zum Reagieren.
- **Treffer-Spuren:** blaue Flecken, Kratzer, Pflaster und blaues Auge je nach Energie (pro Runde neu), Comic-Blutstropfen mit Flecken auf dem Ringboden.
- **Start:** am Handy «Bereit», dann Fäuste vors Gesicht halten · **Neuer Kampf:** beide Fäuste über den Kopf
- **Tastatur:** P1 `Q`/`E` Gerade, `Z` Haken, `C` Uppercut, `W` Deckung, `A`/`D` ausweichen, `S` Tritt, Pfeile laufen · P2 `U`/`O`, `H`, `N`, `I`, `J`/`L`, `K`, `8`/`4`/`5`/`6` laufen · `Leertaste` bereit · `B`/`X` Boxen/Kickboxen · `V` Ansicht

## ⛷️ Skicross – `skicross/`

Vier am Start, eine Piste (ca. 1,2 km) mit Steilkurven, Wellen und drei Schanzen. Kamera hinter der eigenen Figur; zu zweit geteilter Bildschirm, zu dritt/viert in Vierteln. Leere Startplätze fährt die KI.

- **Lenken:** Oberkörper zur Seite lehnen (Schultern gegenüber der Hüfte + Schulterlinie schräg). Unten zeigt eine Anzeige, wie stark man lehnt.
- **Hocke:** Schultern tiefer als im Stehen → weniger Luftwiderstand (schneller), aber träger in Kurven. Die Höhe im Stehen misst das Spiel laufend selbst.
- **Springen:** schnell hochkommen/hochspringen. An der Schanze = Big Air; harte Landungen (flacher Hang, viel Höhe) kosten Tempo.
- **Start:** Gatter öffnet nach 3-2-1; beide Arme schnell nach unten schwingen = mit den Stöcken anschieben (bis 30 m).
- **Skicross-Elemente:** Rempeln (wer hinten ist, verliert Tempo), Windschatten knapp hinter jemandem, Bande kostet Tempo.
- **Start-Pose:** Hocke halten · **Neues Rennen:** beide Hände über den Kopf
- Wird jemand kurz nicht erkannt, fährt ein Autopilot (langsam) weiter.
- **Tastatur:** P1 `←`/`→` lenken, `↓` Hocke, `↑` springen/anschieben · P2 `A`/`D`, `S`, `W` · `Leertaste` bereit
- Statistik: `skicross` (Sekunden), `skiRaces`, `skiWins`, `skiBest`, Verlauf mit `g: 'ski'`

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

- Eigene 3D-Modelle aus Blender (als `.glb` laden)
- Eigener PeerJS-Server, falls der Gratis-Server einmal überlastet ist (`?peer=host:port`)
