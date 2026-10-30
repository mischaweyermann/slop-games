// Skicross – Ski-Rennen für 1–4 Personen am gleichen TV (fehlende Plätze fährt die KI).
//  • Lehnen = lenken · Hocke = schneller · Hochspringen = Sprung · Arme runter schwingen = am Start anschieben
//  • Piste mit Steilkurven, Wellen und Schanzen; Rempeln und Windschatten wie im echten Skicross
import * as THREE from 'three';
import { createAudio } from '../js/audio.js';
import { loadConfig, sanitize, PRESETS } from '../js/character.js';
import { MultiTracker } from '../js/tracker.js';
import { avatarSvg } from '../js/avatar2d.js';
import { Avatar, D } from '../js/avatar3d.js';
import { peerOptions as netOptions } from '../js/net.js';
import { endMenu } from '../js/endmenu.js';
import { reward, tvUid } from '../js/reward.js';

/* ================================================================
   Grundlagen
   ================================================================ */
const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAR_KEY = 'ballonplatzer.character';
const GAME = 'ski';
const MAX = 4, RACERS = 4;
const P_COLORS = ['#e2574c', '#5aa9c9', '#9b7fd1', '#f39a4c'];
const FUN_NAMES = ['Pisten-Paula', 'Schuss-Sepp', 'Carving-Carla', 'Buckel-Beni', 'Tiefschnee-Tina', 'Slalom-Sämi', 'Firn-Fritz', 'Schanzen-Susi', 'Hocke-Hugo', 'Powder-Pia', 'Kanten-Kurt', 'Gipfel-Gabi'];
const AI_DEF = [
  { name: 'Vreni Vollgas', preset: 2 }, { name: 'Ueli Überflieger', preset: 4 }, { name: 'Flocke', preset: 5 },
  { name: 'Bergfex Beat', preset: 6 }, { name: 'Lawinen-Lena', preset: 1 },
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const newCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
const fmt = (t) => { if (t == null || !isFinite(t)) return '–'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture'); // Aufnahme-Modus: KI-Rennen, ohne Anzeigen, feste Bildrate
if (CAPTURE) document.body.classList.add('capture');
const audio = createAudio();
let now = 0;

/* ================================================================
   Szene
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e9a59c');
scene.fog = new THREE.Fog('#f3c4b8', 90, 420);
scene.add(new THREE.HemisphereLight('#fff1ea', '#b98a9a', 1.35));
const sun = new THREE.DirectionalLight('#ffd9bf', 2.3);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
scene.add(sun, sun.target);

const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...o });
const mesh = (geo, m, parent = scene, pos = [0, 0, 0], scl = [1, 1, 1], rot = [0, 0, 0], shadow = true) => {
  const o = new THREE.Mesh(geo, m); o.position.set(...pos); o.scale.set(...scl); o.rotation.set(...rot);
  o.castShadow = shadow; o.receiveShadow = shadow; parent.add(o); return o;
};
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

/* ================================================================
   Piste: Mittellinie mit Kurven, Höhe mit Wellen und Schanzen
   ================================================================ */
const HALF = 8;          // halbe Pistenbreite (Bande bei ±HALF)
const EXT = 38;          // Gelände links/rechts der Piste
const DS = 1;            // Abtastung der Piste in Metern
// Abschnitte: Länge, Richtungsänderung (Grad, + = links), Gefälle, Besonderheit
const SEGS = [
  { len: 34, turn: 0, slope: 0.34 },                      // Start-Rampe
  { len: 50, turn: 0, slope: 0.24 },
  { len: 96, turn: -42, slope: 0.23 },                    // Rechtskurve
  { len: 60, turn: 0, slope: 0.22, feat: 'kicker' },
  { len: 104, turn: 46, slope: 0.23 },
  { len: 76, turn: 0, slope: 0.21, feat: 'rollers' },
  { len: 112, turn: -50, slope: 0.24 },
  { len: 58, turn: 0, slope: 0.22, feat: 'kicker' },
  { len: 92, turn: 38, slope: 0.23 },
  { len: 70, turn: 0, slope: 0.22, feat: 'rollers' },
  { len: 100, turn: -40, slope: 0.24 },
  { len: 62, turn: 0, slope: 0.22, feat: 'kicker' },
  { len: 90, turn: 30, slope: 0.22 },
  { len: 70, turn: 0, slope: 0.16 },
  { len: 70, turn: 0, slope: 0.07 },                      // Zielhang / Auslauf
];
const LEN = SEGS.reduce((a, s) => a + s.len, 0);
const FINISH = LEN - 52;
const NPTS = Math.floor(LEN / DS) + 1;
const C = { x: new Float32Array(NPTS), z: new Float32Array(NPTS), yaw: new Float32Array(NPTS), base: new Float32Array(NPTS), feat: new Float32Array(NPTS), kap: new Float32Array(NPTS), bank: new Float32Array(NPTS) };
const KICKERS = [], ROLLERS = [];
const LANES = [-4.8, -1.6, 1.6, 4.8];   // Startbahnen (x)
const START = { gates: [], open: 0 };
const CROWD = [];
(function buildCourse() {
  let x = 0, z = 0, yaw = Math.PI, y = 0, s0 = 0; // yaw = π: talwärts Richtung −z
  const kapAt = [];
  for (const sg of SEGS) {
    const turn = THREE.MathUtils.degToRad(sg.turn);
    for (let k = 0; k < sg.len; k++) kapAt.push({ kap: (turn / sg.len) * (1 - Math.cos(2 * Math.PI * (k + 0.5) / sg.len)), slope: sg.slope });
    if (sg.feat === 'kicker') KICKERS.push(s0 + sg.len * 0.45);
    if (sg.feat === 'rollers') ROLLERS.push([s0 + 10, s0 + sg.len - 10]);
    s0 += sg.len;
  }
  // Gefälle weich überblenden
  const slopeS = kapAt.map((_, i) => { let a = 0, n = 0; for (let j = -12; j <= 12; j++) { const q = kapAt[clamp(i + j, 0, kapAt.length - 1)]; a += q.slope; n++; } return a / n; });
  for (let i = 0; i < NPTS; i++) {
    C.x[i] = x; C.z[i] = z; C.yaw[i] = yaw; C.base[i] = y;
    const q = kapAt[Math.min(i, kapAt.length - 1)];
    C.kap[i] = q.kap;
    yaw += q.kap * DS;
    x += Math.sin(yaw) * DS; z += Math.cos(yaw) * DS;
    y -= slopeS[Math.min(i, slopeS.length - 1)] * DS;
  }
  // Besonderheiten (Höhe über dem Grundhang)
  for (let i = 0; i < NPTS; i++) {
    const s = i * DS; let h = 0;
    for (const k of KICKERS) {
      const t = s - k;
      if (t > -11 && t <= 0) h += 1.55 * ((t + 11) / 11) ** 2;            // Anfahrt, wird zur Kante hin steiler
      else if (t > 0 && t <= 3) h += 1.55 - 0.12 * t;                     // Kante
      else if (t > 3 && t <= 19) h += lerp(1.19, -0.55, smooth((t - 3) / 16)); // Landung
      else if (t > 19 && t <= 30) h += lerp(-0.55, 0, smooth((t - 19) / 11));
    }
    for (const [a, b] of ROLLERS) if (s > a && s < b) h += 0.75 * Math.sin(Math.PI * (s - a) / 9.5) ** 2 * smooth((s - a) / 6) * smooth((b - s) / 6);
    C.feat[i] = h;
  }
  // Steilkurven: aussen höher (Krümmung nach links = rechts aussen)
  for (let i = 0; i < NPTS; i++) { let a = 0, n = 0; for (let j = -6; j <= 6; j++) { a += C.kap[clamp(i + j, 0, NPTS - 1)]; n++; } C.bank[i] = clamp((a / n) * 13, -0.3, 0.3); }
})();
function idxF(s) { const f = clamp(s / DS, 0, NPTS - 1.001); const i = Math.floor(f); return [i, f - i]; }
const at = (arr, s) => { const [i, t] = idxF(s); return arr[i] + (arr[i + 1] - arr[i]) * t; };
// rechts aus Sicht der Fahrenden (Blick talwärts)
function frame(s) {
  const yaw = at(C.yaw, s);
  return { px: at(C.x, s), pz: at(C.z, s), yaw, tx: Math.sin(yaw), tz: Math.cos(yaw), rx: -Math.cos(yaw), rz: Math.sin(yaw) };
}
function ground(s, x) {
  const xi = clamp(x, -HALF, HALF);
  return at(C.base, s) + at(C.feat, s) * (Math.abs(x) <= HALF + 0.6 ? 1 : 0) + at(C.bank, s) * xi; // Linkskurve: rechts (aussen) höher
}
function worldPos(s, x, y, out = new THREE.Vector3()) { const f = frame(s); return out.set(f.px + f.rx * x, y, f.pz + f.rz * x); }

/* ---------- Gelände + Piste als ein Netz ---------- */
(function buildTerrain() {
  const XS = [-EXT, -28, -20, -14, -11.5, -10, -9, -8.4, -8, -6, -4, -2, 0, 2, 4, 6, 8, 8.4, 9, 10, 11.5, 14, 20, 28, EXT];
  const S0 = -40, S1 = LEN + 40, STEP = 2;
  const rows = Math.floor((S1 - S0) / STEP) + 1, cols = XS.length;
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), uv = new Float32Array(rows * cols * 2);
  const cPiste = new THREE.Color('#fff7f4'), cEdge = new THREE.Color('#f1dde3'), cOut = new THREE.Color('#f7ecef'), cFar = new THREE.Color('#e8d3dc');
  const noise = (a, b) => Math.sin(a * 0.13 + b * 0.31) * Math.cos(a * 0.07 - b * 0.19) + Math.sin(a * 0.031 + b * 0.05) * 1.6;
  for (let r = 0; r < rows; r++) {
    const s = S0 + r * STEP, sc = clamp(s, 0, LEN), f = frame(sc);
    const ext = s < 0 ? s : s > LEN ? s - LEN : 0; // vor dem Start / nach dem Ziel: geradeaus weiter
    for (let c = 0; c < cols; c++) {
      const x = XS[c], ax = Math.abs(x), d = ax - HALF;
      let y = ground(sc, x) - ext * 0.12;
      if (d > 0) y += 1.25 * smooth(d / 1.4) + Math.max(0, d - 3) * 0.1 + noise(s, x) * smooth((d - 3) / 10) * 1.4;
      const k = (r * cols + c) * 3;
      pos[k] = f.px + f.tx * ext + f.rx * x; pos[k + 1] = y; pos[k + 2] = f.pz + f.tz * ext + f.rz * x;
      const cc = d <= 0 ? cPiste : d < 2 ? cEdge : d < 10 ? cOut : cFar;
      col[k] = cc.r; col[k + 1] = cc.g; col[k + 2] = cc.b;
      uv[(r * cols + c) * 2] = x / 4; uv[(r * cols + c) * 2 + 1] = s / 6;
    }
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) { const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1; idx.push(a, b, d, b, e, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  // Pistenmuster (Rillen vom Pistenbully)
  const tex = canvasTex(256, 256, (x, w, h) => {
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { x.fillStyle = i % 16 ? 'rgba(200,170,190,.10)' : 'rgba(200,170,190,.18)'; x.fillRect(i, 0, 3, h); }
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(190,160,180,${Math.random() * 0.12})`; x.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 0.92, metalness: 0 });
  const terrain = new THREE.Mesh(g, m); terrain.receiveShadow = true; scene.add(terrain);
  // Farblinien am Pistenrand (blau) + Markierungen an den Schanzenkanten (orange)
  const line = (x0, color, w = 0.18) => {
    const p = [], ii = [];
    for (let s = 0, n = 0; s <= LEN; s += 2, n++) {
      for (const dx of [-w / 2, w / 2]) { const xx = x0 + dx; const f = frame(s); p.push(f.px + f.rx * xx, ground(s, xx) + 0.03, f.pz + f.rz * xx); }
      if (n) { const a = (n - 1) * 2; ii.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); gg.setIndex(ii); gg.computeVertexNormals();
    const o = new THREE.Mesh(gg, mat(color, { roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 })); o.receiveShadow = true; scene.add(o);
  };
  line(-HALF + 0.35, '#5aa9c9'); line(HALF - 0.35, '#5aa9c9');
  for (const k of KICKERS) {
    const p = [], ii = [];
    for (let n = 0, x = -HALF; x <= HALF + 0.01; x += 1, n++) {
      for (const ds of [-0.25, 0.25]) { const f = frame(k + ds); p.push(f.px + f.rx * x, ground(k + ds, x) + 0.04, f.pz + f.rz * x); }
      if (n) { const a = (n - 1) * 2; ii.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); gg.setIndex(ii); gg.computeVertexNormals();
    scene.add(new THREE.Mesh(gg, mat('#f39a4c', { side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 })));
  }
})();

/* ---------- Himmel, Berge, Bäume, Tore, Start, Ziel ---------- */
(function buildWorld() {
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: { top: { value: new THREE.Color('#9b4652') }, mid: { value: new THREE.Color('#ee9a86') }, bottom: { value: new THREE.Color('#fbd9c2') } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = mix(bottom, mid, smoothstep(-0.05, 0.16, h)); c = mix(c, top, smoothstep(0.14, 0.62, h));
      gl_FragColor = vec4(c, 1.0);
      #include <colorspace_fragment>
      }`,
  })));
  // Berge rundherum (Fels + Schneekappe), auf Höhe der Pistenmitte
  const midY = at(C.base, LEN / 2), cx = at(C.x, LEN / 2), cz = at(C.z, LEN / 2);
  const rock = [mat('#a8636c', { roughness: 1, flatShading: true }), mat('#9a5560', { roughness: 1, flatShading: true }), mat('#b7737a', { roughness: 1, flatShading: true })];
  const snowCap = mat('#fff4f2', { roughness: 0.9, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rand(-0.08, 0.08), d = rand(560, 720), hgt = rand(140, 280), r = rand(110, 190);
    const g = new THREE.Group(); g.position.set(cx + Math.cos(a) * d, midY - 150, cz + Math.sin(a) * d); scene.add(g);
    mesh(new THREE.ConeGeometry(r, hgt, 7), rock[i % 3], g, [0, hgt / 2, 0], [1, 1, 1], [0, rand(0, 3), 0], false);
    mesh(new THREE.ConeGeometry(r * 0.42, hgt * 0.42, 7), snowCap, g, [0, hgt * 0.79 + 0.5, 0], [1, 1, 1], [0, rand(0, 3), 0], false);
  }
  // Tannen (instanziert): Stamm + drei Kegel mit Schnee
  const spots = [];
  for (let s = -30; s < LEN + 30; s += 3.2) {
    for (const side of [-1, 1]) {
      if (Math.random() < 0.55) continue;
      const x = side * rand(HALF + 4.5, EXT - 2), sc = clamp(s, 0, LEN);
      const f = frame(sc), d = Math.abs(x) - HALF;
      const y = ground(sc, x) + 1.25 + Math.max(0, d - 3) * 0.1 - 0.3;
      spots.push([f.px + f.rx * x, y, f.pz + f.rz * x, rand(0.8, 1.5)]);
    }
  }
  const N = spots.length;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 6), mat('#6b3f37'), N);
  const tiers = [0, 1, 2].map((t) => new THREE.InstancedMesh(new THREE.ConeGeometry(1.6 - t * 0.38, 2.0 - t * 0.2, 8), mat(t === 2 ? '#5a7a6a' : '#3e5f53', { roughness: 0.9, flatShading: true }), N));
  const caps = new THREE.InstancedMesh(new THREE.ConeGeometry(0.6, 0.7, 8), mat('#fff6f4', { flatShading: true }), N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  spots.forEach(([x, y, z, k], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6);
    trunk.setMatrixAt(i, m4.compose(v.set(x, y + 0.6 * k, z), q, sc.setScalar(k)));
    tiers.forEach((t, j) => t.setMatrixAt(i, m4.compose(v.set(x, y + (1.6 + j * 1.05) * k, z), q, sc.setScalar(k))));
    caps.setMatrixAt(i, m4.compose(v.set(x, y + 4.15 * k, z), q, sc.setScalar(k)));
  });
  for (const o of [trunk, ...tiers, caps]) { o.castShadow = true; o.receiveShadow = true; scene.add(o); }

  // Tore: Tafeln links/rechts, abwechselnd rot/blau
  const panelGeo = new THREE.PlaneGeometry(1.5, 1.0), poleGeo = new THREE.CylinderGeometry(0.035, 0.035, 2.0, 6);
  const panelMats = ['#e2574c', '#5aa9c9'].map((c) => mat(c, { side: THREE.DoubleSide, roughness: 0.6 })), poleMat = mat('#fbf7f0');
  let gi = 0;
  for (let s = 55; s < FINISH - 20; s += 44, gi++) {
    const f = frame(s), m = panelMats[gi % 2];
    for (const side of [-1, 1]) {
      const x = side * (HALF + 0.9), y = ground(s, side * HALF) + 0.4;
      const g = new THREE.Group(); g.position.set(f.px + f.rx * x, y, f.pz + f.rz * x); g.rotation.y = f.yaw + Math.PI; scene.add(g);
      mesh(poleGeo, poleMat, g, [-0.72, 1.0, 0]); mesh(poleGeo, poleMat, g, [0.72, 1.0, 0]);
      mesh(panelGeo, m, g, [0, 1.45, 0]);
    }
  }
  // Fangnetze am Pistenrand (orange Pfosten-Linie)
  const netM = mat('#f39a4c', { transparent: true, opacity: 0.38, side: THREE.DoubleSide, roughness: 0.7, depthWrite: false });
  for (const side of [-1, 1]) {
    const p = [], ii = [];
    for (let s = 0, n = 0; s <= FINISH + 30; s += 3, n++) {
      const f = frame(s), x = side * (HALF + 2.2), y = ground(s, side * HALF) + 1.25;
      p.push(f.px + f.rx * x, y, f.pz + f.rz * x, f.px + f.rx * x, y + 0.9, f.pz + f.rz * x);
      if (n) { const a = (n - 1) * 2; ii.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); gg.setIndex(ii); gg.computeVertexNormals();
    scene.add(new THREE.Mesh(gg, netM));
  }

  // Start: Hütte + Startgatter pro Bahn
  const f0 = frame(0), y0 = ground(0, 0);
  const startG = new THREE.Group(); startG.position.set(f0.px, y0, f0.pz); startG.rotation.y = f0.yaw; scene.add(startG);
  mesh(new THREE.BoxGeometry(HALF * 2 + 1.2, 0.5, 5), mat('#f4e7e3'), startG, [0, -0.15, -2.6]);
  mesh(new THREE.BoxGeometry(HALF * 2 + 1.6, 3.6, 0.4), mat('#7d2a2e'), startG, [0, 1.8, -4.9]);
  const sign = canvasTex(1024, 160, (x, w, h) => { x.fillStyle = '#e2574c'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.font = '800 104px Poppins, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('SKICROSS', w / 2, h / 2 + 6); });
  mesh(new THREE.PlaneGeometry(HALF * 2, 2.4), new THREE.MeshStandardMaterial({ map: sign, roughness: 0.6 }), startG, [0, 4.2, -4.6], [1, 1, 1], [0, 0, 0], false);
  for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.5, 5.8, 0.5), mat('#e2574c'), startG, [sx * (HALF + 0.6), 2.9, -4.6]);
  START.gates = LANES.map((lx) => {
    const g = new THREE.Group(); g.position.set(-lx, 0.55, 0.15); startG.add(g); // −lx: im Gatter-Koordinatensystem ist +x links
    mesh(new THREE.BoxGeometry(1.7, 0.09, 0.09), mat('#f7e9a6', { roughness: 0.5 }), g, [0, 0, 0]);
    mesh(new THREE.BoxGeometry(0.12, 0.6, 0.12), mat('#3b2a2c'), startG, [-lx - 0.95, 0.3, 0.15]);
    return g;
  });
  // Ziel: Bogen mit Banner
  const ff = frame(FINISH), yf = ground(FINISH, 0);
  const finG = new THREE.Group(); finG.position.set(ff.px, yf, ff.pz); finG.rotation.y = ff.yaw; scene.add(finG);
  const banner = canvasTex(1024, 192, (x, w, h) => {
    x.fillStyle = '#fbf7f0'; x.fillRect(0, 0, w, h);
    const q = 32; for (let i = 0; i < w / q; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#3b2a2c' : '#fbf7f0'; x.fillRect(i * q, j * q, q, q); x.fillRect(i * q, h - (j + 1) * q, q, q); }
    x.fillStyle = '#e2574c'; x.font = '800 92px Poppins, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('ZIEL', w / 2, h / 2 + 4);
  });
  for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(0.35, 0.35, 6.5, 12), mat('#e2574c'), finG, [sx * (HALF + 0.8), 3.25, 0]);
  const bn = mesh(new THREE.PlaneGeometry(HALF * 2 + 1.6, 2.6), new THREE.MeshStandardMaterial({ map: banner, side: THREE.DoubleSide, roughness: 0.6 }), finG, [0, 5.6, 0], [1, 1, 1], [0, Math.PI, 0]);
  bn.castShadow = false;
  // Ziellinie
  mesh(new THREE.PlaneGeometry(HALF * 2, 0.5), mat('#e2574c', { polygonOffset: true, polygonOffsetFactor: -3 }), finG, [0, 0.05, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
  // Zuschauer-Tribünen im Zielbereich (einfach)
  const crowdM = ['#e2574c', '#5aa9c9', '#9b7fd1', '#f7e9a6', '#7fb069', '#f39a4c'].map((c) => mat(c));
  for (let i = 0; i < 60; i++) {
    const side = i % 2 ? 1 : -1, s = FINISH - 30 + rand(0, 50), x = side * rand(HALF + 3.2, HALF + 7), f = frame(s);
    const y = ground(s, side * HALF) + 1.25 + 0.4;
    const g = new THREE.Group(); g.position.set(f.px + f.rx * x, y, f.pz + f.rz * x); scene.add(g);
    mesh(new THREE.CapsuleGeometry(0.28, 0.4, 3, 8), crowdM[i % crowdM.length], g, [0, 0.5, 0]);
    mesh(new THREE.SphereGeometry(0.24, 10, 8), mat(['#ffdcc6', '#e3a97f', '#c08158', '#8d5b3d'][i % 4]), g, [0, 1.1, 0]);
    CROWD.push(g);
  }
})();

/* ================================================================
   Fahrer:innen (Figur, Ski, Stöcke, Startnummer)
   ================================================================ */
const HIP_Y = 0.14 + D.thigh + D.shin;
const SKI_GEO = new THREE.BoxGeometry(0.13, 0.045, 1.75), TIP_GEO = new THREE.BoxGeometry(0.13, 0.045, 0.32);
const POLE_GEO = new THREE.CylinderGeometry(0.018, 0.018, 1, 6), BASKET_GEO = new THREE.CylinderGeometry(0.07, 0.07, 0.015, 10);
function bibTexture(n, color) {
  return canvasTex(128, 128, (x, w, h) => { x.fillStyle = '#fbf7f0'; x.fillRect(0, 0, w, h); x.fillStyle = color; x.fillRect(0, 0, w, 22); x.fillRect(0, h - 22, w, 22); x.fillStyle = '#2a0e11'; x.font = '800 70px Poppins, system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(n), w / 2, h / 2 + 3); });
}
function makeRacer(i) {
  const av = new Avatar(scene);
  av.follow = 16;
  av.root.rotation.order = 'YXZ';
  const skiMat = mat(P_COLORS[i], { roughness: 0.35, metalness: 0.1 });
  const skis = ['l', 'r'].map(() => {
    const g = new THREE.Group(); av.root.add(g);
    mesh(SKI_GEO, skiMat, g, [0, 0, 0.12]);
    mesh(TIP_GEO, skiMat, g, [0, 0.07, 1.08], [1, 1, 1], [-0.5, 0, 0]);
    return g;
  });
  const poleMat = mat('#3b3b45', { metalness: 0.5, roughness: 0.4 });
  const poles = ['l', 'r'].map(() => { const p = mesh(POLE_GEO, poleMat, av.root); const b = mesh(BASKET_GEO, poleMat, av.root); return { p, b }; });
  // Startnummer vorne + hinten
  const bibM = new THREE.MeshStandardMaterial({ map: bibTexture(i + 1, P_COLORS[i]), roughness: 0.8, side: THREE.DoubleSide });
  const bib = [mesh(new THREE.PlaneGeometry(0.46, 0.4), bibM, av.torsoFrame, [0, 0.02, 0.36], [1, 1, 1], [0, 0, 0], false), mesh(new THREE.PlaneGeometry(0.46, 0.4), bibM, av.torsoFrame, [0, 0.02, -0.36], [1, 1, 1], [0, Math.PI, 0], false)];
  return {
    i, av, skis, poles, bib, player: null, ai: null, name: '', cfg: null,
    s: 0, x: LANES[i], y: 0, vy: 0, v: 0, th: 0, air: false, airT: 0, lean: 0, tuck: 0, push: 0, pushT: 0, jumpReq: -9,
    finished: null, place: 0, bumpT: 0, fenceT: 0, wake: 0, draft: 0, skill: 1, hard: 0,
  };
}
const racers = [0, 1, 2, 3].map(makeRacer);

// 2-Gelenk-IK in der Ebene (y, z): Knie/Ellbogen nach vorne (+z) bzw. hinten
function ik(a, b, l1, l2, bend) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.max(0.001, Math.hypot(dx, dy, dz));
  const dd = Math.min(d, l1 + l2 - 0.001), t = (l1 * l1 - l2 * l2 + dd * dd) / (2 * dd), h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
  const ux = dx / d, uy = dy / d, uz = dz / d;
  // Biegerichtung senkrecht zur Verbindung, möglichst in Richtung "bend"
  let px = bend.x, py = bend.y, pz = bend.z; const dot = px * ux + py * uy + pz * uz; px -= dot * ux; py -= dot * uy; pz -= dot * uz;
  const pl = Math.hypot(px, py, pz) || 1;
  return new THREE.Vector3(a.x + ux * t + (px / pl) * h, a.y + uy * t + (py / pl) * h, a.z + uz * t + (pz / pl) * h);
}
const FWD = { x: 0, y: 0, z: 1 }, BACK = { x: 0, y: -0.3, z: -1 };
// Haltung aus Hocke, Anschieben und Luft
function skiPose(r, dt) {
  const J = r.av.J, c = r.tuck, airK = r.air ? 1 : 0;
  r.pushAnim = Math.max(0, (r.pushAnim || 0) - dt * 2.6);
  const pa = r.pushAnim; // 1 → 0: Arme von vorne nach hinten
  const hipY = HIP_Y - 0.14 - c * 0.36 - airK * 0.12, hipZ = -0.06 - c * 0.2;
  const ph = 0.3 + c * 0.75 + pa * 0.25; // Oberkörper nach vorne geneigt
  for (const [side, sx] of [['l', -1], ['r', 1]]) {
    const hip = new THREE.Vector3(sx * D.hipHalf, hipY, hipZ);
    const an = new THREE.Vector3(sx * 0.17, 0.14 + airK * 0.18, 0.05 + airK * 0.08);
    J[side + 'Hip'].tgt.copy(hip); J[side + 'An'].tgt.copy(an);
    J[side + 'Kn'].tgt.copy(ik(hip, an, D.thigh, D.shin, FWD));
  }
  const shY = hipY + Math.cos(ph) * D.torso, shZ = hipZ + Math.sin(ph) * D.torso;
  J.lSh.tgt.set(-D.shoulderHalf, shY, shZ); J.rSh.tgt.set(D.shoulderHalf, shY, shZ);
  const hp = 0.25 + c * 0.35; // Kopf schaut nach vorne
  J.head.tgt.set(0, shY + Math.cos(hp) * D.neck * 0.92, shZ + Math.sin(hp) * D.neck * 0.92 + 0.05);
  for (const [side, sx] of [['l', -1], ['r', 1]]) {
    let hand;
    if (c > 0.35 && pa < 0.05) hand = new THREE.Vector3(sx * 0.22, shY - 0.22, shZ + 0.42); // Hocke: Hände vorne zusammen
    else hand = new THREE.Vector3(sx * (0.44 + airK * 0.18), lerp(shY - 0.42, hipY + 0.05, pa) + airK * 0.25, lerp(shZ + 0.3, hipZ - 0.55, pa));
    const sh = J[side + 'Sh'].tgt;
    J[side + 'Ha'].tgt.copy(hand);
    J[side + 'El'].tgt.copy(ik(sh, hand, D.upperArm, D.foreArm, { x: sx * 0.6, y: -0.6, z: -0.3 }));
  }
}
// Ski + Stöcke folgen der Figur
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function placeGear(r) {
  const J = r.av.J;
  r.skis.forEach((g, k) => { const an = J[k ? 'rAn' : 'lAn'].cur; g.position.set(an.x, an.y - 0.12, an.z - 0.05); g.rotation.set(r.air ? -0.12 : 0, (k ? -1 : 1) * 0.02, 0); });
  r.poles.forEach(({ p, b }, k) => {
    const hand = J[k ? 'rHa' : 'lHa'].cur;
    const tip = _q.set(hand.x * 1.15, Math.max(0.05, hand.y - 1.15), hand.z - 0.55 - (r.pushAnim || 0) * 0.2);
    _p.subVectors(tip, hand); const len = _p.length();
    p.position.copy(hand).addScaledVector(_p, 0.5); p.quaternion.setFromUnitVectors(UP, _p.clone().normalize()); p.scale.set(1, len, 1);
    b.position.copy(hand).addScaledVector(_p, 0.9); b.quaternion.copy(p.quaternion);
  });
}

/* ================================================================
   Physik: Fahren, Kurven, Springen, Bande, Rempeln, Windschatten
   ================================================================ */
const G = 9.81, K_STAND = 0.0062, K_TUCK = 0.0036, MU = 0.022, STEER = 1.45;
function resetRacers() {
  racers.forEach((r, i) => {
    Object.assign(r, { s: 0.6, x: LANES[i], vy: 0, v: 0, th: 0, air: false, airT: 0, lean: 0, tuck: 0, pushT: 0, jumpReq: -9, finished: null, place: 0, bumpT: 0, fenceT: 0, draft: 0, hard: 0, pushAnim: 0, lastS: 0.6 });
    r.y = ground(r.s, r.x);
    r.skill = r.ai ? rand(0.97, 1.03) : 1;
  });
  START.open = 0;
}
function physics(r, dt) {
  const racing = state === 'race' && START.open >= 1;
  if (!racing) return;
  if (r.finished != null) { // nach dem Ziel abbremsen
    r.v = Math.max(0, r.v - 7 * dt); r.s = Math.min(LEN - 6, r.s + r.v * dt); r.th *= 1 - dt * 2; r.air = false; r.vy = 0; r.y = ground(r.s, r.x);
    return;
  }
  const s0 = r.s;
  const k = (r.tuck > 0.5 ? K_TUCK : K_STAND) * (r.ai ? 1 / r.skill : 1) * (1 - r.draft * 0.25);
  const kap = at(C.kap, r.s);
  const steer = STEER * (r.tuck > 0.5 ? 0.6 : 1) * (r.air ? 0.25 : 1) * clamp(r.v / 6, 0.4, 1);
  r.th += (r.lean * steer + kap * r.v * Math.cos(r.th)) * dt;
  r.th -= r.th * 0.15 * dt;
  r.th = clamp(r.th, -1.1, 1.1);
  const vs = r.v * Math.cos(r.th);
  r.s += vs * dt; r.x += r.v * Math.sin(r.th) * dt;
  // Anschieben am Start
  if (r.pushReq && now - r.pushReq < 0.3 && now - r.pushT > 0.35 && r.s < 30 && !r.air) { r.v = Math.min(r.v + 1.7, 10); r.pushT = now; r.pushReq = 0; r.pushAnim = 1; }
  const gN = ground(r.s, r.x);
  if (!r.air) {
    const gs = (ground(r.s + 0.5, r.x) - ground(r.s - 0.5, r.x));
    r.v += (-G * gs / Math.sqrt(1 + gs * gs) - k * r.v * r.v - MU * G - Math.abs(r.th) * 2.2 - Math.abs(r.lean) * 0.35) * dt;
    // Absprung: Boden fällt schneller weg als die Flugbahn, oder Sprung gedrückt
    const yB = r.y + r.vy * dt - 0.5 * G * dt * dt;
    const jump = now - r.jumpReq < 0.25;
    if (jump) { r.vy += 4.4; r.jumpReq = -9; r.air = true; r.airT = 0; r.y += r.vy * dt; r.jumped = true; }
    else if (yB > gN + 0.02 && r.v > 6) { r.air = true; r.airT = 0; r.vy -= G * dt; r.y = yB; r.jumped = false; }
    else { r.vy = (gN - r.y) / dt; r.y = gN; }
  } else {
    r.airT += dt;
    r.vy -= G * dt; r.y += r.vy * dt;
    r.v -= k * 0.6 * r.v * r.v * dt;
    if (r.y <= gN) {
      // Landung: Aufprall gegenüber dem Hang
      const gs = (ground(r.s + 0.5, r.x) - ground(r.s - 0.5, r.x));
      const impact = gs * r.v - r.vy;
      r.air = false; r.y = gN; r.vy = gs * r.v;
      if (r.airT > 0.35) {
        if (impact > 7.5) { r.v *= 0.82; r.hard = 1; event(r, 'Harte Landung!', 'bad'); }
        else if (r.airT > 0.6) event(r, r.jumped ? 'Big Air!' : 'Saubere Landung', 'good');
      }
    }
  }
  r.v = Math.max(0, r.v);
  // Bande
  const lim = HALF - 0.55;
  if (Math.abs(r.x) > lim) {
    r.x = Math.sign(r.x) * lim;
    if (Math.sign(r.th) === Math.sign(r.x)) r.th *= -0.35;
    if (now - r.fenceT > 0.6) { r.v *= 0.86; r.fenceT = now; event(r, 'Bande!', 'bad'); shakeFor(r, 0.5); audio.skid(1); }
  }
  // Ziel
  if (r.finished == null && r.s >= FINISH && s0 < FINISH) {
    const t = raceT - (r.s - FINISH) / Math.max(1, vs);
    r.finished = t;
    onFinish(r);
  }
}
function interactions(dt) {
  for (let a = 0; a < racers.length; a++) for (let b = a + 1; b < racers.length; b++) {
    const A = racers[a], B = racers[b];
    if (A.air || B.air) continue;
    const ds = B.s - A.s, dx = B.x - A.x;
    if (Math.abs(ds) < 1.4 && Math.abs(dx) < 0.95) {
      const push = (0.95 - Math.abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
      A.x -= push; B.x += push; A.th -= push * 0.6; B.th += push * 0.6;
      const back = ds > 0 ? A : B;
      if (now - back.bumpT > 0.5) { back.v *= 0.94; back.bumpT = now; event(back, 'Rempler!', 'bad'); shakeFor(back, 0.35); audio.bad(); }
    }
  }
  // Windschatten: knapp hinter jemandem
  for (const r of racers) {
    let d = 0;
    for (const o of racers) { if (o === r) continue; const ds = o.s - r.s; if (ds > 1.5 && ds < 9 && Math.abs(o.x - r.x) < 1.6) d = 1; }
    r.draft = lerp(r.draft, d, damp(3, dt));
  }
}
function event(r, text, kind) {
  if (!r.player) return;
  const p = r.player; if (!p.hud) return;
  const b = p.hud.banner; b.textContent = text; b.className = 'pbanner ' + (kind === 'bad' ? 'bang' : '') + ' quick';
  void b.offsetWidth; b.classList.add('pop');
  if (p.conn) sendPhone(p.conn, { t: kind === 'bad' ? 'bad' : 'hit' });
}

/* ---------- KI (auch Autopilot, wenn eine Person kurz nicht erkannt wird) ---------- */
function makeAI(r) {
  return { lane: rand(-4, 4), laneT: rand(2, 5), jumpPlan: Math.random() < 0.35 };
}
function drive(r, ai, dt, auto = false) {
  ai.laneT -= dt;
  if (ai.laneT <= 0) { ai.laneT = rand(2, 5); ai.lane = clamp(ai.lane + rand(-3.5, 3.5), -5.5, 5.5); }
  // Kurven innen anfahren
  const kapA = at(C.kap, r.s + 25);
  const target = clamp(ai.lane + kapA * -220, -5.8, 5.8) * (auto ? 0.4 : 1);
  const thD = clamp((target - r.x) * 0.1, -0.3, 0.3);
  const kap = at(C.kap, r.s);
  const steer = STEER * (r.tuck > 0.5 ? 0.6 : 1) * clamp(r.v / 6, 0.4, 1);
  r.lean = clamp(((thD - r.th) * 3 - kap * r.v) / steer, -1, 1);
  const straight = Math.abs(kap) < 0.004 && Math.abs(at(C.kap, r.s + 15)) < 0.006;
  r.tuck = lerp(r.tuck, !auto && straight && r.v > 9 ? 1 : 0, damp(4, dt));
  if (r.s < 28 && now - r.pushT > 0.45) r.pushReq = now;
  if (!auto && ai.jumpPlan) for (const kk of KICKERS) if (r.s > kk - 1.5 && r.s < kk) { r.jumpReq = now; ai.jumpPlan = Math.random() < 0.35; }
}

/* ================================================================
   Spieler an diesem TV
   ================================================================ */
const locals = [];
const NAMES = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lIx', 'rIx', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];
const pName = (p) => p.name || `P${p.slot + 1}`;
function freshName() { const used = new Set(locals.map((q) => q.name)); return FUN_NAMES.filter((n) => !used.has(n)).sort(() => Math.random() - 0.5)[0] || 'Ski-Ass'; }
const PRESET_FOR = [0, 3, 6, 1];
function createLocal(source, conn = null) {
  const used = new Set(locals.map((p) => p.slot));
  let slot = 0; while (used.has(slot)) slot++;
  if (slot >= MAX) return null;
  const p = {
    slot, id: newCode() + slot, source, conn, name: freshName(),
    cfg: slot === 0 ? loadConfig(CHAR_KEY) : sanitize({ ...PRESETS[PRESET_FOR[slot] % PRESETS.length].cfg, topColor: P_COLORS[slot] }),
    confirmed: source !== 'phone', ready: false, readyT: 0, upT: 0, lastAt: -1e9,
    lean: 0, tuck: 0, handsUp: false, y0: null, sw0: null, prevY: null, prevW: null, lastPoseT: 0, jumpAt: -9, pushAt: -9,
    keyMap: source === 'keys' ? (locals.some((q) => q.keyMap === 0) ? 1 : 0) : null,
    racer: null, hud: null, camera: new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1500), camLook: new THREE.Vector3(), camFresh: true, shake: 0,
  };
  p.hud = createHud(p);
  locals.push(p); locals.sort((a, b) => a.slot - b.slot);
  return p;
}
let fullAt = -1e9, lastJoinAt = -1e9;
function joinLocal(source, conn = null) {
  if (state === 'countdown' || state === 'race') { toast('Rennen läuft – du fährst beim nächsten mit'); return null; }
  if (locals.length >= MAX) { if (now - fullAt > 6) { fullAt = now; toast('Maximal 4 Personen'); } return null; }
  const p = createLocal(source, conn);
  if (!p) return null;
  audio.unlock(); audio.whoosh();
  toast(`${pName(p)} ist am Start!`);
  lastJoinAt = now; startAt = null;
  if (state === 'lobby' || state === 'results') setState('ready');
  assignRacers(); updateLayout();
  return p;
}
function leaveLocal(p) {
  const i = locals.indexOf(p); if (i < 0) return;
  locals.splice(i, 1);
  p.hud.root.remove();
  if (state === 'ready' || state === 'lobby' || state === 'results') { assignRacers(); if (!locals.length) setState('lobby'); }
  updateLayout();
}
const hasControl = (p) => p.source === 'keys' || now - p.lastAt < 1.0;

/* ---------- Pose: Lehnen, Hocke, Sprung, Anschieben ---------- */
function onPose(p, k, w = 640, h = 480) {
  if (!Array.isArray(k) || k.length < NAMES.length * 3) return;
  const P = {};
  NAMES.forEach((n, i) => (P[n] = { x: k[i * 3] * w, y: k[i * 3 + 1] * h, v: k[i * 3 + 2] }));
  const ok = (q, th = 0.3) => q && q.v >= th;
  if (!ok(P.lSh, 0.4) || !ok(P.rSh, 0.4)) return;
  const t = performance.now() / 1000, dtp = clamp(t - (p.lastPoseT || t - 0.033), 0.01, 0.2); p.lastPoseT = t;
  p.lastAt = now;
  const sw = Math.hypot(P.rSh.x - P.lSh.x, P.rSh.y - P.lSh.y) || 1;
  const M = { x: (P.lSh.x + P.rSh.x) / 2, y: (P.lSh.y + P.rSh.y) / 2 };
  p.cx = M.x / w;
  const hips = ok(P.lHip, 0.5) && ok(P.rHip, 0.5) ? { x: (P.lHip.x + P.rHip.x) / 2, y: (P.lHip.y + P.rHip.y) / 2 } : null;
  // Lehnen: Schultern gegenüber der Hüfte + Schulterlinie schräg (Bild gespiegelt: rechts = rechts)
  const tilt = (P.rSh.y - P.lSh.y) / sw;
  if (p.bx == null) p.bx = M.x;
  const off = hips ? (M.x - hips.x) / sw : (M.x - p.bx) / sw;
  if (!hips && Math.abs(off) < 0.2) p.bx = lerp(p.bx, M.x, 0.02);
  const raw = off * 1.25 + tilt * 0.9;
  p.lean = Math.abs(raw) < 0.07 ? 0 : clamp((Math.abs(raw) - 0.07) / 0.42, 0, 1) * Math.sign(raw);
  // Hocke: Schultern tiefer als im Stehen (Grundhöhe passt sich an, wenn man aufrecht steht)
  if (p.y0 == null) { p.y0 = M.y; p.sw0 = sw; }
  if (M.y < p.y0) p.y0 = lerp(p.y0, M.y, 0.25);                       // aufrechter als gedacht → sofort übernehmen
  const crouch = (M.y - p.y0) / p.sw0;
  if (crouch < 0.15 && Math.abs(p.lean) < 0.3) { p.y0 = lerp(p.y0, M.y, 0.01); p.sw0 = lerp(p.sw0, sw, 0.02); }
  p.tuck = clamp((crouch - 0.28) / 0.45, 0, 1);
  // Sprung: Schultern schnell nach oben
  if (p.prevY != null) {
    const vy = (M.y - p.prevY) / sw / dtp;
    if (vy < -3.2 && now - p.jumpAt > 0.8) { p.jumpAt = now; const r = p.racer; if (r) r.jumpReq = now; }
  }
  p.prevY = M.y;
  // Anschieben: beide Hände schnell nach unten
  if (ok(P.lWr) && ok(P.rWr)) {
    const W = { y: (P.lWr.y + P.rWr.y) / 2 };
    if (p.prevW != null) {
      const vw = (W.y - p.prevW) / sw / dtp;
      if (vw > 4.5 && now - p.pushAt > 0.35) { p.pushAt = now; if (p.racer) p.racer.pushReq = now; }
    }
    p.prevW = W.y;
    const nose = ok(P.nose, 0.4) ? P.nose.y : M.y - sw * 0.6;
    p.handsUp = P.lWr.y < nose - sw * 0.3 && P.rWr.y < nose - sw * 0.3;
  } else { p.prevW = null; p.handsUp = false; }
}

/* ================================================================
   Ablauf: Lobby → Startaufstellung → Countdown → Rennen → Resultate
   ================================================================ */
let state = 'lobby', stateT = 0, raceT = 0, startAt = null, finishAt = null;
function assignRacers() {
  // mehrere vor einer Kamera: links im Bild = linke Bahn
  const humans = [...locals].sort((a, b) => (a.cx != null && b.cx != null && a.conn && a.conn === b.conn ? a.cx - b.cx : a.slot - b.slot));
  const usedAi = new Set();
  racers.forEach((r, i) => {
    const p = humans[i] || null;
    if (r.player && r.player !== p) r.player.racer = null;
    r.player = p; r.ai = null;
    if (p) { p.racer = r; r.name = pName(p); r.cfg = p.cfg; r.ai = null; r.auto = makeAI(r); }
    else {
      if (!r.aiDef || usedAi.has(r.aiDef)) { const pool = AI_DEF.filter((d) => !usedAi.has(d) && !racers.some((o) => o !== r && o.aiDef === d)); r.aiDef = pool[Math.floor(Math.random() * pool.length)] || AI_DEF[i]; }
      usedAi.add(r.aiDef);
      r.name = r.aiDef.name; r.cfg = sanitize({ ...PRESETS[r.aiDef.preset % PRESETS.length].cfg }); r.ai = makeAI(r);
    }
    if (r.cfgKey !== JSON.stringify(r.cfg)) { r.cfgKey = JSON.stringify(r.cfg); r.av.setConfig(r.cfg); }
  });
}
function setState(s) {
  state = s; stateT = 0;
  document.body.className = document.body.className.replace(/\bst-\w+/g, '').trim() + ' st-' + s;
  $('lobby').classList.toggle('hide', s === 'countdown' || s === 'race' || s === 'results');
  $('results').classList.toggle('show', s === 'results');
  $('hud').classList.toggle('show', s === 'countdown' || s === 'race');
  if (s !== 'ready') setPrompt(false);
  if (s === 'ready') {
    for (const p of [...locals]) if (p.source === 'phone' && !p.conn) leaveLocal(p);
    for (const p of locals) { p.ready = false; p.readyT = 0; }
    if (!locals.length && !CAPTURE) { setState('lobby'); return; }
    assignRacers(); resetRacers(); startAt = null;
  }
  if (s === 'lobby') { assignRacers(); resetRacers(); }
  if (s === 'countdown') { assignRacers(); resetRacers(); raceT = 0; finishAt = null; for (const p of locals) p.camFresh = true; }
  if (s === 'race') { START.open = 0.001; audio.go(); banner('LOS!', true); audio.wind?.(true); }
  if (s === 'results') { showResults(); audio.wind?.(false); } else END.hide();
  phonesState();
  updateLayout();
}
function onFinish(r) {
  const placeNo = racers.filter((o) => o.finished != null).length;
  r.place = placeNo;
  if (r.player) {
    event(r, placeNo === 1 ? '🏆 Sieg!' : `${placeNo}. Platz`, 'good');
    audio.gold();
  }
  const humans = racers.filter((o) => o.player);
  if (humans.length && humans.every((o) => o.finished != null)) finishAt = now + 2.5;
  if (!humans.length && racers.every((o) => o.finished != null)) finishAt = now + 1.5;
}
function standings() {
  return [...racers].sort((a, b) => (a.finished != null && b.finished != null ? a.finished - b.finished : a.finished != null ? -1 : b.finished != null ? 1 : b.s - a.s));
}
function showResults() {
  audio.end();
  const list = standings();
  const best = list.find((r) => r.player);
  $('resultsTitle').textContent = list[0].player ? `🏆 ${list[0].name} gewinnt!` : best ? `${best.name}: Platz ${list.indexOf(best) + 1}` : 'Ziel!';
  $('podium').innerHTML = list.map((r, i) => `<div class="${r.player ? 'me' : ''}"><span class="place">${i + 1}.</span><span class="dot" style="--c:${P_COLORS[r.i]}"></span>${esc(r.name)}<span class="who">${r.player ? '' : 'KI'}</span><span class="t">${r.finished != null ? fmt(r.finished) : 'nicht im Ziel'}</span></div>`).join('');
  const nHum = racers.filter((r) => r.player).length;
  for (const r of racers) if (r.player) sendPhone(r.player.conn, { t: 'result', score: list.indexOf(r) + 1, game: 'skicross', id: r.player.conn && r.player.conn.__multi ? r.player.trackId : null, sec: Math.round(raceT), n: nHum, time: r.finished != null ? +r.finished.toFixed(1) : null, win: list.indexOf(r) === 0, tvacc: tvUid });
  saveStats(list);
  END.show({ againLabel: 'Neues Rennen', againHint: 'Beide Hände hoch' });
  // Münzen fürs Konto am TV (beste Person am TV zählt)
  const hum = racers.filter((r) => r.player);
  if (hum.length && !CAPTURE) {
    const place = Math.min(...hum.map((r) => list.indexOf(r) + 1));
    const t = Math.min(...hum.map((r) => r.finished ?? Infinity));
    reward(END.coins, { game: 'skicross', seconds: raceT, place, players: hum.length, finishTime: isFinite(t) ? t : null, won: place === 1 });
  }
}
// Zur Übersicht: Lobby mit QR-Code; Handy-Spieler drücken dort wieder «Bereit», neue Leute können dazukommen
function toMenu() {
  for (const p of locals) { if (p.source === 'phone') p.confirmed = false; p.ready = false; p.readyT = 0; }
  setState('ready');
  for (const c of new Set(locals.map((p) => p.conn).filter(Boolean))) syncPhone(c);
}
const END = endMenu({ again: () => setState('ready'), menu: () => toMenu() });
function saveStats(list) {
  try {
    const st = JSON.parse(localStorage.getItem('slope.stats')) || {};
    const humans = racers.filter((r) => r.player);
    if (!humans.length) return;
    const sec = Math.round(raceT) * humans.length;
    st.skicross = (st.skicross || 0) + sec;
    st.skiRaces = (st.skiRaces || 0) + 1;
    const day = new Date().toISOString().slice(0, 10);
    st.days = st.days || {}; st.days[day] = (st.days[day] || 0) + sec;
    const bestPlace = Math.min(...humans.map((r) => list.indexOf(r) + 1));
    if (bestPlace === 1) st.skiWins = (st.skiWins || 0) + 1;
    const bestTime = Math.min(...humans.map((r) => r.finished ?? Infinity));
    if (isFinite(bestTime)) st.skiBest = Math.min(st.skiBest || Infinity, bestTime);
    st.history = (st.history || []).concat([{ d: Date.now(), g: GAME, n: humans.length, names: humans.map((r) => r.name), place: bestPlace, t: Math.round(isFinite(bestTime) ? bestTime : raceT) }]).slice(-30);
    localStorage.setItem('slope.stats', JSON.stringify(st));
  } catch { /* privat */ }
}

/* ================================================================
   Anzeige: pro Person (Platz, Tempo, Lehnen/Hocke) + gemeinsam (Zeit, Fortschritt)
   ================================================================ */
const face = (cfg) => avatarSvg(sanitize(cfg), { body: false });
function createHud(p) {
  const el = document.createElement('div');
  el.className = 'phud';
  el.innerHTML = `
    <div class="ptop">
      <div class="ptag" style="--c:${P_COLORS[p.slot]}"><span class="pface"></span><span class="pname"></span></div>
      <div class="pstat"><div class="lbl">Platz</div><div class="num"><b class="ppos">–</b><small>/${RACERS}</small></div></div>
    </div>
    <div class="pspeed"><b>0</b><small>km/h</small></div>
    <div class="pmeter" aria-hidden="true">
      <div class="lean"><span class="l">◀</span><div class="track"><i class="dot"></i></div><span class="r">▶</span></div>
      <div class="chips"><span class="chip-tuck">Hocke</span><span class="chip-draft">Windschatten</span><span class="chip-air">Luft</span></div>
    </div>
    <div class="pauto"><b>Autopilot</b><span>Stell dich wieder vor die Kamera</span></div>
    <div class="pbanner"></div>`;
  $('phuds').appendChild(el);
  const q = (s) => el.querySelector(s);
  return { root: el, name: q('.pname'), face: q('.pface'), pos: q('.ppos'), speed: q('.pspeed b'), dot: q('.pmeter .dot'), tuck: q('.chip-tuck'), draft: q('.chip-draft'), air: q('.chip-air'), auto: q('.pauto'), banner: q('.pbanner'), key: '' };
}
let views = [];
function updateLayout() {
  const W = innerWidth, H = innerHeight, n = locals.length;
  const quads = [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
  views = n <= 1 ? [[0, 0, W, H]] : n === 2 ? [[0, 0, W / 2, H], [W / 2, 0, W / 2, H]] : quads.slice(0, n);
  document.body.classList.toggle('split', n > 1);
  document.body.classList.toggle('quad', n > 2);
  locals.forEach((p, i) => {
    const [x, y, w, h] = views[i];
    Object.assign(p.hud.root.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
    p.hud.root.style.setProperty('--u', Math.min(h / 100, w / 178) * (n > 1 ? 1.25 : 1) + 'px');
    p.camera.aspect = w / h; p.camera.updateProjectionMatrix();
  });
  const target = Math.min(devicePixelRatio || 1, n > 1 ? 1 : 1.5);
  if (target !== pixelRatio) { pixelRatio = target; renderer.setPixelRatio(pixelRatio); }
  renderer.setSize(W, H, false);
  demoCam.aspect = W / H; demoCam.updateProjectionMatrix();
}
addEventListener('resize', updateLayout);
function renderHud() {
  const playing = state === 'countdown' || state === 'race';
  const list = standings();
  for (const p of locals) {
    const h = p.hud, r = p.racer;
    h.root.classList.toggle('show', playing);
    const key = pName(p) + JSON.stringify(p.cfg);
    if (h.key !== key) { h.key = key; h.name.textContent = pName(p); h.face.innerHTML = face(p.cfg); }
    if (!r) continue;
    h.pos.textContent = list.indexOf(r) + 1;
    h.speed.textContent = Math.round(r.v * 3.6);
    h.dot.style.left = (50 + r.lean * 46) + '%';
    h.tuck.classList.toggle('on', r.tuck > 0.5);
    h.draft.classList.toggle('on', r.draft > 0.5);
    h.air.classList.toggle('on', r.air && r.airT > 0.2);
    h.auto.classList.toggle('show', state === 'race' && !hasControl(p) && r.finished == null);
  }
  $('time').textContent = fmt(raceT);
  // Fortschrittsbalken: Punkte für alle
  const dots = $('courseDots');
  if (dots.children.length !== racers.length) dots.innerHTML = racers.map((r) => `<i style="--c:${P_COLORS[r.i]}"></i>`).join('');
  racers.forEach((r, i) => { const el = dots.children[i]; el.style.left = clamp(r.s / FINISH, 0, 1) * 100 + '%'; el.classList.toggle('me', !!r.player); });
}
const RING = 2 * Math.PI * 42;
function setPrompt(show, text = '', sub = '', icon = '⛷️', fill = 0) {
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
const KEYTXT = ['← → lenken · ↓ Hocke · ↑ springen/anschieben', 'A D lenken · S Hocke · W springen/anschieben'];
function renderSlots() {
  const html = [0, 1, 2, 3].map((i) => {
    const p = locals.find((x) => x.slot === i);
    if (!p) return `<div class="slot empty${locals.length ? ' ai' : ''}"><span class="av">${locals.length ? '🤖' : ICON.plus}</span><b>${locals.length ? 'KI fährt' : 'P' + (i + 1)}</b><span class="st">${locals.length ? 'oder QR scannen' : 'QR scannen'}</span></div>`;
    const fill = p.ready ? 1 : clamp(p.readyT / 1.2, 0, 1);
    let st;
    if (p.ready) st = 'Bereit!';
    else if (p.source === 'keys') st = `Leertaste = bereit<br><small>${KEYTXT[p.keyMap] || ''}</small>`;
    else if (!p.confirmed) st = 'Am Handy einstellen<br>und «Bereit» drücken';
    else if (!hasControl(p)) st = 'Stell dich vor die Kamera';
    else st = 'In die Hocke gehen …';
    return `<div class="slot ${p.ready ? 'ready' : ''}"><span class="av" style="--c:${P_COLORS[i]}">${face(p.cfg)}<span class="src">${ICON[p.source] || ICON.phone}</span></span><b>${esc(pName(p))}</b><span class="bar"><i style="width:${fill * 100}%"></i></span><span class="st">${st}</span></div>`;
  }).join('');
  if (html !== renderSlots.last) { $('slots').innerHTML = html; renderSlots.last = html; }
}

/* ================================================================
   Tastatur
   ================================================================ */
const KEYMAP = [
  { l: 'arrowleft', r: 'arrowright', tuck: 'arrowdown', jump: 'arrowup' },
  { l: 'a', r: 'd', tuck: 's', jump: 'w' },
];
const held = new Set();
addEventListener('keydown', (e) => {
  audio.unlock(); updateSoundBtn();
  const k = e.key.toLowerCase();
  if (k.startsWith('arrow')) e.preventDefault();
  if (k === 'f') toggleFullscreen();
  if (k === 'm') { audio.setMuted(!audio.muted); updateSoundBtn(); }
  if (k === 't' && !e.repeat) addKeysPlayer();
  held.add(k);
  // Leertaste/Enter heisst «bereit» – nicht den zuletzt geklickten Button (z. B. «Tastatur») nochmals auslösen
  if ((k === ' ' || k === 'enter') && locals.some((p) => p.source === 'keys') && e.target && e.target.closest && e.target.closest('button, a')) { e.preventDefault(); e.target.blur(); }
  if (k === ' ' || k === 'enter') {
    if (state === 'ready') for (const p of locals) if (p.source === 'keys') { if (p.ready) p.startNow = true; p.ready = true; }
    if (state === 'results' && stateT > 2) setState('ready');
  }
  if (e.repeat) return;
  for (const p of locals) {
    if (p.source !== 'keys' || !p.racer) continue;
    if (k === KEYMAP[p.keyMap].jump) { if (p.racer.s < 28 && !p.racer.air) p.racer.pushReq = now; else p.racer.jumpReq = now; }
  }
});
addEventListener('keyup', (e) => held.delete(e.key.toLowerCase()));
function keysInput(dt) {
  for (const p of locals) {
    if (p.source !== 'keys') continue;
    const m = KEYMAP[p.keyMap];
    const t = (held.has(m.r) ? 1 : 0) - (held.has(m.l) ? 1 : 0);
    p.lean = lerp(p.lean, t, damp(8, dt));
    p.tuck = held.has(m.tuck) ? 1 : 0;
  }
}
function addKeysPlayer() {
  if (locals.filter((p) => p.source === 'keys').length >= 2) { toast('Höchstens 2 Tastatur-Spieler'); return; }
  const p = joinLocal('keys');
  if (p) toast(`${pName(p)}: ${KEYTXT[p.keyMap]} · Leertaste = bereit`, 6000);
}
$('keysBtn').addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); addKeysPlayer(); });

/* ================================================================
   Kamera dieses Geräts (Laptop) – bis zu 4 Personen
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
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: MAX, minPoseDetectionConfidence: 0.45, minPosePresenceConfidence: 0.35, minTrackingConfidence: 0.35 });
    let lm; try { lm = await PoseLandmarker.createFromOptions(vision, opts('GPU')); } catch { lm = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    camOn = true; btn.textContent = '✅ Kamera aktiv';
    const tracker = new MultiTracker(MAX);
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
            if (!p && (state === 'lobby' || state === 'ready' || state === 'results')) { p = joinLocal('cam'); if (p) { p.trackId = tr.id; camPlayers.set(tr.id, p); } }
            if (!p) continue;
            p.lostAt = 0;
            onPose(p, tracker.points(tr, ts), video.videoWidth, video.videoHeight);
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
   Handys
   ================================================================ */
let peer = null, code = '', retries = 0;
const peerOptions = () => netOptions(params);
function setStatus(kind, text) { $('status').className = 'status ' + kind; $('statusText').textContent = text; }
function updateStatus() { setStatus(peer && peer.open ? 'ok' : 'wait', locals.length ? `${locals.length} am Start` : peer && peer.open ? 'Warte auf Spieler …' : 'Verbinde …'); }
function startPeer() {
  if (!window.Peer) { setStatus('err', 'Verbindungsdienst nicht geladen'); return; }
  try { code = sessionStorage.getItem('skicross.code') || newCode(); } catch { code = newCode(); }
  setStatus('wait', 'Verbinde …');
  peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => { retries = 0; try { sessionStorage.setItem('skicross.code', code); } catch { /* */ } renderJoin(); updateStatus(); });
  peer.on('connection', (c) => { if (c.metadata && c.metadata.type === 'tv') { c.on('open', () => setTimeout(() => c.close(), 200)); return; } acceptPhone(c); });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); if (++retries > 2) { try { sessionStorage.removeItem('skicross.code'); } catch { /* */ } } setTimeout(startPeer, 1500); }
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
    sendPhone(c, { t: 'state', s: phoneState(), g: GAME });
    syncPhone(c);
  });
  c.on('data', (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'p') { const p = c.__ps.get(0); if (p && msg.k) { p.lostAt = 0; onPose(p, msg.k, msg.w, msg.h); } }
    else if (msg.t === 'mp') onMulti(c, msg);
    else if (msg.t === 'mode') setPhoneMode(c, msg.m === 'multi');
    else if (msg.t === 'char') { const p = !c.__multi && c.__ps.get(0); if (p) applyChar(p, { cfg: msg.c }); }
    else if (msg.t === 'setp') { const p = c.__ps.get(msg.id == null ? 0 : msg.id); if (p) applyChar(p, { cfg: msg.cfg, name: msg.name }); }
    else if (msg.t === 'ok') { const p = c.__ps.get(msg.id == null ? 0 : msg.id); if (p) { p.confirmed = !!msg.v; if (!p.confirmed) { p.ready = false; p.readyT = 0; } syncPhone(c); } }
    else if (msg.t === 'hello') sendPhone(c, { t: 'state', s: phoneState(), g: GAME });
    else if (msg.t === 'end' && state === 'results' && stateT > 1) END.phone(msg.a);
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
    const p = c.__ps.get(e.id) || ((state === 'lobby' || state === 'ready' || state === 'results') && locals.length < MAX ? addPhonePlayer(c, e.id) : null);
    if (!p) continue;
    p.lostAt = 0;
    onPose(p, e.k, msg.w, msg.h);
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
  if (state === 'lobby' || state === 'ready' || state === 'results') assignRacers();
  syncPhone(p.conn);
}
function syncPhone(c) {
  if (!c || !c.__ps) return;
  sendPhone(c, { t: 'ps', l: [...c.__ps.entries()].map(([id, p]) => ({ id: c.__multi ? id : null, name: pName(p), color: P_COLORS[p.slot], cfg: p.cfg, slot: p.slot, ok: p.confirmed ? 1 : 0, ready: p.ready ? 1 : 0, fill: +(p.ready ? 1 : clamp(p.readyT / 1.2, 0, 1)).toFixed(2) })) });
}
function sendPhone(c, msg) { if (c && c.open) { try { c.send(msg); } catch { /* */ } } }
const phoneState = () => (state === 'race' ? 'play' : state);
function phonesState() { for (const c of new Set(locals.map((p) => p.conn).filter(Boolean))) sendPhone(c, { t: 'state', s: phoneState(), g: GAME }); }
function dropLost() {
  if (state !== 'lobby' && state !== 'ready' && state !== 'results') return;
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
  u.searchParams.set('c', code); u.searchParams.set('g', GAME);
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
   Kameras
   ================================================================ */
const demoCam = new THREE.PerspectiveCamera(55, 16 / 9, 0.1, 1500);
const demoLook = new THREE.Vector3();
let demoFresh = true, capT = 0;
function racerDir(r) { const f = frame(r.s); const c = Math.cos(r.th), sn = Math.sin(r.th); return new THREE.Vector3(f.tx * c + f.rx * sn, 0, f.tz * c + f.rz * sn); }
// hinter der Person, etwas erhöht, Blick talwärts
function chaseCam(cam, r, look, dt, fresh, shakeAmt = 0) {
  const f = frame(r.s), pos = worldPos(r.s, r.x, r.y);
  const dir = new THREE.Vector3(f.tx, 0, f.tz).lerp(racerDir(r), 0.35).normalize();
  const want = pos.clone().addScaledVector(dir, -6.2).add(new THREE.Vector3(0, 2.7, 0));
  want.y = Math.max(want.y, ground(Math.max(0, r.s - 6), r.x) + 1.6);
  const aim = pos.clone().addScaledVector(dir, 7).add(new THREE.Vector3(0, 0.2, 0));
  aim.y = Math.min(aim.y, r.y + 0.6);
  if (fresh) { cam.position.copy(want); look.copy(aim); }
  cam.position.lerp(want, damp(6, dt)); look.lerp(aim, damp(8, dt));
  cam.position.x += (Math.random() - 0.5) * shakeAmt * 0.3; cam.position.y += (Math.random() - 0.5) * shakeAmt * 0.3;
  cam.lookAt(look);
  cam.fov = cam.aspect < 1.2 ? 70 : 58 + Math.min(10, r.v * 0.35); cam.updateProjectionMatrix();
}
function shakeFor(r, a) { if (r.player) r.player.shake = Math.max(r.player.shake, a); }
function updateDemoCam(dt) {
  if (CAPTURE) {
    capT += dt;
    const r = racers[1]; // Aufnahme: immer dieselbe Person verfolgen (ruhiges Bild)
    if (state === 'race' && START.open >= 1) { chaseCam(demoCam, r, demoLook, dt, demoFresh); demoFresh = false; return; }
  }
  if (state === 'ready' || state === 'countdown' || (state === 'race' && START.open < 1)) {
    // vor dem Startgatter, Blick bergauf auf die Fahrer:innen
    const f = frame(0), p0 = worldPos(9, 0, ground(9, 0) + 1.3);
    const sway = Math.sin(now * 0.4) * 2.5;
    const want = p0.clone().add(new THREE.Vector3(f.rx * sway, 0, f.rz * sway));
    const aim = worldPos(0, 0, ground(0, 0) + 1.4);
    if (demoFresh) { demoCam.position.copy(want); demoLook.copy(aim); demoFresh = false; }
    demoCam.position.lerp(want, damp(2, dt)); demoLook.lerp(aim, damp(3, dt));
    demoCam.lookAt(demoLook);
    return;
  }
  // Lobby: Flug über die Piste
  const s = (now * 14) % (LEN - 60) + 20;
  const f = frame(s);
  const want = worldPos(s, Math.sin(now * 0.2) * 5, ground(s, 0) + 9);
  const aim = worldPos(Math.min(LEN, s + 30), 0, ground(Math.min(LEN, s + 30), 0) + 1);
  if (demoFresh || demoCam.position.distanceTo(want) > 60) { demoCam.position.copy(want); demoLook.copy(aim); demoFresh = false; }
  demoCam.position.lerp(want, damp(2, dt)); demoLook.lerp(aim, damp(2, dt));
  demoCam.lookAt(demoLook);
  void f;
}

/* ================================================================
   Hauptschleife
   ================================================================ */
const clock = new THREE.Clock();
let hudT = 0, syncT = 0;
function tick() {
  const realDt = CAPTURE ? 1 / 30 : Math.min(clock.getDelta(), 0.1);
  update(realDt);
  draw(realDt);
  if (!CAPTURE) requestAnimationFrame(tick);
}
function update(realDt) {
  now += realDt; stateT += realDt;
  keysInput(realDt);
  dropLost();

  if (state === 'ready') {
    for (const p of locals) {
      if (p.ready || p.source === 'keys' || !p.confirmed) continue;
      p.readyT = p.tuck > 0.45 && hasControl(p) ? p.readyT + realDt : Math.max(0, p.readyT - realDt * 2);
      if (p.readyT >= 1.2) { p.ready = true; audio.tick(); syncPhone(p.conn); }
    }
    const allReady = locals.length > 0 && locals.every((p) => p.ready);
    if (allReady || CAPTURE) {
      if (startAt == null) startAt = Math.max(now + (CAPTURE ? 0.5 : locals.length >= 2 ? 3 : 4), lastJoinAt + 3);
      const left = locals.some((p) => p.startNow) ? 0 : Math.max(0, startAt - now);
      if (left <= 0) setState('countdown');
      else setPrompt(!CAPTURE, `Start in ${Math.ceil(left)} …`, locals.length < MAX ? 'Noch jemand? Jetzt QR-Code scannen' : 'Gleich geht’s los!', '⛷️', 1 - left / 4);
    } else { startAt = null; setPrompt(false); }
  } else if (state === 'countdown') {
    const n = 3 - Math.floor(stateT);
    if (n !== tick.lastN && n >= 1) { tick.lastN = n; banner(String(n)); audio.tick(); }
    if (stateT >= 3) { tick.lastN = null; setState('race'); }
  } else if (state === 'race') {
    raceT += realDt;
    if (START.open > 0 && START.open < 1) START.open = Math.min(1, START.open + realDt * 3);
    if (finishAt != null && now > finishAt) { if (CAPTURE) { setState('ready'); } else setState('results'); }
  } else if (state === 'results') {
    if (stateT > 2.5) for (const p of locals) {
      p.upT = p.handsUp && hasControl(p) ? (p.upT || 0) + realDt : 0;
      if (p.upT > 0.9) { p.upT = 0; setState('ready'); break; }
    }
    END.update(stateT, Math.max(0, ...locals.map((p) => (p.upT || 0) / 0.9)));
  }
  // Startgatter öffnen
  START.gates.forEach((g) => { g.rotation.x = lerp(g.rotation.x, state === 'race' ? -Math.PI / 2 : 0, damp(10, realDt)); });

  // Eingaben → Fahrer:innen
  for (const r of racers) {
    const p = r.player;
    if (p) {
      const ctl = hasControl(p);
      if (ctl) { r.lean = p.lean; r.tuck = lerp(r.tuck, p.tuck, damp(10, realDt)); }
      else if (state === 'race') drive(r, r.auto, realDt, true);
    } else if (r.ai && state === 'race') drive(r, r.ai, realDt);
    else if (!p) { r.lean = 0; r.tuck = lerp(r.tuck, state === 'countdown' || state === 'ready' ? 0.4 : 0, damp(3, realDt)); }
  }
  // Physik in kleinen Schritten
  const steps = Math.max(1, Math.ceil(realDt / (1 / 90)));
  for (let k = 0; k < steps; k++) { for (const r of racers) physics(r, realDt / steps); interactions(realDt / steps); }
  // Figuren
  for (const r of racers) {
    if (state !== 'race') { r.y = ground(r.s, r.x); }
    const pos = worldPos(r.s, r.x, r.y);
    r.av.root.position.copy(pos);
    const dir = racerDir(r);
    const gs = ground(r.s + 0.6, r.x) - ground(r.s - 0.6, r.x);
    const pitch = r.air ? lerp(r.av.root.rotation.x, -Math.atan(r.vy / Math.max(4, r.v)) * 0.6, damp(4, realDt)) : -Math.atan(gs / 1.2);
    r.av.root.rotation.set(pitch, Math.atan2(dir.x, dir.z), lerp(r.av.root.rotation.z, r.lean * 0.42 * (r.air ? 0.4 : 1) - at(C.bank, r.s) * 0.8, damp(10, realDt)));
    skiPose(r, realDt);
    r.av.update(realDt, now);
    r.av.root.position.copy(pos); // Avatar.update setzt y für den Hüpfer – hier wieder auf den Schnee
    placeGear(r);
    r.hard = Math.max(0, r.hard - realDt * 2);
  }
  // Zuschauer jubeln im Zielbereich
  CROWD.forEach((g, i) => { g.position.y += Math.sin(now * 8 + i) * 0.004 * (state === 'race' ? 1 : 0.2); });
  // Wind-Geräusch nach dem schnellsten Menschen
  const fastest = Math.max(0, ...locals.map((p) => (p.racer ? p.racer.v : 0)));
  audio.windSet?.(clamp(fastest / 24, 0, 1));

}
function draw(realDt) {
  // Schatten folgen der wichtigsten Person
  const focus = locals[0]?.racer || racers.reduce((a, b) => (b.s > a.s ? b : a));
  const fp = state === 'lobby' ? demoCam.position : worldPos(focus.s, focus.x, focus.y);
  sun.position.set(fp.x - 40, fp.y + 60, fp.z + 30); sun.target.position.copy(fp); sun.target.updateMatrixWorld();

  // Zeichnen
  const W = innerWidth, H = innerHeight;
  const chase = state === 'race' && START.open >= 0.2 && locals.length && !CAPTURE;
  if (!chase) {
    updateDemoCam(realDt);
    renderer.setViewport(0, 0, W, H); renderer.setScissor(0, 0, W, H);
    renderer.render(scene, demoCam);
  } else {
    locals.forEach((p, i) => {
      if (!p.racer) return;
      p.shake = Math.max(0, p.shake - realDt * 1.8);
      chaseCam(p.camera, p.racer, p.camLook, realDt, p.camFresh, p.shake); p.camFresh = false;
      const [x, y, w, h] = views[i] || [0, 0, W, H];
      renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h);
      renderer.render(scene, p.camera);
    });
  }

  hudT -= realDt;
  if (hudT <= 0) {
    hudT = 0.1;
    if (state === 'lobby' || state === 'ready' || state === 'results') {
      renderSlots();
      if ((syncT -= 0.1) <= 0) { syncT = 0.4; for (const c of new Set(locals.map((q) => q.conn).filter(Boolean))) syncPhone(c); }
    }
    renderHud();
    updateStatus();
  }
}

/* ================================================================
   Start
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
if (CAPTURE) setState('ready'); else startPeer();
if (params.has('keys')) addKeysPlayer();
tick();

// Test-Hilfe (Konsole)
window.__ski = {
  locals, racers, get state() { return state; }, get code() { return code; }, get raceT() { return raceT; },
  frame: () => tick(), sim: (sec, dt = 1 / 30) => { for (let t = 0; t < sec; t += dt) update(dt); }, setState, addKeysPlayer, onPose: (i, k, w, h) => locals[i] && onPose(locals[i], k, w, h),
  LEN, FINISH, KICKERS, ground, C,
};
