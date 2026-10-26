// Kurvenflitzer – Rennspiel in der Fahrerperspektive, mit Mehrspieler-Modus.
//  • Lokal: bis zu 4 Personen am gleichen TV, jede mit eigenem Handy (geteilter Bildschirm)
//  • Online: mehrere TVs in einem Raum – ein TV ist Gastgeber (steuert Start und KI-Gegner)
// Gelenkt wird mit einem unsichtbaren Lenkrad: Der Winkel zwischen beiden Händen ist der Lenkeinschlag.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAudio } from '../js/audio.js';
import { loadConfig, sanitize } from '../js/character.js';
import { GRASS, WALL, T, N, SEG, TRACK_LEN, sample, nearest, nearestGlobal, lateral, buildWorld, makeKart } from './world.js';
import { Cockpit } from './cockpit.js';

/* ================================================================
   Grundlagen
   ================================================================ */
const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAR_KEY = 'ballonplatzer.character';
const LAPS = 3;
const V_MAX = 34, V_BOOST = 45, V_GRASS = 15;
const MAX_LOCAL = 4;     // Spieler pro TV
const MIN_FIELD = 4;     // so viele Karts mindestens (Rest = KI)
const MAX_FIELD = 8;     // Höchstzahl Karts im Online-Rennen
const P_COLORS = ['#e8574f', '#5aa9c9', '#7fb069', '#f39a4c'];
const HELMETS = ['#fbf7f0', '#f2c94c', '#f3a6b8', '#3f325e'];
const AI_DEF = [
  { name: 'Blitz', color: '#5aa9c9', helmet: '#fbf7f0', vmax: 33.2 },
  { name: 'Sunny', color: '#f2c94c', helmet: '#3f325e', vmax: 32.4 },
  { name: 'Lila', color: '#9b7fd1', helmet: '#f3a6b8', vmax: 31.6 },
  { name: 'Minzi', color: '#7fb069', helmet: '#fbf7f0', vmax: 30.8 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const fmt = (t) => { if (t == null || !isFinite(t)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const newCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const params = new URLSearchParams(location.search);
const audio = createAudio();
const myTv = newCode() + newCode(); // eindeutige Kennung dieses Geräts (für Online)

/* ================================================================
   Renderer, Szene, Licht, Welt
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // pro Bild einmal, auch bei geteiltem Bildschirm
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#efe4d8', 110, 420);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight('#fff6ec', '#9cc58b', 1.25));
const sun = new THREE.DirectionalLight('#ffe7cc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
sun.shadow.camera.layers.enableAll(); // auch Karts auf Spieler-Ebenen werfen Schatten
scene.add(sun, sun.target);
let shadowMode = '';
function setShadowArea(mode) {
  if (shadowMode === mode) return;
  shadowMode = mode;
  const r = mode === 'near' ? 45 : 200;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: mode === 'near' ? 160 : 420 });
  sun.shadow.camera.updateProjectionMatrix();
}
buildWorld(scene);

const demoCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 900); scene.add(demoCam);
const topCam = new THREE.PerspectiveCamera(45, 16 / 9, 1, 1200); scene.add(topCam);
topCam.position.set(0, 330, 260); topCam.lookAt(0, 0, 0);
demoCam.layers.enableAll(); topCam.layers.enable(0);
for (let i = 0; i < MAX_LOCAL; i++) { demoCam.layers.disable(5 + i); topCam.layers.enable(1 + i); }

/* ---------- Münzen (pro Spieler eigene, damit jede/r alle einsammeln kann) ---------- */
const COINS = [];
for (let s = 70; s < TRACK_LEN - 30; s += 42) {
  const off = Math.sin(s * 0.013) * 4.2;
  for (let k = 0; k < 3; k++) { const sp = sample(s + k * 4.5); COINS.push(sp.p.clone().addScaledVector(sp.r, off).setY(1.1)); }
}
const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 28); coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshPhysicalMaterial({ color: '#f2c94c', metalness: 0.85, roughness: 0.25, clearcoat: 1, emissive: '#8a5a00', emissiveIntensity: 0.25 });
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s1 = new THREE.Vector3(1, 1, 1), _s0 = new THREE.Vector3(0, 0, 0);

/* ================================================================
   Rennfahrer (KI, lokale Spieler, Online-Gäste) + lokale Spieler
   ================================================================ */
const racers = new Map();     // id -> Rennfahrer
let roster = [];              // Startaufstellung (Reihenfolge = Startplatz, vorne zuerst)
const locals = [];            // Spieler an diesem TV (max. 4)
const pendingPhones = [];     // Handys, die während eines Rennens dazukommen
let raceT = 0;

const setLayer = (obj, layer) => obj.traverse((o) => o.layers.set(layer));
const kartColorOf = (p) => (['#f4efe6', '#3b3b45', '#c69c6d'].includes(p.cfg.topColor) ? P_COLORS[p.slot] : p.cfg.topColor);

function createRacer(def) {
  const r = {
    id: def.id, def, name: def.name, color: def.color, helmet: def.helmet,
    kind: def.kind === 'ai' ? (role === 'client' ? 'remote' : 'ai') : (def.tv === myTv ? 'local' : 'remote'),
    kart: makeKart(scene, def.color, def.helmet, def.skin),
    pos: new THREE.Vector3(), heading: 0, v: 0, idx: 0, lap: 0, prog: -10, finished: null,
    s: 0, off: 0, offT: 0, laneT: 0, vmax: def.vmax || 32,
    tgt: { x: 0, z: 0, h: 0, v: 0 }, gotAt: -1e9,
  };
  return r;
}
function removeRacer(r) { scene.remove(r.kart); racers.delete(r.id); }

function createLocal(source, conn = null) {
  const used = new Set(locals.map((p) => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  if (slot >= MAX_LOCAL) return null;
  const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.05, 900);
  scene.add(camera);
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, COINS.length);
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage); coins.layers.set(5 + slot);
  scene.add(coins);
  const p = {
    slot, id: `${myTv}:${slot}`, source, conn, camera, cockpit: new Cockpit(camera, 5 + slot), coins,
    cfg: slot === 0 ? loadConfig(CHAR_KEY) : sanitize({}),
    input: { steer: 0, onWheel: false, handsUp: false, lastAt: -1e9, l: false, r: false },
    keyMap: null, racer: null, ready: false, readyT: 0, upT: 0,
    taken: new Uint8Array(COINS.length), coinCount: 0, boost: 0, boostT: 0,
    laps: [], lapStart: 0, prevIdx: 0, bumpCd: 0, wallCd: 0, offroad: false, steer: 0, shake: 0, fovKick: 0, camTarget: new THREE.Vector3(),
  };
  if (source === 'keys') p.keyMap = locals.some((q) => q.keyMap === 'arrows') ? 'ad' : 'arrows';
  if (slot > 0) p.cfg = sanitize({ ...p.cfg, topColor: P_COLORS[slot] });
  p.hud = createHud(p);
  locals.push(p);
  locals.sort((a, b) => a.slot - b.slot);
  return p;
}
function removeLocal(p) {
  const i = locals.indexOf(p); if (i < 0) return;
  locals.splice(i, 1);
  scene.remove(p.camera); scene.remove(p.coins); p.hud.root.remove();
  if (p.racer) p.racer.local = null;
}
const pName = (p) => `P${p.slot + 1}`;
const humanDef = (p) => ({ id: p.id, kind: 'human', tv: myTv, name: pName(p), color: kartColorOf(p), helmet: HELMETS[p.slot], skin: p.cfg.skin, pc: P_COLORS[p.slot] });

/* ---------- Startaufstellung zusammenstellen ---------- */
function buildRoster() {
  if (role === 'client' && hostRoster) {
    // Vorläufig: eigene Spieler sofort einsetzen, der Gastgeber schickt gleich die endgültige Liste
    const others = hostRoster.filter((d) => d.tv !== myTv);
    const mine = hostRoster.filter((d) => d.tv === myTv && locals.some((p) => p.id === d.id));
    const missing = locals.filter((p) => !mine.some((d) => d.id === p.id)).map(humanDef);
    return [...others, ...mine, ...missing];
  }
  let humans = locals.map(humanDef);
  if (role === 'host') {
    let k = 2;
    for (const t of tvConns.values()) {
      humans = humans.concat(t.players.map((d, i) => ({ ...d, name: `TV${k} · P${i + 1}` })));
      k++;
    }
  }
  humans = humans.slice(0, MAX_FIELD);
  const nAI = Math.max(0, MIN_FIELD - humans.length);
  const ai = AI_DEF.slice(0, nAI).map((d, i) => ({ ...d, id: 'ai' + i, kind: 'ai' }));
  return [...ai, ...humans];
}
function applyRoster(list) {
  roster = list;
  const ids = new Set(list.map((d) => d.id));
  for (const r of [...racers.values()]) if (!ids.has(r.id)) removeRacer(r);
  list.forEach((d, slot) => {
    let r = racers.get(d.id);
    const kind = d.kind === 'ai' ? (role === 'client' ? 'remote' : 'ai') : (d.tv === myTv ? 'local' : 'remote');
    if (r && (r.color !== d.color || r.helmet !== d.helmet || r.kind !== kind)) { removeRacer(r); r = null; }
    if (!r) { r = createRacer(d); racers.set(d.id, r); }
    r.def = d; r.name = d.name; r.slot = slot; r.kind = kind;
  });
  for (const p of locals) {
    p.racer = racers.get(p.id) || null;
    if (p.racer) { p.racer.local = p; setLayer(p.racer.kart, 1 + p.slot); }
    p.cockpit.setColors(p.cfg, kartColorOf(p));
  }
  for (const r of racers.values()) if (!r.local) setLayer(r.kart, 0);
  updateLayout();
  if (role === 'host') broadcastTv({ t: 'roster', list, s: state });
}
function refreshRoster() { applyRoster(buildRoster()); }

function gridPos(slot) { // Startplatz 0 = vorne
  const s = TRACK_LEN - 9 - slot * 7.5;
  return { s, lane: slot % 2 ? 2.6 : -2.6 };
}
function resetRace() {
  raceT = 0;
  for (const r of racers.values()) {
    const g = gridPos(r.slot), sp = sample(g.s);
    r.finished = null; r.v = 0; r.lap = 0;
    r.s = g.s; r.off = r.offT = g.lane; r.laneT = 0;
    r.pos.copy(sp.p).addScaledVector(sp.r, g.lane);
    r.heading = Math.atan2(sp.t.x, sp.t.z);
    r.idx = nearestGlobal(r.pos); r.prog = r.idx * SEG - TRACK_LEN;
    r.tgt = { x: r.pos.x, z: r.pos.z, h: r.heading, v: 0 };
    placeKart(r, 0);
  }
  for (const p of locals) {
    Object.assign(p, { ready: false, readyT: 0, upT: 0, coinCount: 0, boost: 0, boostT: 0, laps: [], lapStart: 0, steer: 0, fovKick: 0 });
    p.taken.fill(0);
    if (p.racer) p.prevIdx = p.racer.idx;
  }
}

/* ================================================================
   Eingabe: Lenkwinkel aus den Händen
   ================================================================ */
const NAMES = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lIx', 'rIx', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];
let now = 0;

function onPose(p, k, w = 640, h = 480) {
  if (!Array.isArray(k) || k.length < NAMES.length * 3) return;
  const P = {};
  NAMES.forEach((n, i) => (P[n] = { x: k[i * 3] * w, y: k[i * 3 + 1] * h, v: k[i * 3 + 2] }));
  const ok = (q, th = 0.3) => q.v >= th;
  const inp = p.input;
  if (!ok(P.lSh, 0.4) || !ok(P.rSh, 0.4)) return;
  inp.lastAt = now;
  const sw = Math.hypot(P.rSh.x - P.lSh.x, P.rSh.y - P.lSh.y);
  const hand = (s) => {
    const W = P[s + 'Wr'], I = P[s + 'Ix'];
    if (!ok(W)) return null;
    return ok(I) ? { x: W.x + (I.x - W.x) * 0.5, y: W.y + (I.y - W.y) * 0.5 } : { x: W.x, y: W.y };
  };
  const L = hand('l'), R = hand('r');
  const headY = ok(P.nose, 0.4) ? P.nose.y : (P.lSh.y + P.rSh.y) / 2 - sw * 0.6;
  inp.handsUp = !!(L && R && L.y < headY - sw * 0.15 && R.y < headY - sw * 0.15);
  if (!L || !R) { inp.onWheel = false; return; }
  const dx = R.x - L.x, dy = R.y - L.y, dist = Math.hypot(dx, dy);
  inp.onWheel = dist > sw * 0.35 && dist < sw * 3.2 && !inp.handsUp;
  if (!inp.onWheel) return;
  // Rechte Hand tiefer als linke = Lenkrad im Uhrzeigersinn = rechts
  let ang = Math.atan2(dy, dx);
  if (Math.abs(ang) < 0.05) ang = 0; else ang -= Math.sign(ang) * 0.05;
  inp.steer = clamp(ang / 1.0, -1, 1);
}
const hasControl = (p) => p.source === 'keys' || now - p.input.lastAt < 0.6;
const gripping = (p) => p.source === 'keys' || (hasControl(p) && p.input.onWheel);

const KEYS = { arrows: { l: ['arrowleft'], r: ['arrowright'] }, ad: { l: ['a'], r: ['d'] } };
addEventListener('keydown', (e) => {
  audio.unlock(); updateSoundBtn();
  const k = e.key.toLowerCase();
  if (e.target && e.target.tagName === 'INPUT') return;
  for (const p of locals) if (p.keyMap) {
    if (KEYS[p.keyMap].l.includes(k)) p.input.l = true;
    if (KEYS[p.keyMap].r.includes(k)) p.input.r = true;
  }
  if (k === 'f') toggleFullscreen();
  if (k === 'm') { audio.setMuted(!audio.muted); updateSoundBtn(); }
  if (k === 'k' && !e.repeat) addKeysPlayer();
  if (k === ' ' || k === 'enter') {
    if (state === 'ready') for (const p of locals) if (p.source === 'keys') p.ready = true;
    if (state === 'results' && stateT > 2 && locals.some((p) => p.source === 'keys')) requestRestart();
  }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  for (const p of locals) if (p.keyMap) {
    if (KEYS[p.keyMap].l.includes(k)) p.input.l = false;
    if (KEYS[p.keyMap].r.includes(k)) p.input.r = false;
  }
});

/* ---------- Spieler hinzufügen ---------- */
function joinLocal(source, conn = null) {
  if (state === 'countdown' || state === 'race') {
    if (conn) { pendingPhones.push(conn); toast('Neue/r Spieler/in fährt ab dem nächsten Rennen mit'); }
    return null;
  }
  if (locals.length >= MAX_LOCAL) { toast('Maximal 4 Spieler pro TV'); return null; }
  const p = createLocal(source, conn);
  if (!p) return null;
  audio.unlock(); updateSoundBtn(); audio.whoosh();
  toast(`${pName(p)} ist dabei!`);
  p.hud.root.classList.toggle('show', state !== 'lobby'); p.cockpit.visible = state !== 'lobby';
  sendPlayersToHost();
  refreshRoster();
  if (state === 'lobby') setState('ready'); else if (state === 'ready') resetRace();
  updateStatus();
  return p;
}
function leaveLocal(p) {
  removeLocal(p);
  sendPlayersToHost();
  if (state === 'ready' || state === 'lobby' || state === 'results') {
    refreshRoster();
    if (!locals.length) setState('lobby'); else if (state === 'ready') resetRace();
  }
  updateStatus();
}
function addKeysPlayer() {
  if (locals.filter((p) => p.source === 'keys').length >= 2) { toast('Höchstens 2 Tastatur-Spieler (← → und A/D)'); return; }
  const p = joinLocal('keys');
  if (p) toast(`${pName(p)}: ${p.keyMap === 'arrows' ? '← →' : 'A / D'} lenken, Leertaste = bereit`);
}
$('keysBtn').addEventListener('click', (e) => { e.stopPropagation(); addKeysPlayer(); });

/* ================================================================
   Kamera dieses Geräts (Laptop-Webcam)
   ================================================================ */
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const IDX = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26, 27, 28];
class OneEuro {
  constructor(minCutoff = 1.4, beta = 7, dCutoff = 1.2) { Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0, t: 0 }); }
  static a(c, dt) { const r = 2 * Math.PI * c * dt; return r / (r + 1); }
  filter(v, t) {
    if (this.x === null) { this.x = v; this.t = t; return v; }
    const dt = Math.max((t - this.t) / 1000, 1e-3); this.t = t;
    this.dx += OneEuro.a(this.dCutoff, dt) * ((v - this.x) / dt - this.dx);
    this.x += OneEuro.a(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (v - this.x);
    return this.x;
  }
}
let camPlayer = null;
async function useLocalCamera() {
  const btn = $('camBtn');
  if (camPlayer) return;
  if (!window.isSecureContext) { toast('Die Kamera braucht https://'); return; }
  btn.disabled = true; btn.textContent = '⏳ Kamera startet …';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = $('localVideo'); video.srcObject = stream; await video.play().catch(() => {});
    $('camPip').hidden = false;
    btn.textContent = '⏳ KI wird geladen …';
    const { FilesetResolver, PoseLandmarker } = await import(VISION);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    let lm; try { lm = await PoseLandmarker.createFromOptions(vision, opts('GPU')); } catch { lm = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    camPlayer = joinLocal('cam');
    if (!camPlayer) { btn.disabled = false; btn.textContent = '💻 Kamera dieses Geräts'; return; }
    btn.textContent = '✅ Kamera aktiv';
    const filters = IDX.map(() => [new OneEuro(), new OneEuro()]);
    const ov = $('localOverlay'), g = ov.getContext('2d');
    let last = -1;
    const loop = () => {
      if (video.readyState >= 2 && camPlayer) {
        const ts = performance.now();
        if (ts > last) {
          last = ts;
          const l = lm.detectForVideo(video, ts).landmarks?.[0];
          ov.width = video.videoWidth; ov.height = video.videoHeight; g.clearRect(0, 0, ov.width, ov.height);
          if (l) {
            const k = [];
            IDX.forEach((i, n) => { k.push(1 - filters[n][0].filter(l[i].x, ts), filters[n][1].filter(l[i].y, ts), l[i].visibility ?? 1); });
            onPose(camPlayer, k, video.videoWidth, video.videoHeight);
            g.fillStyle = '#ff8fa3';
            for (const i of [15, 16]) if (l[i].visibility > 0.3) { g.beginPath(); g.arc(l[i].x * ov.width, l[i].y * ov.height, ov.width / 28, 0, 7); g.fill(); }
          }
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    console.warn(e);
    btn.disabled = false; btn.textContent = '💻 Kamera dieses Geräts';
    toast(e && e.name === 'NotAllowedError' ? 'Kamera wurde nicht erlaubt' : 'Kamera/KI konnte nicht starten');
  }
}
$('camBtn').addEventListener('click', (e) => { e.stopPropagation(); useLocalCamera(); });

/* ================================================================
   Netzwerk: Handys (wie beim Ballon-Platzer) + andere TVs (Online)
   ================================================================ */
let peer = null, code = '', retries = 0;
let role = 'solo';             // 'solo' | 'host' | 'client'
const tvConns = new Map();     // nur Gastgeber: tv-id -> { conn, players, ready }
let hostConn = null, hostRoster = null, hostState = 'lobby', hostCode = '';

function peerOptions() {
  const p = params.get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { host, port: +port || 443, path: '/', secure: location.protocol === 'https:', debug: 1 };
}
function setStatus(kind, text) { $('status').className = 'status ' + kind; $('statusText').textContent = text; }
function updateStatus() {
  const n = locals.length;
  let t = n ? `${n} Spieler an diesem TV` : (peer && peer.open ? 'Warte auf Spieler …' : 'Verbinde …');
  if (role === 'host') t += ` · Online-Gastgeber (${tvConns.size} TV${tvConns.size === 1 ? '' : 's'} verbunden)`;
  if (role === 'client') t += ` · Online mit Raum ${hostCode}`;
  setStatus(peer && peer.open ? 'ok' : 'wait', t);
  const mo = role === 'host' ? `🌍 Raum ${code} · ${tvConns.size} weitere TV${tvConns.size === 1 ? '' : 's'}` : role === 'client' ? `🌍 Online im Raum ${hostCode}` : '';
  $('miniOnline').textContent = mo;
}

function startPeer() {
  if (!window.Peer) { setStatus('err', 'Verbindungsdienst nicht geladen'); return; }
  try { code = sessionStorage.getItem('kurvenflitzer.code') || newCode(); } catch { code = newCode(); }
  setStatus('wait', 'Verbinde …');
  peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => {
    retries = 0;
    try { sessionStorage.setItem('kurvenflitzer.code', code); } catch { /* */ }
    renderJoin(); updateStatus();
    if (params.get('room')) joinRoom(params.get('room'));
  });
  peer.on('connection', (c) => {
    if (c.metadata && c.metadata.type === 'tv') return acceptTv(c);
    acceptPhone(c);
  });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); if (++retries > 2) { try { sessionStorage.removeItem('kurvenflitzer.code'); } catch { /* */ } } setTimeout(startPeer, 1500); }
    else if (e.type === 'peer-unavailable') { if (role !== 'client' && joining) { joining = false; onlineInfo('Kein Raum mit diesem Code gefunden. Stimmt der Code?'); } }
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { setStatus('err', 'Keine Verbindung zum Server – neuer Versuch …'); setTimeout(() => { peer && peer.destroy(); startPeer(); }, 4000); }
  });
}

/* ---------- Handys ---------- */
function acceptPhone(c) {
  let p = null;
  c.on('open', () => {
    p = joinLocal('phone', c);
    sendPhone(c, { t: 'state', s: phoneState(), g: 'rennen' });
  });
  c.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (!p) { const q = locals.find((x) => x.conn === c); if (q) p = q; }
    if (msg.t === 'p') { if (p && msg.k) onPose(p, msg.k, msg.w, msg.h); }
    else if (msg.t === 'char') { if (p) { p.cfg = sanitize(msg.c); p.cockpit.setColors(p.cfg, kartColorOf(p)); if (state !== 'race' && state !== 'countdown') { sendPlayersToHost(); refreshRoster(); if (state === 'ready') resetRace(); } } }
    else if (msg.t === 'hello') sendPhone(c, { t: 'state', s: phoneState(), g: 'rennen' });
  });
  c.on('close', () => {
    const i = pendingPhones.indexOf(c); if (i >= 0) pendingPhones.splice(i, 1);
    if (!p) p = locals.find((x) => x.conn === c) || null;
    if (!p) return;
    p.conn = null;
    if (state === 'race' || state === 'countdown') return; // fährt ohne Hände weiter (Gas weg), wird nach dem Rennen entfernt
    leaveLocal(p);
  });
}
function sendPhone(c, msg) { if (c && c.open) { try { c.send(msg); } catch { /* */ } } }
const phoneState = () => (state === 'race' ? 'play' : state);
function phonesState() { for (const p of locals) sendPhone(p.conn, { t: 'state', s: phoneState(), g: 'rennen' }); }

function controllerUrl() {
  const u = new URL('../controller.html', location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('c', code); u.searchParams.set('g', 'rennen');
  if (params.get('peer')) u.searchParams.set('peer', params.get('peer'));
  return u.toString();
}
function qrSvg(text) {
  if (!window.qrcode) return '';
  const qr = window.qrcode(0, 'M'); qr.addData(text); qr.make();
  const n = qr.getModuleCount();
  const inF = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c) && !inF(r, c)) d += `<rect x="${c}" y="${r}" width="1.02" height="1.02" rx="0.28"/>`;
  const f = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="0.6" fill="none" stroke="#3f325e" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.35" fill="#3f325e"/>`;
  return `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR-Code"><g fill="#3f325e">${d}</g>${f(0, 0)}${f(n - 7, 0)}${f(0, n - 7)}</svg>`;
}
function renderJoin() {
  const url = controllerUrl();
  $('code').textContent = code; $('miniCode').textContent = code;
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  const svg = qrSvg(url);
  if (svg) { $('qr').innerHTML = svg; $('miniQr').innerHTML = svg; }
}

/* ---------- Online: Raum erstellen / beitreten ---------- */
let joining = false;
function onlineInfo(html) { $('onlineInfo').innerHTML = html; }
$('onlineBtn').addEventListener('click', (e) => { e.stopPropagation(); $('onlinePanel').hidden = !$('onlinePanel').hidden; });
$('roomInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5); });
$('hostBtn').addEventListener('click', (e) => { e.stopPropagation(); hostRoom(); });
$('joinBtn').addEventListener('click', (e) => { e.stopPropagation(); joinRoom($('roomInput').value); });

function hostRoom() {
  if (!peer || !peer.open) { onlineInfo('Noch keine Verbindung zum Server – bitte kurz warten.'); return; }
  if (role === 'client') leaveRoom();
  role = 'host';
  onlineInfo(`Raum erstellt! Auf den anderen TVs <b>Kurvenflitzer → 🌍 Online</b> öffnen und diesen Code eingeben: <b>${code}</b>`);
  $('hostBtn').textContent = '✅ Gastgeber';
  refreshRoster(); updateStatus();
}
function joinRoom(c) {
  c = (c || '').toUpperCase().trim();
  if (c.length !== 5) { onlineInfo('Bitte den 5-stelligen Code des Gastgeber-TVs eingeben.'); return; }
  if (c === code) { onlineInfo('Das ist der Code dieses TVs – gib den Code des <b>anderen</b> TVs ein.'); return; }
  if (!peer || !peer.open) { onlineInfo('Noch keine Verbindung zum Server – bitte kurz warten.'); return; }
  if (role === 'host') { for (const t of tvConns.values()) t.conn.close(); tvConns.clear(); }
  joining = true;
  onlineInfo('Verbinde mit Raum ' + c + ' …');
  const conn = peer.connect(PEER_PREFIX + c, { reliable: true, serialization: 'json', metadata: { type: 'tv', tv: myTv } });
  conn.on('open', () => {
    joining = false; role = 'client'; hostConn = conn; hostCode = c;
    onlineInfo(`Verbunden mit Raum <b>${c}</b>. Der Gastgeber startet, sobald alle die Hände am Lenkrad haben.`);
    $('hostBtn').textContent = 'Raum erstellen';
    sendPlayersToHost(); updateStatus();
  });
  conn.on('data', onHostMessage);
  conn.on('close', () => {
    if (hostConn !== conn) return;
    hostConn = null; hostRoster = null; role = 'solo';
    toast('Verbindung zum Online-Raum beendet');
    onlineInfo('Die Verbindung zum Raum wurde beendet.');
    if (state !== 'race' && state !== 'countdown') { refreshRoster(); if (state === 'ready') resetRace(); }
    updateStatus();
  });
}
function leaveRoom() { if (hostConn) { const c = hostConn; hostConn = null; c.close(); } role = 'solo'; hostRoster = null; }

function acceptTv(c) {
  if (role !== 'host') { c.on('open', () => { try { c.send({ t: 'nohost' }); } catch { /* */ } setTimeout(() => c.close(), 300); }); return; }
  const tv = c.metadata.tv;
  c.on('open', () => {
    tvConns.set(tv, { conn: c, players: [], ready: false });
    toast('Ein weiterer TV ist dem Raum beigetreten');
    updateStatus();
    try { c.send({ t: 'roster', list: roster, s: state }); } catch { /* */ }
  });
  c.on('data', (msg) => onClientMessage(tv, msg));
  c.on('close', () => {
    tvConns.delete(tv);
    toast('Ein TV hat den Raum verlassen');
    if (state !== 'race' && state !== 'countdown') { refreshRoster(); if (state === 'ready') resetRace(); }
    else for (const r of racers.values()) if (r.def.tv === tv) r.gone = true;
    updateStatus();
  });
}
function broadcastTv(msg, except = null) { for (const [id, t] of tvConns) if (id !== except && t.conn.open) { try { t.conn.send(msg); } catch { /* */ } } }
function sendHost(msg) { if (hostConn && hostConn.open) { try { hostConn.send(msg); } catch { /* */ } } }
function sendPlayersToHost() { if (role === 'client') sendHost({ t: 'players', list: locals.map(humanDef) }); }

// Gastgeber empfängt von einem Gast-TV
function onClientMessage(tv, msg) {
  const t = tvConns.get(tv); if (!t || !msg) return;
  if (msg.t === 'players') {
    t.players = (msg.list || []).slice(0, MAX_LOCAL).map((d) => ({ ...d, tv, kind: 'human' }));
    if (state !== 'race' && state !== 'countdown') { refreshRoster(); if (state === 'ready' || state === 'lobby') resetRace(); }
  } else if (msg.t === 'ready') t.ready = !!msg.v;
  else if (msg.t === 'st') { applyStates(msg.l); broadcastTv(msg, tv); }
  else if (msg.t === 'again') { if (state === 'results' || state === 'ready') doRestart(); }
}
// Gast empfängt vom Gastgeber
function onHostMessage(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'roster') {
    hostState = msg.s || hostState;
    if (state === 'race' || state === 'countdown') { pendingRoster = msg.list; return; }
    hostRoster = msg.list; applyRoster(hostRoster);
    if (state === 'ready' || state === 'lobby') resetRace();
    updateStatus();
  } else if (msg.t === 'st') applyStates(msg.l);
  else if (msg.t === 'go') { if (state === 'ready') setState('countdown'); }
  else if (msg.t === 'reset') { if (pendingRoster) { hostRoster = pendingRoster; pendingRoster = null; } if (msg.list) hostRoster = msg.list; applyRoster(hostRoster || buildRoster()); setState(locals.length ? 'ready' : 'lobby'); }
  else if (msg.t === 'hstate') hostState = msg.s;
  else if (msg.t === 'nohost') { onlineInfo('Unter diesem Code gibt es keinen Online-Raum. Der andere TV muss zuerst «Raum erstellen» drücken.'); }
}
let pendingRoster = null;

// Positionen anderer TVs übernehmen
function applyStates(list) {
  if (!Array.isArray(list)) return;
  for (const s of list) {
    const r = racers.get(s.i);
    if (!r || r.kind !== 'remote') continue;
    r.tgt = { x: s.x, z: s.z, h: s.h, v: s.v };
    r.prog = s.p; r.lap = s.lp; r.finished = s.f; r.gotAt = now;
    if (r.firstSnap !== false) { r.pos.set(s.x, 0, s.z); r.heading = s.h; r.firstSnap = false; }
  }
}
let netT = 0, readyT = 0;
function netTick(dt) {
  if (role === 'solo') return;
  netT -= dt; readyT -= dt;
  if (netT <= 0 && (state === 'race' || state === 'countdown' || state === 'results' || state === 'ready')) {
    netT = 1 / 15;
    const own = [...racers.values()].filter((r) => r.kind === 'local' || (role === 'host' && r.kind === 'ai'));
    const l = own.map((r) => ({ i: r.id, x: +r.pos.x.toFixed(2), z: +r.pos.z.toFixed(2), h: +r.heading.toFixed(3), v: +r.v.toFixed(1), p: +r.prog.toFixed(1), lp: r.lap, f: r.finished }));
    if (role === 'host') broadcastTv({ t: 'st', l }); else sendHost({ t: 'st', l });
  }
  if (role === 'client' && readyT <= 0) { readyT = 0.5; sendHost({ t: 'ready', v: state === 'ready' && locals.length > 0 && locals.every((p) => p.ready) }); }
}

/* ================================================================
   HUD
   ================================================================ */
const SPEED_LEN = 235.6, BOOST_LEN = 251.3 * 0.75, RING = 2 * Math.PI * 42;
function createHud(p) {
  const el = document.createElement('div');
  el.className = 'phud';
  el.innerHTML = `
    <div class="ptag" style="--c:${P_COLORS[p.slot]}"><span class="src">${p.source === 'keys' ? '⌨️' : p.source === 'cam' ? '💻' : '📱'}</span>${pName(p)}</div>
    <div class="pstats">
      <div class="pill ppos"><span class="label">Platz</span><span class="value"><b>–</b><small>/4</small></span></div>
      <div class="pill plap"><span class="label">Runde</span><span class="value"><b>1</b><small>/${LAPS}</small></span></div>
    </div>
    <div class="speedo"><svg viewBox="0 0 120 120" aria-hidden="true"><circle class="track" cx="60" cy="60" r="50"/><circle class="bar" cx="60" cy="60" r="50"/><circle class="boost" cx="60" cy="60" r="40"/></svg>
      <div class="speed-num"><b>0</b><small>km/h</small></div></div>
    <div class="pcoins">🪙 <b>0</b></div>
    <div class="pready"><div class="ring"><svg viewBox="0 0 100 100" aria-hidden="true"><circle class="track" cx="50" cy="50" r="42"/><circle class="bar" cx="50" cy="50" r="42" style="stroke-dasharray:${RING};stroke-dashoffset:${RING}"/></svg><span class="ring-icon">🏎️</span></div>
      <div><div class="t1">Hände ans Lenkrad!</div><div class="t2">Beide Hände vor die Brust</div></div></div>
    <div class="pwheel"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="9"/><path d="M14 54h72M50 54v34" stroke="currentColor" stroke-width="8" stroke-linecap="round"/></svg></div>
    <div class="pbanner" style="--c:${P_COLORS[p.slot]}"></div>`;
  $('phuds').appendChild(el);
  const q = (s) => el.querySelector(s);
  return {
    root: el, pos: q('.ppos b'), posOf: q('.ppos small'), lap: q('.plap b'), speed: q('.speed-num b'), speedo: q('.speedo'),
    bar: q('.speedo .bar'), boost: q('.speedo .boost'), coins: q('.pcoins b'), ready: q('.pready'), readyBar: q('.pready .bar'),
    readyT1: q('.pready .t1'), readyT2: q('.pready .t2'), readyIcon: q('.pready .ring-icon'), wheel: q('.pwheel'), banner: q('.pbanner'),
  };
}
function pBanner(p, text) { const b = p.hud.banner; b.textContent = text; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
function banner(text) { const b = $('banner'); b.textContent = text; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
let toastTimer = 0;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2600); }
function setPrompt(show, text = '', sub = '', icon = '🏎️', fill = 0) {
  $('prompt').classList.toggle('show', show);
  if (text) $('promptText').textContent = text;
  $('promptSub').textContent = sub; $('promptIcon').textContent = icon;
  $('promptBar').style.strokeDasharray = RING; $('promptBar').style.strokeDashoffset = RING * (1 - fill);
}

// Bildausschnitte je nach Spielerzahl
let views = [];
function updateLayout() {
  const W = innerWidth, H = innerHeight, n = locals.length;
  const quads = [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
  views = n <= 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]] : quads.slice(0, n);
  document.body.classList.toggle('split', n > 1);
  document.body.classList.toggle('three', n === 3);
  locals.forEach((p, i) => {
    const [x, y, w, h] = views[i];
    Object.assign(p.hud.root.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    p.hud.root.style.setProperty('--u', Math.min(h / 100, w / 178) * (n > 1 ? 1.25 : 1) + 'px');
    p.camera.aspect = w / h;
  });
  for (const p of locals) {
    p.camera.layers.set(0);
    for (const q of locals) if (q !== p) p.camera.layers.enable(1 + q.slot);
    p.camera.layers.enable(5 + p.slot);
  }
  const targetRatio = Math.min(devicePixelRatio || 1, n > 1 ? 1 : 1.5);
  if (targetRatio !== pixelRatio) { pixelRatio = targetRatio; renderer.setPixelRatio(pixelRatio); }
  renderer.setSize(W, H, false);
}
addEventListener('resize', updateLayout);

// Minimap
const mm = $('minimap'), mmCtx = mm.getContext('2d');
const mmBase = document.createElement('canvas'); mmBase.width = mm.width; mmBase.height = mm.height;
let mmTf;
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of T) { x0 = Math.min(x0, s.p.x); x1 = Math.max(x1, s.p.x); z0 = Math.min(z0, s.p.z); z1 = Math.max(z1, s.p.z); }
  const pad = 36, sc = Math.min((mm.width - pad * 2) / (x1 - x0), (mm.height - pad * 2) / (z1 - z0));
  mmTf = (x, z) => [pad + (x - x0) * sc + ((mm.width - pad * 2) - (x1 - x0) * sc) / 2, pad + (z - z0) * sc + ((mm.height - pad * 2) - (z1 - z0) * sc) / 2];
  const g = mmBase.getContext('2d'); g.lineJoin = g.lineCap = 'round';
  for (const [w, c] of [[26, '#ffffff'], [16, '#a49cb0']]) {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath();
    T.forEach((s, i) => { const [x, y] = mmTf(s.p.x, s.p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.stroke();
  }
  const [sx, sy] = mmTf(T[0].p.x, T[0].p.z); g.fillStyle = '#3f325e'; g.fillRect(sx - 12, sy - 3, 24, 6);
}
function drawMinimap() {
  mmCtx.clearRect(0, 0, mm.width, mm.height); mmCtx.drawImage(mmBase, 0, 0);
  const dot = (x, z, c, r) => { const [px, py] = mmTf(x, z); mmCtx.fillStyle = '#fff'; mmCtx.beginPath(); mmCtx.arc(px, py, r + 4, 0, 7); mmCtx.fill(); mmCtx.fillStyle = c; mmCtx.beginPath(); mmCtx.arc(px, py, r, 0, 7); mmCtx.fill(); };
  for (const r of racers.values()) if (!r.local && !r.gone) dot(r.pos.x, r.pos.z, r.color, r.kind === 'remote' && r.def.kind === 'human' ? 11 : 8);
  for (const p of locals) if (p.racer) dot(p.racer.pos.x, p.racer.pos.z, P_COLORS[p.slot], 13);
}

function standings() {
  return [...racers.values()].filter((r) => !r.gone).sort((a, b) => {
    if (a.finished != null && b.finished != null) return a.finished - b.finished;
    if (a.finished != null) return -1;
    if (b.finished != null) return 1;
    return b.prog - a.prog;
  });
}

/* ================================================================
   Spielzustand
   ================================================================ */
let state = 'lobby', stateT = 0, firstFinishAt = null;
function setState(s) {
  state = s; stateT = 0;
  document.body.className = document.body.className.replace(/\bst-\w+/g, '').trim() + ' st-' + s;
  const playing = s !== 'lobby';
  $('lobby').classList.toggle('hide', playing);
  $('hud').classList.toggle('show', playing);
  $('results').classList.toggle('show', s === 'results');
  $('miniJoin').classList.toggle('show', s === 'ready');
  $('lights').classList.remove('show', 'go');
  [...$('lights').children].forEach((l) => l.classList.remove('on'));
  for (const p of locals) { p.hud.root.classList.toggle('show', playing); p.cockpit.visible = playing; }
  if (s !== 'ready') setPrompt(false);
  if (s === 'ready') {
    // Wartende Handys aufnehmen, getrennte Spieler entfernen
    for (const p of [...locals]) if (p.source === 'phone' && !p.conn) removeLocal(p);
    while (pendingPhones.length && locals.length < MAX_LOCAL) { const c = pendingPhones.shift(); if (c.open) createLocal('phone', c); }
    sendPlayersToHost();
    refreshRoster();
    if (!locals.length) { setState('lobby'); return; }
    resetRace(); audio.engine(true);
  }
  if (s === 'countdown') { $('lights').classList.add('show'); audio.engine(true); firstFinishAt = null; }
  if (s === 'race') { $('lights').classList.add('show', 'go'); audio.go(); banner('LOS!'); setTimeout(() => $('lights').classList.remove('show'), 1200); }
  if (s === 'results') showResults();
  if (s === 'lobby') { audio.engine(false); refreshRoster(); resetRace(); camSnap = true; }
  updateLayout();
  phonesState();
  if (role === 'host') broadcastTv({ t: 'hstate', s });
}

function showResults() {
  audio.end();
  renderResults();
  locals.forEach((p) => {
    const place = standings().indexOf(p.racer) + 1;
    sendPhone(p.conn, { t: 'result', score: place, record: place === 1, g: 'rennen' });
  });
}
function renderResults() {
  const st = standings();
  const mine = locals.map((p) => st.indexOf(p.racer) + 1).filter((x) => x > 0);
  const best = mine.length ? Math.min(...mine) : 0;
  $('resultsTitle').textContent = locals.length > 1
    ? `🏁 ${pName(locals.find((p) => st.indexOf(p.racer) + 1 === best) || locals[0])} ist am schnellsten!`
    : best === 1 ? '🏆 Sieg!' : best === 2 ? '🥈 Zweiter Platz!' : best === 3 ? '🥉 Dritter Platz!' : 'Ziel erreicht!';
  if (role === 'host' || role === 'client') $('resultsTitle').textContent = best === 1 ? '🏆 Sieg für dieses TV!' : `🏁 Bestes Ergebnis hier: Platz ${best}`;
  $('podium').innerHTML = st.map((r, i) => {
    const me = !!r.local;
    const c = me ? P_COLORS[r.local.slot] : r.color;
    const who = r.kind === 'ai' || r.def.kind === 'ai' ? 'KI' : me ? (r.local.coinCount + ' 🪙') : 'online';
    return `<div class="${me ? 'me' : ''}" style="--c:${c}"><span class="place">${i + 1}.</span><span class="dot" style="--c:${r.color}"></span>${r.name}<span class="who">${who}</span><span class="t">${r.finished != null ? fmt(r.finished) : 'fährt noch …'}</span></div>`;
  }).join('');
  $('resultsHint').textContent = role === 'client' ? 'Beide Hände hoch über den Kopf – der Gastgeber startet dann ein neues Rennen' : 'Beide Hände hoch über den Kopf für ein neues Rennen';
}
function requestRestart() { if (role === 'client') sendHost({ t: 'again' }); else doRestart(); }
function doRestart() {
  setState('ready');
  if (role === 'host') broadcastTv({ t: 'reset', list: roster });
}

/* ---------- Fahrphysik (lokale Spieler) ---------- */
const fwd = new THREE.Vector3(), _v = new THREE.Vector3();
function updateLocal(p, dt, driving) {
  const r = p.racer; if (!r) return;
  let target = 0;
  if (p.source === 'keys') target = (p.input.r ? 1 : 0) - (p.input.l ? 1 : 0);
  else if (gripping(p)) target = p.input.steer;
  p.steer += (target - p.steer) * damp(p.source === 'keys' ? 6 : 14, dt);
  r.steer = p.steer;

  const i = r.idx = nearest(r.pos, r.idx);
  p.offroad = Math.abs(lateral(r.pos, i)) > GRASS;
  let vT = 0;
  if (driving) {
    p.boostT = Math.max(0, p.boostT - dt);
    vT = p.boostT > 0 ? V_BOOST : V_MAX;
    vT *= 1 - 0.22 * Math.abs(p.steer) ** 1.5;
    if (p.offroad) vT = Math.min(vT, V_GRASS);
    if (!gripping(p)) vT *= 0.45; // Hände weg vom Lenkrad = Gas weg
  }
  r.v += (vT - r.v) * (r.v < vT ? 0.5 : 1.4) * dt;
  r.v = Math.max(0, r.v);
  r.heading -= p.steer * 1.5 * Math.min(1, r.v / 9) * dt;
  fwd.set(Math.sin(r.heading), 0, Math.cos(r.heading));
  r.pos.addScaledVector(fwd, r.v * dt);

  // Reifenstapel
  p.wallCd -= dt;
  const lat = lateral(r.pos, i);
  if (Math.abs(lat) > WALL - 0.8) {
    r.pos.addScaledVector(T[i].r, Math.sign(lat) * (WALL - 0.8) - lat);
    r.heading += angDiff(r.heading, Math.atan2(T[i].t.x, T[i].t.z)) * 0.5;
    if (p.wallCd <= 0) { r.v *= 0.55; p.wallCd = 0.8; audio.bad(); p.shake = 0.5; sendPhone(p.conn, { t: 'bad' }); }
  }
  // Zusammenstösse mit allen anderen Karts
  p.bumpCd -= dt;
  for (const o of racers.values()) {
    if (o === r || o.gone) continue;
    const d = _v.subVectors(r.pos, o.pos); d.y = 0;
    const L = d.length();
    if (L < 2.7 && L > 0.001) {
      r.pos.addScaledVector(d.normalize(), (2.7 - L) * (o.local ? 0.5 : 1));
      if (p.bumpCd <= 0) { r.v *= 0.86; if (o.kind === 'ai') o.v *= 0.93; p.bumpCd = 0.6; audio.skid(1); p.shake = 0.25; sendPhone(p.conn, { t: 'bad' }); }
    }
  }
  // Münzen
  for (let c = 0; c < COINS.length; c++) {
    if (p.taken[c]) continue;
    if ((COINS[c].x - r.pos.x) ** 2 + (COINS[c].z - r.pos.z) ** 2 < 2.4 * 2.4) {
      p.taken[c] = 1; p.coinCount++;
      p.boost = Math.min(1, p.boost + 0.2);
      audio.pop(Math.min(8, p.coinCount % 9)); sendPhone(p.conn, { t: 'hit' });
      if (p.boost >= 1) { p.boost = 0; p.boostT = 3; audio.gold(); pBanner(p, 'TURBO!'); sendPhone(p.conn, { t: 'hit', gold: true }); }
    }
  }
  if (p.offroad && r.v > 8 && Math.random() < dt * 6) audio.skid(0.4);
  r.prog = (r.lap - 1) * TRACK_LEN + r.idx * SEG;
}
function updateLaps(p) {
  const r = p.racer; if (!r || r.finished != null) return;
  const i = r.idx;
  if (p.prevIdx > N * 0.85 && i < N * 0.15) {
    r.lap++;
    if (r.lap >= 2) {
      p.laps.push(raceT - p.lapStart); p.lapStart = raceT;
      if (r.lap > LAPS) {
        r.finished = raceT; r.lap = LAPS + 1;
        const place = standings().indexOf(r) + 1;
        pBanner(p, `ZIEL! Platz ${place}`); audio.gold();
        if (firstFinishAt == null) firstFinishAt = raceT;
      } else { pBanner(p, r.lap === LAPS ? 'Letzte Runde!' : `Runde ${r.lap}`); audio.combo(2); p.taken.fill(0); }
    } else p.lapStart = raceT;
  } else if (p.prevIdx < N * 0.15 && i > N * 0.85) r.lap--;
  p.prevIdx = i;
  r.prog = (r.lap - 1) * TRACK_LEN + r.idx * SEG;
}

/* ---------- KI (nur solo / Gastgeber) ---------- */
function updateAI(r, dt, mode) {
  const i = Math.floor((((r.s / SEG) % N) + N) % N);
  let R = 1e9; for (let k = 0; k < 40; k += 4) R = Math.min(R, T[(i + Math.round(k / SEG)) % N].R);
  let target = Math.min(r.vmax, Math.sqrt(30 * R));
  if (mode === 'race') {
    const humans = [...racers.values()].filter((o) => o.def.kind === 'human' && !o.gone);
    const lead = humans.length ? Math.max(...humans.map((o) => o.prog)) : r.s - TRACK_LEN;
    target *= clamp(1 + (lead - (r.s - TRACK_LEN)) / 500, 0.9, 1.08);
    if (r.finished != null) target = 18;
  } else if (mode === 'demo') target *= 0.8;
  else target = 0;
  r.v += (target - r.v) * (r.v < target ? 0.45 : 1.6) * dt;
  r.s += r.v * dt;
  r.laneT -= dt;
  if (r.laneT <= 0 && mode !== 'idle') { r.laneT = rand(2, 5); r.offT = clamp(r.offT + rand(-2.5, 2.5), -4.2, 4.2); }
  r.off += (r.offT - r.off) * damp(0.8, dt);
  const sp = sample(r.s);
  r.pos.copy(sp.p).addScaledVector(sp.r, r.off);
  r.heading = Math.atan2(sp.t.x, sp.t.z);
  r.idx = sp.i;
  r.prog = r.s - TRACK_LEN;
  r.lap = Math.floor(r.prog / TRACK_LEN) + 1;
  if (mode === 'race' && r.finished == null && r.prog >= LAPS * TRACK_LEN) r.finished = raceT;
}
function updateRemote(r, dt) {
  // Weiche Bewegung zwischen den Netz-Updates (plus Vorausrechnen)
  const t = r.tgt;
  fwd.set(Math.sin(t.h), 0, Math.cos(t.h));
  t.x += fwd.x * t.v * dt; t.z += fwd.z * t.v * dt;
  r.pos.x = lerp(r.pos.x, t.x, damp(10, dt)); r.pos.z = lerp(r.pos.z, t.z, damp(10, dt));
  r.heading += angDiff(r.heading, t.h) * damp(10, dt);
  r.v = t.v;
}
function placeKart(r, dt) {
  r.kart.position.copy(r.pos);
  r.kart.rotation.y = r.heading;
  r.kart.visible = !r.gone;
  for (const w of r.kart.userData.wheels) w.rotation.x += r.v * dt / 0.42;
}

/* ---------- Kameras ---------- */
let demoCar = 0, demoT = 0, camSnap = true;
const demoTarget = new THREE.Vector3();
function updateDemoCam(dt) {
  const list = [...racers.values()];
  if (!list.length) return;
  demoT += dt;
  if (demoT > 9) { demoT = 0; demoCar = (demoCar + 1) % list.length; camSnap = true; }
  const k = list[demoCar % list.length].kart;
  const back = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y));
  const want = k.position.clone().addScaledVector(back, -9 + Math.sin(demoT * 0.4) * 2).add(new THREE.Vector3(Math.cos(demoT * 0.3) * 4, 4.2, 0));
  const look = k.position.clone().addScaledVector(back, 6).setY(1.2);
  if (camSnap) { demoCam.position.copy(want); demoTarget.copy(look); camSnap = false; }
  demoCam.position.lerp(want, damp(2.5, dt)); demoTarget.lerp(look, damp(4, dt));
  demoCam.lookAt(demoTarget);
}
function updatePlayerCam(p, dt) {
  const r = p.racer, cam = p.camera;
  if (!r) return;
  p.shake = Math.max(0, p.shake - dt * 1.5);
  fwd.set(Math.sin(r.heading), 0, Math.cos(r.heading));
  const bump = p.offroad ? Math.sin(now * 40) * 0.025 * Math.min(1, r.v / 10) : 0;
  cam.position.copy(r.pos).addScaledVector(fwd, -0.2);
  cam.position.y = 1.25 + bump + (Math.random() - 0.5) * p.shake * 0.3;
  cam.position.x += (Math.random() - 0.5) * p.shake * 0.3;
  p.camTarget.copy(r.pos).addScaledVector(fwd, 12); p.camTarget.y = 0.95;
  const roll = p.steer * 0.05 * Math.min(1, r.v / 20);
  cam.up.set(Math.cos(r.heading) * roll, 1, -Math.sin(r.heading) * roll).normalize();
  cam.lookAt(p.camTarget);
  p.fovKick = lerp(p.fovKick, p.boostT > 0 ? 12 : 0, damp(3, dt));
  // Breite Bildausschnitte: normaler Blickwinkel; schmale (geteilt): vertikal etwas weiter
  const a = cam.aspect, base = 64 + (r.v / V_BOOST) * 8 + p.fovKick;
  cam.fov = a >= 1.5 ? base : Math.min(90, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base / 2)) * 1.5 / a)) * 0.9);
  // In schmalen (geteilten) Ausschnitten das Cockpit etwas kleiner und tiefer
  const narrow = a < 1.2;
  p.cockpit.group.scale.setScalar(narrow ? 0.8 : 1);
  p.cockpit.group.position.y = narrow ? -0.12 : 0;
  cam.updateProjectionMatrix();
}

/* ================================================================
   Hauptschleife
   ================================================================ */
const clock = new THREE.Clock();
let hudT = 0, frameAcc = 0, frameN = 0, qChecks = 0;

function tick() {
  const realDt = Math.min(clock.getDelta(), 0.25);
  const dt = Math.min(realDt, 0.05);
  now += realDt; stateT += realDt;
  const simAI = role !== 'client';

  if (state === 'lobby') {
    for (const r of racers.values()) if (r.kind === 'ai') updateAI(r, dt, 'demo');
  } else if (state === 'ready') {
    for (const p of locals) {
      updateLocal(p, dt, false);
      if (!p.ready && p.source !== 'keys') {
        p.readyT = gripping(p) && Math.abs(p.input.steer) < 0.3 ? p.readyT + realDt : Math.max(0, p.readyT - realDt * 2);
        if (p.readyT >= 1.2) { p.ready = true; audio.tick(); }
      }
    }
    const localReady = locals.length > 0 && locals.every((p) => p.ready);
    if (role === 'client') {
      setPrompt(localReady, 'Warte auf die anderen …', hostState === 'race' ? 'Beim Gastgeber läuft noch ein Rennen' : 'Der Gastgeber startet, sobald alle bereit sind', '🌍', 1);
    } else if (role === 'host') {
      const others = [...tvConns.values()].filter((t) => t.players.length);
      const nReady = others.filter((t) => t.ready).length;
      if (localReady && nReady === others.length) { broadcastTv({ t: 'go' }); setState('countdown'); }
      else setPrompt(localReady && others.length > 0, 'Warte auf die anderen TVs …', `${nReady} von ${others.length} bereit`, '🌍', others.length ? nReady / others.length : 0);
    } else if (localReady) setState('countdown');
  } else if (state === 'countdown') {
    for (const p of locals) updateLocal(p, dt, false);
    const n = Math.floor(stateT / 0.9);
    [...$('lights').children].forEach((l, i) => l.classList.toggle('on', i < n + 1));
    if ($('lights').dataset.n != n && n < 3) { $('lights').dataset.n = n; audio.tick(); }
    if (stateT >= 2.9) { $('lights').dataset.n = ''; setState('race'); }
  } else if (state === 'race' || state === 'results') {
    if (state === 'race') raceT += realDt;
    for (const p of locals) { updateLocal(p, dt, p.racer && p.racer.finished == null); updateLaps(p); }
    if (simAI) for (const r of racers.values()) if (r.kind === 'ai') updateAI(r, dt, 'race');
    if (state === 'race') {
      const allDone = locals.every((p) => !p.racer || p.racer.finished != null);
      if (allDone && stateT > 1 && (firstFinishAt == null || raceT - firstFinishAt > 2)) setState('results');
      // Wer nach 45 s noch fährt, wird geschätzt (damit niemand ewig wartet)
      else if (firstFinishAt != null && raceT - firstFinishAt > 45) setState('results');
    } else {
      if (stateT % 0.5 < realDt) renderResults();
      if (stateT > 2.5) {
        for (const p of locals) {
          p.upT = p.input.handsUp && hasControl(p) ? p.upT + realDt : Math.max(0, p.upT - realDt * 2);
          if (p.upT > 0.9) { p.upT = 0; requestRestart(); break; }
        }
      }
    }
  }
  for (const r of racers.values()) {
    if (r.kind === 'remote') updateRemote(r, dt);
    placeKart(r, dt);
  }
  netTick(realDt);

  // Cockpits, Münzen, Kameras
  for (const p of locals) {
    p.cockpit.update(dt, p.steer, gripping(p) ? 1 : 0);
    updatePlayerCam(p, dt);
    let k = 0;
    for (let c = 0; c < COINS.length; c++) {
      _e.set(0, now * 3 + c * 0.3, 0); _q.setFromEuler(_e);
      _m4.compose(_v.copy(COINS[c]).setY(1.1 + Math.sin(now * 3 + COINS[c].x) * 0.15), _q, p.taken[c] ? _s0 : _s1);
      p.coins.setMatrixAt(k++, _m4);
    }
    p.coins.instanceMatrix.needsUpdate = true;
  }
  if (state === 'lobby' || !locals.length) updateDemoCam(dt);

  // Motor (lautester = schnellster lokaler Spieler)
  if (state !== 'lobby' && locals.length) {
    const fastest = Math.max(...locals.map((p) => (p.racer ? p.racer.v : 0)));
    audio.engineSet(fastest / V_BOOST, locals.some((p) => p.boostT > 0));
  }

  // Schatten
  const single = locals.length === 1 && state !== 'lobby' && locals[0].racer;
  setShadowArea(single || state === 'lobby' ? 'near' : 'wide');
  const focus = single ? locals[0].racer.pos : state === 'lobby' ? demoCam.position : new THREE.Vector3();
  sun.position.set(focus.x + 30, 60, focus.z + 25); sun.target.position.set(focus.x, 0, focus.z);
  sun.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;

  // Zeichnen: ein Bildausschnitt pro Spieler
  const W = innerWidth, H = innerHeight;
  if (state === 'lobby' || !locals.length) {
    demoCam.aspect = W / H; demoCam.updateProjectionMatrix();
    renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
    renderer.render(scene, demoCam);
  } else {
    locals.forEach((p, i) => {
      const [x, y, w, h] = views[i] || [0, 0, W, H];
      renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
      renderer.render(scene, p.camera);
    });
    if (locals.length === 3) {
      const [x, y, w, h] = [W / 2, H / 2, W / 2, H / 2];
      topCam.aspect = w / h; topCam.updateProjectionMatrix();
      renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
      renderer.render(scene, topCam);
    }
  }

  // HUD (10× pro Sekunde)
  hudT -= realDt;
  if (hudT <= 0) {
    hudT = 0.1;
    $('time').textContent = fmt(raceT);
    const st = standings();
    for (const p of locals) {
      const r = p.racer, h = p.hud;
      if (!r) continue;
      h.pos.textContent = st.indexOf(r) + 1; h.posOf.textContent = '/' + st.length;
      h.lap.textContent = clamp(r.lap, 1, LAPS);
      h.speed.textContent = Math.round(r.v * 3.6);
      h.bar.style.strokeDasharray = `${SPEED_LEN * clamp(r.v / V_BOOST, 0, 1)} 314.2`;
      h.boost.style.strokeDasharray = `${p.boostT > 0 ? BOOST_LEN * (p.boostT / 3) : BOOST_LEN * p.boost} 251.3`;
      h.speedo.classList.toggle('boosting', p.boostT > 0);
      h.coins.textContent = p.coinCount;
      // Bereit-Anzeige
      const showReady = state === 'ready';
      h.ready.classList.toggle('show', showReady);
      h.ready.classList.toggle('ok', p.ready);
      if (showReady) {
        if (p.ready) { h.readyT1.textContent = 'Bereit!'; h.readyT2.textContent = locals.length > 1 || role !== 'solo' ? 'Warte auf die anderen' : 'Gleich geht’s los'; h.readyIcon.textContent = '✅'; }
        else if (p.source === 'keys') { h.readyT1.textContent = 'Leertaste = bereit'; h.readyT2.textContent = p.keyMap === 'arrows' ? 'Lenken mit ← →' : 'Lenken mit A / D'; h.readyIcon.textContent = '⌨️'; }
        else if (!hasControl(p)) { h.readyT1.textContent = 'Setz dich vor die Kamera'; h.readyT2.textContent = 'Oberkörper und Hände müssen sichtbar sein'; h.readyIcon.textContent = '📱'; }
        else { h.readyT1.textContent = 'Hände ans Lenkrad!'; h.readyT2.textContent = 'Beide Hände ruhig vor die Brust'; h.readyIcon.textContent = '🏎️'; }
        h.readyBar.style.strokeDashoffset = RING * (1 - (p.ready ? 1 : clamp(p.readyT / 1.2, 0, 1)));
      }
      h.wheel.classList.toggle('show', state === 'race' && r.finished == null && !gripping(p));
    }
    drawMinimap();
  }

  // Qualität automatisch anpassen
  frameAcc += realDt; frameN++;
  if (frameAcc > 2 && qChecks < 3) {
    const avg = frameAcc / frameN; frameAcc = 0; frameN = 0; qChecks++;
    if (avg > 0.024 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); updateLayout(); }
    else if (avg > 0.03 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => o.material && (o.material.needsUpdate = true)); }
  }
  requestAnimationFrame(tick);
}

/* ================================================================
   Buttons & Start
   ================================================================ */
function updateSoundBtn() { $('soundBtn').textContent = !audio.ready ? '🔇 Ton an' : audio.muted ? '🔇 Ton aus' : '🔊 Ton an'; }
$('soundBtn').addEventListener('click', (e) => { e.stopPropagation(); if (!audio.ready) audio.unlock(); else audio.setMuted(!audio.muted); setTimeout(updateSoundBtn, 50); });
function toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
$('fsBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
addEventListener('pointerdown', () => { audio.unlock(); updateSoundBtn(); });

document.querySelectorAll('.logo .word').forEach((w, wi) => {
  const colors = ['#e8574f', '#f39a4c', '#f2c94c', '#7fb069', '#5aa9c9', '#9b7fd1', '#f3a6b8'];
  [...w.dataset.word].forEach((ch, i) => {
    const s = document.createElement('span'); s.className = 'ch'; s.textContent = ch;
    s.style.setProperty('--c', colors[(i + wi * 3) % colors.length]); s.style.setProperty('--i', i + wi * 6);
    w.appendChild(s);
  });
});

updateLayout();
setState('lobby');
startPeer();
if (params.has('keys')) addKeysPlayer();
tick();

// Test-Hilfe (Konsole)
window.__race = {
  locals, racers, get state() { return state; }, get role() { return role; }, get code() { return code; }, get roster() { return roster; },
  setState, onPose: (i, k, w, h) => locals[i] && onPose(locals[i], k, w, h), addKeysPlayer, hostRoom, joinRoom, T, N, TRACK_LEN,
  finishLocal: (i) => { const p = locals[i]; if (p && p.racer) { p.racer.lap = LAPS; const s = T[N - 20]; p.racer.pos.set(s.p.x, 0, s.p.z); p.racer.idx = N - 20; p.prevIdx = N - 20; p.racer.heading = Math.atan2(s.t.x, s.t.z); p.racer.v = 30; } },
};
