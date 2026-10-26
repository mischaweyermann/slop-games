// Ballon-Platzer – Handy-Seite
// Kamera -> MediaPipe Pose (läuft komplett auf dem Handy) -> Körperpunkte per WebRTC an den TV.

import { createEditor, loadConfig, saveConfig } from './character.js';

const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// «full» ist genauer (mit Grafikchip), «lite» ist der Notnagel für schwache Handys
const MODEL_FULL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MODEL_LITE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
// Nur diese Punkte werden gesendet: Nase, Schultern, Ellbogen, Handgelenke, Zeigefinger, Hüften, Knie, Knöchel
const IDX = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28];
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [15, 19], [16, 20]];

const params = new URLSearchParams(location.search);
// Welches Spiel läuft auf dem TV? (?g=rennen) – bestimmt nur die Texte
const GAME = params.get('g') === 'rennen' ? 'rennen' : 'ballon';
const TXT = GAME === 'rennen' ? {
  far: 'Setz dich so hin, dass Oberkörper und beide Hände im Bild sind.',
  play: ['Rennen läuft! 🏎️', 'Dreh das unsichtbare Lenkrad und schau auf den Fernseher.'],
  results: ['Im Ziel!', 'Beide Hände über den Kopf für ein neues Rennen.'],
  ready: ['Bereit!', 'Halte beide Hände vor der Brust, wie an einem Lenkrad.'],
  result: (m) => [m.score === 1 ? '🏆 Sieg!' : `Platz ${m.score}!`, 'Beide Hände über den Kopf für ein neues Rennen.'],
} : {
  far: 'Geh 2–3 Schritte zurück, bis du von Kopf bis Fuss im Bild bist.',
  play: ['Spiel läuft! 🎈', 'Schau auf den Fernseher und platze die Ballone.'],
  results: ['Runde vorbei!', 'Arme hoch für noch eine Runde.'],
  ready: ['Bereit!', 'Heb beide Arme über den Kopf, um zu starten.'],
  result: (m) => [m.record ? `Neuer Rekord: ${m.score} Punkte!` : `${m.score} Punkte!`, 'Arme hoch für noch eine Runde.'],
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
  facing = b.dataset.cam;
  document.querySelectorAll('.seg').forEach((x) => {
    const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', on);
  });
}));
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
  try {
    await startCamera();
  } catch (e) {
    ui.startBtn.disabled = false;
    showError(e && e.name === 'NotAllowedError'
      ? 'Kamerazugriff verweigert. Erlaube die Kamera in den Browser-Einstellungen und versuche es nochmals.'
      : 'Kamera konnte nicht gestartet werden: ' + (e && e.message || e));
    return;
  }
  ui.setup.hidden = true; ui.running.hidden = false;
  history.replaceState(null, '', '?c=' + code + (GAME === 'rennen' ? '&g=rennen' : '') + (params.get('peer') ? '&peer=' + params.get('peer') : ''));
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
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
  });
  try { landmarker = await PoseLandmarker.createFromOptions(vision, opts('GPU', MODEL_FULL)); }
  catch { landmarker = await PoseLandmarker.createFromOptions(vision, opts('CPU', MODEL_LITE)); }
  slowCheckAt = performance.now() + 4000;
  ui.loading.classList.add('done');
}

/* ---------- Erkennungsschleife ---------- */
let lastTs = -1, fpsN = 0, fpsT = performance.now(), slowCheckAt = Infinity, lastFps = 30;

/* One-Euro-Filter: glättet Zittern bei langsamen Bewegungen, reagiert sofort bei schnellen */
class OneEuro {
  constructor(minCutoff = 1.4, beta = 7, dCutoff = 1.2) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  static a(cutoff, dt) { const r = 2 * Math.PI * cutoff * dt; return r / (r + 1); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    const dx = (v - this.x) / dt;
    this.dx += OneEuro.a(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.a(cutoff, dt) * (v - this.x);
    return this.x;
  }
  reset() { this.x = null; this.dx = 0; }
}
const filters = IDX.map(() => [new OneEuro(), new OneEuro()]);
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

  const visible = lm && lm[11].visibility > 0.5 && lm[12].visibility > 0.5;
  if (visible !== bodySeen) { bodySeen = !!visible; check('chkBody', bodySeen); updateMessage(); }

  if (lm) {
    const k = [], t = performance.now();
    // Glätten und spiegeln (1 - x), damit der TV wie ein Spiegel wirkt
    IDX.forEach((i, n) => {
      const p = lm[i];
      const x = filters[n][0].filter(p.x, t), y = filters[n][1].filter(p.y, t);
      k.push(r3(1 - x), r3(y), Math.round((p.visibility ?? 1) * 100) / 100);
    });
    send({ t: 'p', k, w: v.videoWidth, h: v.videoHeight });
    if (previewOn) drawSkeleton(lm);
  } else if (performance.now() - lastNoneSent > 300) {
    filters.forEach((f) => { f[0].reset(); f[1].reset(); });
    lastNoneSent = performance.now();
    send({ t: 'p', k: null });
  }
}

function drawSkeleton(lm) {
  const W = ui.overlay.width, H = ui.overlay.height;
  ctx2d.lineCap = 'round';
  ctx2d.lineWidth = Math.max(4, W / 90);
  ctx2d.strokeStyle = 'rgba(255,255,255,.9)';
  ctx2d.shadowColor = 'rgba(169,139,255,.9)'; ctx2d.shadowBlur = 10;
  ctx2d.beginPath();
  for (const [a, b] of BONES) {
    if (lm[a].visibility < 0.4 || lm[b].visibility < 0.4) continue;
    ctx2d.moveTo(lm[a].x * W, lm[a].y * H); ctx2d.lineTo(lm[b].x * W, lm[b].y * H);
  }
  ctx2d.stroke();
  ctx2d.shadowBlur = 0;
  for (const i of [15, 16]) {
    if (lm[i].visibility < 0.4) continue;
    ctx2d.fillStyle = '#ff8fa3';
    ctx2d.beginPath(); ctx2d.arc(lm[i].x * W, lm[i].y * H, W / 40, 0, Math.PI * 2); ctx2d.fill();
  }
  if (lm[0].visibility > 0.4) {
    ctx2d.fillStyle = '#b6a3ff';
    ctx2d.beginPath(); ctx2d.arc(lm[0].x * W, lm[0].y * H, W / 30, 0, Math.PI * 2); ctx2d.fill();
  }
}

/* ---------- Verbindung zum TV ---------- */
function peerOptions() {
  const p = params.get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { host, port: +port || 443, path: '/', secure: location.protocol === 'https:', debug: 1 };
}

let reconnectTimer = null;
function connect() {
  setChip('wait', 'Verbinde …');
  peer = new window.Peer(peerOptions());
  peer.on('open', openConn);
  peer.on('error', (e) => {
    if (e.type === 'peer-unavailable') {
      setChip('err', 'TV nicht gefunden');
      message('Fernseher nicht gefunden', `Ist die TV-Seite offen und lautet der Code ${code}?`);
      retry();
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
      setChip('err', 'Keine Verbindung');
      setTimeout(() => { peer.destroy(); connect(); }, 3000);
    } else {
      console.warn('Peer-Fehler', e.type, e);
    }
  });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
}
function retry() { clearTimeout(reconnectTimer); reconnectTimer = setTimeout(openConn, 2500); }

function openConn() {
  if (!peer || peer.destroyed || peer.disconnected) return;
  const c = peer.connect(PEER_PREFIX + code, { reliable: false, serialization: 'json' });
  c.on('open', () => {
    conn = c;
    setChip('ok', 'Mit TV verbunden');
    check('chkTv', true);
    send({ t: 'hello' });
    send({ t: 'char', c: charCfg });
    updateMessage();
  });
  c.on('data', onTv);
  c.on('close', () => {
    if (conn !== c) return;
    conn = null; check('chkTv', false);
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
  else if (msg.t === 'state') { tvState = msg.s; updateMessage(); }
  else if (msg.t === 'result') {
    message(...TXT.result(msg));
  }
}

function updateMessage() {
  if (!conn) return message('Verbinde mit dem Fernseher …', `Code ${code} – die TV-Seite muss offen sein.`);
  if (!bodySeen) return message('Ich sehe dich noch nicht', TXT.far);
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

if (code.length === 5) ui.startBtn.focus();

/* ---------- Charakter ---------- */
const CHAR_KEY = 'ballonplatzer.character';
let charCfg = loadConfig(CHAR_KEY);
createEditor($('charEditor'), charCfg, (c) => {
  charCfg = c;
  saveConfig(CHAR_KEY, c);
  send({ t: 'char', c });
  buzz(12);
});

async function switchToLite() {
  try {
    const { FilesetResolver, PoseLandmarker } = await import(VISION);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const lite = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_LITE, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    const old = landmarker; landmarker = lite; lastTs = -1; old.close?.();
  } catch (e) { console.warn('Lite-Modell nicht verfügbar', e); }
}

// Rennspiel: Einleitungstext anpassen
if (GAME === 'rennen') {
  const p = document.querySelector('.hero > p');
  if (p) p.textContent = 'Das Handy wird zur Kamera. Stell es vor dich, sodass es deinen Oberkörper und beide Hände sieht – im Sitzen geht das prima.';
  document.title = 'Kurvenflitzer · Handy';
}
