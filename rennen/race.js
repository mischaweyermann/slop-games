// Kurvenflitzer – Rennspiel in der Fahrerperspektive.
// Gelenkt wird mit einem unsichtbaren Lenkrad: Der Winkel zwischen deinen beiden Händen ist der Lenkeinschlag.
// Eingabe: Handy (PeerJS, gleiche Handy-Seite wie der Ballon-Platzer), Kamera dieses Geräts oder Tastatur.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAudio } from '../js/audio.js';
import { loadConfig, sanitize, saveConfig } from '../js/character.js';

/* ================================================================
   Grundlagen
   ================================================================ */
const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CHAR_KEY = 'ballonplatzer.character';
const LAPS = 3;
const HALF_W = 7;            // halbe Strassenbreite (m)
const GRASS = HALF_W + 1.4;  // ab hier Wiese (bremst)
const WALL = HALF_W + 8;     // Reifenstapel
const V_MAX = 34, V_BOOST = 45, V_GRASS = 15;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const fmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`; };
const params = new URLSearchParams(location.search);
const audio = createAudio();

/* ================================================================
   Renderer, Szene, Licht
   ================================================================ */
const renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#efe4d8', 110, 420);
const camera = new THREE.PerspectiveCamera(66, 16 / 9, 0.05, 900);
scene.add(camera);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.5;
scene.add(new THREE.HemisphereLight('#fff6ec', '#9cc58b', 1.25));
const sun = new THREE.DirectionalLight('#ffe7cc', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 160 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const SPH = new THREE.SphereGeometry(1, 28, 18);
const SPH_LO = new THREE.SphereGeometry(1, 16, 10);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 20);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
const mesh = (geo, m, parent, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], shadow = true) => {
  const o = new THREE.Mesh(geo, m); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r);
  o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
};

/* ================================================================
   Strecke: geschlossener Spline, abgetastet in N Punkte
   ================================================================ */
const CTRL = [[-40, 8], [-8, -35], [6, -105], [50, -152], [120, -162], [165, -125], [162, -68], [125, -30], [120, 20], [155, 65], [150, 122], [100, 162], [30, 170], [-35, 152], [-100, 152], [-150, 112], [-158, 58], [-112, 22]];
const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
const N = 1000;
const TRACK_LEN = curve.getLength();
const SEG = TRACK_LEN / N;
const T = []; // { p, t (Tangente), r (rechts), R (Kurvenradius), turn (+ rechts / − links) }
{
  const pts = curve.getSpacedPoints(N);
  for (let i = 0; i < N; i++) {
    const p = pts[i], nx = pts[(i + 1) % N], pv = pts[(i - 1 + N) % N];
    const t = new THREE.Vector3().subVectors(nx, pv).normalize();
    const r = new THREE.Vector3(-t.z, 0, t.x); // rechts von der Fahrtrichtung
    T.push({ p, t, r, R: 1e9, turn: 0 });
  }
  for (let i = 0; i < N; i++) {
    const a = T[(i - 6 + N) % N].t, b = T[(i + 6) % N].t;
    const ang = Math.atan2(a.x * b.z - a.z * b.x, a.x * b.x + a.z * b.z); // + = Rechtskurve
    T[i].R = (12 * SEG) / Math.max(Math.abs(ang), 1e-4);
    T[i].turn = Math.sign(ang);
  }
}
const sample = (s) => {
  const f = (((s / SEG) % N) + N) % N, i = Math.floor(f), k = f - i;
  const a = T[i], b = T[(i + 1) % N];
  return {
    p: new THREE.Vector3().lerpVectors(a.p, b.p, k),
    t: new THREE.Vector3().lerpVectors(a.t, b.t, k).normalize(),
    r: new THREE.Vector3().lerpVectors(a.r, b.r, k).normalize(),
    i,
  };
};
// Nächster Streckenpunkt (lokale Suche ab letztem Index)
function nearest(pos, hint) {
  let best = hint, bd = Infinity;
  for (let o = -30; o <= 30; o++) {
    const i = (hint + o + N) % N;
    const d = (T[i].p.x - pos.x) ** 2 + (T[i].p.z - pos.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function nearestGlobal(pos) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i += 4) { const d = (T[i].p.x - pos.x) ** 2 + (T[i].p.z - pos.z) ** 2; if (d < bd) { bd = d; best = i; } }
  return nearest(pos, best);
}
const lateral = (pos, i) => (pos.x - T[i].p.x) * T[i].r.x + (pos.z - T[i].p.z) * T[i].r.z;

/* ---------- Strassen-Mesh ---------- */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const roadTex = canvasTex(128, 512, (g, w, h) => {
  g.fillStyle = '#a49cb0'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '60,40,90'},0.05)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  g.fillStyle = '#fbf7f0'; g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
  g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
});
const curbTex = canvasTex(32, 64, (g, w, h) => {
  g.fillStyle = '#e8574f'; g.fillRect(0, 0, w, h / 2);
  g.fillStyle = '#fbf7f0'; g.fillRect(0, h / 2, w, h / 2);
});

function ribbon(off0, off1, y, vScale, texture, color = '#ffffff') {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const s = T[i % N];
    for (const [k, off] of [[0, off0], [1, off1]]) {
      pos.push(s.p.x + s.r.x * off, y, s.p.z + s.r.z * off);
      uv.push(k, (i * SEG) / vScale);
    }
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture, color, roughness: 0.95 }));
  m.receiveShadow = true; scene.add(m);
  return m;
}
ribbon(-HALF_W, HALF_W, 0.03, 14, roadTex);
ribbon(-HALF_W - 1.3, -HALF_W, 0.04, 4, curbTex);
ribbon(HALF_W, HALF_W + 1.3, 0.04, 4, curbTex);

// Wiese, Sand-Saum, Hügel, Himmel
{
  const ground = mesh(new THREE.CircleGeometry(800, 64), mat('#a9cf98', { roughness: 1 }), scene, [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
  ground.receiveShadow = true;
  ribbon(-HALF_W - 4, -HALF_W - 1.3, 0.015, 10, null, '#c4e0b0');
  ribbon(HALF_W + 1.3, HALF_W + 4, 0.015, 10, null, '#c4e0b0');
  const hillMats = ['#9cc68b', '#accf9a', '#bcd9a9', '#93bd84'].map((c) => mat(c, { roughness: 1 }));
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + rand(-0.1, 0.1), d = rand(330, 430), r = rand(50, 110);
    mesh(SPH, pick(hillMats), scene, [Math.cos(a) * d, -r * 0.15, Math.sin(a) * d], [r, r * rand(0.3, 0.5), r], [0, 0, 0], false);
  }
  scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(600, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
      uniforms: { top: { value: new THREE.Color('#8fc0d3') }, mid: { value: new THREE.Color('#cfe2df') }, bottom: { value: new THREE.Color('#f4e4d2') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = vP.y; vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.15, 0.6, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        }`,
    }),
  ));
  const cloudMat = mat('#ffffff', { roughness: 1, emissive: '#fff4ea', emissiveIntensity: 0.35 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    [[0, 0, 1], [1.1, -0.2, 0.75], [-1.1, -0.25, 0.72], [0.45, 0.5, 0.7], [-0.4, 0.4, 0.65]].forEach(([x, y, r]) => mesh(SPH_LO, cloudMat, g, [x, y, 0], [r, r * 0.85, r * 0.8], [0, 0, 0], false));
    const a = rand(0, Math.PI * 2), d = rand(250, 420);
    g.position.set(Math.cos(a) * d, rand(60, 110), Math.sin(a) * d); g.scale.setScalar(rand(10, 18)); g.lookAt(0, g.position.y, 0);
    scene.add(g);
  }
}

// Start/Ziel: Zielstreifen + Torbogen
{
  const s = T[0];
  const checker = canvasTex(256, 32, (g, w, h) => {
    for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#3f325e' : '#fbf7f0'; g.fillRect(x * 16, y * 16, 16, 16); }
  }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.8), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.9 }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.atan2(s.t.x, -s.t.z);
  line.position.set(s.p.x, 0.05, s.p.z); line.receiveShadow = true; scene.add(line);

  const arch = new THREE.Group();
  const pillarMat = mat('#fbf7f0', { roughness: 0.6 });
  for (const side of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.55, 0.65, 7, 20), pillarMat, arch, [side * (HALF_W + 2.2), 3.5, 0]);
    mesh(SPH, mat('#e8574f', { roughness: 0.4 }), arch, [side * (HALF_W + 2.2), 7.4, 0], [0.8, 0.8, 0.8]);
  }
  const bannerTex = canvasTex(1024, 160, (g, w, h) => {
    g.fillStyle = '#e8574f'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += 40) { g.fillStyle = (x / 40) % 2 ? '#3f325e' : '#fbf7f0'; g.fillRect(x, 0, 40, 20); g.fillStyle = (x / 40) % 2 ? '#fbf7f0' : '#3f325e'; g.fillRect(x, h - 20, 40, 20); }
    g.fillStyle = '#fbf7f0'; g.font = '700 92px Fredoka, Nunito, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('KURVENFLITZER', w / 2, h / 2 + 4);
  }, false);
  const banner = mesh(new THREE.BoxGeometry((HALF_W + 2.2) * 2 + 1.2, 1.9, 0.4), [mat('#e8574f'), mat('#e8574f'), mat('#e8574f'), mat('#e8574f'), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 })], arch, [0, 6.4, 0]);
  banner.castShadow = true;
  arch.position.set(s.p.x, 0, s.p.z);
  arch.rotation.y = Math.atan2(s.t.x, s.t.z);
  scene.add(arch);

  // Ballone am Start (Gruss vom Ballon-Platzer)
  const cols = ['#e8574f', '#f39a4c', '#f2c94c', '#5aa9c9', '#9b7fd1', '#7fb069', '#f3a6b8'];
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1;
    const b = mesh(SPH, new THREE.MeshPhysicalMaterial({ color: pick(cols), roughness: 0.3, clearcoat: 0.7 }), arch,
      [side * (HALF_W + rand(3.5, 6)), rand(5, 9), rand(-3, 3)], [0.6, 0.72, 0.6]);
    b.userData.float = rand(0, 6);
  }
}

// Bäume, Pilze, Reifenstapel – Abstand zur Strecke prüfen
function farFromTrack(x, z, min) {
  for (let i = 0; i < N; i += 5) if ((T[i].p.x - x) ** 2 + (T[i].p.z - z) ** 2 < min * min) return false;
  return true;
}
{
  const trunks = [], tops = [], cones = [];
  let tries = 0;
  while (trunks.length < 170 && tries++ < 4000) {
    const x = rand(-260, 280), z = rand(-260, 260);
    if (!farFromTrack(x, z, WALL + 6)) continue;
    const s = rand(1.6, 3.2);
    trunks.push([x, z, s]);
    (Math.random() < 0.65 ? tops : cones).push([x, z, s]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
  const inst = (geo, material, list, fn, colors) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((it, i) => { fn(it, m4); im.setMatrixAt(i, m4); if (colors) im.setColorAt(i, col.set(pick(colors))); });
    im.castShadow = true; im.receiveShadow = true; scene.add(im);
  };
  inst(new THREE.CylinderGeometry(0.11, 0.16, 1.2, 10), mat('#a87b57', { roughness: 0.7 }), trunks,
    ([x, z, s], m) => m.compose(new THREE.Vector3(x, 0.6 * s, z), q, new THREE.Vector3(s, s, s)));
  inst(SPH, mat('#ffffff', { roughness: 0.7 }), tops,
    ([x, z, s], m) => m.compose(new THREE.Vector3(x, 1.65 * s, z), q, new THREE.Vector3(0.85 * s, 0.92 * s, 0.85 * s)),
    ['#7fb069', '#93c27a', '#e9a46b', '#f0c75e', '#8fbf7a', '#c98a6b']);
  inst(new THREE.ConeGeometry(0.7, 1.9, 18), mat('#ffffff', { roughness: 0.7 }), cones,
    ([x, z, s], m) => m.compose(new THREE.Vector3(x, 2.0 * s, z), q, new THREE.Vector3(s, s, s)),
    ['#7fb069', '#93c27a', '#f0c75e', '#e9a46b']);

  // Reifenstapel aussen in Kurven
  const tires = [];
  for (let i = 0; i < N; i += 3) {
    const s = T[i];
    if (s.R > 70) continue;
    const off = -s.turn * (WALL + 0.6); // Kurvenaussenseite
    const x = s.p.x + s.r.x * off, z = s.p.z + s.r.z * off;
    for (let h = 0; h < 2; h++) tires.push([x, z, h, (i / 3) % 2]);
  }
  const tireGeo = new THREE.TorusGeometry(0.42, 0.22, 10, 20); tireGeo.rotateX(Math.PI / 2);
  const tim = new THREE.InstancedMesh(tireGeo, mat('#ffffff', { roughness: 0.6 }), tires.length);
  tires.forEach(([x, z, h, c], i) => {
    m4.compose(new THREE.Vector3(x, 0.22 + h * 0.42, z), q, new THREE.Vector3(1, 1, 1)); tim.setMatrixAt(i, m4);
    tim.setColorAt(i, col.set(h ? (c ? '#e8574f' : '#fbf7f0') : '#5d4f7c'));
  });
  tim.castShadow = true; scene.add(tim);

  // Pilze
  for (let n = 0, t = 0; n < 40 && t < 800; t++) {
    const i = Math.floor(rand(0, N)), side = Math.random() < 0.5 ? -1 : 1;
    const s = T[i], off = side * rand(GRASS + 3, WALL - 1.5);
    const x = s.p.x + s.r.x * off, z = s.p.z + s.r.z * off;
    if (!farFromTrack(x, z, GRASS + 2)) continue;
    const g = new THREE.Group(); const k = rand(1.2, 2.2);
    mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 12), mat('#f6ecdc'), g, [0, 0.15, 0]);
    mesh(new THREE.SphereGeometry(0.26, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e8574f', { roughness: 0.45 }), g, [0, 0.27, 0], [1, 0.75, 1]);
    g.position.set(x, 0, z); g.scale.setScalar(k); scene.add(g); n++;
  }
}

/* ================================================================
   Autos: kleine Go-Karts mit Chibi-Fahrern
   ================================================================ */
const SKINS = ['#ffdcc6', '#f6c6a4', '#e3a97f', '#c08158', '#8d5b3d'];
function makeKart(color, helmet, skin = pick(SKINS)) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.45, metalness: 0.05 });
  const dark = mat('#3b3b45', { roughness: 0.6 });
  mesh(SPH, body, g, [0, 0.55, 0], [1.05, 0.36, 2.05]);
  mesh(SPH, body, g, [0, 0.62, 1.55], [0.75, 0.26, 0.7]);
  mesh(new THREE.BoxGeometry(1.7, 0.1, 0.45), body, g, [0, 0.92, -1.9]);
  for (const sx of [-0.55, 0.55]) mesh(new THREE.BoxGeometry(0.08, 0.3, 0.3), dark, g, [sx, 0.76, -1.9]);
  const wheels = [];
  for (const [x, z] of [[-1.05, 1.25], [1.05, 1.25], [-1.1, -1.25], [1.1, -1.25]]) {
    const w = new THREE.Group(); w.position.set(x, 0.42, z); g.add(w);
    mesh(CYL, dark, w, [0, 0, 0], [0.42, 0.36, 0.42], [0, 0, Math.PI / 2]);
    mesh(CYL, mat('#fbf7f0', { roughness: 0.5 }), w, [Math.sign(x) * 0.19, 0, 0], [0.18, 0.02, 0.18], [0, 0, Math.PI / 2]);
    wheels.push(w);
  }
  // Fahrer: grosser Chibi-Kopf mit Helm
  const head = new THREE.Group(); head.position.set(0, 1.45, -0.35); g.add(head);
  mesh(SPH, mat(skin, { roughness: 0.55 }), head, [0, 0, 0], [0.5, 0.47, 0.46]);
  mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, 1.45), mat(helmet, { roughness: 0.3 }), head, [0, 0.03, -0.02], [0.56, 0.54, 0.53], [-0.35, 0, 0]);
  mesh(new THREE.BoxGeometry(0.62, 0.08, 0.05), mat('#fbf7f0', { roughness: 0.4 }), head, [0, 0.42, 0.18], [1, 1, 1], [-0.5, 0, 0]);
  mesh(SPH, mat(color), g, [0, 0.98, -0.45], [0.45, 0.4, 0.35]);
  g.userData.wheels = wheels;
  scene.add(g);
  return g;
}

/* ================================================================
   Cockpit (Ich-Perspektive): Haube, Armaturen, Lenkrad, Hände
   ================================================================ */
const cockpit = new THREE.Group();
camera.add(cockpit);
const ck = {
  body: mat('#e8574f', { roughness: 0.45 }),
  skin: mat('#ffdcc6', { roughness: 0.55 }),
  sleeve: mat('#e8574f', { roughness: 0.8 }),
  dark: mat('#3f325e', { roughness: 0.55 }),
};
{
  const c = cockpit;
  // Haube vorne (sichtbar unten im Bild) + Seitenkästen
  mesh(SPH, ck.body, c, [0, -1.2, -2.4], [0.95, 0.42, 1.9], [0, 0, 0], false);
  mesh(SPH, ck.body, c, [0, -1.02, -3.9], [0.55, 0.2, 0.5], [0, 0, 0], false);
  for (const sx of [-1, 1]) mesh(SPH, ck.body, c, [sx * 1.0, -1.12, -0.9], [0.36, 0.3, 1.2], [0, 0, 0], false);
  ck.wheels = [];
  // Armaturenbrett
  mesh(SPH, ck.dark, c, [0, -0.62, -1.15], [0.55, 0.14, 0.22], [0, 0, 0], false);
  mesh(CYL, ck.dark, c, [0, -0.5, -1.0], [0.03, 0.3, 0.03], [-1.1, 0, 0], false); // Lenksäule
  // Lenkrad
  ck.wheel = new THREE.Group(); ck.wheel.position.set(0, -0.36, -0.85); ck.wheel.rotation.x = -0.45; ck.wheel.scale.setScalar(0.72); c.add(ck.wheel);
  const rimMat = mat('#3f325e', { roughness: 0.4 });
  mesh(new THREE.TorusGeometry(0.21, 0.03, 14, 48), rimMat, ck.wheel, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
  for (const a of [Math.PI / 2 + 0.05, -Math.PI / 2 - 0.05, Math.PI]) {
    const spoke = mesh(CYL, rimMat, ck.wheel, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], [0.018, 0.2, 0.012], [0, 0, a + Math.PI / 2], false);
    spoke.rotation.z = a - Math.PI / 2;
  }
  mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 24), mat('#e8574f', { roughness: 0.35 }), ck.wheel, [0, 0, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0], false);
  mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), mat('#fbf7f0'), ck.wheel, [0, 0.21, 0.03], [1, 1, 1], [0, 0, 0], false); // Markierung oben
  // Griffpunkte (10 und 2 Uhr) – hier sitzen die Hände
  ck.grips = [-1, 1].map((sx) => {
    const o = new THREE.Object3D(); const a = Math.PI / 2 + sx * -1.05;
    o.position.set(Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0.02); ck.wheel.add(o); return o;
  });
  // Hände + Ärmel
  ck.hands = [-1, 1].map((sx) => ({
    sx,
    fist: mesh(SPH, ck.skin, c, [0, 0, 0], [0.047, 0.043, 0.05], [0, 0, 0], false),
    thumb: mesh(SPH_LO, ck.skin, c, [0, 0, 0], [0.019, 0.019, 0.026], [0, 0, 0], false),
    sleeve: mesh(CYL, ck.sleeve, c, [0, 0, 0], [0.05, 1, 0.05], [0, 0, 0], false),
    cuff: mesh(CYL, ck.sleeve, c, [0, 0, 0], [0.05, 0.045, 0.05], [0, 0, 0], false),
    pos: new THREE.Vector3(sx * 0.35, -0.9, -0.35),
  }));
}
function setCockpitColors(cfg) {
  ck.skin.color.set(cfg.skin);
  ck.sleeve.color.set(cfg.topColor);
  ck.body.color.set(cfg.topColor === '#f4efe6' || cfg.topColor === '#3b3b45' ? '#e8574f' : cfg.topColor);
}
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function updateCockpit(dt, steerShown, grip) {
  ck.wheel.rotation.z = -steerShown * 1.35;
  for (const w of ck.wheels) w.rotation.y = -steerShown * 0.45;
  for (const h of ck.hands) {
    const target = h.sx < 0 ? ck.grips[0] : ck.grips[1];
    target.getWorldPosition(_v); cockpit.worldToLocal(_v);
    const rest = _w.set(h.sx * 0.33, -0.86, -0.42);
    const want = rest.lerp(_v, grip);
    h.pos.lerp(want, damp(18, dt));
    h.fist.position.copy(h.pos);
    h.thumb.position.copy(h.pos).add(_w.set(-h.sx * 0.026, 0.03, 0.018));
    // Ärmel vom (unsichtbaren) Ellbogen zur Hand
    // Ellbogen tief unten, damit der Arm von unten kommt und die Hand nie verdeckt
    const elbow = _w.set(h.sx * 0.34, -1.2, -0.5);
    const d = new THREE.Vector3().subVectors(h.pos, elbow);
    const len = d.length();
    h.sleeve.position.copy(elbow).addScaledVector(d, 0.38);
    h.sleeve.quaternion.setFromUnitVectors(_up, d.clone().normalize());
    h.sleeve.scale.set(0.046, len * 0.76, 0.046);
    h.cuff.position.copy(elbow).addScaledVector(d, 0.76);
    h.cuff.quaternion.copy(h.sleeve.quaternion);
  }
}

/* ================================================================
   Spieler, Gegner, Münzen
   ================================================================ */
const AI_DEF = [
  { color: '#5aa9c9', helmet: '#fbf7f0', vmax: 33.2, lane: -2.6, name: 'Blitz' },
  { color: '#f2c94c', helmet: '#3f325e', vmax: 32.4, lane: 2.6, name: 'Sunny' },
  { color: '#9b7fd1', helmet: '#f3a6b8', vmax: 31.6, lane: -2.6, name: 'Lila' },
];
const ai = AI_DEF.map((d) => ({ ...d, kart: makeKart(d.color, d.helmet), s: 0, v: 0, off: d.lane, offT: d.lane, laneT: 0, finished: null }));
const player = {
  pos: new THREE.Vector3(), heading: 0, v: 0, idx: 0, lap: 0, steer: 0, boost: 0, boostT: 0, coins: 0,
  laps: [], lapStart: 0, finished: null, bumpCd: 0, wallCd: 0, offroad: false, name: 'Du',
};
let raceT = 0;

const coinGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.16, 28); coinGeo.rotateX(Math.PI / 2);
const coinMat = new THREE.MeshPhysicalMaterial({ color: '#f2c94c', metalness: 0.85, roughness: 0.25, clearcoat: 1, emissive: '#8a5a00', emissiveIntensity: 0.25 });
const coins = [];
for (let s = 70; s < TRACK_LEN - 30; s += 42) {
  const off = Math.sin(s * 0.013) * 4.2;
  for (let k = 0; k < 3; k++) {
    const sp = sample(s + k * 4.5);
    const m = mesh(coinGeo, coinMat, scene, [0, 0, 0]);
    m.position.copy(sp.p).addScaledVector(sp.r, off); m.position.y = 1.1;
    coins.push({ m, taken: false, base: m.position.clone() });
  }
}
function resetCoins() { for (const c of coins) { c.taken = false; c.m.visible = true; } }

function gridPos(slot) { // slot 0 = vorne
  const s = TRACK_LEN - 9 - slot * 8;
  return { s, lane: slot % 2 ? 2.6 : -2.6 };
}
function resetRace() {
  raceT = 0;
  ai.forEach((a, i) => { const g = gridPos(i); a.s = g.s; a.off = a.offT = g.lane; a.v = 0; a.finished = null; a.lapsDone = 0; });
  const g = gridPos(3), sp = sample(g.s);
  player.pos.copy(sp.p).addScaledVector(sp.r, g.lane);
  player.heading = Math.atan2(sp.t.x, sp.t.z);
  player.v = 0; player.idx = nearestGlobal(player.pos); player.lap = 0; player.steer = 0;
  player.boost = 0; player.boostT = 0; player.coins = 0; player.laps = []; player.lapStart = 0; player.finished = null;
  prevIdx = player.idx;
  resetCoins();
  placeAI(0);
}

function placeAI(dt, racing = false, demo = false) {
  for (const a of ai) {
    if (racing || demo) {
      const i = Math.floor((((a.s / SEG) % N) + N) % N);
      // Vor Kurven abbremsen (Blick 40 m voraus)
      let R = 1e9; for (let k = 0; k < 40; k += 4) R = Math.min(R, T[(i + Math.round(k / SEG)) % N].R);
      let target = Math.min(a.vmax, Math.sqrt(30 * R));
      if (racing && !demo) {
        // Leichtes Gummiband, damit es spannend bleibt
        const gap = playerProgress() - progress(a);
        target *= clamp(1 + gap / 500, 0.9, 1.08);
        if (a.finished != null) target = 18;
      }
      if (demo) target *= 0.8;
      a.v += (target - a.v) * (a.v < target ? 0.45 : 1.6) * dt;
      a.s += a.v * dt;
      a.laneT -= dt;
      if (a.laneT <= 0) { a.laneT = rand(2, 5); a.offT = clamp(a.offT + rand(-2.5, 2.5), -4.2, 4.2); }
      a.off += (a.offT - a.off) * damp(0.8, dt);
    }
    const sp = sample(a.s);
    a.kart.position.copy(sp.p).addScaledVector(sp.r, a.off);
    a.kart.rotation.y = Math.atan2(sp.t.x, sp.t.z);
    for (const w of a.kart.userData.wheels) w.rotation.x += a.v * dt / 0.42;
  }
}
// Fortschritt in Metern ab Startlinie (Startaufstellung liegt knapp davor -> leicht negativ)
const progress = (a) => a.s - TRACK_LEN;
const playerProgress = () => (player.lap - 1) * TRACK_LEN + player.idx * SEG;

/* ================================================================
   Eingabe: Lenkwinkel aus den Händen
   ================================================================ */
const NAMES = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lIx', 'rIx', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];
const input = { steer: 0, onWheel: false, handsUp: false, lastAt: -1e9, source: null, keys: { l: false, r: false } };
let now = 0;

function onPose(k, w = 640, h = 480) {
  if (!Array.isArray(k) || k.length < NAMES.length * 3) return;
  const P = {};
  NAMES.forEach((n, i) => (P[n] = { x: k[i * 3] * w, y: k[i * 3 + 1] * h, v: k[i * 3 + 2] }));
  const ok = (p, th = 0.3) => p.v >= th;
  if (!ok(P.lSh, 0.4) || !ok(P.rSh, 0.4)) return;
  input.lastAt = now;
  const sw = Math.hypot(P.rSh.x - P.lSh.x, P.rSh.y - P.lSh.y);
  const handOf = (s) => {
    const W = P[s + 'Wr'], I = P[s + 'Ix'];
    if (!ok(W)) return null;
    return ok(I) ? { x: W.x + (I.x - W.x) * 0.5, y: W.y + (I.y - W.y) * 0.5 } : { x: W.x, y: W.y };
  };
  const L = handOf('l'), R = handOf('r');
  const headY = ok(P.nose, 0.4) ? P.nose.y : (P.lSh.y + P.rSh.y) / 2 - sw * 0.6;
  input.handsUp = !!(L && R && L.y < headY - sw * 0.15 && R.y < headY - sw * 0.15);
  if (!L || !R) { input.onWheel = false; return; }
  const dx = R.x - L.x, dy = R.y - L.y, dist = Math.hypot(dx, dy);
  // Am Lenkrad = Hände ungefähr eine Schulterbreite auseinander, nicht über dem Kopf
  input.onWheel = dist > sw * 0.35 && dist < sw * 3.2 && !input.handsUp;
  if (!input.onWheel) return;
  // Rechte Hand tiefer als linke = Lenkrad im Uhrzeigersinn = rechts
  let ang = Math.atan2(dy, dx);
  if (Math.abs(ang) < 0.05) ang = 0; else ang -= Math.sign(ang) * 0.05;
  input.steer = clamp(ang / 1.0, -1, 1);
}
const hasControl = () => input.source === 'keys' || now - input.lastAt < 0.6;

addEventListener('keydown', (e) => {
  audio.unlock(); updateSoundBtn();
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') input.keys.l = true;
  if (k === 'arrowright' || k === 'd') input.keys.r = true;
  if (k === 'f') toggleFullscreen();
  if (k === 'm') { audio.setMuted(!audio.muted); updateSoundBtn(); }
  if (k === 'k' && !e.repeat) useKeys();
  if ((k === ' ' || k === 'enter') && input.source === 'keys') {
    if (state === 'ready') setState('countdown');
    else if (state === 'results' && stateT > 2) { resetRace(); setState('countdown'); }
  }
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'arrowleft' || k === 'a') input.keys.l = false;
  if (k === 'arrowright' || k === 'd') input.keys.r = false;
});
function useKeys() { input.source = 'keys'; audio.unlock(); updateSoundBtn(); setStatus('ok', 'Tastatur: ← → lenken, Leertaste startet'); if (state === 'lobby') setState('ready'); }
$('keysBtn').addEventListener('click', (e) => { e.stopPropagation(); useKeys(); });

/* ================================================================
   Kamera dieses Geräts (Laptop-Webcam) – MediaPipe direkt hier
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
async function useLocalCamera() {
  const btn = $('camBtn');
  if (!window.isSecureContext) { setStatus('err', 'Kamera braucht https://'); return; }
  btn.disabled = true; btn.textContent = '⏳ Kamera startet …';
  audio.unlock(); updateSoundBtn();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const video = $('localVideo'); video.srcObject = stream; await video.play().catch(() => {});
    $('camPip').hidden = false;
    btn.textContent = '⏳ KI wird geladen …';
    const { FilesetResolver, PoseLandmarker } = await import(VISION);
    const vision = await FilesetResolver.forVisionTasks(WASM);
    const opts = (delegate) => ({ baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5 });
    let lm; try { lm = await PoseLandmarker.createFromOptions(vision, opts('GPU')); } catch { lm = await PoseLandmarker.createFromOptions(vision, opts('CPU')); }
    input.source = 'local';
    btn.textContent = '✅ Kamera aktiv';
    setStatus('ok', 'Kamera dieses Geräts aktiv');
    if (state === 'lobby') setState('ready');
    const filters = IDX.map(() => [new OneEuro(), new OneEuro()]);
    const ov = $('localOverlay'), g = ov.getContext('2d');
    let last = -1;
    const loop = () => {
      if (video.readyState >= 2) {
        const ts = performance.now();
        if (ts > last) {
          last = ts;
          const res = lm.detectForVideo(video, ts);
          const l = res.landmarks && res.landmarks[0];
          ov.width = video.videoWidth; ov.height = video.videoHeight; g.clearRect(0, 0, ov.width, ov.height);
          if (l) {
            const k = [];
            IDX.forEach((i, n) => { k.push(1 - filters[n][0].filter(l[i].x, ts), filters[n][1].filter(l[i].y, ts), l[i].visibility ?? 1); });
            onPose(k, video.videoWidth, video.videoHeight);
            g.fillStyle = '#ff8fa3';
            for (const i of [15, 16]) if (l[i].visibility > 0.3) { g.beginPath(); g.arc(l[i].x * ov.width, l[i].y * ov.height, ov.width / 28, 0, 7); g.fill(); }
            if (l[15].visibility > 0.3 && l[16].visibility > 0.3) {
              g.strokeStyle = '#fff'; g.lineWidth = ov.width / 70; g.beginPath();
              g.moveTo(l[15].x * ov.width, l[15].y * ov.height); g.lineTo(l[16].x * ov.width, l[16].y * ov.height); g.stroke();
            }
          }
        }
      }
      requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    console.warn(e);
    btn.disabled = false; btn.textContent = '💻 Kamera dieses Geräts';
    setStatus('err', e && e.name === 'NotAllowedError' ? 'Kamera wurde nicht erlaubt' : 'Kamera/KI konnte nicht starten');
  }
}
$('camBtn').addEventListener('click', (e) => { e.stopPropagation(); useLocalCamera(); });

/* ================================================================
   Verbindung zum Handy (identisch zum Ballon-Platzer)
   ================================================================ */
let peer = null, conn = null, code = '', retries = 0;
function peerOptions() {
  const p = params.get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { host, port: +port || 443, path: '/', secure: location.protocol === 'https:', debug: 1 };
}
const newCode = () => Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
function setStatus(kind, text) { $('status').className = 'status ' + kind; $('statusText').textContent = text; }
function startPeer() {
  if (!window.Peer) { setStatus('err', 'Verbindungsdienst nicht geladen'); return; }
  try { code = sessionStorage.getItem('kurvenflitzer.code') || newCode(); } catch { code = newCode(); }
  setStatus('wait', 'Verbinde …');
  peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => { retries = 0; try { sessionStorage.setItem('kurvenflitzer.code', code); } catch { /* */ } renderJoin(); if (!conn && !input.source) setStatus('wait', 'Warte auf Handy …'); });
  peer.on('connection', (c) => {
    if (conn) { try { conn.close(); } catch { /* */ } }
    conn = c;
    c.on('open', () => {
      input.source = 'phone';
      setStatus('ok', 'Handy verbunden'); audio.whoosh();
      send({ t: 'state', s: state, g: 'rennen' });
      if (state === 'lobby') setState('ready');
    });
    c.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'p') { if (msg.k) onPose(msg.k, msg.w, msg.h); }
      else if (msg.t === 'char') applyCharacter(msg.c);
      else if (msg.t === 'hello') send({ t: 'state', s: state, g: 'rennen' });
    });
    c.on('close', () => { if (conn !== c) return; conn = null; setStatus('wait', 'Handy getrennt – warte …'); });
  });
  peer.on('disconnected', () => setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500));
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') { peer.destroy(); if (++retries > 2) { try { sessionStorage.removeItem('kurvenflitzer.code'); } catch { /* */ } } setTimeout(startPeer, 1500); }
    else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) { setStatus('err', 'Keine Verbindung zum Server – neuer Versuch …'); setTimeout(() => { peer && peer.destroy(); startPeer(); }, 4000); }
  });
}
function send(msg) { if (conn && conn.open) { try { conn.send(msg); } catch { /* */ } } }
function controllerUrl() {
  const u = new URL('../controller.html', location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('c', code); u.searchParams.set('g', 'rennen');
  if (params.get('peer')) u.searchParams.set('peer', params.get('peer'));
  return u.toString();
}
function renderJoin() {
  $('code').textContent = code;
  const url = controllerUrl();
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  if (!window.qrcode) return;
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount();
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c) && !inFinder(r, c)) dots += `<rect x="${c}" y="${r}" width="1.02" height="1.02" rx="0.28"/>`;
  const finder = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="0.6" fill="none" stroke="#3f325e" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.35" fill="#3f325e"/>`;
  $('qr').innerHTML = `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR-Code"><g fill="#3f325e">${dots}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
}

function applyCharacter(c) {
  const cfg = sanitize(c);
  saveConfig(CHAR_KEY, cfg);
  setCockpitColors(cfg);
}
setCockpitColors(loadConfig(CHAR_KEY));

/* ================================================================
   HUD, Minimap, Ansagen
   ================================================================ */
const ui = {
  lobby: $('lobby'), hud: $('hud'), prompt: $('prompt'), promptText: $('promptText'), promptSub: $('promptSub'), promptBar: $('promptBar'), promptIcon: $('promptIcon'),
  lights: $('lights'), banner: $('banner'), results: $('results'), wheelHint: $('wheelHint'),
  pos: $('pos'), lap: $('lap'), time: $('time'), speed: $('speed'), speedBar: $('speedBar'), boostBar: $('boostBar'), coins: $('coins'),
};
const RING = 2 * Math.PI * 42;
ui.promptBar.style.strokeDasharray = RING;
function setPrompt(show, text = '', sub = '', icon = '🏎️') {
  ui.prompt.classList.toggle('show', show);
  if (text) ui.promptText.textContent = text;
  ui.promptSub.textContent = sub; ui.promptIcon.textContent = icon;
}
function banner(text, small = false) {
  const b = ui.banner; b.textContent = text; b.classList.toggle('small', small);
  b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
}

const mm = $('minimap'), mmCtx = mm.getContext('2d');
const mmBase = document.createElement('canvas'); mmBase.width = mm.width; mmBase.height = mm.height;
let mmTf;
{
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of T) { x0 = Math.min(x0, s.p.x); x1 = Math.max(x1, s.p.x); z0 = Math.min(z0, s.p.z); z1 = Math.max(z1, s.p.z); }
  const pad = 36, sc = Math.min((mm.width - pad * 2) / (x1 - x0), (mm.height - pad * 2) / (z1 - z0));
  mmTf = (x, z) => [pad + (x - x0) * sc + ((mm.width - pad * 2) - (x1 - x0) * sc) / 2, pad + (z - z0) * sc + ((mm.height - pad * 2) - (z1 - z0) * sc) / 2];
  const g = mmBase.getContext('2d');
  g.lineJoin = g.lineCap = 'round';
  for (const [w, c] of [[26, '#ffffff'], [16, '#a49cb0']]) {
    g.strokeStyle = c; g.lineWidth = w; g.beginPath();
    T.forEach((s, i) => { const [x, y] = mmTf(s.p.x, s.p.z); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.closePath(); g.stroke();
  }
  const [sx, sy] = mmTf(T[0].p.x, T[0].p.z);
  g.fillStyle = '#3f325e'; g.fillRect(sx - 12, sy - 3, 24, 6);
}
function drawMinimap() {
  mmCtx.clearRect(0, 0, mm.width, mm.height);
  mmCtx.drawImage(mmBase, 0, 0);
  const dot = (x, z, c, r) => { const [px, py] = mmTf(x, z); mmCtx.fillStyle = '#fff'; mmCtx.beginPath(); mmCtx.arc(px, py, r + 4, 0, 7); mmCtx.fill(); mmCtx.fillStyle = c; mmCtx.beginPath(); mmCtx.arc(px, py, r, 0, 7); mmCtx.fill(); };
  for (const a of ai) dot(a.kart.position.x, a.kart.position.z, a.color, 9);
  dot(player.pos.x, player.pos.z, '#e8574f', 13);
}

function standings() {
  const list = [
    { name: 'Du', color: ck.body.color.getStyle(), me: true, prog: player.finished != null ? 1e6 - player.finished : playerProgress(), finished: player.finished },
    ...ai.map((a) => ({ name: a.name, color: a.color, prog: a.finished != null ? 1e6 - a.finished : progress(a), finished: a.finished, a })),
  ];
  return list.sort((x, y) => y.prog - x.prog);
}

/* ================================================================
   Spielzustand
   ================================================================ */
let state = 'lobby', stateT = 0, gestureT = 0;
function setState(s) {
  state = s; stateT = 0; gestureT = 0;
  ui.lobby.classList.toggle('hide', s !== 'lobby');
  ui.hud.classList.toggle('show', s === 'ready' || s === 'countdown' || s === 'race');
  ui.results.classList.toggle('show', s === 'results');
  ui.lights.classList.remove('show', 'go');
  [...ui.lights.children].forEach((l) => l.classList.remove('on'));
  cockpit.visible = s !== 'lobby';
  if (s !== 'ready') setPrompt(false);
  send({ t: 'state', s: s === 'race' ? 'play' : s === 'ready' ? 'ready' : s, g: 'rennen' });
  if (s === 'ready') { resetRace(); audio.engine(true); }
  if (s === 'countdown') { ui.lights.classList.add('show'); audio.engine(true); }
  if (s === 'race') { ui.lights.classList.add('show', 'go'); audio.go(); banner('LOS!'); player.lapStart = 0; setTimeout(() => ui.lights.classList.remove('show'), 1200); }
  if (s === 'results') showResults();
  if (s === 'lobby') { audio.engine(false); resetRace(); camSnap = true; }
}

function showResults() {
  audio.end();
  const st = standings();
  // Gegner, die noch nicht im Ziel sind: Zeit hochrechnen
  for (const e of st) if (e.finished == null && e.a) e.finished = raceT + (LAPS * TRACK_LEN - progress(e.a)) / Math.max(e.a.vmax * 0.85, 1);
  st.sort((x, y) => x.finished - y.finished);
  const place = st.findIndex((e) => e.me) + 1;
  $('resultsTitle').textContent = place === 1 ? '🏆 Sieg!' : place === 2 ? '🥈 Zweiter Platz!' : place === 3 ? '🥉 Dritter Platz!' : 'Ziel erreicht!';
  $('podium').innerHTML = st.map((e, i) => `<div class="${e.me ? 'me' : ''}"><span class="place">${i + 1}.</span><span class="dot" style="--c:${e.color}"></span>${e.name}<span class="t">${fmt(e.finished)}</span></div>`).join('');
  $('statTime').textContent = fmt(player.finished);
  $('statBest').textContent = fmt(Math.min(...player.laps));
  $('statCoins').textContent = player.coins;
  $('resultsHint').textContent = input.source === 'keys' ? 'Leertaste für ein neues Rennen' : 'Beide Hände hoch über den Kopf für ein neues Rennen';
  send({ t: 'result', score: place, record: place === 1, g: 'rennen' });
}

/* ---------- Spieler-Physik ---------- */
const fwd = new THREE.Vector3();
function updatePlayer(dt, driving) {
  // Lenkung: Hände, Tastatur oder (ohne Hände) langsam zurück zur Mitte
  let target = 0;
  if (input.source === 'keys') target = (input.keys.r ? 1 : 0) - (input.keys.l ? 1 : 0);
  else if (hasControl() && input.onWheel) target = input.steer;
  player.steer += (target - player.steer) * damp(input.source === 'keys' ? 6 : 14, dt);

  const i = player.idx = nearest(player.pos, player.idx);
  const lat = lateral(player.pos, i);
  player.offroad = Math.abs(lat) > GRASS;

  let vT = 0;
  if (driving) {
    player.boostT = Math.max(0, player.boostT - dt);
    vT = player.boostT > 0 ? V_BOOST : V_MAX;
    vT *= 1 - 0.22 * Math.abs(player.steer) ** 1.5; // starkes Lenken kostet Tempo
    if (player.offroad) vT = Math.min(vT, V_GRASS);
    if (!(input.source === 'keys' || (hasControl() && input.onWheel))) vT *= 0.45; // ohne Hände am Lenkrad: Gas weg
  }
  player.v += (vT - player.v) * (player.v < vT ? 0.5 : 1.4) * dt;
  player.v = Math.max(0, player.v);

  // Gieren: je schneller, desto stärker (bis zu einem Maximum)
  player.heading -= player.steer * 1.5 * Math.min(1, player.v / 9) * dt;
  fwd.set(Math.sin(player.heading), 0, Math.cos(player.heading));
  player.pos.addScaledVector(fwd, player.v * dt);

  // Reifenstapel: zurückschubsen
  player.wallCd -= dt;
  const lat2 = lateral(player.pos, i);
  if (Math.abs(lat2) > WALL - 0.8) {
    player.pos.addScaledVector(T[i].r, (Math.sign(lat2) * (WALL - 0.8) - lat2));
    const tH = Math.atan2(T[i].t.x, T[i].t.z);
    let d = tH - player.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    player.heading += d * 0.5;
    if (player.wallCd <= 0) { player.v *= 0.55; player.wallCd = 0.8; audio.bad(); shake = 0.5; send({ t: 'bad' }); flash(); }
  }

  // Zusammenstoss mit Gegnern
  player.bumpCd -= dt;
  for (const a of ai) {
    const d = _v.subVectors(player.pos, a.kart.position); d.y = 0;
    const L = d.length();
    if (L < 2.7 && L > 0.001) {
      player.pos.addScaledVector(d.normalize(), 2.7 - L);
      if (player.bumpCd <= 0) { player.v *= 0.85; a.v *= 0.93; player.bumpCd = 0.6; audio.skid(1); shake = 0.25; send({ t: 'bad' }); }
    }
  }

  // Münzen
  for (const c of coins) {
    if (c.taken) continue;
    if ((c.base.x - player.pos.x) ** 2 + (c.base.z - player.pos.z) ** 2 < 2.4 * 2.4) {
      c.taken = true; c.m.visible = false; player.coins++;
      player.boost = Math.min(1, player.boost + 0.2);
      audio.pop(Math.min(8, player.coins % 9)); send({ t: 'hit' });
      if (player.boost >= 1) { player.boost = 0; player.boostT = 3; audio.gold(); banner('TURBO!', true); send({ t: 'hit', gold: true }); }
    }
  }
  if (player.offroad && player.v > 8 && Math.random() < dt * 8) audio.skid(0.5);
}

/* ---------- Runden zählen ---------- */
let prevIdx = 0;
function updateLaps() {
  const i = player.idx;
  if (prevIdx > N * 0.85 && i < N * 0.15) {
    player.lap++;
    if (player.lap >= 2) {
      const lt = raceT - player.lapStart; player.laps.push(lt); player.lapStart = raceT;
      if (player.lap > LAPS) { player.finished = raceT; player.lap = LAPS + 1; banner('ZIEL!'); audio.gold(); setTimeout(() => state === 'race' && setState('results'), 2200); }
      else { banner(player.lap === LAPS ? 'Letzte Runde!' : `Runde ${player.lap}`, true); audio.combo(2); resetCoins(); }
    } else { player.lapStart = raceT; }
  } else if (prevIdx < N * 0.15 && i > N * 0.85) {
    player.lap--; // rückwärts über die Linie
  }
  prevIdx = i;
  for (const a of ai) {
    if (a.finished == null && a.s >= TRACK_LEN * (LAPS + 1)) a.finished = raceT;
  }
}

/* ---------- Kamera ---------- */
let shake = 0, fovKick = 0, demoCar = 0, demoT = 0, camSnap = true;
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  shake = Math.max(0, shake - dt * 1.5);
  if (state === 'lobby') {
    // Vorführung: Verfolgerkamera hinter einem Gegner, wechselt alle 9 s
    demoT += dt;
    if (demoT > 9) { demoT = 0; demoCar = (demoCar + 1) % ai.length; camSnap = true; }
    const k = ai[demoCar].kart;
    const back = new THREE.Vector3(Math.sin(k.rotation.y), 0, Math.cos(k.rotation.y));
    const want = k.position.clone().addScaledVector(back, -9 + Math.sin(demoT * 0.4) * 2).add(new THREE.Vector3(Math.cos(demoT * 0.3) * 4, 4.2, 0));
    const look = k.position.clone().addScaledVector(back, 6).setY(1.2);
    if (camSnap) { camera.position.copy(want); camTarget.copy(look); camSnap = false; }
    camera.position.lerp(want, damp(2.5, dt));
    camTarget.lerp(look, damp(4, dt));
    camera.up.set(0, 1, 0);
    camera.lookAt(camTarget);
    camera.fov = lerp(camera.fov, 55, damp(2, dt));
    camera.updateProjectionMatrix();
    return;
  }
  fwd.set(Math.sin(player.heading), 0, Math.cos(player.heading));
  const bump = player.offroad ? Math.sin(now * 40) * 0.025 * Math.min(1, player.v / 10) : 0;
  camera.position.copy(player.pos).addScaledVector(fwd, -0.2);
  camera.position.y = 1.25 + bump + (Math.random() - 0.5) * shake * 0.3;
  camera.position.x += (Math.random() - 0.5) * shake * 0.3;
  camTarget.copy(player.pos).addScaledVector(fwd, 12); camTarget.y = 0.95;
  // Leichtes Neigen in Kurven
  const roll = player.steer * 0.05 * Math.min(1, player.v / 20);
  camera.up.set(Math.cos(player.heading) * roll, 1, -Math.sin(player.heading) * roll).normalize();
  camera.lookAt(camTarget);
  fovKick = lerp(fovKick, player.boostT > 0 ? 12 : 0, damp(3, dt));
  camera.fov = 64 + (player.v / V_BOOST) * 8 + fovKick;
  camera.updateProjectionMatrix();
}

/* ================================================================
   Hauptschleife
   ================================================================ */
const clock = new THREE.Clock();
let hudT = 0, frameAcc = 0, frameN = 0, qChecks = 0;
const SPEED_LEN = 235.6, BOOST_LEN = 251.3 * 0.75;
function flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }

function tick() {
  const realDt = Math.min(clock.getDelta(), 0.25);
  const dt = Math.min(realDt, 0.05);
  now += realDt; stateT += realDt;

  if (state === 'lobby') {
    placeAI(dt, false, true);
  } else if (state === 'ready') {
    placeAI(0);
    updatePlayer(dt, false);
    const ctl = hasControl();
    if (input.source === 'keys') setPrompt(true, 'Leertaste zum Starten', '← → lenken', '⌨️');
    else if (!ctl) setPrompt(true, 'Setz dich vor die Kamera', 'Oberkörper und beide Hände müssen sichtbar sein', '📱');
    else {
      gestureT = input.onWheel && Math.abs(input.steer) < 0.25 ? gestureT + realDt : Math.max(0, gestureT - realDt * 2);
      setPrompt(true, 'Hände ans Lenkrad!', 'Halte beide Hände vor der Brust, wie am Lenkrad', '🏎️');
      if (gestureT > 1.2) setState('countdown');
    }
    ui.promptBar.style.strokeDashoffset = RING * (1 - clamp(gestureT / 1.2, 0, 1));
  } else if (state === 'countdown') {
    updatePlayer(dt, false);
    const n = Math.floor(stateT / 0.9);
    [...ui.lights.children].forEach((l, i) => l.classList.toggle('on', i < n + 1));
    if (ui.lights.dataset.n != n && n < 3) { ui.lights.dataset.n = n; audio.tick(); }
    if (stateT >= 2.9) { ui.lights.dataset.n = ''; setState('race'); }
  } else if (state === 'race' || state === 'results') {
    raceT += state === 'race' && player.finished == null ? realDt : 0;
    placeAI(dt, true);
    updatePlayer(dt, player.finished == null);
    if (player.finished == null) updateLaps();
    if (state === 'results' && stateT > 2.5) {
      gestureT = input.handsUp ? gestureT + realDt : Math.max(0, gestureT - realDt * 2);
      if (gestureT > 0.9) { setState('ready'); }
    }
  }

  // Lenkrad-Anzeige + Hinweis
  const grip = state !== 'lobby' && (input.source === 'keys' || (hasControl() && input.onWheel)) ? 1 : 0;
  updateCockpit(dt, player.steer, grip);
  ui.wheelHint.classList.toggle('show', state === 'race' && input.source !== 'keys' && !grip);
  for (const c of coins) if (c.m.visible) { c.m.rotation.y += dt * 3; c.m.position.y = c.base.y + Math.sin(now * 3 + c.base.x) * 0.15; }

  // Motor
  if (state !== 'lobby') audio.engineSet(player.v / V_BOOST, player.boostT > 0);

  // Sonne + Schatten folgen dem Spieler
  const focus = state === 'lobby' ? ai[demoCar].kart.position : player.pos;
  sun.position.set(focus.x + 30, 60, focus.z + 25); sun.target.position.copy(focus);

  updateCamera(dt);
  renderer.render(scene, camera);

  // HUD (10× pro Sekunde reicht)
  hudT -= realDt;
  if (hudT <= 0 && state !== 'lobby') {
    hudT = 0.1;
    const st = standings();
    ui.pos.textContent = st.findIndex((e) => e.me) + 1;
    ui.lap.textContent = clamp(player.lap, 1, LAPS);
    ui.time.textContent = fmt(raceT);
    const kmh = Math.round(player.v * 3.6);
    ui.speed.textContent = kmh;
    ui.speedBar.style.strokeDasharray = `${SPEED_LEN * clamp(player.v / V_BOOST, 0, 1)} 314.2`;
    ui.boostBar.style.strokeDasharray = `${player.boostT > 0 ? BOOST_LEN * (player.boostT / 3) : BOOST_LEN * player.boost} 251.3`;
    ui.speedBar.parentElement.parentElement.classList.toggle('boosting', player.boostT > 0);
    ui.coins.textContent = player.coins;
    drawMinimap();
  }

  // Qualität automatisch anpassen
  frameAcc += realDt; frameN++;
  if (frameAcc > 2 && qChecks < 3) {
    const avg = frameAcc / frameN; frameAcc = 0; frameN = 0; qChecks++;
    if (avg > 0.024 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    else if (avg > 0.028 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => o.material && (o.material.needsUpdate = true)); }
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

setState('lobby');
startPeer();
if (params.has('keys')) useKeys();
tick();

// Test-Hilfe (Konsole)
window.__race = { onPose, player, ai, input, get state() { return state; }, setState, T, N, TRACK_LEN, setPrevIdx: (i) => { prevIdx = i; } };
