// Boxring – Box- und Kickbox-Spiel für 1–2 Personen am gleichen TV.
//  • Allein gegen die KI oder zu zweit gegeneinander (eigene Handys oder ein Handy für beide)
//  • Boxen: nur Arme · Kickboxen: auch Tritte (ganzer Körper im Bild)
// Die Figur folgt dem Körper (Richtungen aus dem Kamerabild, Tiefe aus MediaPipe-z: Schläge zur Kamera = nach vorne).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAudio } from '../js/audio.js';
import { loadConfig, sanitize, PRESETS } from '../js/character.js';
import { MultiTracker } from '../js/tracker.js';
import { avatarSvg } from '../js/avatar2d.js';
import { Avatar, D } from '../js/avatar3d.js';
import { peerOptions as netOptions } from '../js/net.js';

/* ================================================================
   Grundlagen
   ================================================================ */
const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAR_KEY = 'ballonplatzer.character';
const MAX = 2;
const ROUND_TIME = 60, WIN_ROUNDS = 2, HP = 100;
const P_COLORS = ['#e2574c', '#5aa9c9'];
const GLOVES = ['#e2574c', '#3f7fb3'];
const DMG = { head: 8, body: 6, kick: 13 };
const FUN_NAMES = ['Faust-Fritz', 'Blitz-Bine', 'Boxer-Beni', 'Punch-Paula', 'Haken-Hans', 'Konter-Kim', 'Wirbel-Wanda', 'Turbo-Tiger', 'Rumms-Ruedi', 'Kick-Kiki'];
const AI_DEF = [
  { name: 'Bruno Bumms', preset: 2 },
  { name: 'Kiki Krawall', preset: 5 },
  { name: 'Max Muskel', preset: 4 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const nrm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const newCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // Aufnahme-Modus: KI gegen KI, ohne Anzeigen, feste Bildrate
if (CAPTURE) document.body.classList.add('capture');
const audio = createAudio();
let now = 0;
let mode = (() => { try { return localStorage.getItem('slop.boxmode') === 'kick' ? 'kick' : 'box'; } catch { return 'box'; } })();

/* ================================================================
   Szene: Boxring mit Publikum
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a0e11');
scene.fog = new THREE.Fog('#2a0e11', 13, 34);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight('#ffd9c2', '#3d1418', 0.9));
const spot = new THREE.SpotLight('#fff1dc', 140, 30, 0.62, 0.45, 1.1);
spot.position.set(0, 9.5, 3.2); spot.target.position.set(0, 0.6, 0);
spot.castShadow = true; spot.shadow.mapSize.set(2048, 2048); spot.shadow.bias = -0.0004;
scene.add(spot, spot.target);
for (const [x, c] of [[-6, '#ff6b5e'], [6, '#6fb7e0']]) {
  const s = new THREE.SpotLight(c, 45, 22, 0.5, 0.6, 1.3);
  s.position.set(x, 6, 4); s.target.position.set(x * 0.15, 1, 0); scene.add(s, s.target);
}

// Kameras: Seitenansicht (TV-Kamera) + je eine Spieler-Kamera (hinter dir / Ich-Sicht)
const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
const CAM_BASE = new THREE.Vector3(0, 2.7, 9.6), CAM_LOOK = new THREE.Vector3(0, 1.55, 0);
camera.position.copy(CAM_BASE); camera.lookAt(CAM_LOOK);
const pcams = [0, 1].map(() => { const c = new THREE.PerspectiveCamera(46, 16 / 9, 0.06, 100); c.userData.look = new THREE.Vector3(); c.userData.fresh = true; return c; });
const VIEWS = ['third', 'first', 'side'];
const VIEW_NAMES = { third: 'Hinter dir', first: 'Ich-Sicht', side: 'Seitlich' };
let view = (() => {
  const q = params.get('view'); if (VIEWS.includes(q)) return q;
  if (CAPTURE) return 'side';
  try { const v = localStorage.getItem('slop.boxview'); return VIEWS.includes(v) ? v : 'third'; } catch { return 'third'; }
})();

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
const crowd = { list: [], heads: null, bodies: null }; // Publikum
(function buildRing() {
  const floor = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat('#3d1418', { roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.9; floor.receiveShadow = true; scene.add(floor);
  const plat = new THREE.Mesh(new THREE.BoxGeometry(7.6, 0.9, 5.8), mat('#5a1f25'));
  plat.position.y = -0.45; plat.receiveShadow = true; scene.add(plat);
  const skirt = new THREE.Mesh(new THREE.BoxGeometry(7.62, 0.16, 5.82), mat('#e2574c'));
  skirt.position.y = -0.2; scene.add(skirt);
  const canvasTop = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.06, 5.6), mat('#f6e3e1', { roughness: 0.9 }));
  canvasTop.position.y = 0; canvasTop.receiveShadow = true; scene.add(canvasTop);
  const logo = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.05, 64), mat('#e2574c', { roughness: 0.85 }));
  logo.rotation.x = -Math.PI / 2; logo.position.y = 0.034; logo.receiveShadow = true; scene.add(logo);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.55, 48), mat('#f7e9a6', { roughness: 0.85 }));
  dot.rotation.x = -Math.PI / 2; dot.position.y = 0.036; dot.receiveShadow = true; scene.add(dot);
  // Eckpfosten + Polster (rot = P1, blau = P2)
  const X = 3.55, Z = 2.65;
  const corners = [[-X, -Z, '#e2574c'], [X, -Z, '#5aa9c9'], [-X, Z, '#e2574c'], [X, Z, '#5aa9c9']];
  for (const [x, z, c] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.9, 16), mat('#d9d0cc', { metalness: 0.6, roughness: 0.3 }));
    post.position.set(x, 0.95, z); post.castShadow = true; scene.add(post);
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.26, 1.15, 0.26), mat(c, { roughness: 0.5 }));
    pad.position.set(x, 1.05, z); scene.add(pad);
  }
  // Seile
  const ropeCols = ['#e2574c', '#f6e3e1', '#e2574c'];
  [0.55, 0.98, 1.41].forEach((y, i) => {
    const m = mat(ropeCols[i], { roughness: 0.45 });
    for (const [a, b] of [[[-X, -Z], [X, -Z]], [[-X, Z], [X, Z]], [[-X, -Z], [-X, Z]], [[X, -Z], [X, Z]]]) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 10), m);
      r.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
      r.rotation.set(a[1] === b[1] ? 0 : Math.PI / 2, 0, a[1] === b[1] ? Math.PI / 2 : 0);
      r.castShadow = true; scene.add(r);
    }
  });
  // Licht-Rahmen über dem Ring
  const truss = mat('#2a0e11', { roughness: 0.6 });
  for (const [w, d, x, z] of [[8, 0.15, 0, -3], [8, 0.15, 0, 3], [0.15, 6, -4, 0], [0.15, 6, 4, 0]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), truss); b.position.set(x, 7.2, z); scene.add(b);
  }
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.24, 0.3, 16), new THREE.MeshBasicMaterial({ color: '#fff3d6' }));
    l.position.set(-3.2 + i * 1.28, 7.0, -3); scene.add(l);
  }
  // Publikum (Instanzen: Köpfe + Körper)
  const N = 300;
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 14, 10), mat('#e3a97f', { roughness: 0.8 }), N);
  const bodies = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.3, 0.35, 4, 10), mat('#ffffff', { roughness: 0.9 }), N);
  const cols = ['#e2574c', '#5aa9c9', '#9b7fd1', '#f7e9a6', '#7fb069', '#f39a4c', '#7d2a2e', '#f3a6b8'];
  const skins = ['#ffdcc6', '#f6c6a4', '#e3a97f', '#c08158', '#8d5b3d'];
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  crowd.list = [];
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < N; i++) { heads.setMatrixAt(i, hidden); bodies.setMatrixAt(i, hidden); }
  for (let i = 0; i < N; i++) {
    const row = i % 4, k = Math.floor(i / 4);
    const ang = (k / (N / 4)) * Math.PI * 2 + row * 0.07; // rundherum (vorne nur in den Spieler-Ansichten sichtbar)
    const r = 7.2 + row * 1.1;
    const x = Math.cos(ang) * r * 1.25, z = Math.sin(ang) * r * 0.85 - 1;
    const y = -0.4 + row * 0.55;
    crowd.list.push({ i, x, y, z, ph: Math.random() * 6, front: z > 1.5 });
    m4.makeTranslation(x, y + 0.5, z); bodies.setMatrixAt(i, m4); bodies.setColorAt(i, col.set(cols[i % cols.length]));
    m4.makeTranslation(x, y + 1.12, z); heads.setMatrixAt(i, m4); heads.setColorAt(i, col.set(skins[i % skins.length]));
  }
  scene.add(heads, bodies);
  crowd.heads = heads; crowd.bodies = bodies;
})();
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
function animateCrowd(excite, showFront) {
  const m4 = new THREE.Matrix4();
  for (const c of crowd.list) {
    if (c.front && !showFront) { crowd.bodies.setMatrixAt(c.i, HIDDEN); crowd.heads.setMatrixAt(c.i, HIDDEN); continue; }
    const j = Math.max(0, Math.sin(now * (3 + excite * 5) + c.ph)) * (0.05 + excite * 0.22);
    m4.makeTranslation(c.x, c.y + 0.5 + j, c.z); crowd.bodies.setMatrixAt(c.i, m4);
    m4.makeTranslation(c.x, c.y + 1.12 + j, c.z); crowd.heads.setMatrixAt(c.i, m4);
  }
  crowd.bodies.instanceMatrix.needsUpdate = true; crowd.heads.instanceMatrix.needsUpdate = true;
}

/* ---------- Treffer-Sterne ---------- */
function starTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.translate(128, 128); g.fillStyle = color; g.beginPath();
  for (let i = 0; i < 20; i++) { const r = i % 2 ? 70 : 120, a = (i / 20) * Math.PI * 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill();
  g.fillStyle = '#3d1418'; g.font = '900 64px Poppins, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 0, 6);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const STARS = { POW: starTexture('POW!', '#f7e9a6'), BAM: starTexture('BAM!', '#f39a4c'), KICK: starTexture('KICK!', '#f3a6b8'), BLOCK: starTexture('BLOCK', '#9fd6ef') };
const sprites = [];
function burst(pos, kind, target = null) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: STARS[kind], depthTest: false, transparent: true }));
  s.position.copy(pos); s.renderOrder = 10; s.userData.target = target; scene.add(s);
  sprites.push({ s, t: 0 });
}
function animateSprites(dt) {
  for (let i = sprites.length - 1; i >= 0; i--) {
    const o = sprites[i]; o.t += dt;
    const k = o.t / 0.6;
    o.s.scale.setScalar(0.35 + Math.min(1, k * 4) * 0.4);
    o.s.material.opacity = 1 - Math.max(0, k - 0.5) * 2;
    o.s.position.y += dt * 0.4;
    if (k >= 1) { scene.remove(o.s); o.s.material.dispose(); sprites.splice(i, 1); }
  }
}

/* ---------- Blutspritzer (Comic-Tropfen) + Flecken auf dem Ringboden ---------- */
const DROP_GEO = new THREE.SphereGeometry(1, 10, 8);
const DROP_MAT = new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.25, transparent: true });
const SPLAT_GEO = new THREE.CircleGeometry(1, 18);
const drops = [], splats = [];
function splatter(pos, target, from, n) {
  const away = new THREE.Vector3(target.av.root.position.x - from.av.root.position.x, 0, 0).normalize();
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(DROP_GEO, DROP_MAT);
    const r = rand(0.03, 0.065); m.scale.setScalar(r);
    m.position.copy(pos).add(new THREE.Vector3(rand(-0.15, 0.15), rand(-0.1, 0.15), rand(-0.2, 0.2)));
    m.userData = { target, r, v: away.clone().multiplyScalar(rand(0.8, 2.4)).add(new THREE.Vector3(0, rand(0.6, 2.2), rand(-1.1, 1.1))) };
    scene.add(m); drops.push(m);
  }
}
function animateDrops(dt) {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i], u = d.userData;
    u.v.y -= 9 * dt; d.position.addScaledVector(u.v, dt);
    d.scale.set(u.r * 0.8, u.r * (1 + Math.min(1, Math.abs(u.v.y) * 0.15)), u.r * 0.8);
    if (d.position.y <= 0.045) {
      scene.remove(d); drops.splice(i, 1);
      if (Math.abs(d.position.x) < 3.6 && Math.abs(d.position.z) < 2.7 && splats.length < 140) {
        const s = new THREE.Mesh(SPLAT_GEO, new THREE.MeshStandardMaterial({ color: '#b3122b', roughness: 0.4, transparent: true, opacity: 0.85, polygonOffset: true, polygonOffsetFactor: -2 }));
        s.rotation.x = -Math.PI / 2; s.position.set(d.position.x, 0.04, d.position.z);
        s.scale.set(u.r * rand(1.6, 2.6), u.r * rand(1.3, 2.2), 1); s.receiveShadow = true;
        scene.add(s); splats.push(s);
      }
    }
  }
}
function clearSplats() { for (const s of splats) { scene.remove(s); s.material.dispose(); } splats.length = 0; }

/* ---------- Wunden am Kopf: je weniger Energie, desto mehr Spuren (pro Runde neu) ---------- */
const WOUND_SPOTS = [ // Richtung auf dem Kopf (vorne = +z), Art
  { d: [-0.42, 0.42, 0.8], kind: 'bruise' },
  { d: [0.55, -0.28, 0.78], kind: 'scratch' },
  { d: [0.32, 0.5, 0.8], kind: 'plaster' },
  { d: [-0.27, -0.04, 1], kind: 'eye' },
  { d: [-0.15, -0.62, 0.78], kind: 'bruise' },
];
const WOUND_AT = [85, 68, 50, 32, 16];
const woundMat = {
  bruise: new THREE.MeshStandardMaterial({ color: '#7b4a8f', roughness: 0.8, transparent: true, opacity: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
  cut: new THREE.MeshStandardMaterial({ color: '#c8102e', roughness: 0.35, polygonOffset: true, polygonOffsetFactor: -3 }),
  plaster: new THREE.MeshStandardMaterial({ color: '#f1d3a8', roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3 }),
  pad: new THREE.MeshStandardMaterial({ color: '#fbf2e3', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -4 }),
  eye: new THREE.MeshStandardMaterial({ color: '#4a2a5e', roughness: 0.8, transparent: true, opacity: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }),
};
const CIRC = new THREE.CircleGeometry(1, 24), RING_G = new THREE.RingGeometry(0.62, 1, 28), PLANE = new THREE.PlaneGeometry(1, 1);
function addWound(f, spot) {
  const n = new THREE.Vector3(...spot.d).normalize();
  const g = new THREE.Group();
  g.position.set(n.x * D.head.x, n.y * D.head.y, n.z * D.head.z).multiplyScalar(1.004);
  g.lookAt(g.position.clone().add(new THREE.Vector3(n.x / D.head.x, n.y / D.head.y, n.z / D.head.z))); // Flächen-Normale des Ellipsoids
  const piece = (geo, m, sx, sy, x = 0, y = 0, rz = 0) => { const o = new THREE.Mesh(geo, m.clone()); o.scale.set(sx, sy, 1); o.position.set(x, y, 0.003); o.rotation.z = rz; g.add(o); };
  if (spot.kind === 'bruise') { piece(CIRC, woundMat.bruise, 0.17, 0.13); piece(CIRC, woundMat.cut, 0.035, 0.03, 0.02, -0.01); }
  if (spot.kind === 'scratch') for (let k = 0; k < 3; k++) piece(PLANE, woundMat.cut, 0.22, 0.022, 0, (k - 1) * 0.05, 0.5);
  if (spot.kind === 'plaster') { piece(PLANE, woundMat.plaster, 0.36, 0.1, 0, 0, -0.6); piece(PLANE, woundMat.plaster, 0.36, 0.1, 0, 0, 0.6); piece(PLANE, woundMat.pad, 0.09, 0.09, 0, 0, 0.78); }
  if (spot.kind === 'eye') piece(RING_G, woundMat.eye, 0.13, 0.15);
  f.av.head.add(g); f.wounds.push(g); f.look = null;
}
function woundsFor(f) {
  while (f.wounds.length < WOUND_AT.length && f.hp <= WOUND_AT[f.wounds.length]) addWound(f, WOUND_SPOTS[f.wounds.length]);
}
function clearWounds(f) { for (const g of f.wounds) { f.av.head.remove(g); g.traverse((o) => o.material?.dispose()); } f.wounds.length = 0; }

/* ================================================================
   Kämpfer (Figur + Zustand)
   ================================================================ */
const HIP_Y = 0.14 + D.thigh + D.shin;
const SIDE_X = 1.2, YAW = 1.05; // Abstand zur Mitte, Drehung zueinander (leicht zur Kamera)
function makeFighter(i) {
  const av = new Avatar(scene);
  av.setGloves(GLOVES[i]);
  av.follow = 22;
  av.root.position.set(i === 0 ? -SIDE_X : SIDE_X, 0, 0);
  av.root.rotation.y = i === 0 ? YAW : -YAW;
  return {
    pos: new THREE.Vector2(i === 0 ? -SIDE_X : SIDE_X, 0), move: { f: 0, s: 0 }, walk: 0, walkPh: 0,
    i, av, player: null, ai: null, name: '', cfg: null, hp: HP, wins: 0,
    guard: false, dodge: 0, knock: 0, anim: { l: 0, r: 0, kick: 0 }, cool: { l: 0, r: 0, kick: 0 }, queue: [],
    combo: 0, lastHitAt: -9, wounds: [], stats: { thrown: 0, landed: 0, blocked: 0, dmg: 0 }, down: 0, cheer: 0,
  };
}
const fighters = [makeFighter(0), makeFighter(1)];
// Deckung sichtbar machen: durchsichtiger Schild vor dem Gesicht, blitzt beim Abblocken auf
const SHIELD_GEO = new THREE.SphereGeometry(1, 36, 12, 0, Math.PI * 2, 0, Math.PI / 2.6);
const SHIELD_RIM = new THREE.TorusGeometry(Math.sin(Math.PI / 2.6), 0.035, 8, 48);
for (const f of fighters) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color: '#9fd6ef', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const cap = new THREE.Mesh(SHIELD_GEO, m); cap.rotation.x = Math.PI / 2; cap.scale.set(0.95, 0.32, 0.85); g.add(cap);
  const rimM = new THREE.MeshBasicMaterial({ color: '#e6f6ff', transparent: true, opacity: 0, depthWrite: false });
  const rim = new THREE.Mesh(SHIELD_RIM, rimM); rim.scale.set(0.95, 0.85, 1); rim.position.z = 0.32 * Math.cos(Math.PI / 2.6); g.add(rim);
  g.renderOrder = 5; scene.add(g);
  f.shield = { g, m, rimM, a: 0 }; f.shieldHit = 0;
}
function updateShield(f, dt) {
  const sh = f.shield, on = f.guard && f.down <= 0 && state !== 'lobby';
  sh.a = lerp(sh.a, on ? 1 : 0, damp(12, dt));
  f.shieldHit = Math.max(0, f.shieldHit - dt * 2.5);
  const fw = facing(f), head = f.av.head.getWorldPosition(new THREE.Vector3());
  sh.g.position.set(head.x + fw.x * 0.55, head.y - 0.45, head.z + fw.y * 0.55);
  sh.g.rotation.y = Math.atan2(fw.x, fw.y);
  const pulse = 1 + f.shieldHit * 0.25;
  sh.g.scale.setScalar(pulse);
  sh.m.opacity = sh.a * 0.3 + f.shieldHit * 0.5;
  sh.rimM.opacity = Math.min(1, sh.a * 0.9 + f.shieldHit * 0.4);
  sh.g.visible = sh.m.opacity > 0.01;
  if (on) for (const k of ['l', 'r']) { const hm = f.av.m.skinHand[k]; hm.emissiveIntensity = Math.max(hm.emissiveIntensity, 0.28); } // Handschuhe leuchten in Deckung
}
const opp = (f) => fighters[1 - f.i];
// Bewegung im Ring: vor/zurück zum Gegner, seitlich = um den Gegner herum (man dreht sich automatisch mit)
const RING_X = 3.0, RING_Z = 2.15, MIN_DIST = 2.05, REACH = { punch: 2.8, kick: 3.15 };
const facing = (f) => { const o = opp(f); const d = new THREE.Vector2(o.pos.x - f.pos.x, o.pos.y - f.pos.y); return d.lengthSq() ? d.normalize() : new THREE.Vector2(f.i === 0 ? 1 : -1, 0); };
const fDist = (f) => f.pos.distanceTo(opp(f).pos);
function moveFighter(f, dt) {
  const m = f.move, can = state === 'fight' && f.down <= 0;
  const mf = can ? clamp(m.f, -1, 1) : 0, ms = can ? clamp(m.s, -1, 1) : 0;
  const fw = facing(f), rt = new THREE.Vector2(-fw.y, fw.x); // rt = rechts aus Sicht des Kämpfers (Welt-z = Bild-y)
  const sp = f.guard ? 1.1 : 1.6;
  f.pos.addScaledVector(fw, mf * sp * dt).addScaledVector(rt, ms * sp * 0.9 * dt);
  f.walk = lerp(f.walk, Math.min(1, Math.hypot(mf, ms)), damp(10, dt));
  f.walkPh += dt * 9 * f.walk;
  f.pos.x = clamp(f.pos.x, -RING_X, RING_X); f.pos.y = clamp(f.pos.y, -RING_Z, RING_Z);
  // nicht ineinander laufen
  const o = opp(f), d = f.pos.distanceTo(o.pos);
  if (d < MIN_DIST) { const push = new THREE.Vector2().subVectors(f.pos, o.pos).normalize().multiplyScalar((MIN_DIST - d) / 2); f.pos.add(push); o.pos.sub(push); }
}

// Von hinten gesehen wäre die Figur sonst spiegelverkehrt: links/rechts tauschen, damit deine linke Hand links im Bild ist
function mirrorS(s) {
  const mx = (v) => v && { ...v, x: -v.x };
  const arm = (a) => ({ ...a, u: mx(a.u), f: mx(a.f) });
  const leg = (L) => ({ ...L, t: mx(L.t), s: mx(L.s) });
  return { ...s, lean: -s.lean, tilt: -(s.tilt || 0), head: mx(s.head), arms: { l: arm(s.arms.r), r: arm(s.arms.l) }, legs: { l: leg(s.legs.r), r: leg(s.legs.l) } };
}

// Darstellung der eigenen Figur je Kamera: normal · halb durchsichtig (hinter dir) · nur Handschuhe (Ich-Sicht)
function setLook(f, look) {
  if (f.look === look) return;
  f.look = look;
  const av = f.av, body = look !== 'hands';
  av.head.visible = av.torsoFrame.visible = av.pelvis.visible = body;
  for (const s of ['l', 'r']) {
    for (const [k, m] of Object.entries(av.legs[s])) m.visible = body && (k !== 'cuff' || !!av.style?.shorts);
    const A = av.arms[s]; A.sh.visible = A.upper.visible = A.sleeve.visible = body;
  }
  av.root.traverse((o) => {
    const ms = !o.material ? [] : Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (!m.userData.look) { m.userData.look = { op: m.opacity }; if (!m.transparent) { m.transparent = true; m.needsUpdate = true; } }
      // Handschuhe bleiben voll sichtbar, damit man die eigenen Schläge und die Deckung gut sieht
      const glove = m === av.m.skinHand.l || m === av.m.skinHand.r;
      m.opacity = m.userData.look.op * (look === 'ghost' && !glove ? 0.32 : 1);
    }
  });
}

// Setzt die Gelenkziele: Richtungen + Tiefe (z = nach vorne zum Gegner), Längen von der Figur
function compose(av, s) {
  const J = av.J;
  const t = nrm(s.lean * 0.35 + (s.tilt || 0), 1);
  const perp = { x: t.y, y: -t.x };
  const hx = s.lean * 0.42, hy = HIP_Y + (s.bounce || 0);
  const shx = hx + t.x * D.torso, shy = hy + t.y * D.torso;
  J.lSh.tgt.set(shx - perp.x * D.shoulderHalf, shy - perp.y * D.shoulderHalf, 0.05);
  J.rSh.tgt.set(shx + perp.x * D.shoulderHalf, shy + perp.y * D.shoulderHalf, 0.05);
  J.lHip.tgt.set(hx - perp.x * D.hipHalf, hy - perp.y * D.hipHalf, 0);
  J.rHip.tgt.set(hx + perp.x * D.hipHalf, hy + perp.y * D.hipHalf, 0);
  for (const side of ['l', 'r']) {
    const a = s.arms[side];
    const u = nrm(a.u.x, a.u.y), f = nrm(a.f.x, a.f.y);
    // st > 1: Comic-Streckung beim Schlag (die Chibi-Arme sind sonst kürzer als der Kopf breit ist)
    const st = a.st || 1, UA = D.upperArm * st, FA = D.foreArm * st;
    const ze = clamp(a.ze * st, -0.1, UA * 0.96);
    const zw = clamp(a.zw * st, ze - FA * 0.6, ze + FA * 0.97);
    const cu = Math.sqrt(1 - (ze / UA) ** 2), cf = Math.sqrt(1 - ((zw - ze) / FA) ** 2);
    const sh = J[side + 'Sh'].tgt;
    const ex = sh.x + u.x * UA * cu, ey = sh.y + u.y * UA * cu;
    J[side + 'El'].tgt.set(ex, ey, sh.z + ze);
    J[side + 'Ha'].tgt.set(ex + f.x * FA * cf, ey + f.y * FA * cf, sh.z + zw);
    const L = s.legs[side];
    const lt = nrm(L.t.x, L.t.y), ls = nrm(L.s.x, L.s.y);
    const zk = clamp(L.zk || 0, -0.2, D.thigh * 0.95), za = clamp(L.za || 0, zk - D.shin * 0.6, zk + D.shin * 0.97);
    const ck = Math.sqrt(1 - (zk / D.thigh) ** 2), ca = Math.sqrt(1 - ((za - zk) / D.shin) ** 2);
    const hp = J[side + 'Hip'].tgt;
    const kx = hp.x + lt.x * D.thigh * ck, ky = hp.y + lt.y * D.thigh * ck;
    const ax = kx + ls.x * D.shin * ca, ay = Math.max(0.14, ky + ls.y * D.shin * ca);
    J[side + 'Kn'].tgt.set(kx, Math.max(ky, ay + 0.1), zk);
    J[side + 'An'].tgt.set(ax, ay, za);
  }
  const n = s.head ? nrm(lerp(t.x, s.head.x, 0.6), lerp(t.y, s.head.y, 0.6)) : t;
  J.head.tgt.set(shx + n.x * D.neck, shy + n.y * D.neck, 0.08);
}

// Schlag-Bewegung über die Arm-Haltung legen: Gerade, Haken, Uppercut (auch über die echte Pose, damit man den Schlag sicher sieht)
function punchArm(f, side, a) {
  const p = f.anim[side];
  if (!(p > 0)) return a;
  const sg = side === 'l' ? -1 : 1, type = f.ptype?.[side] || 'jab', k = Math.min(1, p);
  const e = Math.sin(k * Math.PI);
  let t;
  if (type === 'hook') { // Haken: Ellbogen hoch und seitlich, Faust schwingt von aussen nach innen
    const sw = Math.sin(Math.min(1, k * 1.4) * Math.PI / 2);
    t = { u: { x: sg * 0.95, y: 0.05 }, f: { x: lerp(sg * 0.2, -sg * 1, sw), y: 0.08 }, ze: lerp(0.05, 0.28, sw), zw: lerp(0.35, 0.62, sw) };
  } else if (type === 'upper') { // Uppercut: von unten nach oben vor dem Kinn des Gegners
    const up = Math.sin(Math.min(1, k * 1.3) * Math.PI / 2);
    t = { u: { x: sg * 0.18, y: lerp(-0.9, -0.2, up) }, f: { x: -sg * 0.12, y: lerp(0.2, 1, up) }, ze: lerp(0.15, 0.32, up), zw: lerp(0.3, 0.55, up) };
  } else { // Gerade: Arm ganz nach vorne
    t = { u: { x: -sg * 0.05, y: f.punchHigh?.[side] === false ? -0.25 : 0.05 }, f: { x: -sg * 0.02, y: 0.05 }, ze: 0.38, zw: 0.82 };
  }
  const w = type === 'jab' ? e : Math.min(1, e * 1.25);
  const stMax = type === 'jab' ? 1.7 : type === 'hook' ? 1.45 : 1.5;
  return { st: lerp(a.st || 1, stMax, w), u: { x: lerp(a.u.x, t.u.x, w), y: lerp(a.u.y, t.u.y, w) }, f: { x: lerp(a.f.x, t.f.x, w), y: lerp(a.f.y, t.f.y, w) }, ze: lerp(a.ze, t.ze, w), zw: lerp(a.zw, t.zw, w) };
}

// Grundhaltung (KI, Tastatur, ohne Kamera): Deckung, Schläge, Tritte, Ausweichen als Animation
const STANCE = { l: { t: { x: -0.32, y: -1 }, s: { x: -0.05, y: -1 }, zk: 0.12, za: 0.18 }, r: { t: { x: 0.28, y: -1 }, s: { x: 0.08, y: -1 }, zk: -0.1, za: -0.16 } };
function synth(f, dt) {
  const s = { lean: 0, bounce: Math.sin(now * 6 + f.i) * 0.025, arms: {}, legs: {}, head: null };
  s.lean = lerp(f.leanAnim || 0, f.dodge, damp(10, dt)); f.leanAnim = s.lean;
  for (const side of ['l', 'r']) {
    const sg = side === 'l' ? -1 : 1;
    const g = f.guard ? 1 : 0;
    let u = { x: sg * (0.28 - g * 0.12), y: -0.75 + g * 0.45 }, fa = { x: -sg * (0.42 + g * 0.1), y: 1 }, ze = 0.18 + g * 0.08, zw = 0.42 + g * 0.1;
    s.arms[side] = punchArm(f, side, { u, f: fa, ze, zw });
    s.legs[side] = { ...STANCE[side] };
  }
  if (f.anim.kick > 0) {
    const e = Math.sin(Math.min(1, f.anim.kick) * Math.PI);
    s.legs.r = { t: { x: lerp(0.28, 0.05, e), y: lerp(-1, 0.05, e) }, s: { x: 0.05, y: lerp(-1, 0.1, e) }, zk: lerp(-0.1, 0.35, e), za: lerp(-0.16, 0.75, e) };
    s.tilt = -0.15 * e;
  }
  if (f.down > 0) { // K.O.: Arme hängen lassen
    for (const side of ['l', 'r']) { const sg = side === 'l' ? -1 : 1; s.arms[side] = { u: { x: sg * 0.4, y: -1 }, f: { x: sg * 0.2, y: -1 }, ze: 0.05, zw: 0.1 }; }
  }
  if (f.cheer > 0) {
    for (const side of ['l', 'r']) { const sg = side === 'l' ? -1 : 1; s.arms[side] = { u: { x: sg * 0.6, y: 1 }, f: { x: sg * (0.2 + Math.sin(now * 9 + sg) * 0.2), y: 1 }, ze: 0.05, zw: 0.1 }; }
    s.bounce = Math.abs(Math.sin(now * 5)) * 0.18;
  }
  return s;
}

// Aus der echten Pose (vom Handy) die Haltung der Figur
function fromPose(f, dt) {
  const q = f.player.pose;
  if (!q || now - f.player.lastAt > 0.8) return synth(f, dt);
  const { P, Z, sw, swN } = q;
  const ok = (p, th = 0.3) => p && p.v >= th;
  const dir = (a, b) => ({ x: b.x - a.x, y: -(b.y - a.y) });
  const depth = (a, b) => (Z ? ((Z[a] - Z[b]) / swN) * 0.72 : null); // > 0 = b näher an der Kamera als a
  const s = { lean: clamp(f.player.leanN * 0.9, -1, 1), bounce: 0, arms: {}, legs: {}, head: null };
  const mid = { x: (P.lSh.x + P.rSh.x) / 2, y: (P.lSh.y + P.rSh.y) / 2 };
  if (ok(P.nose, 0.4)) s.head = dir(mid, P.nose);
  const prev = f.lastS;
  for (const side of ['l', 'r']) {
    const S = P[side + 'Sh'], E = P[side + 'El'], W = P[side + 'Wr'];
    const pa = prev && prev.arms[side];
    if (ok(E) && ok(W)) {
      // Tiefe: MediaPipe-z ist bei Händen ungenau – zusätzlich aus der Verkürzung im Bild schätzen
      // (zeigt ein Arm zur Kamera, wirkt er im Bild kürzer). Der grössere Wert gewinnt.
      const fs = (len, full) => full * Math.sqrt(Math.max(0, 1 - Math.min(1, len / full) ** 2));
      const upFull = sw * (D.upperArm / (2 * D.shoulderHalf)), foFull = sw * (D.foreArm / (2 * D.shoulderHalf));
      const zeF = fs(Math.hypot(E.x - S.x, E.y - S.y), upFull) / upFull * D.upperArm;
      const zfF = fs(Math.hypot(W.x - E.x, W.y - E.y), foFull) / foFull * D.foreArm;
      const zD = depth(side + 'Sh', side + 'El'), zwD = depth(side + 'Sh', side + 'Wr');
      const ze = Math.max(zD ?? 0, zeF * 0.85), zw = Math.max(zwD ?? 0, ze + zfF * 0.9);
      let arm = { u: dir(S, E), f: dir(E, W), ze: clamp(ze, -0.05, 0.4), zw: clamp(zw, 0, 0.82) };
      if (pa) arm = { u: { x: lerp(pa.u.x, arm.u.x, 0.6), y: lerp(pa.u.y, arm.u.y, 0.6) }, f: { x: lerp(pa.f.x, arm.f.x, 0.6), y: lerp(pa.f.y, arm.f.y, 0.6) }, ze: lerp(pa.ze, arm.ze, 0.6), zw: lerp(pa.zw, arm.zw, 0.6) };
      s.arms[side] = arm;
    } else s.arms[side] = pa || synth(f, dt).arms[side];
    // Beine: beim Kickboxen aus der Pose, sonst Kampfstellung
    const H = P[side + 'Hip'], K = P[side + 'Kn'], A = P[side + 'An'];
    if (mode === 'kick' && ok(H, 0.4) && ok(K, 0.4) && ok(A, 0.4)) {
      const zk = depth(side + 'Hip', side + 'Kn'), za = depth(side + 'Hip', side + 'An');
      s.legs[side] = { t: dir(H, K), s: dir(K, A), zk: zk == null ? 0 : clamp(zk, -0.2, 0.4), za: za == null ? 0 : clamp(za, -0.2, 0.8) };
    } else s.legs[side] = { ...STANCE[side] };
  }
  s.bounce = Math.sin(now * 6 + f.i) * 0.02;
  f.lastS = s;
  // Deckung gut sichtbar: Handschuhe klar vors Gesicht ziehen · Schläge immer als Bewegung zeigen
  const out = { ...s, arms: {} };
  const guardArms = f.guard ? synth({ ...f, anim: { l: 0, r: 0, kick: 0 } }, 0).arms : null;
  for (const side of ['l', 'r']) {
    let a = s.arms[side];
    if (guardArms) { const g = guardArms[side]; a = { u: { x: lerp(a.u.x, g.u.x, 0.75), y: lerp(a.u.y, g.u.y, 0.75) }, f: { x: lerp(a.f.x, g.f.x, 0.75), y: lerp(a.f.y, g.f.y, 0.75) }, ze: lerp(a.ze, g.ze, 0.75), zw: lerp(a.zw, g.zw, 0.75) }; }
    out.arms[side] = punchArm(f, side, a);
  }
  return out;
}

/* ================================================================
   Spieler an diesem TV (Handys, Laptop-Kamera, Tastatur)
   ================================================================ */
const locals = [];
const NAMES = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lIx', 'rIx', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];
const pName = (p) => p.name || `P${p.slot + 1}`;
function freshName() { const used = new Set(locals.map((q) => q.name)); return FUN_NAMES.filter((n) => !used.has(n)).sort(() => Math.random() - 0.5)[0] || 'Boxer'; }

function createLocal(source, conn = null) {
  const used = new Set(locals.map((p) => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  if (slot >= MAX) return null;
  const p = {
    slot, id: newCode() + slot, source, conn, name: freshName(),
    cfg: slot === 0 ? loadConfig(CHAR_KEY) : sanitize({ ...PRESETS[3].cfg, topColor: '#5aa9c9' }),
    confirmed: source !== 'phone', ready: false, readyT: 0, upT: 0, lastAt: -1e9, pose: null,
    guard: false, handsUp: false, leanN: 0, base: null, dodge: 0, ext: { l: 0, r: 0, kl: 0, kr: 0 }, prevW: { l: null, r: null }, prevA: { l: null, r: null }, lastPoseT: 0,
    keys: source === 'keys' ? (locals.some((q) => q.keyMap === 0) ? 1 : 0) : null,
  };
  p.keyMap = p.keys;
  locals.push(p); locals.sort((a, b) => a.slot - b.slot);
  return p;
}
function joinLocal(source, conn = null) {
  if (state === 'intro' || state === 'fight' || state === 'roundEnd') { toast('Kampf läuft – du bist beim nächsten Kampf dabei'); return null; }
  if (locals.length >= MAX) { if (now - fullAt > 6) { fullAt = now; toast('Maximal 2 Personen im Ring'); } return null; }
  const p = createLocal(source, conn);
  if (!p) return null;
  audio.unlock(); audio.whoosh();
  toast(`${pName(p)} ist im Ring!`);
  lastJoinAt = now; startAt = null;
  if (state === 'lobby') setState('ready');
  assignFighters();
  return p;
}
let fullAt = -1e9;
function leaveLocal(p) {
  const i = locals.indexOf(p); if (i < 0) return;
  locals.splice(i, 1);
  if (state === 'ready' || state === 'lobby' || state === 'results') { assignFighters(); if (!locals.length) setState('lobby'); }
}
const hasControl = (p) => p.source === 'keys' || now - p.lastAt < 1.0;

/* ---------- Pose auswerten: Deckung, Ausweichen, Schläge, Tritte ---------- */
function onPose(p, k, w = 640, h = 480, z = null) {
  if (!Array.isArray(k) || k.length < NAMES.length * 3) return;
  const P = {}, Z = Array.isArray(z) && z.length >= NAMES.length ? {} : null;
  NAMES.forEach((n, i) => { P[n] = { x: k[i * 3] * w, y: k[i * 3 + 1] * h, v: k[i * 3 + 2] }; if (Z) Z[n] = z[i]; });
  const ok = (q, th = 0.3) => q && q.v >= th;
  if (!ok(P.lSh, 0.4) || !ok(P.rSh, 0.4)) return;
  const t = performance.now() / 1000, dtp = clamp(t - (p.lastPoseT || t - 0.033), 0.01, 0.2); p.lastPoseT = t;
  p.lastAt = now;
  const sw = Math.hypot(P.rSh.x - P.lSh.x, P.rSh.y - P.lSh.y) || 1, swN = sw / w;
  p.pose = { P, Z, sw, swN };
  const mid = { x: (P.lSh.x + P.rSh.x) / 2, y: (P.lSh.y + P.rSh.y) / 2 };
  p.cx = mid.x / w;
  const noseY = ok(P.nose, 0.4) ? P.nose.y : mid.y - sw * 0.6;
  const nose = ok(P.nose, 0.4) ? P.nose : { x: mid.x, y: noseY };
  // Deckung: beide Fäuste vor dem Gesicht
  const nearFace = (W) => ok(W) && Math.hypot(W.x - nose.x, W.y - nose.y) < sw * 0.95 && W.y < mid.y + sw * 0.35;
  p.guard = nearFace(P.lWr) && nearFace(P.rWr);
  p.handsUp = ok(P.lWr) && ok(P.rWr) && P.lWr.y < noseY - sw * 0.35 && P.rWr.y < noseY - sw * 0.35;
  const hipsOk = ok(P.lHip, 0.5) && ok(P.rHip, 0.5);
  const hipX = hipsOk ? (P.lHip.x + P.rHip.x) / 2 : null;
  if (hipsOk) {
    // Ausweichen: Oberkörper gegenüber der Hüfte zur Seite lehnen
    if (p.lbase == null) p.lbase = mid.x - hipX;
    p.leanN = (mid.x - hipX - p.lbase) / sw;
    if (Math.abs(p.leanN) < 0.2) p.lbase = lerp(p.lbase, mid.x - hipX, 0.03);
    // Laufen wie ein Joystick: Schritt zur Seite = seitlich gehen, Schritt zur Kamera/weg = vor/zurück, zurück in die Mitte = stehen bleiben
    if (p.hbase == null) p.hbase = hipX;
    if (p.swBase == null) p.swBase = sw;
    const sideN = (hipX - p.hbase) / sw, size = sw / p.swBase;
    p.moveS = Math.abs(sideN) > 0.45 ? clamp((Math.abs(sideN) - 0.35) * 2.5, 0, 1) * Math.sign(sideN) : 0;
    p.moveF = size > 1.13 ? clamp((size - 1.08) * 6, 0, 1) : size < 0.88 ? -clamp((0.93 - size) * 6, 0, 1) : 0;
    if (Math.abs(sideN) < 0.15) p.hbase = lerp(p.hbase, hipX, 0.01);
    if (size > 0.96 && size < 1.04) p.swBase = lerp(p.swBase, sw, 0.01);
  } else {
    // ohne Hüfte im Bild (z. B. sitzend): Ausweichen gegenüber der ruhigen Mitte, kein Laufen
    if (p.base == null) p.base = mid.x;
    p.leanN = (mid.x - p.base) / sw;
    if (Math.abs(p.leanN) < 0.25) p.base = lerp(p.base, mid.x, 0.03);
    p.moveS = 0; p.moveF = 0;
  }
  p.dodge = Math.abs(p.leanN) > 0.5 ? Math.sign(p.leanN) : 0;
  const f = fighters.find((x) => x.player === p);
  if (!f || state !== 'fight') { p.prevW = { l: null, r: null }; p.prevA = { l: null, r: null }; return; }
  f.guard = p.guard; f.dodge = p.dodge; f.move = { f: p.moveF || 0, s: p.moveS || 0 };
  // Schläge: Faust schnell zur Kamera (Tiefe) oder schnelle Bewegung im Bild
  for (const s of ['l', 'r']) {
    const W = P[s + 'Wr'];
    if (!ok(W)) { p.prevW[s] = null; continue; }
    const ext = Z ? ((Z[s + 'Sh'] - Z[s + 'Wr']) / swN) * 0.72 : 0;
    const vel = (ext - p.ext[s]) / dtp;
    const pw = p.prevW[s];
    const sp = pw ? Math.hypot(W.x - pw.x, W.y - pw.y) / sw / dtp : 0;
    const away = pw ? Math.hypot(W.x - P[s + 'Sh'].x, W.y - P[s + 'Sh'].y) > Math.hypot(pw.x - P[s + 'Sh'].x, pw.y - P[s + 'Sh'].y) : false;
    // Verkürzung im Bild: Arm zeigt zur Kamera → wirkt kürzer (zuverlässiger als die Hand-Tiefe)
    const E = P[s + 'El'], S = P[s + 'Sh'];
    let fsx = 0;
    if (ok(E)) {
      const fs = (len, full) => Math.sqrt(Math.max(0, 1 - Math.min(1, len / full) ** 2));
      fsx = fs(Math.hypot(E.x - S.x, E.y - S.y), sw * 0.58) * 0.5 + fs(Math.hypot(W.x - E.x, W.y - E.y), sw * 0.55) * 0.5;
    }
    const fsv = (fsx - (p.fs?.[s] ?? fsx)) / dtp;
    p.fs = { ...(p.fs || {}), [s]: fsx };
    if (f.cool[s] <= 0 && pw) {
      const vx = (W.x - pw.x) / sw / dtp, vy = (W.y - pw.y) / sw / dtp; // Bild: y nach unten
      const inward = s === 'l' ? vx : -vx; // zur Körpermitte hin (Bild gespiegelt: linke Hand links)
      const elbowUp = ok(E) && E.y < mid.y + sw * 0.4;
      let type = null;
      if (vy < -6 && Math.abs(vy) > Math.abs(vx) * 1.3 && pw.y > mid.y - sw * 0.05 && W.y < pw.y) type = 'upper'; // schnell von unten nach oben
      else if (inward > 6 && Math.abs(vx) > Math.abs(vy) * 1.3 && elbowUp) type = 'hook';                           // schnell seitlich zur Mitte, Ellbogen oben
      else if ((Z && ext > 0.42 && vel > 1.6) || (fsx > 0.55 && fsv > 2.2) || (sp > 6.5 && away && vy < 3)) type = 'jab';     // nach vorne
      if (type) attack(f, s, W.y < mid.y + sw * 0.15 ? 'head' : 'body', type);
    }
    p.ext[s] = ext; p.prevW[s] = { x: W.x, y: W.y };
  }
  // Tritte (nur Kickboxen): Fuss schnell nach vorne/oben oder Knie hoch
  if (mode === 'kick' && f.cool.kick <= 0) {
    for (const s of ['l', 'r']) {
      const A = P[s + 'An'], K = P[s + 'Kn'], H = P[s + 'Hip'];
      if (!ok(A, 0.4) || !ok(K, 0.4)) { p.prevA[s] = null; continue; }
      const ext = Z && ok(H, 0.4) ? ((Z[s + 'Hip'] - Z[s + 'An']) / swN) * 0.72 : 0;
      const vel = (ext - p.ext['k' + s]) / dtp;
      const pa = p.prevA[s];
      const sp = pa ? Math.hypot(A.x - pa.x, A.y - pa.y) / sw / dtp : 0;
      const other = P[(s === 'l' ? 'r' : 'l') + 'An'];
      const lifted = ok(other, 0.4) && A.y < other.y - sw * 0.5;
      const kneeUp = ok(H, 0.4) && K.y < H.y + sw * 0.1;
      if ((Z && ext > 0.4 && vel > 1.5) || (sp > 7 && lifted) || kneeUp) { attack(f, 'kick', 'body'); p.prevA = { l: null, r: null }; break; }
      p.ext['k' + s] = ext; p.prevA[s] = { x: A.x, y: A.y };
    }
  }
}

/* ================================================================
   Kampf: Angriff → Wirkung (Deckung / Ausweichen / Treffer)
   ================================================================ */
const PTYPE = { jab: { cool: 0.4, dur: 0.4, mul: 1, name: '' }, hook: { cool: 0.55, dur: 0.5, mul: 1.25, name: 'Haken!' }, upper: { cool: 0.7, dur: 0.5, mul: 1.5, name: 'Uppercut!' } };
function attack(f, kind, target, type = 'jab') {
  if (state !== 'fight' || f.down > 0) return;
  const isKick = kind === 'kick';
  if (isKick && mode !== 'kick') return;
  if (f.cool[kind] > 0) return;
  if (isKick) type = 'kick';
  else { if (!PTYPE[type]) type = 'jab'; f.ptype = { ...(f.ptype || {}), [kind]: type }; if (type !== 'jab') target = 'head'; }
  f.cool[kind] = isKick ? 0.9 : PTYPE[type].cool;
  // Dauerfeuer lohnt sich nicht: schnelle Folgeschläge machen weniger Schaden
  const tired = now - (f.lastThrow ?? -9) < 0.5; f.lastThrow = now;
  f.anim[kind] = 0.001;
  f.punchHigh = { ...(f.punchHigh || {}), [kind]: target === 'head' };
  f.stats.thrown++;
  f.queue.push({ kind, type, target: isKick ? 'kick' : target, tired, at: now + (isKick ? 0.3 : 0.2) }); // Zeit zum Decken/Ausweichen
  audio.whoosh();
  const o = opp(f);
  if (o.ai) o.ai.react(kind); // KI kann reagieren
}
function resolve(f, a) {
  const o = opp(f);
  if (state !== 'fight' || o.down > 0) return;
  const head = o.av.head.getWorldPosition(new THREE.Vector3());
  const hitPos = a.target === 'body' || a.target === 'kick' ? head.clone().add(new THREE.Vector3(0, -1.0, 0)) : head;
  { const fw = facing(o); hitPos.x += fw.x * 0.3; hitPos.z += fw.y * 0.3; }
  // Reichweite: zu weit weg = daneben (zurückgehen ist auch Verteidigung)
  if (fDist(f) > (a.kind === 'kick' ? REACH.kick : REACH.punch)) { pop(f, 'Zu weit!', 'miss'); f.combo = 0; return; }
  if (o.dodge && a.target === 'head') { pop(o, 'Ausgewichen!', 'miss'); audio.skid(0.6); f.combo = 0; return; }
  let dmg = Math.round(DMG[a.target] * (PTYPE[a.type]?.mul || 1));
  if (a.tired) dmg = Math.round(dmg * 0.6);
  const blocked = o.guard && (a.target !== 'body' || Math.random() < 0.7);
  if (blocked) {
    // Kopf-Deckung hält Geraden und Haken ganz ab; der Uppercut kommt teilweise von unten durch, Körper/Tritt teilweise
    dmg = a.type === 'upper' ? Math.round(dmg * 0.4) : a.target === 'head' ? 0 : Math.round(dmg * (a.target === 'kick' ? 0.4 : 0.25));
    o.stats.blocked++;
    f.cool.l = Math.max(f.cool.l, 0.55); f.cool.r = Math.max(f.cool.r, 0.55);
    f.knock = Math.max(f.knock, 0.2); o.knock = Math.max(o.knock, 0.12); // Abprallen
    o.av.flash('l'); o.av.flash('r'); o.shieldHit = 1;
    burst(hitPos, 'BLOCK', o); pop(o, dmg ? `Geblockt −${dmg}` : 'Geblockt!', 'block'); audio.tick();
    if (o.player) sendPhone(o.player.conn, { t: 'hit' });
    f.combo = 0;
  } else {
    f.combo = now - f.lastHitAt < 1.1 ? f.combo + 1 : 1;
    f.lastHitAt = now;
    dmg += Math.min(4, f.combo - 1);
    f.stats.landed++;
    burst(hitPos, a.target === 'kick' ? 'KICK' : Math.random() < 0.5 ? 'POW' : 'BAM', o); hurt(o);
    splatter(hitPos, o, f, a.target === 'kick' ? 12 : a.target === 'head' ? 9 : 5);
    pop(o, `−${dmg}`, 'dmg');
    if (PTYPE[a.type]?.name) pop(f, PTYPE[a.type].name, 'combo');
    if (f.combo >= 3) pop(f, `Kombo ×${f.combo}!`, 'combo');
    audio.bad(); shake = Math.max(shake, a.target === 'kick' ? 0.35 : 0.22);
    o.av.shake = 1; o.knock = a.target === 'kick' ? 0.45 : 0.28;
    excite = Math.min(1, excite + 0.35);
    if (f.player) sendPhone(f.player.conn, { t: 'hit' });
    if (o.player) sendPhone(o.player.conn, { t: 'bad' });
  }
  o.hp = Math.max(0, o.hp - dmg);
  f.stats.dmg += dmg;
  if (dmg > 0) woundsFor(o);
  if (o.hp <= 0) roundOver(f, 'K.O.!');
}

/* ---------- KI-Gegner ---------- */
function makeAI(f, level = 1) {
  return {
    t: rand(1, 2), guardT: 0, moveT: 0, back: 0, circle: 0,
    tick(dt) {
      if (state !== 'fight' || f.down > 0) { f.guard = false; f.dodge = 0; f.move = { f: 0, s: 0 }; return; }
      this.t -= dt; this.guardT -= dt; this.moveT -= dt; this.back -= dt;
      // Laufen: ran an den Gegner, nach Schlägen manchmal zurück, ab und zu um ihn herum
      if (this.moveT <= 0) { this.circle = Math.random() < 0.45 ? (Math.random() < 0.5 ? -1 : 1) * rand(0.5, 1) : 0; this.moveT = rand(0.8, 2); }
      const d = fDist(f);
      f.move = { f: this.back > 0 ? -1 : d > 2.6 ? 1 : d < 2.2 ? -0.6 : 0, s: this.circle };
      if (d > REACH.punch + 0.1) { if (this.t < 0.2) this.t = 0.2; }
      if (this.guardT <= 0) f.guard = false;
      if (f.dodgeT > 0) { f.dodgeT -= dt; if (f.dodgeT <= 0) f.dodge = 0; }
      if (this.t <= 0) {
        const r = Math.random();
        if (r < 0.2) { f.guard = true; this.guardT = rand(0.8, 1.6); this.t = this.guardT + rand(0.2, 0.5); return; }
        const hand = Math.random() < 0.5 ? 'l' : 'r';
        const tp = Math.random();
        if (mode === 'kick' && r > 0.85) attack(f, 'kick', 'body');
        else attack(f, hand, Math.random() < 0.65 ? 'head' : 'body', tp < 0.18 ? 'upper' : tp < 0.4 ? 'hook' : 'jab');
        if (Math.random() < 0.35) setTimeout(() => attack(f, hand === 'l' ? 'r' : 'l', 'head'), 260);
        this.t = rand(0.7, 1.5) / level;
        if (Math.random() < 0.3) this.back = rand(0.4, 0.8);
      }
    },
    react() {
      if (f.guard || f.down > 0) return;
      const r = Math.random();
      if (r < 0.14) { f.dodge = Math.random() < 0.5 ? -1 : 1; f.dodgeT = 0.45; }
      else if (r < 0.3) { f.guard = true; this.guardT = 0.5; }
    },
  };
}

/* ================================================================
   Runden
   ================================================================ */
let state = 'lobby', stateT = 0, roundNo = 0, roundT = ROUND_TIME, shake = 0, excite = 0;
let lastJoinAt = -1e9, startAt = null, matchT = 0;
function assignFighters() {
  // Bei zwei Personen vor einer Kamera: wer links im Bild steht, boxt links
  const humans = [...locals].sort((a, b) => (a.cx != null && b.cx != null && a.conn && a.conn === b.conn ? a.cx - b.cx : a.slot - b.slot));
  fighters.forEach((f, i) => {
    const p = humans[i] || null;
    f.player = p; f.ai = null;
    if (p) { f.name = pName(p); f.cfg = p.cfg; }
    else {
      if (!f.aiDef) { const other = fighters[1 - i].aiDef; const pool = AI_DEF.filter((x) => x !== other); f.aiDef = pool[Math.floor(Math.random() * pool.length)]; }
      f.name = f.aiDef.name; f.cfg = sanitize({ ...PRESETS[f.aiDef.preset].cfg });
      f.ai = makeAI(f, 1);
    }
    if (f.cfgKey !== JSON.stringify(f.cfg)) { f.cfgKey = JSON.stringify(f.cfg); f.av.setConfig(f.cfg); f.look = null; }
  });
  renderPanels(true);
}
function resetFighters(full) {
  if (full) clearSplats();
  for (const f of fighters) {
    Object.assign(f, { hp: HP, guard: false, dodge: 0, knock: 0, combo: 0, down: 0, cheer: 0, queue: [] });
    f.anim = { l: 0, r: 0, kick: 0 }; f.cool = { l: 0, r: 0, kick: 0 };
    if (full) { f.wins = 0; f.stats = { thrown: 0, landed: 0, blocked: 0, dmg: 0 }; }
    clearWounds(f);
    f.pos.set(f.i === 0 ? -SIDE_X : SIDE_X, 0); f.move = { f: 0, s: 0 }; f.walk = 0;
    f.av.root.rotation.z = 0; f.av.root.position.y = 0;
  }
}
function setState(s) {
  state = s; stateT = 0;
  document.body.className = document.body.className.replace(/\bst-\w+/g, '').trim() + ' st-' + s;
  const fighting = s === 'intro' || s === 'fight' || s === 'roundEnd';
  $('lobby').classList.toggle('hide', fighting || s === 'results');
  $('bhud').classList.toggle('show', fighting || s === 'results');
  $('results').classList.toggle('show', s === 'results');
  if (s !== 'ready') setPrompt(false);
  if (s === 'ready') {
    for (const p of [...locals]) if (p.source === 'phone' && !p.conn) leaveLocal(p);
    for (const p of locals) { p.ready = false; p.readyT = 0; }
    if (!locals.length) { setState('lobby'); return; }
    resetFighters(true); assignFighters(); startAt = null; roundNo = 0;
  }
  if (s === 'intro') {
    roundNo++; roundT = ROUND_TIME; resetFighters(false); assignFighters();
    for (const p of locals) { p.hbase = null; p.swBase = null; } // Grundstellung neu messen (da wo du gerade stehst)
    banner(roundNo === 1 ? 'Runde 1' : `Runde ${roundNo}`);
    audio.tick();
  }
  if (s === 'fight') { banner('BOX!', true); audio.go(); }
  if (s === 'results') showResults();
  if (s === 'lobby') { resetFighters(true); assignFighters(); }
  phonesState();
  renderPanels(true);
}
function roundOver(winner, why) {
  if (state !== 'fight') return;
  if (winner) { winner.wins++; winner.cheer = 1; opp(winner).down = why === 'K.O.!' ? 1 : 0; }
  banner(winner ? `${why} ${winner.name}` : 'Unentschieden', true);
  audio.gold(); excite = 1;
  setState('roundEnd');
}
function showResults() {
  audio.end();
  const [a, b] = fighters;
  const w = a.wins > b.wins ? a : b.wins > a.wins ? b : null;
  $('resultsTitle').textContent = w ? `🏆 ${w.name} gewinnt!` : 'Unentschieden!';
  $('podium').innerHTML = [a, b].sort((x, y) => y.wins - x.wins).map((f, i) => {
    const acc = f.stats.thrown ? Math.round((f.stats.landed / f.stats.thrown) * 100) : 0;
    return `<div class="${f.player ? 'me' : ''}" style="--c:${P_COLORS[f.i]}"><span class="place">${i + 1}.</span><span class="dot" style="--c:${P_COLORS[f.i]}"></span>${esc(f.name)}<span class="who">${f.wins} Runde${f.wins === 1 ? '' : 'n'} · ${f.stats.landed} Treffer · ${acc}%</span><span class="t">${f.player ? '' : 'KI'}</span></div>`;
  }).join('');
  for (const f of fighters) if (f.player) sendPhone(f.player.conn, { t: 'result', score: f === w ? 1 : 2 });
  saveStats(w);
}
function saveStats(w) {
  try {
    const st = JSON.parse(localStorage.getItem('slope.stats')) || {};
    const humans = fighters.filter((f) => f.player);
    const sec = Math.round(matchT) * Math.max(1, humans.length);
    st.boxring = (st.boxring || 0) + sec;
    st.fights = (st.fights || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    st.days = st.days || {}; st.days[day] = (st.days[day] || 0) + sec;
    if (w && w.player) st.boxWins = (st.boxWins || 0) + 1;
    st.history = (st.history || []).concat([{ d: Date.now(), g: 'box', n: humans.length, names: humans.map((f) => f.name), place: w ? (w.player ? 1 : 2) : 0, t: Math.round(matchT) }]).slice(-30);
    localStorage.setItem('slope.stats', JSON.stringify(st));
  } catch { /* privat */ }
}
function requestRestart() { setState('ready'); }

/* ================================================================
   Anzeige
   ================================================================ */
const SHIELD = '🛡️';
function renderPanels(full = false) {
  fighters.forEach((f, i) => {
    const el = $('f' + i);
    if (full || !el.firstChild) {
      el.style.setProperty('--c', P_COLORS[i]);
      el.innerHTML = `<span class="fav">${avatarSvg(f.cfg || sanitize({}), { body: false })}</span>
        <div class="fmain"><div class="fname"><b>${esc(f.name)}</b><span class="fsrc">${f.player ? '' : 'KI'}</span></div>
        <div class="hpbar"><i class="hp"></i><i class="hpghost"></i></div>
        <div class="frow"><span class="wins">${'<i></i>'.repeat(WIN_ROUNDS)}</span><span class="fstate"></span></div></div>`;
    }
    const hp = el.querySelector('.hp'), ghost = el.querySelector('.hpghost');
    hp.style.width = (f.hp / HP) * 100 + '%';
    f.ghost = lerp(f.ghost ?? HP, f.hp, 0.06); ghost.style.width = (f.ghost / HP) * 100 + '%';
    el.classList.toggle('low', f.hp < 30);
    el.querySelectorAll('.wins i').forEach((x, k) => x.classList.toggle('on', k < f.wins));
    const st = f.down ? 'K.O.' : f.guard ? `${SHIELD} Deckung` : f.dodge ? '↔ Ausweichen' : '';
    const fs = el.querySelector('.fstate'); if (fs.textContent !== st) fs.textContent = st;
  });
  $('roundLbl').textContent = `Runde ${Math.max(1, roundNo)}`;
  $('clock').textContent = Math.ceil(roundT);
}
// Kleine Texte über den Köpfen
function pop(f, text, kind) {
  const world = f.av.head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.9, 0));
  for (const v of views) {
    let x, y;
    if (v.f === f && view === 'first') { x = 0.5; y = 0.72; } // eigener Kopf ist die Kamera: Text unten in die Mitte
    else {
      const p = world.clone().project(v.cam);
      if (p.z > 1) continue;
      x = (p.x + 1) / 2; y = clamp((1 - p.y) / 2, 0.08, 0.95);
      if (x < 0.02 || x > 0.98) continue;
    }
    const el = document.createElement('div');
    el.className = 'pop ' + kind; el.textContent = text;
    el.style.left = (v.x + x * v.w) * 100 + '%'; el.style.top = y * 100 + '%';
    $('pops').appendChild(el);
    setTimeout(() => el.remove(), 1000);
  }
}
const RING = 2 * Math.PI * 42;
function setPrompt(show, text = '', sub = '', icon = '🥊', fill = 0) {
  $('prompt').classList.toggle('show', show);
  if (text) $('promptText').textContent = text;
  $('promptSub').textContent = sub; $('promptIcon').textContent = icon;
  $('promptBar').style.strokeDasharray = RING; $('promptBar').style.strokeDashoffset = RING * (1 - fill);
}
function banner(text, bang = false) { const b = $('banner'); b.textContent = text; b.classList.toggle('bang', bang); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
let toastTimer = 0;
function toast(text, ms = 2600) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), Math.max(ms, text.length > 50 ? 6000 : ms)); }

const ICON = {
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="13" rx="2"/><path d="M8 22h8M12 18v4"/></svg>',
  keys: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M7 14h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="#e2847b" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};
const KEYTXT = ['Q/E Gerade · Z Haken · C Uppercut · W Deckung · A/D ausweichen · S Tritt · Pfeile laufen', 'U/O Gerade · H Haken · N Uppercut · I Deckung · J/L ausweichen · K Tritt · 8/4/5/6 laufen'];
function renderSlots() {
  const html = [0, 1].map((i) => {
    const p = locals.find((x) => x.slot === i);
    if (!p) {
      return i === 1 && locals.length === 1
        ? `<div class="slot empty ai"><span class="av">🤖</span><b>KI-Gegner</b><span class="st">Allein? Dann boxt die KI.<br>Zu zweit: 2. Person scannt den QR-Code</span></div>`
        : `<div class="slot empty"><span class="av">${ICON.plus}</span><b>P${i + 1}</b><span class="st">QR scannen</span></div>`;
    }
    const fill = p.ready ? 1 : clamp(p.readyT / 1.2, 0, 1);
    let st;
    if (p.ready) st = 'Bereit!';
    else if (p.source === 'keys') st = `Leertaste = bereit<br><small>${KEYTXT[p.keyMap] || ''}</small>`;
    else if (!p.confirmed) st = 'Am Handy einstellen<br>und «Bereit» drücken';
    else if (!hasControl(p)) st = 'Stell dich vor die Kamera';
    else st = 'Fäuste vors Gesicht …';
    return `<div class="slot ${p.ready ? 'ready' : ''}"><span class="av" style="--c:${P_COLORS[i]}">${avatarSvg(p.cfg, { body: false })}<span class="src">${ICON[p.source] || ICON.phone}</span></span><b>${esc(pName(p))}</b><span class="bar"><i style="width:${fill * 100}%"></i></span><span class="st">${st}</span></div>`;
  }).join('');
  if (html !== renderSlots.last) { $('slots').innerHTML = html; renderSlots.last = html; }
}

/* ---------- Kampfart wählen ---------- */
function setMode(m) {
  mode = m === 'kick' ? 'kick' : 'box';
  try { localStorage.setItem('slop.boxmode', mode); } catch { /* */ }
  document.querySelectorAll('.mode').forEach((b) => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
}
document.querySelectorAll('.mode').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setMode(b.dataset.mode); audio.unlock(); audio.tick(); }));
setMode(mode);

/* ================================================================
   Tastatur (zum Testen ohne Kamera)
   ================================================================ */
const KEYMAP = [
  { l: 'q', r: 'e', hook: 'z', upper: 'c', guard: 'w', left: 'a', right: 'd', kick: 's', fw: 'arrowup', bk: 'arrowdown', sl: 'arrowleft', sr: 'arrowright' },
  { l: 'u', r: 'o', hook: 'h', upper: 'n', guard: 'i', left: 'j', right: 'l', kick: 'k', fw: '8', bk: '5', sl: '4', sr: '6' },
];
const held = new Set();
addEventListener('keydown', (e) => {
  audio.unlock(); updateSoundBtn();
  const k = e.key.toLowerCase();
  if (k === 'f') toggleFullscreen();
  if (k === 'm') { audio.setMuted(!audio.muted); updateSoundBtn(); }
  if (k === 'b' && (state === 'lobby' || state === 'ready')) setMode('box');
  if (k === 'x' && (state === 'lobby' || state === 'ready')) setMode('kick');
  if (k === 't' && !e.repeat) addKeysPlayer();
  if (k === 'v' && !e.repeat) { setView(VIEWS[(VIEWS.indexOf(view) + 1) % VIEWS.length]); toast('Ansicht: ' + VIEW_NAMES[view]); }
  held.add(k);
  if (k === ' ' || k === 'enter') {
    if (state === 'ready') for (const p of locals) if (p.source === 'keys') { if (p.ready) p.startNow = true; p.ready = true; }
    if (state === 'results' && stateT > 2) requestRestart();
  }
  if (e.repeat) return;
  for (const p of locals) {
    if (p.source !== 'keys') continue;
    const m = KEYMAP[p.keyMap], f = fighters.find((x) => x.player === p);
    if (!f) continue;
    if (k === m.l) attack(f, 'l', 'head');
    if (k === m.r) attack(f, 'r', Math.random() < 0.5 ? 'head' : 'body');
    if (k === m.hook) attack(f, 'l', 'head', 'hook');
    if (k === m.upper) attack(f, 'r', 'head', 'upper');
    if (k === m.kick) attack(f, 'kick', 'body');
  }
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
function keysInput() {
  for (const p of locals) {
    if (p.source !== 'keys') continue;
    const m = KEYMAP[p.keyMap], f = fighters.find((x) => x.player === p);
    if (!f) continue;
    f.guard = held.has(m.guard);
    f.dodge = held.has(m.left) ? -1 : held.has(m.right) ? 1 : 0;
    f.move = { f: (held.has(m.fw) ? 1 : 0) - (held.has(m.bk) ? 1 : 0), s: (held.has(m.sr) ? 1 : 0) - (held.has(m.sl) ? 1 : 0) };
  }
}
function addKeysPlayer() {
  if (locals.filter((p) => p.source === 'keys').length >= 2) { toast('Höchstens 2 Tastatur-Spieler'); return; }
  const p = joinLocal('keys');
  if (p) toast(`${pName(p)}: ${KEYTXT[p.keyMap]} · Leertaste = bereit`, 6000);
}
$('keysBtn').addEventListener('click', (e) => { e.stopPropagation(); addKeysPlayer(); });

/* ================================================================
   Kamera dieses Geräts (Laptop) – bis zu 2 Personen
   ================================================================ */
const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const camPlayers = new Map();
let camOn = false;
async function useLocalCamera() {
  const btn = $('camBtn');
  if (camOn) return;
  if (!window.isSecureContext) { toast('Die Kamera braucht https://'); return; }
  btn.disabled = true; btn.textContent = '⏳ Kamera startet …';
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = $('localVideo'); video.srcObject = stream; await video.play().catch(() => {});
    $('camPip').hidden = false;
    btn.textContent = '⏳ KI wird geladen …';
    const { FilesetResolver, PoseLandmarker } = await import(VISION);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 2, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    let lm; try { lm = await PoseLandmarker.createFromOptions(vision, opts('GPU')); } catch { lm = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    camOn = true; btn.textContent = '✅ Kamera aktiv';
    const tracker = new MultiTracker(2);
    let last = -1;
    const loop = () => {
      if (video.readyState >= 2) {
        const ts = performance.now();
        if (ts > last) {
          last = ts;
          const tracks = tracker.update(lm.detectForVideo(video, ts).landmarks || [], ts);
          const seen = new Set();
          for (const tr of tracks) {
            seen.add(tr.id);
            let p = camPlayers.get(tr.id);
            if (!p && (state === 'lobby' || state === 'ready')) { p = joinLocal('cam'); if (p) { p.trackId = tr.id; camPlayers.set(tr.id, p); } }
            if (!p) continue;
            p.lostAt = 0;
            onPose(p, tracker.points(tr, ts), video.videoWidth, video.videoHeight, tracker.depth(tr, ts));
          }
          for (const [id, p] of camPlayers) if (!seen.has(id) && !p.lostAt) p.lostAt = now;
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
   Handys (eine Person pro Handy oder mehrere vor einer Kamera)
   ================================================================ */
let peer = null, code = '', retries = 0;
const peerOptions = () => netOptions(params);
function setStatus(kind, text) { $('status').className = 'status ' + kind; $('statusText').textContent = text; }
function updateStatus() { setStatus(peer && peer.open ? 'ok' : 'wait', locals.length ? `${locals.length} im Ring` : peer && peer.open ? 'Warte auf Spieler …' : 'Verbinde …'); }
function startPeer() {
  if (!window.Peer) { setStatus('err', 'Verbindungsdienst nicht geladen'); return; }
  try { code = sessionStorage.getItem('boxring.code') || newCode(); } catch { code = newCode(); }
  setStatus('wait', 'Verbinde …');
  peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => { retries = 0; try { sessionStorage.setItem('boxring.code', code); } catch { /* */ } renderJoin(); updateStatus(); });
  peer.on('connection', (c) => { if (c.metadata && c.metadata.type === 'tv') { c.on('open', () => setTimeout(() => c.close(), 200)); return; } acceptPhone(c); });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); if (++retries > 2) { try { sessionStorage.removeItem('boxring.code'); } catch { /* */ } } setTimeout(startPeer, 1500); }
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { setStatus('err', 'Keine Verbindung zum Server – neuer Versuch …'); setTimeout(() => { peer && peer.destroy(); startPeer(); }, 4000); }
  });
}
function acceptPhone(c) {
  const pid = c.metadata && c.metadata.pid;
  c.__multi = !!(c.metadata && c.metadata.multi);
  c.__ps = new Map();
  toast('Ein Handy verbindet sich …');
  c.on('open', () => {
    if (pid) for (const q of locals) if (q.pid === pid) { q.conn = c; c.__ps.set(q.trackId || 0, q); }
    if (!c.__multi && !c.__ps.size) addPhonePlayer(c, 0);
    sendPhone(c, { t: 'state', s: phoneState(), g: 'box' });
    syncPhone(c);
  });
  c.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'p') { const p = c.__ps.get(0); if (p && msg.k) { p.lostAt = 0; onPose(p, msg.k, msg.w, msg.h, msg.z); } }
    else if (msg.t === 'mp') onMulti(c, msg);
    else if (msg.t === 'mode') setPhoneMode(c, msg.m === 'multi');
    else if (msg.t === 'char') { const p = !c.__multi && c.__ps.get(0); if (p) applyChar(p, { cfg: msg.c }); }
    else if (msg.t === 'setp') { const p = c.__ps.get(msg.id == null ? 0 : msg.id); if (p) applyChar(p, { cfg: msg.cfg, name: msg.name }); }
    else if (msg.t === 'ok') { const p = c.__ps.get(msg.id == null ? 0 : msg.id); if (p) { p.confirmed = !!msg.v; if (!p.confirmed) { p.ready = false; p.readyT = 0; } syncPhone(c); } }
    else if (msg.t === 'hello') sendPhone(c, { t: 'state', s: phoneState(), g: 'box' });
  });
  c.on('close', () => {
    for (const p of [...c.__ps.values()]) {
      if (p.conn !== c) continue;
      p.conn = null;
      if (state === 'lobby' || state === 'ready' || state === 'results') leaveLocal(p);
    }
  });
}
function addPhonePlayer(c, id) {
  const p = joinLocal('phone', c);
  if (!p) return null;
  p.pid = c.metadata && c.metadata.pid; p.trackId = id;
  c.__ps.set(id, p); syncPhone(c);
  return p;
}
function onMulti(c, msg) {
  if (!c.__multi) setPhoneMode(c, true);
  const seen = new Set();
  for (const e of msg.ps || []) {
    if (!e || !Array.isArray(e.k)) continue;
    seen.add(e.id);
    const p = c.__ps.get(e.id) || ((state === 'lobby' || state === 'ready') && locals.length < MAX ? addPhonePlayer(c, e.id) : null);
    if (!p) continue;
    p.lostAt = 0;
    onPose(p, e.k, msg.w, msg.h, e.z);
  }
  for (const [id, p] of c.__ps) if (!seen.has(id) && !p.lostAt) p.lostAt = now;
}
function setPhoneMode(c, multi) {
  if (c.__multi === multi) return;
  c.__multi = multi;
  if (state !== 'lobby' && state !== 'ready') return;
  for (const p of [...c.__ps.values()]) { c.__ps.delete(p.trackId || 0); leaveLocal(p); }
  if (!multi) addPhonePlayer(c, 0);
  syncPhone(c);
}
function applyChar(p, { cfg, name }) {
  if (cfg) p.cfg = sanitize(cfg);
  if (name) p.name = String(name).replace(/[<>&"]/g, '').trim().slice(0, 14) || p.name;
  if (state === 'lobby' || state === 'ready' || state === 'results') assignFighters();
  syncPhone(p.conn);
}
function syncPhone(c) {
  if (!c || !c.__ps) return;
  sendPhone(c, { t: 'ps', l: [...c.__ps.entries()].map(([id, p]) => ({ id: c.__multi ? id : null, name: pName(p), color: P_COLORS[p.slot], cfg: p.cfg, slot: p.slot, ok: p.confirmed ? 1 : 0, ready: p.ready ? 1 : 0, fill: +(p.ready ? 1 : clamp(p.readyT / 1.2, 0, 1)).toFixed(2) })) });
}
function sendPhone(c, msg) { if (c && c.open) { try { c.send(msg); } catch { /* */ } } }
const phoneState = () => (state === 'fight' || state === 'roundEnd' ? 'play' : state === 'intro' ? 'countdown' : state);
function phonesState() { for (const c of new Set(locals.map((p) => p.conn).filter(Boolean))) sendPhone(c, { t: 'state', s: phoneState(), g: 'box' }); }
function dropLost() {
  if (state !== 'lobby' && state !== 'ready') return;
  for (const p of [...locals]) {
    if (!p.lostAt || now - p.lostAt < 2.5) continue;
    p.lostAt = 0;
    if (p.conn && p.conn.__ps) { const c = p.conn; c.__ps.delete(p.trackId || 0); leaveLocal(p); syncPhone(c); }
    else if (p.source === 'cam') { camPlayers.delete(p.trackId); leaveLocal(p); }
  }
}
function controllerUrl() {
  const u = new URL('../controller.html', location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('c', code); u.searchParams.set('g', 'box');
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
  $('code').textContent = code;
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  const svg = qrSvg(url); if (svg) $('qr').innerHTML = svg;
}

/* ================================================================
   Hauptschleife
   ================================================================ */
/* ---------- Ansichten: Seitlich · Hinter dir · Ich-Sicht (zu zweit: geteilter Bildschirm) ---------- */
const SIDE_VIEW = [{ cam: camera, f: null, x: 0, w: 1 }];
let views = SIDE_VIEW;
function layoutViews() {
  const live = state === 'ready' || state === 'intro' || state === 'fight' || state === 'roundEnd';
  const hs = fighters.filter((f) => f.player);
  if (CAPTURE && view !== 'side') hs.splice(0, hs.length, fighters[0]);
  else if (view === 'side' || !live || !hs.length) return SIDE_VIEW;
  const out = hs.map((f, k) => ({ cam: pcams[k], f, x: hs.length === 2 ? k * 0.5 : 0, w: hs.length === 2 ? 0.5 : 1 }));
  if (out.length !== views.length || out.some((v, k) => v.f !== views[k].f)) out.forEach((v) => (v.cam.userData.fresh = true));
  return out;
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
function placeCam(v, dt) {
  const f = v.f, o = opp(f), cam = v.cam, J = f.av.J;
  const me = f.av.root.position, op = o.av.root.position;
  const fwd = _a.set(op.x - me.x, 0, op.z - me.z).normalize();
  const right = _b.set(-fwd.z, 0, fwd.x);
  const pos = new THREE.Vector3(), look = new THREE.Vector3();
  if (view === 'first') {
    // Augenhöhe: zwischen den Schultern, etwas höher – folgt Ausweichen und K.O.-Sturz
    f.av.root.localToWorld(_c.addVectors(J.lSh.cur, J.rSh.cur).multiplyScalar(0.5));
    pos.copy(_c).addScaledVector(fwd, -0.8).add(new THREE.Vector3(0, 0.45, 0));
    look.copy(op).add(new THREE.Vector3(0, 1.7, 0));
  } else {
    // Über die Schulter: hinter dir, leicht rechts versetzt, Blick auf den Gegner
    pos.copy(me).addScaledVector(fwd, -2.7).addScaledVector(right, 2.1).add(new THREE.Vector3(0, 4.2, 0));
    look.copy(op).addScaledVector(right, 0.1).add(new THREE.Vector3(0, 1.85, 0));
  }
  if (cam.userData.fresh) { cam.position.copy(pos); cam.userData.look.copy(look); cam.userData.fresh = false; }
  cam.position.lerp(pos, damp(view === 'first' ? 14 : 6, dt)).add(camShake);
  cam.userData.look.lerp(look, damp(8, dt));
  cam.lookAt(cam.userData.look);
  const aspect = (innerWidth * v.w) / innerHeight, narrow = aspect < 1.3;
  const fov = view === 'first' ? (narrow ? 80 : 64) : (narrow ? 62 : 50);
  if (cam.fov !== fov || Math.abs(cam.aspect - aspect) > 1e-3) { cam.fov = fov; cam.aspect = aspect; cam.updateProjectionMatrix(); }
}
function render() {
  const W = innerWidth, H = innerHeight, split = views.length > 1;
  document.body.classList.toggle('split', split);
  renderer.setScissorTest(split);
  for (const v of views) {
    for (const f of fighters) setLook(f, f !== v.f ? 'normal' : view === 'first' ? 'hands' : 'ghost');
    // Ich-Sicht: Treffer-Sterne am eigenen Kopf nicht direkt vor die Kamera setzen
    for (const o of sprites) o.s.visible = !(view === 'first' && v.f && o.s.userData.target === v.f);
    for (const d of drops) d.visible = !(view === 'first' && v.f && d.userData.target === v.f && d.position.distanceTo(v.cam.position) < 1.2);
    renderer.setViewport(v.x * W, 0, v.w * W, H);
    if (split) renderer.setScissor(v.x * W, 0, v.w * W, H);
    renderer.render(scene, v.cam);
  }
  // Rote Ränder (getroffen) an die richtige Bildhälfte
  for (const f of fighters) {
    const el = $('hurt' + f.i), v = views.find((x) => x.f === f);
    el.hidden = !v;
    if (v) { el.style.left = v.x * 100 + '%'; el.style.width = v.w * 100 + '%'; }
  }
}
function hurt(f) {
  if (!views.some((v) => v.f === f)) return;
  const el = $('hurt' + f.i); el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
function setView(v) {
  view = VIEWS.includes(v) ? v : 'third';
  try { localStorage.setItem('slop.boxview', view); } catch { /* */ }
  document.querySelectorAll('.view').forEach((b) => { const on = b.dataset.view === view; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
  pcams.forEach((c) => (c.userData.fresh = true));
}
document.querySelectorAll('.view').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setView(b.dataset.view); audio.unlock(); audio.tick(); }));
setView(view);

const clock = new THREE.Clock();
let hudT = 0, syncT = 0;
const camShake = new THREE.Vector3();
function tick() {
  const realDt = CAPTURE ? 1 / 30 : Math.min(clock.getDelta(), 0.1), dt = Math.min(realDt, 0.05);
  now += realDt; stateT += realDt;
  keysInput();
  dropLost();
  views = layoutViews();

  if (state === 'ready') {
    for (const p of locals) {
      if (p.ready || p.source === 'keys' || !p.confirmed) continue;
      p.readyT = p.guard && hasControl(p) ? p.readyT + realDt : Math.max(0, p.readyT - realDt * 2);
      if (p.readyT >= 1.2) { p.ready = true; audio.tick(); syncPhone(p.conn); }
    }
    const allReady = locals.length > 0 && locals.every((p) => p.ready);
    const keysNow = locals.some((p) => p.startNow);
    if (allReady) {
      if (startAt == null) startAt = Math.max(now + (locals.length >= 2 ? 3 : 6), lastJoinAt + 3);
      const left = keysNow ? 0 : Math.max(0, startAt - now);
      if (left <= 0) { matchT = 0; setState('intro'); }
      else setPrompt(true, `Kampf in ${Math.ceil(left)} …`, locals.length === 1 ? 'Gegen die KI – oder 2. Person: jetzt QR-Code scannen' : 'Fäuste hoch!', '🥊', 1 - left / 6);
    } else { startAt = null; setPrompt(false); }
  } else if (state === 'intro') {
    if (stateT > 2.2) setState('fight');
  } else if (state === 'fight') {
    roundT -= realDt; matchT += realDt;
    if (roundT <= 0) {
      roundT = 0;
      const [a, b] = fighters;
      roundOver(a.hp > b.hp ? a : b.hp > a.hp ? b : null, 'Zeit!');
    }
  } else if (state === 'roundEnd') {
    if (stateT > 3.2) {
      if (fighters.some((f) => f.wins >= WIN_ROUNDS) || roundNo >= 3) setState('results');
      else setState('intro');
    }
  } else if (state === 'results') {
    if (stateT > 2.5) for (const p of locals) {
      p.upT = p.handsUp && hasControl(p) ? (p.upT || 0) + realDt : 0;
      if (p.upT > 0.9) { p.upT = 0; requestRestart(); break; }
    }
  }

  // Kämpfer bewegen
  for (const f of fighters) {
    if (f.ai) f.ai.tick(dt);
    for (const k of ['l', 'r', 'kick']) {
      f.cool[k] = Math.max(0, f.cool[k] - dt);
      if (f.anim[k] > 0) { f.anim[k] += dt / (k === 'kick' ? 0.6 : PTYPE[f.ptype?.[k] || 'jab'].dur); if (f.anim[k] >= 1) f.anim[k] = 0; }
    }
    for (let i = f.queue.length - 1; i >= 0; i--) if (now >= f.queue[i].at) { const a = f.queue.splice(i, 1)[0]; resolve(f, a); }
    if (f.player && f.player.source !== 'keys' && state !== 'fight') { f.guard = f.player.guard; f.dodge = f.player.dodge; }
    const human = f.player && f.player.source !== 'keys' && f.down <= 0 && f.cheer <= 0;
    moveFighter(f, dt);
    const pose = human ? fromPose(f, dt) : synth(f, dt);
    if (f.walk > 0.05 && !(f.anim.kick > 0) && !(mode === 'kick' && human)) { // Schritte
      for (const side of ['l', 'r']) {
        const lift = Math.max(0, Math.sin(f.walkPh + (side === 'l' ? 0 : Math.PI))) * f.walk;
        const L = pose.legs[side];
        pose.legs[side] = { ...L, t: { x: L.t.x, y: L.t.y + lift * 0.35 }, zk: (L.zk || 0) + lift * 0.22, za: (L.za || 0) + lift * 0.12 };
      }
      pose.bounce = (pose.bounce || 0) + Math.abs(Math.sin(f.walkPh)) * 0.04 * f.walk;
    }
    compose(f.av, views.some((v) => v.f === f) ? mirrorS(pose) : pose);
    // Immer zum Gegner gedreht · seitlich zusätzlich etwas zur Kamera (damit man Gesichter sieht)
    const fw = facing(f);
    let yaw = Math.atan2(fw.x, fw.y);
    if (!views[0].f) yaw -= Math.sign(yaw) * (Math.PI / 2 - YAW) * Math.abs(Math.sin(yaw));
    let dy = yaw - f.av.root.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    f.av.root.rotation.y += dy * damp(8, dt);
    // Rückstoss nach Treffer, K.O.-Sturz
    f.knock = Math.max(0, f.knock - dt * 1.6);
    const dirX = f.i === 0 ? -1 : 1;
    // Beim Schlagen/Treten einen Schritt nach vorne (damit die Handschuhe den Gegner erreichen)
    const J = f.av.J, reach = Math.max(J.lHa.tgt.z, J.rHa.tgt.z, J.lAn.tgt.z * 0.9, J.rAn.tgt.z * 0.9);
    f.lunge = lerp(f.lunge || 0, clamp((reach - 0.45) / 0.37, 0, 1) * 0.5, damp(14, dt));
    const off = f.lunge - Math.sin(Math.min(1, f.knock) * Math.PI) * 0.3;
    f.av.root.position.x = f.pos.x + fw.x * off; f.av.root.position.z = f.pos.y + fw.y * off;
    if (f.down > 0) { f.av.root.rotation.z = lerp(f.av.root.rotation.z, -dirX * 1.35, damp(3, dt)); }
    else f.av.root.rotation.z = lerp(f.av.root.rotation.z, 0, damp(6, dt));
    f.cheer = state === 'roundEnd' || state === 'results' ? f.cheer : 0;
    f.av.update(dt, now);
    updateShield(f, dt);
    if (f.down > 0) f.av.root.position.y = -0.15 * Math.min(1, Math.abs(f.av.root.rotation.z));
  }
  animateSprites(dt);
  animateDrops(dt);
  excite = Math.max(0, excite - dt * 0.5);
  animateCrowd(excite, !!views[0].f);

  // Kamera: leicht wackeln bei Treffern
  shake = Math.max(0, shake - dt * 1.4);
  camShake.set((Math.random() - 0.5) * shake * 0.25, (Math.random() - 0.5) * shake * 0.25, 0);
  const zoom = state === 'roundEnd' ? Math.min(1, stateT) * 1.2 : 0;
  camera.position.lerp(new THREE.Vector3(CAM_BASE.x, CAM_BASE.y - zoom * 0.3, CAM_BASE.z - zoom * 1.6).add(camShake), damp(5, dt));
  camera.lookAt(CAM_LOOK);
  for (const v of views) if (v.f) placeCam(v, dt);
  render();

  hudT -= realDt;
  if (hudT <= 0) {
    hudT = 0.1;
    if (state === 'lobby' || state === 'ready') {
      renderSlots();
      if ((syncT -= 0.1) <= 0) { syncT = 0.4; for (const c of new Set(locals.map((q) => q.conn).filter(Boolean))) syncPhone(c); }
    }
    renderPanels();
    updateStatus();
  }
  if (CAPTURE) { if (state === 'fight') roundT = ROUND_TIME; for (const f of fighters) f.hp = Math.max(f.hp, 40); }
  else requestAnimationFrame(tick);
}

/* ================================================================
   Start
   ================================================================ */
function resize() { const W = innerWidth, H = innerHeight; renderer.setSize(W, H, false); camera.aspect = W / H; camera.fov = W / H < 1.3 ? 52 : 40; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
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

setState('lobby');
if (CAPTURE) { setState('intro'); setState('fight'); } else startPeer();
if (params.has('keys')) addKeysPlayer();
tick();

// Test-Hilfe (Konsole)
window.__box = {
  locals, fighters, get state() { return state; }, get code() { return code; }, get mode() { return mode; }, get view() { return view; }, setView, cams: () => pcams.map((c) => [c.position.toArray().map((v) => +v.toFixed(2)), c.userData.look.toArray().map((v) => +v.toFixed(2))]),
  frame: () => tick(), setState, setMode, attack, addKeysPlayer, onPose: (i, k, w, h, z) => locals[i] && onPose(locals[i], k, w, h, z),
  get roundT() { return roundT; }, set roundT(v) { roundT = v; },
};
