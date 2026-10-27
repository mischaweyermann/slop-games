# Slop Games 🎮

Gratis Bewegungsspiele für den Fernseher. Das Handy ist die Kamera, der Körper ist der Controller – ohne App, ohne eigenen Server.

| Pfad | Inhalt |
|---|---|
| `/` | Startseite mit allen Spielen |
| `/kurvenflitzer/` | 🏎️ Kurvenflitzer (1–4 Spieler am TV + online) |
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

Wer getroffen wurde, ist **20 Sekunden geschützt** (im Menü ausgegraut; ein Wurf in dieser Zeit prallt ab und das Item kommt zurück). Über getroffenen Karts schwebt das Symbol, damit alle sehen, wen es erwischt hat. KI-Gegner sammeln und werfen auch. Online funktionieren Würfe zwischen allen TVs.

### Mehrspieler am gleichen TV (bis 4)
Jede Person scannt den QR-Code mit ihrem eigenen Handy. Der Bildschirm teilt sich automatisch (2 = nebeneinander, 3–4 = Viertel). Jede/r hat eigenes Cockpit, eigene Münzen und eigene Anzeige; die anderen sieht man als Karts in ihren Charakterfarben. Wer während eines Rennens dazukommt, fährt ab dem nächsten Rennen mit.

### Online (mehrere TVs)
1. TV A: **Online spielen → 🔗 Einladungs-Link teilen** und den Link per WhatsApp o. ä. schicken
2. Der Freund öffnet den Link auf **seinem TV/Laptop** (nicht auf dem Handy) – sein Bildschirm tritt automatisch bei. Alternativ dort **Online spielen** → Code von TV A eingeben → **Beitreten**
3. Bis der andere Bildschirm verbunden ist, startet keiner allein (oben steht «Warte auf den eingeladenen Bildschirm …» bzw. «Verbinde mit Raum …»; beide Hände hoch = trotzdem allein fahren). In der Lobby zeigt ein grüner Balken, wer am anderen Bildschirm dabei ist.
4. Wichtig: Handys scannen immer den QR-Code auf **ihrem eigenen** Bildschirm. Wer den QR-Code von TV A scannt, fährt auf TV A mit.
5. An jedem TV können zusätzlich 1–4 Handys mitspielen (max. 8 Karts insgesamt)

Der Gastgeber-TV steuert Start und KI-Gegner; alle TVs tauschen 15× pro Sekunde ihre Positionen aus (direkt per WebRTC, kein eigener Server). Der Start erfolgt, wenn an allen TVs alle bereit sind.

### Weitere Eingaben
- **Kamera dieses Geräts** – z. B. Laptop-Webcam
- **Tastatur** zum Testen: Spieler 1 mit ← →, Spieler 2 mit A / D, Leertaste = bereit, ↑ / W = Item-Menü & werfen, ↓ / S = zurück

## Verbindung in jedem Netz

Die Geräte versuchen sich zuerst **direkt** zu verbinden (WebRTC, schnellster Weg). Klappt das nach 4 Sekunden nicht – z. B. zwei verschiedene Heimnetze, Mobilfunk, Gäste-WLAN –, läuft die Verbindung automatisch über einen **Umweg**: einen öffentlichen MQTT-Server über eine normale Web-Verbindung (`js/relay.js`, Reihenfolge: broker.emqx.io → broker.hivemq.com → test.mosquitto.org). Kein Konto, kein eigener Server. Übertragen werden nur Spieldaten (Körperpunkte, Positionen), nie ein Kamerabild. Auf dem Handy steht dann «verbunden (über Relay)».

Testen: `?relay=only` erzwingt den Umweg, `?relay=off` schaltet ihn ab, `?mqtt=ws://…` nimmt einen eigenen Broker.

### Optional: TURN-Relay (Metered)

Normalerweise verbinden sich Handy und TV direkt. In Mobilfunk, Gäste-WLAN, Firmennetzen
oder online zwischen zwei Wohnungen geht das oft nicht – dann braucht es ein **Relay**.
Das Gratis-Relay von PeerJS ist unzuverlässig, deshalb kann ein eigenes eingetragen werden:

1. Gratis-Konto auf [metered.ca](https://www.metered.ca/stun-turn) erstellen → App anlegen (z. B. `slopegames`).
2. Im Dashboard unter *TURN Server* den **API Key** kopieren.
3. In `js/config.js` eintragen: `TURN_APP = 'slopegames'`, `TURN_KEY = '…'` → committen.

Ohne Eintrag läuft alles wie bisher (direkt + Gratis-Fallback). Testen ohne Commit: `?turn=app:key` an die URL hängen.

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
