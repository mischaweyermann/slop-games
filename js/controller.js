// Slop Games – Handy-Seite für alle Spiele (Kamera + Körpererkennung, Spieler-Karten).
// Spiel-eigene Texte kommen aus GAMES (Spiel über ?g=…).
// Kamera -> MediaPipe Pose (läuft komplett auf dem Handy) -> Körperpunkte per WebRTC an den TV.

import { createEditor, loadConfig, saveConfig, sanitize, PRESETS } from './character.js';
import { MultiTracker, OneEuro } from './tracker.js';
import { avatarSvg } from './avatar2d.js';
import { peerOptions as netOptions, deviceId } from './net.js';

const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// «full» ist genauer (mit Grafikchip), «lite» ist der Notnagel für schwache Handys
const MODEL_FULL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MODEL_LITE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
// Nur diese Punkte werden gesendet: Nase, Schultern, Ellbogen, Handgelenke, Zeigefinger, Hüften, Knie, Knöchel
const IDX = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28];
// Mehrere Personen mit einer Kamera (bis 4) oder nur eine
let multi = (() => { try { return localStorage.getItem('slop.multi') !== '0'; } catch { return true; } })();
const tracker = new MultiTracker(4);
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [15, 19], [16, 20]];

const params = new URLSearchParams(location.search);
// Texte je Spiel – neue Spiele hier eintragen
const GAMES = {
  rennen: {
    title: 'Kurvenflitzer', intro: 'Das Handy wird zur Kamera. Stell es vor dich, sodass es deinen Oberkörper und beide Hände sieht – im Sitzen geht das prima.',
    far: 'Setz dich so hin, dass Oberkörper und beide Hände im Bild sind.',
    pose: 'Hände vor die Brust wie an ein Lenkrad und still halten',
    play: ['Rennen läuft! 🏎️', 'Dreh das unsichtbare Lenkrad. Beide Arme runter = Item werfen.'],
    queued: 'Das aktuelle Rennen läuft noch – du fährst beim nächsten mit.',
    results: ['Im Ziel!', 'Beide Hände über den Kopf = weiter · beide Arme runter = zur Übersicht.'],
    result: (m) => [m.gpEnd ? (m.score === 1 ? '🏆 Grand-Prix-Sieg!' : `Grand Prix: Platz ${m.score}!`) : m.score === 1 ? '🏆 Sieg!' : `Platz ${m.score}!`, 'Beide Hände über den Kopf = weiter · beide Arme runter = zur Übersicht.'],
  },
  box: {
    title: 'Boxring', intro: 'Das Handy wird zur Kamera. Stell es 2–3 m vor dich (zu zweit: nebeneinander), sodass es euch ganz sieht.',
    far: 'Stell dich so hin, dass dich die Kamera vom Kopf bis (beim Kickboxen) zu den Füssen sieht.',
    pose: 'Fäuste vors Gesicht halten (Deckung)',
    play: ['Kampf läuft! 🥊', 'Gerade, Haken oder Uppercut schlagen · Fäuste vors Gesicht = Deckung, Oberkörper lehnen = ausweichen. Schritt vor/zurück/zur Seite = laufen, zurück in die Mitte = stehen.'],
    queued: 'Der Kampf läuft noch – du bist beim nächsten dabei.',
    results: ['Kampf vorbei!', 'Beide Fäuste hoch über den Kopf für einen neuen Kampf – oder unten «Zur Übersicht».'],
    result: (m) => [m.score === 1 ? '🏆 Gewonnen!' : 'Knapp verloren!', 'Beide Fäuste hoch über den Kopf für einen neuen Kampf – oder unten «Zur Übersicht».'],
  },
  ski: {
    title: 'Skicross', intro: 'Das Handy wird zur Kamera. Stell es 2–3 m vor dich (zu mehreren: nebeneinander), sodass es dich vom Kopf bis zu den Knien sieht.',
    far: 'Stell dich so hin, dass dich die Kamera vom Kopf bis mindestens zu den Knien sieht.',
    pose: 'In die Hocke gehen (Abfahrtshocke) und kurz halten',
    play: ['Rennen läuft! ⛷️', 'Zur Seite lehnen = lenken · Hocke = schneller · schnell hochkommen = springen · am Start Arme runter schwingen = anschieben.'],
    queued: 'Das Rennen läuft noch – du fährst beim nächsten mit.',
    results: ['Im Ziel!', 'Beide Hände über den Kopf für ein neues Rennen – oder unten «Zur Übersicht».'],
    result: (m) => [m.score === 1 ? '🏆 Sieg!' : `Platz ${m.score}!`, 'Beide Hände über den Kopf für ein neues Rennen – oder unten «Zur Übersicht».'],
  },
};
const GAME_ID = GAMES[params.get('g')] ? params.get('g') : 'rennen';
const G = GAMES[GAME_ID];
const TXT = {
  ...G,
  ready: ['Fast bereit!', `Unten bei «Spieler» Name und Figur wählen und «Bereit» drücken. Danach am TV: ${G.pose}.`],
};
const ui = {
  codeInput: $('codeInput'), startBtn: $('startBtn'), setupError: $('setupError'),
  setup: $('setup'), running: $('running'), video: $('video'), overlay: $('overlay'),
  previewCard: $('previewCard'), loading: $('loading'), loadingText: $('loadingText'), fps: $('fps'),
  chip: $('connChip'), chipText: $('connText'), msgTitle: $('msgTitle'), msgSub: $('msgSub'),
};
const ctx2d = ui.overlay.getContext('2d');

let code = (params.get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
ui.codeInput.value = code;
let facing = 'user';
let landmarker = null, stream = null, peer = null, conn = null;
let bodySeen = false, lastNoneSent = 0, previewOn = true, running = false, tvState = 'lobby';

/* ---------- UI-Helfer ---------- */
function setChip(kind, text) { ui.chip.className = 'chip ' + kind; ui.chipText.textContent = text; }
function check(id, ok) { $(id).classList.toggle('ok', ok); }
function message(title, sub) {
  if (ui.msgTitle.textContent === title && ui.msgSub.textContent === sub) return;
  ui.msgTitle.textContent = title; ui.msgSub.textContent = sub;
  const m = ui.msgTitle.parentElement; m.classList.remove('pop'); void m.offsetWidth; m.classList.add('pop');
}
function showError(text) { ui.setupError.textContent = text; ui.setupError.hidden = false; }

document.querySelectorAll('.seg').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.cam) facing = b.dataset.cam;
  if (b.dataset.mode) setMulti(b.dataset.mode === 'multi');
  b.parentElement.querySelectorAll('.seg').forEach((x) => {
    const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', on);
  });
}));
function setMulti(on) {
  multi = on;
  try { localStorage.setItem('slop.multi', on ? '1' : '0'); } catch { /* */ }
  send({ t: 'mode', m: on ? 'multi' : 'single' });
  if (landmarker) landmarker.setOptions?.({ numPoses: on ? 4 : 1 });
}
document.querySelectorAll('.seg[data-mode]').forEach((x) => { const on = (x.dataset.mode === 'multi') === multi; x.classList.toggle('active', on); x.setAttribute('aria-checked', on); });
ui.codeInput.addEventListener('input', () => {
  ui.codeInput.value = ui.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
});

/* ---------- Start ---------- */
ui.startBtn.addEventListener('click', async () => {
  code = ui.codeInput.value.trim();
  if (code.length !== 5) {
    ui.codeInput.classList.remove('shake'); void ui.codeInput.offsetWidth; ui.codeInput.classList.add('shake');
    ui.codeInput.focus();
    return;
  }
  if (!window.isSecureContext) { showError('Bitte die Seite über https:// öffnen – sonst erlaubt der Browser keine Kamera.'); return; }
  ui.startBtn.disabled = true; ui.setupError.hidden = true;
  connect(); // falls noch nicht verbunden
  diag('dgCam', 'wait', 'startet …');
  try {
    await startCamera();
  } catch (e) {
    ui.startBtn.disabled = false;
    diag('dgCam', 'err', e && e.name === 'NotAllowedError' ? 'nicht erlaubt' : 'Fehler');
    showError(e && e.name === 'NotAllowedError'
      ? 'Kamerazugriff verweigert. Erlaube die Kamera in den Browser-Einstellungen und versuche es nochmals.'
      : 'Kamera konnte nicht gestartet werden: ' + (e && e.message || e));
    return;
  }
  diag('dgCam', 'ok', 'läuft');
  ui.setup.hidden = true; ui.running.hidden = false;
  document.getElementById('running').prepend(document.getElementById('diag'));
  history.replaceState(null, '', '?c=' + code + '&g=' + GAME_ID + (params.get('peer') ? '&peer=' + params.get('peer') : ''));
  running = true;
  keepAwake();
  connect();
  loadModel().then(loop).catch((e) => {
    ui.loadingText.textContent = 'KI konnte nicht geladen werden. Internet prüfen und Seite neu laden.';
    ui.loading.classList.add('fail');
    console.error(e);
  });
});

async function startCamera() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: facing, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  });
  ui.video.srcObject = stream;
  await ui.video.play().catch(() => {});
  ui.previewCard.classList.toggle('mirror', facing === 'user');
  check('chkCam', true);
}

async function loadModel() {
  ui.loadingText.textContent = 'KI wird geladen …';
  const { FilesetResolver, PoseLandmarker } = await import(VISION);
  const vision = await FilesetResolver.forVisionTasks(WASM);
  const opts = (delegate, model) => ({
    baseOptions: { modelAssetPath: model, delegate },
    runningMode: 'VIDEO', numPoses: multi ? 4 : 1,
    minPoseDetectionConfidence: 0.45, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35,
  });
  try { landmarker = await PoseLandmarker.createFromOptions(vision, opts('GPU', MODEL_FULL)); }
  catch { landmarker = await PoseLandmarker.createFromOptions(vision, opts('CPU', MODEL_LITE)); }
  slowCheckAt = performance.now() + 4000;
  ui.loading.classList.add('done');
}

/* ---------- Erkennungsschleife ---------- */
let lastTs = -1, fpsN = 0, fpsT = performance.now(), slowCheckAt = Infinity, lastFps = 30;

const filters = IDX.map(() => [new OneEuro(), new OneEuro()]);
const zf = IDX.map(() => new OneEuro(1, 4));
const r3 = (v) => Math.round(v * 1000) / 1000;

function loop() {
  const schedule = () => ('requestVideoFrameCallback' in HTMLVideoElement.prototype
    ? ui.video.requestVideoFrameCallback(frame)
    : requestAnimationFrame(frame));
  const frame = () => {
    if (!running) return;
    const v = ui.video;
    if (v.readyState >= 2 && v.videoWidth) {
      const ts = performance.now();
      if (ts > lastTs) {
        lastTs = ts;
        let res = null;
        try { res = landmarker.detectForVideo(v, ts); } catch (e) { console.warn(e); }
        handle(res);
        fpsN++;
        if (ts - fpsT > 1000) { lastFps = Math.round((fpsN * 1000) / (ts - fpsT)); ui.fps.textContent = lastFps + ' fps'; fpsN = 0; fpsT = ts; }
        // Zu langsam für das genaue Modell? -> auf «lite» wechseln
        if (ts > slowCheckAt) { slowCheckAt = Infinity; if (lastFps < 15) switchToLite(); }
      }
    }
    schedule();
  };
  schedule();
}

function handle(res) {
  const v = ui.video, lm = res && res.landmarks && res.landmarks[0];
  if (ui.overlay.width !== v.videoWidth) { ui.overlay.width = v.videoWidth; ui.overlay.height = v.videoHeight; }
  ctx2d.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  if (multi) return handleMulti(res);

  const visible = lm && lm[11].visibility > 0.5 && lm[12].visibility > 0.5;
  if (visible !== bodySeen) { bodySeen = !!visible; check('chkBody', bodySeen); updateMessage(); }

  if (lm) {
    const k = [], z = [], t = performance.now();
    // Glätten und spiegeln (1 - x), damit der TV wie ein Spiegel wirkt
    IDX.forEach((i, n) => {
      const p = lm[i];
      const x = filters[n][0].filter(p.x, t), y = filters[n][1].filter(p.y, t);
      k.push(r3(1 - x), r3(y), Math.round((p.visibility ?? 1) * 100) / 100);
      z.push(r3(zf[n].filter(p.z ?? 0, t)));
    });
    send({ t: 'p', k, z, w: v.videoWidth, h: v.videoHeight });
    if (previewOn) drawSkeleton(lm);
  } else if (performance.now() - lastNoneSent > 300) {
    filters.forEach((f) => { f[0].reset(); f[1].reset(); });
    lastNoneSent = performance.now();
    send({ t: 'p', k: null });
  }
}

// Mehrere Personen: jede bekommt eine feste ID, der TV macht daraus je einen Spieler
let lastMultiSent = 0;
function handleMulti(res) {
  const v = ui.video, t = performance.now();
  const tracks = tracker.update((res && res.landmarks) || [], t);
  const seen = tracks.length > 0;
  if (seen !== bodySeen) { bodySeen = seen; check('chkBody', bodySeen); updateMessage(); }
  if (tracks.length || t - lastMultiSent > 300) {
    lastMultiSent = t;
    send({ t: 'mp', ps: tracks.map((tr) => ({ id: tr.id, k: tracker.points(tr, t), z: tracker.depth(tr, t) })), w: v.videoWidth, h: v.videoHeight });
  }
  if (previewOn) for (const tr of tracks) {
    const info = players.find((q) => q.id === tr.id);
    drawSkeleton(tr.lm, info ? info.color : '#ffffff', info ? info.name : '…');
  }
}

function drawSkeleton(lm, color = '', label = '') {
  const W = ui.overlay.width, H = ui.overlay.height;
  ctx2d.lineCap = 'round';
  ctx2d.lineWidth = Math.max(4, W / 90);
  ctx2d.strokeStyle = color || 'rgba(255,255,255,.9)';
  ctx2d.shadowColor = 'rgba(226,87,76,.9)'; ctx2d.shadowBlur = 10;
  ctx2d.beginPath();
  for (const [a, b] of BONES) {
    if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) continue;
    ctx2d.moveTo(lm[a].x * W, lm[a].y * H); ctx2d.lineTo(lm[b].x * W, lm[b].y * H);
  }
  ctx2d.stroke();
  ctx2d.shadowBlur = 0;
  for (const i of [15, 16]) {
    if (lm[i].visibility < 0.4) continue;
    ctx2d.fillStyle = '#f7e9a6';
    ctx2d.beginPath(); ctx2d.arc(lm[i].x * W, lm[i].y * H, W / 40, 0, Math.PI * 2); ctx2d.fill();
  }
  if (lm[0].visibility > 0.4) {
    ctx2d.fillStyle = color || '#e2574c';
    ctx2d.beginPath(); ctx2d.arc(lm[0].x * W, lm[0].y * H, W / 30, 0, Math.PI * 2); ctx2d.fill();
  }
  if (label) {
    // Namensschild über dem Kopf (Vorschau ist gespiegelt -> Text zurückspiegeln)
    const x = ((lm[11].x + lm[12].x) / 2) * W, y = Math.max(20, lm[0].y * H - W / 12);
    ctx2d.save();
    ctx2d.translate(x, y); if (ui.previewCard.classList.contains('mirror')) ctx2d.scale(-1, 1);
    ctx2d.font = `700 ${Math.round(W / 22)}px Poppins, sans-serif`; ctx2d.textAlign = 'center'; ctx2d.textBaseline = 'middle';
    const w = ctx2d.measureText(label).width + W / 30;
    ctx2d.fillStyle = color || '#e2574c'; ctx2d.beginPath(); ctx2d.roundRect?.(-w / 2, -W / 32, w, W / 16, W / 32); ctx2d.fill();
    ctx2d.fillStyle = '#fff'; ctx2d.fillText(label, 0, 1);
    ctx2d.restore();
  }
}

/* ---------- Verbindung zum TV ---------- */
const peerOptions = () => netOptions(params);
const PID = deviceId();

let reconnectTimer = null;
let peerCode = '';
function connect() {
  if (code.length !== 5) return;
  if (peer && !peer.destroyed && peerCode === code) return; // läuft schon
  if (peer) { try { peer.destroy(); } catch { /* */ } conn = null; pending = null; }
  peerCode = code;
  setChip('wait', 'Verbinde …');
  diag('dgNet', 'wait', 'verbinde …'); diag('dgTv', 'wait', 'warte …');
  peer = new window.Peer(peerOptions());
  peer.on('open', () => { diag('dgNet', 'ok', 'verbunden'); openConn(); });
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      diag('dgTv', 'err', `Code ${code} nicht gefunden`);
      hint('Kein Fernseher mit diesem Code. Ist die Spielseite auf dem TV offen? Stimmt der Code (siehe TV)?');
      setChip('err', 'TV nicht gefunden');
      message('Fernseher nicht gefunden', `Ist die TV-Seite offen und lautet der Code ${code}?`);
      retry();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
      diag('dgNet', 'err', 'kein Server');
      hint('Der Verbindungsdienst ist nicht erreichbar. Internet am Handy prüfen (WLAN oder Mobilfunk an?).');
      setChip('err', 'Keine Verbindung');
      setTimeout(() => { peer.destroy(); connect(); }, 3000);
    } else {
      console.warn('Peer-Fehler', e.type, e);
    }
  });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
}
function retry() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(openConn, 2500); }

let pending = null, openTimer = null, tries = 0;
function openConn() {
  if (!peer || peer.destroyed || peer.disconnected) return;
  if ((conn && conn.open) || pending) return; // schon verbunden bzw. Versuch läuft – keine doppelten Spieler
  tries++;
  const c = pending = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json', metadata: { type: 'phone', pid: PID, multi } });
  // Kommt die Verbindung nicht zustande (Netzwerk blockiert), nach 10 s neu versuchen
  clearTimeout(openTimer);
  openTimer = setTimeout(() => {
    if (pending !== c || c.open) return;
    pending = null; try { c.close(); } catch { /* */ }
    setChip('err', 'Verbindung hängt');
    if (!c.__ice) {
      // TV hat gar nicht geantwortet -> falscher Code oder TV-Seite zu
      diag('dgTv', 'err', `TV ${code} antwortet nicht`);
      hint('Der Fernseher antwortet nicht. Stimmt der Code? Ist die Spielseite auf dem TV offen (nicht im Standby)?');
    } else {
      diag('dgTv', 'err', 'kein Weg zum TV');
      hint('Handy und TV finden keinen Weg zueinander. Fast immer hilft: Handy ins <b>gleiche WLAN</b> wie der TV (nicht Mobilfunk, nicht Gäste-WLAN). Danach Seite neu laden.');
    }
    message('Verbindung zum TV klappt nicht', tries >= 2 ? 'Am besten Handy und TV im gleichen WLAN – Mobilfunk oder Gäste-WLAN blockieren oft.' : 'Neuer Versuch …');
    retry();
  }, 16000);
  diag('dgTv', 'wait', 'verbinde …');
  // Zustand der direkten Verbindung beobachten (zeigt, ob das Netzwerk blockiert)
  let iceTries = 0;
  const watchIce = () => {
    const pc = c.peerConnection;
    if (!pc) return ++iceTries < 50 && setTimeout(watchIce, 200);
    pc.addEventListener('iceconnectionstatechange', () => {
      const st = pc.iceConnectionState;
      if (st !== 'new') c.__ice = true;
      if (st === 'checking') diag('dgTv', 'wait', 'suche Weg …');
      if (st === 'failed' && !c.open) { diag('dgTv', 'err', 'blockiert'); hint('Das Netzwerk blockiert die Verbindung zum TV. Handy ins <b>gleiche WLAN</b> wie der TV bringen (nicht Mobilfunk, nicht Gäste-WLAN) und Seite neu laden.'); }
    });
  };
  watchIce();
  c.on('open', () => {
    clearTimeout(openTimer); pending = null; tries = 0;
    diag('dgTv', 'ok', 'verbunden'); hint('');
    conn = c;
    setChip('ok', 'Mit TV verbunden');
    check('chkTv', true);
    send({ t: 'hello' });
    send({ t: 'mode', m: multi ? 'multi' : 'single' });
    // Allein: gespeicherten Namen + Charakter mitbringen (dann entfällt die Auswahl am TV)
    if (!multi && savedName) send({ t: 'setp', id: null, name: savedName, cfg: charCfg });
    else if (!multi) send({ t: 'char', c: charCfg });
    updateMessage();
  });
  c.on('data', onTv);
  c.on('error', () => { if (pending === c) { pending = null; retry(); } });
  c.on('close', () => {
    if (pending === c) pending = null;
    if (conn !== c) return;
    conn = null; check('chkTv', false);
    diag('dgTv', 'wait', 'getrennt – neuer Versuch …');
    setChip('wait', 'Verbindung verloren …');
    updateMessage();
    retry();
  });
}

function send(msg) { if (conn && conn.open) { try { conn.send(msg); } catch { /* */ } } }

function buzz(p) { if (navigator.vibrate) navigator.vibrate(p); }

function onTv(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hit') buzz(msg.gold ? [25, 30, 25] : 22);
  else if (msg.t === 'bad') buzz([90, 50, 90]);
  else if (msg.t === 'state') { tvState = msg.s; updateMessage(); renderPlayers(players); $('endActions').hidden = tvState !== 'results'; }
  else if (msg.t === 'fx') { buzz(msg.bad ? [120, 60, 120] : [30, 40, 30]); if (msg.title) { message(msg.title, msg.sub || ''); clearTimeout(fxTimer); fxTimer = setTimeout(updateMessage, (msg.ms || 3000)); } }
  else if (msg.t === 'ps') renderPlayers(msg.l || []);
  else if (msg.t === 'result') {
    message(...TXT.result(msg));
    queueSave(msg);
  }
}

let fxTimer = 0;
function updateMessage() {
  if (!conn) return message('Verbinde mit dem Fernseher …', `Code ${code} – die TV-Seite muss offen sein.`);
  if (!bodySeen) return message('Ich sehe dich noch nicht', TXT.far);
  if (tvState === 'queued') return message('Du bist dabei! 🎉', TXT.queued);
  if (tvState === 'play') return message(...TXT.play);
  if (tvState === 'countdown') return message('Achtung, fertig …', 'Gleich geht’s los!');
  if (tvState === 'results') return message(...TXT.results);
  message(...TXT.ready);
}

/* ---------- Bildschirm wach halten ---------- */
let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* nicht unterstützt */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && running) keepAwake(); });

/* ---------- Buttons ---------- */
$('againBtn').addEventListener('click', () => { send({ t: 'end', a: 'again' }); buzz(20); });
$('menuBtn').addEventListener('click', () => { send({ t: 'end', a: 'menu' }); buzz(20); });
$('previewBtn').addEventListener('click', (e) => {
  previewOn = !previewOn;
  ui.previewCard.classList.toggle('off', !previewOn);
  if (!previewOn) ctx2d.clearRect(0, 0, ui.overlay.width, ui.overlay.height);
  e.currentTarget.textContent = previewOn ? 'Vorschau ausblenden' : 'Vorschau zeigen';
});
$('switchBtn').addEventListener('click', async () => {
  facing = facing === 'user' ? 'environment' : 'user';
  try { await startCamera(); } catch { facing = facing === 'user' ? 'environment' : 'user'; await startCamera().catch(() => {}); }
});

// Diagnose-Anzeige
function diag(id, kind, text) { const el = document.getElementById(id); if (!el) return; el.className = 'diag-row ' + kind; el.querySelector('.t').textContent = text; }
function hint(html) { const el = document.getElementById('dgHint'); el.innerHTML = html; el.hidden = !html; }

// In-App-Browser (WhatsApp, Instagram, Facebook …) sperren oft Kamera und Verbindungen
const UA = navigator.userAgent || '';
if (/Instagram|FBAN|FBAV|FB_IAB|WhatsApp|Line\/|Snapchat|TikTok|musical_ly|; wv\)|GSA\//.test(UA)) {
  const b = document.createElement('div'); b.className = 'inapp';
  b.textContent = 'Du bist in einem App-Browser. Bitte öffne die Seite in Safari oder Chrome (Menü «…» → «Im Browser öffnen») – sonst funktionieren Kamera und Verbindung oft nicht.';
  document.body.insertBefore(b, document.querySelector('main'));
}
if (!window.RTCPeerConnection) { diag('dgTv', 'err', 'nicht unterstützt'); hint('Dieser Browser kann keine direkte Verbindung aufbauen. Bitte Safari oder Chrome verwenden.'); }

// Sofort mit dem TV verbinden (nicht erst nach dem Kamerastart)
if (code.length === 5) { ui.startBtn.focus(); connect(); }
ui.codeInput.addEventListener('input', () => { if (ui.codeInput.value.length === 5) { code = ui.codeInput.value; connect(); } });

/* ---------- Spieler (Name + Charakter pro erkannter Person) ---------- */
const CHAR_KEY = 'ballonplatzer.character';
let charCfg = loadConfig(CHAR_KEY);
let savedName = (() => { try { return localStorage.getItem('slop.name') || ''; } catch { return ''; } })();
let players = [];             // vom TV: [{ id, name, color, cfg, slot }]
let ownedSkins = new Set();   // gekaufte Teile aus der Garderobe (nur mit Konto)
const lockedHint = () => acctNote(acctUser ? 'Dieses Teil gibt es in der Garderobe auf slopgames.ch.' : 'Melde dich an – dann kannst du in der Garderobe neue Teile holen.');
const cards = new Map();      // id -> { el, editor }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function renderPlayers(list) {
  players = list;
  const box = $('players');
  $('playersEmpty').hidden = list.length > 0;
  const keep = new Set(list.map((q) => String(q.id)));
  for (const [id, c] of cards) if (!keep.has(id)) { c.el.remove(); cards.delete(id); }
  for (const q of list) {
    const key = String(q.id);
    let c = cards.get(key);
    if (!c) {
      const el = document.createElement('div');
      el.className = 'pcard';
      el.innerHTML = `<div class="pc-head"><span class="pc-av"></span><div class="pc-who"><b class="pc-slot"></b><input class="pc-name" maxlength="14" autocomplete="off" spellcheck="false" aria-label="Name"></div></div>
        <div class="pc-presets">${PRESETS.map((pr, i) => `<button type="button" class="pc-pre" data-i="${i}"><span class="pc-face">${avatarSvg(sanitize(pr.cfg), { body: false })}</span>${esc(pr.name)}</button>`).join('')}</div>
        <button type="button" class="secondary pc-more">Charakter genau einstellen</button><div class="pc-editor" hidden></div>
        <div class="pc-status"><span class="pc-step"></span><span class="pc-bar"><i></i></span></div>
        <button type="button" class="primary pc-ok">✓ Bereit</button>`;
      box.appendChild(el);
      c = { el, cfg: sanitize(q.cfg), name: q.name };
      const name = el.querySelector('.pc-name');
      const push = () => { send({ t: 'setp', id: q.id, name: c.name, cfg: c.cfg }); if (!multi) { savedName = c.name; charCfg = c.cfg; try { localStorage.setItem('slop.name', c.name); } catch { /* */ } saveConfig(CHAR_KEY, c.cfg); syncProfile(c.name, c.cfg); } drawAvatar(c); buzz(12); };
      let nameT = 0;
      name.addEventListener('input', () => { c.name = name.value.trim(); clearTimeout(nameT); if (c.name) nameT = setTimeout(push, 400); });
      el.querySelectorAll('.pc-pre').forEach((b) => b.addEventListener('click', () => { c.cfg = sanitize(PRESETS[+b.dataset.i].cfg); if (c.editor) c.editor.set(c.cfg); push(); }));
      c.editorEl = el.querySelector('.pc-editor');
      el.querySelector('.pc-more').addEventListener('click', () => {
        c.editorEl.hidden = !c.editorEl.hidden;
        if (!c.editorEl.hidden && !c.editor) c.editor = createEditor(c.editorEl, c.cfg, (cfg) => { c.cfg = cfg; push(); }, { owned: ownedSkins, onLocked: lockedHint });
      });
      el.querySelector('.pc-ok').addEventListener('click', () => { send({ t: 'ok', id: q.id, v: !c.confirmed }); buzz(20); });
      cards.set(key, c);
    }
    const el = c.el;
    c.color = q.color; c.confirmed = !!q.ok;
    el.style.setProperty('--c', q.color);
    el.querySelector('.pc-slot').textContent = `P${q.slot + 1}`;
    const name = el.querySelector('.pc-name');
    if (document.activeElement !== name) { name.value = q.name; c.name = q.name; }
    if (!c.editor || c.editorEl.hidden) c.cfg = sanitize(q.cfg);
    drawAvatar(c);
    // Ablauf: 1. einstellen + «Bereit» drücken  2. am TV Startpose halten (je Spiel)  3. bereit
    const step = q.ready ? 'Bereit! Gleich geht’s los 🏁' : q.ok ? `Jetzt am TV: ${G.pose}` : 'Name und Figur wählen, dann «Bereit» drücken';
    el.querySelector('.pc-step').textContent = tvState === 'play' || tvState === 'countdown' ? 'Spielt mit 🎮' : step;
    el.querySelector('.pc-bar').hidden = !q.ok || q.ready;
    el.querySelector('.pc-bar i').style.width = Math.round((q.fill || 0) * 100) + '%';
    const ok = el.querySelector('.pc-ok');
    ok.textContent = q.ok ? 'Doch noch ändern' : '✓ Bereit';
    ok.classList.toggle('secondary', !!q.ok); ok.classList.toggle('primary', !q.ok);
    ok.hidden = tvState === 'play' || tvState === 'countdown';
    el.classList.toggle('ok', !!q.ok); el.classList.toggle('ready', !!q.ready);
  }
}
let avKey = new WeakMap();
function drawAvatar(c) {
  const k = JSON.stringify(c.cfg) + c.color;
  if (avKey.get(c) === k) return;
  avKey.set(c, k);
  c.el.querySelector('.pc-av').innerHTML = avatarSvg(c.cfg);
  c.el.querySelectorAll('.pc-pre').forEach((b) => {
    const pr = PRESETS[+b.dataset.i].cfg;
    b.classList.toggle('sel', ['skin', 'hair', 'hairColor', 'topColor', 'hat', 'glasses', 'beard'].every((x) => pr[x] === c.cfg[x]));
  });
}

async function switchToLite() {
  try {
    const { FilesetResolver, PoseLandmarker } = await import(VISION);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const lite = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_LITE, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: multi ? 4 : 1,
      minPoseDetectionConfidence: 0.45, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35,
    });
    const old = landmarker; landmarker = lite; lastTs = -1; old.close?.();
  } catch (e) { console.warn('Lite-Modell nicht verfügbar', e); }
}

// Einleitungstext + Titel je Spiel
{
  document.title = `${G.title} · Handy`;
  const p = document.querySelector('.hero > p');
  if (p) p.textContent = G.intro;
}

// Test-Hilfe (Konsole)
window.__ctl = { renderPlayers, send: (m) => send(m), get conn() { return conn; } };

/* ================================================================
   Konto: angemeldet? Dann jede Runde dieses Handys speichern
   ================================================================ */
let acct = null, acctUser = null, saveBuf = [], saveTimer = 0, noteTimer = 0;
function acctNote(text) {
  const n = $('acctNote'); if (!n) return;
  n.textContent = text; n.hidden = !text;
  clearTimeout(noteTimer); if (text) noteTimer = setTimeout(() => { n.hidden = true; }, 8000);
}
async function renderAcct() {
  const btn = $('acctBtn'); if (!btn) return;
  if (!acct) { $('acctTitle').textContent = 'Konto'; $('acctSub').textContent = 'Gerade nicht erreichbar – du kannst trotzdem spielen.'; btn.hidden = true; return; }
  const back = location.pathname.split('/').pop() + location.search;
  if (!acctUser) {
    $('acctTitle').textContent = 'Runden speichern?';
    $('acctSub').textContent = 'Melde dich an, dann landen deine Minuten und Plätze in deinem Konto – und deine Figur ist überall dabei.';
    btn.textContent = 'Anmelden'; btn.href = 'login.html?next=' + encodeURIComponent(back); btn.hidden = false;
    return;
  }
  let nick = '';
  try {
    const p = await acct.getProfile();
    nick = (p && p.nickname) || '';
    // Name und Figur aus dem Profil übernehmen (gelten für alle Spiele)
    if (p && (p.nickname || p.character)) {
      if (p.nickname) savedName = p.nickname.slice(0, 14);
      if (p.character) charCfg = sanitize(p.character);
      try { ownedSkins = await acct.loadOwnedSkins(); for (const c of cards.values()) if (c.editor) c.editor.setOwned(ownedSkins); } catch { /* */ }
      if (!multi && conn && conn.open && savedName) send({ t: 'setp', id: null, name: savedName, cfg: charCfg });
    }
  } catch { /* */ }
  $('acctTitle').textContent = 'Angemeldet' + (nick ? ' als ' + nick : '');
  $('acctSub').textContent = multi ? 'Deine Runden werden gespeichert, wenn du allein vor der Kamera spielst.' : 'Deine Runden werden gespeichert.';
  btn.textContent = 'Mein Profil'; btn.href = './#profil'; btn.hidden = false;
}
function queueSave(msg) {
  if (!msg || !msg.game) return;
  saveBuf.push(msg);
  clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 1200);
}
async function flushSave() {
  const list = saveBuf; saveBuf = [];
  if (!acct || !acctUser || !list.length) return;
  // Bei mehreren Personen vor einer Kamera ist nicht klar, wer das Konto hat
  if (list.length > 1) { acctNote('Mehrere Personen an diesem Handy – diese Runde wird nicht ins Konto gespeichert.'); return; }
  const m = list[0];
  // Gleiches Konto wie am TV: dort ist die Runde schon gespeichert
  if (m.tvacc && m.tvacc === acctUser.id) { acctNote('✓ Runde im Konto am TV gespeichert'); return; }
  try {
    const r = await acct.savePlay({ game: m.game, seconds: m.sec, place: m.score, players: m.n, finishTime: m.time, won: m.win });
    acctNote(r && r.earned > 0 ? `✓ Runde gespeichert · +${r.earned} Münzen` : '✓ Runde in deinem Konto gespeichert');
  } catch { acctNote('Die Runde konnte nicht gespeichert werden.'); }
}
import('./account.js').then(async (m) => {
  acct = m;
  try { acctUser = await m.currentUser(); } catch { acctUser = null; }
  renderAcct();
  m.onAuth((u) => { acctUser = u; renderAcct(); });
}).catch(() => renderAcct());

// Änderungen am Handy auch im Profil speichern (nur «Nur ich», angemeldet)
let profileT = 0;
function syncProfile(name, cfg) {
  if (!acct || !acctUser) return;
  clearTimeout(profileT);
  profileT = setTimeout(() => { acct.saveProfile({ nickname: name || undefined, character: cfg }).catch(() => {}); }, 1200);
}
