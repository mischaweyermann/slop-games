// Ballon-Platzer – TV-Seite
// 3D-Szene (Three.js), Avatar, Spiellogik und Verbindung zum Handy (PeerJS/WebRTC).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createAudio } from './audio.js';
import { Avatar, D } from './avatar.js';
import { createEditor, loadConfig, saveConfig, sanitize } from './character.js';

/* ================================================================
   Konstanten & Helfer
   ================================================================ */
const $ = (id) => document.getElementById(id);
const PEER_PREFIX = 'ballonplatzer-v1-';
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const GAME_TIME = 60;
const GROUND_Y = -1.9;
const HIP_Y = GROUND_Y + 0.14 + D.thigh + D.shin; // Hüfthöhe der Figur
const SHIFT_MAX = 2.7;      // wie weit der Avatar seitlich laufen kann
const SPAWN_X = 4.2;        // Bereich, in dem Ballone auftauchen
const BALLOON_R = 0.42;
const HAND_R = 0.27;

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const params = new URLSearchParams(location.search);
const audio = createAudio();

/* ================================================================
   Renderer, Kamera, Licht
   ================================================================ */
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 0.98;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#e7a593', 24, 80);

const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 220);
const CAM_TARGET = new THREE.Vector3(0, 0.35, 0);
let camDist = 9.5;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight('#ffd9c2', '#7d3a40', 1.25));
const sun = new THREE.DirectionalLight('#ffc9a0', 2.6);
sun.position.set(4, 10, 8);
sun.target.position.set(0, -1, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 8, bottom: -6, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // Spielfeld (ca. 11 × 6.2 Einheiten) muss immer ganz sichtbar sein
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camDist = Math.max(3.15 / t, 5.6 / (t * camera.aspect));
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/* ================================================================
   Kulisse im Toy-Look: Himmel, Wiese, Hügel, Bäume, Requisiten
   ================================================================ */
const SPH = new THREE.SphereGeometry(1, 32, 20);
const SPH_LO = new THREE.SphereGeometry(1, 18, 12);
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
const PAL = {
  ground: '#a85c5a', stage: '#c27a70', hills: ['#a9555c', '#b8646a', '#c9767a', '#9c4a52'],
  treeTops: ['#7e3d45', '#6f2f37', '#9c4a52', '#8a3b44', '#e2574c', '#f2c94c'], trunk: '#4b1c22',
  flowers: ['#f7e9a6', '#f2c94c', '#f6e3e1', '#e2574c', '#9b7fd1'], bush: ['#8a3b44', '#7e3d45', '#9c4a52'],
};

// Himmel als Farbverlauf
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(110, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    uniforms: {
      top: { value: new THREE.Color('#8e3a45') },
      mid: { value: new THREE.Color('#e88a78') },
      bottom: { value: new THREE.Color('#f8d2b4') },
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
      void main(){
        float h = vP.y;
        vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.22, h));
        c = mix(c, top, smoothstep(0.2, 0.75, h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  }),
));

// Weiche Sonne
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,252,238,1)');
  grd.addColorStop(0.25, 'rgba(255,246,222,0.9)');
  grd.addColorStop(0.45, 'rgba(255,236,205,0.3)');
  grd.addColorStop(1, 'rgba(255,230,200,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, toneMapped: false }));
  s.position.set(22, 9, -70); s.scale.setScalar(34); // tiefstehende Abendsonne
  scene.add(s);
}

// Wiese + runde «Bühne» in der Mitte
const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 64), mat(PAL.ground, { roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = GROUND_Y; ground.receiveShadow = true;
scene.add(ground);
const stage = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.35, 0.08, 64), mat(PAL.stage, { roughness: 1 }));
stage.position.set(0, GROUND_Y + 0.0, 0.2); stage.receiveShadow = true;
scene.add(stage);

function hill(x, z, r, sy, color) {
  const m = new THREE.Mesh(SPH, mat(color, { roughness: 1 }));
  m.position.set(x, GROUND_Y, z); m.scale.set(r, r * sy, r);
  m.receiveShadow = true; scene.add(m);
}
hill(-14, -24, 11, 0.42, PAL.hills[0]);
hill(12, -28, 14, 0.38, PAL.hills[1]);
hill(0, -38, 18, 0.34, PAL.hills[2]);
hill(-26, -14, 8, 0.5, PAL.hills[3]);
hill(25, -14, 9, 0.48, PAL.hills[0]);

// Bäume: runde Kronen wie Spielzeug
function tree(x, z, s = 1, kind = Math.random() < 0.7 ? 'round' : 'cone') {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.16, 1.2, 14), mat(PAL.trunk, { roughness: 0.7 }));
  trunk.position.y = 0.6; trunk.castShadow = true; g.add(trunk);
  const topMat = mat(pick(PAL.treeTops), { roughness: 0.7 });
  if (kind === 'cone') {
    [[1.5, 0.75, 0.9], [2.05, 0.6, 0.75], [2.55, 0.42, 0.6]].forEach(([y, r, h]) => {
      const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 24), topMat); c.position.y = y; c.castShadow = true; g.add(c);
    });
  } else {
    const top = new THREE.Mesh(SPH, topMat); top.position.y = 1.65; top.scale.set(0.82, 0.9, 0.82); top.castShadow = true; g.add(top);
    const top2 = new THREE.Mesh(SPH_LO, topMat); top2.position.set(0.45, 1.3, 0.12); top2.scale.setScalar(0.5); top2.castShadow = true; g.add(top2);
  }
  g.position.set(x, GROUND_Y, z); g.scale.setScalar(s); g.rotation.y = rand(0, 6);
  scene.add(g);
}
[[-7.6, -3, 1.1], [-9.5, -6.5, 1.3], [-12, -2, 1.2], [8, -4, 1.2], [10.5, -2.5, 1], [12, -7, 1.4],
 [-7, -14, 1.3], [8, -15, 1.5], [-16, -10, 1.6], [17, -9, 1.5], [-2, -19, 1.6], [3.5, -21, 1.4]]
  .forEach(([x, z, s]) => tree(x, z, s));

// Blumen (instanziert = schnell)
{
  const n = 150;
  const flowers = new THREE.InstancedMesh(SPH_LO, mat('#ffffff', { roughness: 0.6 }), n);
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    let x, z;
    do { x = rand(-16, 16); z = rand(-14, 3.5); } while (Math.abs(x) < 3.6 && z > -2.8);
    const s = rand(0.05, 0.085);
    m4.makeScale(s, s * 0.7, s).setPosition(x, GROUND_Y + 0.04, z);
    flowers.setMatrixAt(i, m4);
    flowers.setColorAt(i, col.set(pick(PAL.flowers)));
  }
  scene.add(flowers);
}

// Requisiten: Pilze, Steine, Zaun
function mushroom(x, z, s = 1) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 16), mat('#f6e3e1', { roughness: 0.7 }));
  stem.position.y = 0.15; stem.castShadow = true; g.add(stem);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e2574c', { roughness: 0.45 }));
  cap.position.y = 0.27; cap.scale.y = 0.75; cap.castShadow = true; g.add(cap);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26, d = new THREE.Mesh(SPH_LO, mat('#fbf7f0', { roughness: 0.6 }));
    d.position.set(Math.cos(a) * 0.15, 0.4, Math.sin(a) * 0.15); d.scale.setScalar(0.035); g.add(d);
  }
  g.position.set(x, GROUND_Y, z); g.scale.setScalar(s); scene.add(g);
}
[[-4.6, 0.6, 1.1], [-4.2, 1.1, 0.7], [5.2, -1.5, 1], [6.2, 0.9, 0.8], [-6.5, -1.5, 0.9]].forEach(([x, z, s]) => mushroom(x, z, s));

const rockGeo = new THREE.IcosahedronGeometry(1, 1);
function rock(x, z, s) {
  const r = new THREE.Mesh(rockGeo, mat(pick(['#c98f86', '#b97f78', '#d9a198']), { roughness: 0.9, flatShading: true }));
  r.position.set(x, GROUND_Y + s * 0.25, z); r.scale.set(s, s * 0.6, s * 0.85); r.rotation.y = rand(0, 6);
  r.castShadow = true; r.receiveShadow = true; scene.add(r);
}
[[4.4, 0.3, 0.32], [4.8, 0.7, 0.2], [-5.4, -0.6, 0.38], [7.2, -2.2, 0.45], [-8.5, 0.5, 0.5]].forEach(([x, z, s]) => rock(x, z, s));

function fence(x0, x1, z) {
  const wood = mat('#6f2f37', { roughness: 0.75 });
  for (let x = x0; x <= x1 + 0.01; x += 0.8) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.7, 0.12), wood);
    p.position.set(x, GROUND_Y + 0.35, z); p.castShadow = true; scene.add(p);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 4), wood);
    tip.position.set(x, GROUND_Y + 0.76, z); tip.rotation.y = Math.PI / 4; scene.add(tip);
  }
  for (const y of [0.25, 0.52]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.2, 0.08, 0.06), wood);
    r.position.set((x0 + x1) / 2, GROUND_Y + y, z + 0.07); r.castShadow = true; scene.add(r);
  }
}
fence(-11.5, -6.7, -1.2);
fence(6.7, 11.5, -1.2);

// Wolken
const clouds = [];
const cloudMat = mat('#f9d7c6', { roughness: 1, emissive: '#ffd8c4', emissiveIntensity: 0.4 });
function makeCloud(x, y, z, s) {
  const g = new THREE.Group();
  [[0, 0, 0, 1], [0.95, -0.18, 0, 0.75], [-0.95, -0.22, 0, 0.72], [0.4, 0.48, 0, 0.72],
   [-0.38, 0.38, 0.1, 0.66], [1.7, -0.32, 0, 0.5], [-1.7, -0.36, 0, 0.5]]
    .forEach(([px, py, pz, r]) => {
      const m = new THREE.Mesh(SPH_LO, cloudMat);
      m.position.set(px, py, pz); m.scale.set(r, r * 0.85, r * 0.8); g.add(m);
    });
  g.position.set(x, y, z); g.scale.setScalar(s);
  scene.add(g); clouds.push({ g, speed: rand(0.15, 0.35) });
}
makeCloud(-12, 9, -34, 2.6); makeCloud(6, 11, -42, 3.2); makeCloud(20, 8, -36, 2.4);
makeCloud(-28, 12, -48, 3.4); makeCloud(32, 13, -50, 3);

// Büsche ganz vorne (niedrig, verdecken die Figur nicht)
{
  const bushMats = PAL.bush.map((c) => mat(c, { roughness: 0.8 }));
  const flowerMats = PAL.flowers.map((c) => mat(c, { roughness: 0.5 }));
  for (let x = -11; x <= 11; x += rand(0.75, 1.05)) {
    const r = rand(0.45, 0.7) * (1 + Math.max(0, Math.abs(x) - 5) * 0.08);
    const m = new THREE.Mesh(SPH, pick(bushMats));
    const top = -1.62 + Math.max(0, Math.abs(x) - 5.5) * 0.09 + rand(-0.05, 0.05);
    m.position.set(x, top - r, rand(2.3, 2.7));
    m.scale.set(r * 1.15, r, r);
    m.castShadow = true; m.receiveShadow = true; scene.add(m);
    if (Math.random() < 0.5) {
      const f = new THREE.Mesh(SPH_LO, pick(flowerMats));
      f.position.set(x + rand(-0.3, 0.3), top - 0.04, m.position.z + rand(0.15, 0.35));
      f.scale.setScalar(0.07); scene.add(f);
    }
  }
}

/* ================================================================
   Avatar (Chibi-Figur aus avatar.js) und Posen
   ================================================================ */
const avatar = new Avatar(scene);
const CHAR_KEY = 'ballonplatzer.character';
avatar.setConfig(loadConfig(CHAR_KEY));

const nrm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

// Setzt alle Gelenk-Ziele aus Richtungen; Längen kommen von der Figur (Retargeting)
function composePose({ hx, hy, torso = { x: 0, y: 1 }, neck = null, arms, legs }) {
  const J = avatar.J;
  const t = nrm(torso.x, torso.y);
  const perp = { x: t.y, y: -t.x };
  const shx = hx + t.x * D.torso, shy = hy + t.y * D.torso;
  J.lSh.tgt.set(shx - perp.x * D.shoulderHalf, shy - perp.y * D.shoulderHalf, 0);
  J.rSh.tgt.set(shx + perp.x * D.shoulderHalf, shy + perp.y * D.shoulderHalf, 0);
  J.lHip.tgt.set(hx - perp.x * D.hipHalf, hy - perp.y * D.hipHalf, 0);
  J.rHip.tgt.set(hx + perp.x * D.hipHalf, hy + perp.y * D.hipHalf, 0);
  // Arme vor dem Körper nach vorne schieben, damit sie nicht im Bauch verschwinden
  const zFor = (x, y) => (Math.abs(x - shx) < 0.46 && y < shy + 0.15 && y > hy - 0.25 ? 0.42 : 0.06);
  for (const s of ['l', 'r']) {
    // Richtung exakt übernehmen. Nur ganz senkrecht nach oben leicht öffnen,
    // damit die Hände nicht komplett hinter dem grossen Kopf verschwinden.
    const side = s === 'l' ? -1 : 1;
    const [u, f] = arms[s].map((d) => {
      const v = nrm(d.x, d.y);
      // 1 = Arm liegt quer zur Kamera, klein = Arm zeigt zur Kamera. Erst deutliche Verkürzung zählt,
      // damit unterschiedliche Körperproportionen die Figur nicht verkrümmen.
      const fs = d.f == null ? 1 : clamp(0.3 + ((d.f - 0.25) / 0.5) * 0.7, 0.3, 1);
      if (v.y > 0) {
        // Winkel ab senkrecht oben (0) bis waagrecht (π/2) weich nach aussen verschieben:
        // senkrecht hoch wird zum «V», waagrecht bleibt waagrecht. So bleibt jede Bewegung sichtbar.
        const th = clamp(Math.atan2(v.x * side, v.y), -0.4, Math.PI / 2);
        const ang = th + 0.85 * (1 - th / (Math.PI / 2));
        return { x: side * Math.sin(ang), y: Math.cos(ang), fs };
      }
      return { ...v, fs };
    });
    const sh = J[s + 'Sh'].tgt;
    // Verkürzte Segmente gehen in die Tiefe (Richtung TV-Zuschauer)
    const uz = Math.sqrt(1 - u.fs * u.fs) * D.upperArm, fz = Math.sqrt(1 - f.fs * f.fs) * D.foreArm;
    const ex = sh.x + u.x * D.upperArm * u.fs, ey = sh.y + u.y * D.upperArm * u.fs;
    const hxx = ex + f.x * D.foreArm * f.fs, hyy = ey + f.y * D.foreArm * f.fs;
    const handUp = hyy > shy + 0.35 && Math.abs(hxx - shx) < 0.75; // Hand vor dem Gesicht
    J[s + 'El'].tgt.set(ex, ey, Math.max(zFor(ex, ey) * 0.7, uz));
    J[s + 'Ha'].tgt.set(hxx, hyy, Math.max(zFor(hxx, hyy), uz + fz, handUp ? 0.95 : 0));
    const [lu, lf] = legs[s].map((d) => nrm(d.x, d.y));
    const hp = J[s + 'Hip'].tgt;
    const kx = hp.x + lu.x * D.thigh, ky = hp.y + lu.y * D.thigh;
    let ax = kx + lf.x * D.shin, ay = ky + lf.y * D.shin;
    ay = Math.max(ay, GROUND_Y + 0.14);
    J[s + 'Kn'].tgt.set(kx, Math.max(ky, ay + 0.12), 0.02);
    J[s + 'An'].tgt.set(ax, ay, 0.02);
  }
  const n = nrm(lerp(t.x, (neck || t).x, 0.6), lerp(t.y, (neck || t).y, 0.6));
  J.head.tgt.set(shx + n.x * D.neck, shy + n.y * D.neck, 0.05);
}

const DOWN_L = [{ x: -0.32, y: -1 }, { x: -0.12, y: -1 }];
const DOWN_R = [{ x: 0.32, y: -1 }, { x: 0.12, y: -1 }];
const LEG_L = [{ x: -0.06, y: -1 }, { x: 0, y: -1 }];
const LEG_R = [{ x: 0.06, y: -1 }, { x: 0, y: -1 }];

// Zwei-Gelenk-IK für Maus-Demo
function armDirsTo(sh, target, bend) {
  const dx = target.x - sh.x, dy = target.y - sh.y;
  let d = Math.hypot(dx, dy) || 0.001;
  const ux = dx / d, uy = dy / d;
  const up = D.upperArm, lo = D.foreArm;
  d = clamp(d, 0.1, up + lo - 0.01);
  const a = (up * up - lo * lo + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, up * up - a * a));
  const ex = ux * a - uy * h * bend, ey = uy * a + ux * h * bend;
  return [{ x: ex, y: ey }, { x: ux * d - ex, y: uy * d - ey }];
}

function idlePose(t, shift, mode = 'idle', pointer = null) {
  const hy = HIP_Y + Math.sin(t * 2.2) * 0.02;
  const sw = Math.sin(t * 1.6) * 0.06;
  let arms = { l: [{ x: DOWN_L[0].x - sw, y: -1 }, DOWN_L[1]], r: [{ x: DOWN_R[0].x + sw, y: -1 }, DOWN_R[1]] };
  if (mode === 'wave') arms.r = [{ x: 0.9, y: 0.55 }, { x: 0.25 + Math.sin(t * 6) * 0.55, y: 1 }];
  if (mode === 'cheer') {
    arms = {
      l: [{ x: -0.6, y: 1 }, { x: -0.25 + Math.sin(t * 9) * 0.25, y: 1 }],
      r: [{ x: 0.6, y: 1 }, { x: 0.25 + Math.sin(t * 9 + 1) * 0.25, y: 1 }],
    };
  }
  if (mode === 'pointer' && pointer) {
    const side = pointer.x < shift ? 'l' : 'r';
    const shx = shift + (side === 'l' ? -D.shoulderHalf : D.shoulderHalf);
    arms[side] = armDirsTo({ x: shx, y: hy + D.torso }, pointer, side === 'l' ? 1 : -1);
  }
  const jump = mode === 'cheer' ? Math.abs(Math.sin(t * 4.5)) * 0.25 : 0;
  composePose({ hx: shift, hy: hy + jump, torso: { x: Math.sin(t * 1.1) * 0.04, y: 1 }, arms, legs: { l: LEG_L, r: LEG_R } });
}

/* ================================================================
   Pose vom Handy -> Avatar-Ziele (Richtungen übernehmen, Längen von der Figur)
   ================================================================ */
const NAMES = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lIx', 'rIx', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];
const pose = {
  lastAt: -1e9, torso: 0, baseHipY: null, shift: 0, armsUp: false,
  d: { lU: DOWN_L[0], lF: DOWN_L[1], rU: DOWN_R[0], rF: DOWN_R[1], lT: LEG_L[0], lS: LEG_L[1], rT: LEG_R[0], rS: LEG_R[1] },
};

function applyPose(k, w, h) {
  if (!Array.isArray(k) || k.length < NAMES.length * 3) return;
  w = w || 640; h = h || 480;
  const P = {};
  NAMES.forEach((n, i) => (P[n] = { x: k[i * 3] * w, y: k[i * 3 + 1] * h, v: k[i * 3 + 2] }));
  const ok = (p, th = 0.35) => p && p.v >= th;
  if (!ok(P.lSh, 0.4) || !ok(P.rSh, 0.4)) return;

  const sh = { x: (P.lSh.x + P.rSh.x) / 2, y: (P.lSh.y + P.rSh.y) / 2 };
  const sw = Math.hypot(P.lSh.x - P.rSh.x, P.lSh.y - P.rSh.y);
  const hipsOk = ok(P.lHip) && ok(P.rHip);
  const hp = hipsOk ? { x: (P.lHip.x + P.rHip.x) / 2, y: (P.lHip.y + P.rHip.y) / 2 } : { x: sh.x, y: sh.y + sw * 1.3 };
  const torsoPx = Math.hypot(hp.x - sh.x, hp.y - sh.y);
  if (!(torsoPx > 4)) return;
  pose.torso = pose.torso ? lerp(pose.torso, torsoPx, 0.15) : torsoPx;
  pose.baseHipY = pose.baseHipY == null ? hp.y : lerp(pose.baseHipY, hp.y, 0.01);

  // Seitlich laufen: Position im Kamerabild -> Position auf der Bühne
  const shift = clamp((hp.x / w - 0.5) * 2 * 3.4, -SHIFT_MAX, SHIFT_MAX);
  const dy = clamp((pose.baseHipY - hp.y) / pose.torso, -0.8, 1.0) * D.torso * 1.2;

  const dir = (a, b) => ({ x: b.x - a.x, y: -(b.y - a.y) });
  let torso = hipsOk ? dir(hp, sh) : { x: 0, y: 1 };
  const lean = clamp(Math.atan2(torso.x, torso.y), -0.6, 0.6);
  torso = { x: Math.sin(lean), y: Math.cos(lean) };

  const d = pose.d;
  for (const s of ['l', 'r']) {
    const S = P[s + 'Sh'], E = P[s + 'El'], W = P[s + 'Wr'], I = P[s + 'Ix'];
    // Länge im Bild vs. erwartete Länge -> wie stark zeigt der Arm zur Kamera?
    const fore = (v, ratio) => Math.hypot(v.x, v.y) / (ratio * pose.torso);
    if (ok(E, 0.3)) { const v = dir(S, E); d[s + 'U'] = { ...v, f: fore(v, 0.6) }; }
    if (ok(E, 0.3) && ok(W, 0.3)) {
      const hand = ok(I, 0.3) ? { x: W.x + (I.x - W.x) * 0.6, y: W.y + (I.y - W.y) * 0.6 } : W;
      const v = dir(E, hand); d[s + 'F'] = { ...v, f: fore(v, 0.62) };
    }
    const Hp = hipsOk ? P[s + 'Hip'] : null, K = P[s + 'Kn'], A = P[s + 'An'];
    const def = s === 'l' ? LEG_L : LEG_R;
    d[s + 'T'] = Hp && ok(K, 0.5) ? dir(Hp, K) : def[0];
    d[s + 'S'] = ok(K, 0.5) && ok(A, 0.5) ? dir(K, A) : def[1];
  }
  // Arme hoch = beide Handgelenke über der Nase
  const headY = ok(P.nose, 0.4) ? P.nose.y : sh.y - pose.torso * 0.5;
  pose.armsUp = ok(P.lWr, 0.3) && ok(P.rWr, 0.3) && P.lWr.y < headY && P.rWr.y < headY;

  composePose({
    hx: shift, hy: HIP_Y + dy, torso,
    neck: ok(P.nose, 0.5) ? dir(sh, P.nose) : null,
    arms: { l: [d.lU, d.lF], r: [d.rU, d.rF] },
    legs: { l: [d.lT, d.lS], r: [d.rT, d.rS] },
  });

  pose.shift = shift;
  if (now - pose.lastAt > 1.5) avatar.snap();
  pose.lastAt = now;
}

const tracked = () => demo || now - pose.lastAt < 0.7;
const armsUp = () => (demo ? false : pose.armsUp);

/* ================================================================
   Ballone, Gewitterwolken, Konfetti
   ================================================================ */
const BALLOON_COLORS = ['#e8574f', '#f39a4c', '#f2c94c', '#5aa9c9', '#9b7fd1', '#7fb069', '#f3a6b8'];
const balloonGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const a = (i / 32) * Math.PI;
    const r = Math.sin(a) * (1 - 0.16 * Math.cos(a));
    pts.push(new THREE.Vector2(Math.max(r, 0.0001) * BALLOON_R, -Math.cos(a) * BALLOON_R * 1.16));
  }
  return new THREE.LatheGeometry(pts, 40);
})();
const knotGeo = new THREE.ConeGeometry(0.065, 0.1, 14);
const stringGeo = (() => {
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push(new THREE.Vector3(Math.sin(i * 0.9) * 0.05, -0.5 - i * 0.08, 0));
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.009, 5, false);
})();
const stringMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.6 });
const balloonMats = {};
const balloonMat = (c) => (balloonMats[c] ||= new THREE.MeshPhysicalMaterial({
  color: c, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2,
  sheen: 0.35, sheenColor: new THREE.Color('#ffffff'),
}));
const goldMat = new THREE.MeshPhysicalMaterial({
  color: '#ffc93d', metalness: 0.9, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08,
  emissive: '#8a5a00', emissiveIntensity: 0.25,
});

class Balloon {
  constructor() {
    this.g = new THREE.Group();
    this.body = new THREE.Mesh(balloonGeo, balloonMat(BALLOON_COLORS[0]));
    this.knot = new THREE.Mesh(knotGeo, this.body.material);
    this.knot.position.y = -BALLOON_R * 1.16 - 0.02;
    this.string = new THREE.Mesh(stringGeo, stringMat);
    this.body.castShadow = true;
    this.g.add(this.body, this.knot, this.string);
    scene.add(this.g);
    this.active = false;
  }
  spawn({ x, y = -1.2, z = rand(-0.35, 0.35), speed, kind = 'normal', ambient = false, scale = 1 }) {
    this.kind = kind; this.ambient = ambient;
    this.color = kind === 'gold' ? '#ffc93d' : pick(BALLOON_COLORS);
    const m = kind === 'gold' ? goldMat : balloonMat(this.color);
    this.body.material = m; this.knot.material = m;
    this.baseX = x; this.y = y; this.z = z; this.speed = speed;
    this.phase = rand(0, 6.28); this.freq = rand(0.7, 1.3); this.amp = rand(0.12, 0.3);
    this.scale = scale; this.age = 0;
    this.g.visible = true; this.g.scale.setScalar(0.01);
    this.active = true;
    this.update(0);
  }
  get x() { return this.g.position.x; }
  update(dt) {
    this.age += dt;
    this.y += this.speed * dt;
    const t = this.age * this.freq + this.phase;
    const x = this.baseX + Math.sin(t) * this.amp;
    this.g.position.set(x, this.y, this.z);
    this.g.rotation.z = -Math.cos(t) * this.amp * 0.35;
    this.g.rotation.y += dt * (this.kind === 'gold' ? 2.2 : 0.3);
    const grow = Math.min(1, this.age * 3.2) ** 0.6;
    const wob = 1 + Math.sin(this.age * 5 + this.phase) * 0.02;
    this.g.scale.set(this.scale * grow * wob, this.scale * grow / wob, this.scale * grow * wob);
  }
  hide() { this.active = false; this.g.visible = false; }
}

class StormCloud {
  constructor() {
    this.g = new THREE.Group();
    const m = new THREE.MeshPhysicalMaterial({ color: '#8b86a8', roughness: 0.7, sheen: 0.5, sheenColor: new THREE.Color('#c9c4e6') });
    [[0, 0, 0, 0.42], [0.38, -0.06, 0.02, 0.33], [-0.38, -0.08, 0.02, 0.32], [0.16, 0.22, 0, 0.3], [-0.18, 0.18, 0.05, 0.28]]
      .forEach(([x, y, z, r]) => { const s = new THREE.Mesh(SPH, m); s.position.set(x, y, z); s.scale.setScalar(r); s.castShadow = true; this.g.add(s); });
    const dark = new THREE.MeshStandardMaterial({ color: '#2f2545', roughness: 0.3 });
    [-1, 1].forEach((s) => {
      const e = new THREE.Mesh(SPH_LO, dark); e.position.set(0.12 * s, 0.02, 0.4); e.scale.set(0.05, 0.035, 0.03); this.g.add(e);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.02), dark);
      brow.position.set(0.12 * s, 0.09, 0.41); brow.rotation.z = -0.45 * s; this.g.add(brow);
    });
    const bolt = new THREE.Shape();
    [[0, 0], [0.12, 0], [0.04, -0.16], [0.13, -0.16], [-0.06, -0.42], [0, -0.22], [-0.08, -0.22]].forEach(([x, y], i) => (i ? bolt.lineTo(x, y) : bolt.moveTo(x, y)));
    this.bolt = new THREE.Mesh(
      new THREE.ExtrudeGeometry(bolt, { depth: 0.05, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 2 }),
      new THREE.MeshStandardMaterial({ color: '#ffd84d', emissive: '#ffb800', emissiveIntensity: 0.6, roughness: 0.4 }),
    );
    this.bolt.position.set(0, -0.32, 0.05); this.g.add(this.bolt);
    scene.add(this.g); this.g.visible = false; this.active = false;
  }
  // Die Wolke schaut zuerst am Bildrand herein (Vorwarnung) und fliegt erst dann los
  spawn(fromLeft, y, speed, z = 0.2, edge = 6.2) {
    this.dir = fromLeft ? 1 : -1;
    this.g.position.set(fromLeft ? -edge : edge, y, z);
    this.baseY = y; this.speed = speed; this.age = 0; this.warn = 1.3;
    this.g.scale.setScalar(0.01);
    this.g.visible = true; this.active = true;
  }
  get dangerous() { return this.warn <= 0; }
  get x() { return this.g.position.x; }
  get y() { return this.g.position.y; }
  update(dt) {
    this.age += dt;
    if (this.warn > 0) {
      this.warn -= dt;
      const t = 1 - this.warn / 1.3;
      this.g.scale.setScalar(Math.min(1, t * 2.2) * (1 + Math.sin(this.age * 22) * 0.06));
      this.g.position.y = this.baseY;
      this.bolt.visible = Math.sin(this.age * 18) > 0;
      return;
    }
    this.g.scale.setScalar(1);
    this.g.position.x += this.dir * this.speed * dt;
    this.g.position.y = this.baseY + Math.sin(this.age * 2.4) * 0.15;
    this.g.rotation.z = Math.sin(this.age * 3) * 0.06;
    this.bolt.visible = Math.sin(this.age * 9) > -0.6;
  }
  hide() { this.active = false; this.g.visible = false; }
}

// Konfetti als ein InstancedMesh mit 700 Teilchen
const CONF_N = 700;
const confetti = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.1, 0.06),
  new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.6, metalness: 0.1 }),
  CONF_N,
);
confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
confetti.frustumCulled = false;
scene.add(confetti);
const parts = Array.from({ length: CONF_N }, () => ({
  life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), rv: new THREE.Vector3(), s: 1,
}));
{
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), c = new THREE.Color('#fff');
  for (let i = 0; i < CONF_N; i++) { confetti.setMatrixAt(i, zero); confetti.setColorAt(i, c); }
}
let confIdx = 0;
const _c = new THREE.Color();
function burst(pos, colors, n = 34, power = 4, size = 1) {
  for (let i = 0; i < n; i++) {
    const p = parts[confIdx]; const idx = confIdx; confIdx = (confIdx + 1) % CONF_N;
    p.life = rand(0.9, 1.6); p.s = size * rand(0.7, 1.3);
    p.p.copy(pos);
    const a = rand(0, Math.PI * 2), e = rand(-0.4, 1);
    const sp = rand(0.4, 1) * power;
    p.v.set(Math.cos(a) * sp, e * sp + 1.5, Math.sin(a) * sp * 0.6 + 0.4);
    p.r.set(rand(0, 6), rand(0, 6), rand(0, 6));
    p.rv.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
    confetti.setColorAt(idx, _c.set(pick(colors)));
  }
  confetti.instanceColor.needsUpdate = true;
}
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function updateConfetti(dt) {
  for (let i = 0; i < CONF_N; i++) {
    const p = parts[i];
    if (p.life <= 0) continue;
    p.life -= dt;
    p.v.y -= 7 * dt; p.v.multiplyScalar(1 - 1.8 * dt);
    p.p.addScaledVector(p.v, dt);
    p.r.x += p.rv.x * dt; p.r.y += p.rv.y * dt; p.r.z += p.rv.z * dt;
    const sc = p.life > 0 ? Math.min(1, p.life * 2) * p.s : 0;
    _m4.compose(p.p, _q.setFromEuler(p.r), _s.set(sc, sc, sc));
    confetti.setMatrixAt(i, _m4);
  }
  confetti.instanceMatrix.needsUpdate = true;
}

// Druckwellen-Ringe beim Platzen
const rings = Array.from({ length: 10 }, () => {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.42, 48), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false; scene.add(m);
  return { m, t: 1 };
});
let ringIdx = 0;
function ring(pos, color = '#ffffff') {
  const r = rings[ringIdx]; ringIdx = (ringIdx + 1) % rings.length;
  r.t = 0; r.m.position.copy(pos); r.m.material.color.set(color); r.m.visible = true;
}
function updateRings(dt) {
  for (const r of rings) {
    if (!r.m.visible) continue;
    r.t += dt / 0.4;
    if (r.t >= 1) { r.m.visible = false; continue; }
    r.m.scale.setScalar(1 + r.t * 2.4);
    r.m.material.opacity = (1 - r.t) * 0.85;
    r.m.lookAt(camera.position);
  }
}

const balloonPool = [], clouds2 = [];
function getBalloon() {
  let b = balloonPool.find((x) => !x.active);
  if (!b) { b = new Balloon(); balloonPool.push(b); }
  return b;
}
function getCloud() {
  let c = clouds2.find((x) => !x.active);
  if (!c) { c = new StormCloud(); clouds2.push(c); }
  return c;
}

/* ================================================================
   Punkte-Popups (HTML über der 3D-Szene)
   ================================================================ */
const popLayer = $('popups');
function popupAt(pos, text, color, big = false) {
  const v = pos.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'popup' + (big ? ' big' : '');
  el.textContent = text;
  el.style.setProperty('--c', color);
  el.style.left = ((v.x + 1) / 2) * 100 + '%';
  el.style.top = ((1 - v.y) / 2) * 100 + '%';
  el.addEventListener('animationend', () => el.remove());
  popLayer.appendChild(el);
}
function popupCenter(text, color) {
  const el = document.createElement('div');
  el.className = 'popup big'; el.textContent = text; el.style.setProperty('--c', color);
  el.style.left = '50%'; el.style.top = '38%';
  el.addEventListener('animationend', () => el.remove());
  popLayer.appendChild(el);
}
const bump = (el) => { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

/* ================================================================
   Spielzustand
   ================================================================ */
let state = 'lobby';           // lobby | ready | countdown | play | results
let stateT = 0;
let now = 0;
let demo = false;
let pointer = null;
let demoShift = 0;
let gestureT = 0;
let paused = false;
const game = { score: 0, time: GAME_TIME, popped: 0, combo: 0, bestCombo: 0, lastHit: -9, mult: 1, spawnT: 0.6, cloudT: 6 };
let best = 0;
try { best = +localStorage.getItem('ballonplatzer.best') || 0; } catch { /* privat */ }
let shakeAmt = 0;
let showcaseT = 0, camZoom = 0, editorOpen = false;

const ui = {
  lobby: $('lobby'), hud: $('hud'), prompt: $('prompt'), promptText: $('promptText'), promptSub: $('promptSub'),
  promptBar: $('promptBar'), promptIcon: $('promptIcon'), countdown: $('countdown'), results: $('results'),
  score: $('score'), combo: $('combo'), comboPill: $('comboPill'), time: $('time'), timerBar: $('timerBar'),
  status: $('status'), statusText: $('statusText'),
};
const RING_LEN = 2 * Math.PI * 42, TIMER_LEN = 2 * Math.PI * 44;
ui.promptBar.style.strokeDasharray = RING_LEN;
ui.timerBar.style.strokeDasharray = TIMER_LEN;

function setPrompt(show, text = '', sub = '', icon = '🙌', bottom = false) {
  ui.prompt.classList.toggle('show', show);
  ui.prompt.classList.toggle('bottom', bottom);
  if (text) ui.promptText.textContent = text;
  ui.promptSub.textContent = sub;
  ui.promptIcon.textContent = icon;
}
function setStatus(kind, text) { ui.status.className = 'status ' + kind; ui.statusText.textContent = text; }

function setState(s) {
  state = s; stateT = 0; gestureT = 0;
  ui.lobby.classList.toggle('hide', s !== 'lobby');
  ui.hud.classList.toggle('show', s === 'countdown' || s === 'play');
  ui.results.classList.toggle('show', s === 'results');
  document.body.classList.toggle('playing', (s === 'play' || s === 'countdown') && !demo);
  if (s !== 'ready' && s !== 'results') setPrompt(false);
  ui.prompt.classList.remove('mid');
  send({ t: 'state', s });
  if (s === 'countdown') { resetGame(); audio.whoosh(); openEditor(false); }
  if (s === 'play') { audio.go(); audio.music(true); popupCenter('Los!', '#e2574c'); }
  if (s === 'results') showResults();
  if (s === 'lobby' || s === 'ready') audio.music(false);
}

function resetGame() {
  Object.assign(game, { score: 0, time: GAME_TIME, popped: 0, combo: 0, bestCombo: 0, lastHit: -9, mult: 1, spawnT: 0.4, cloudT: rand(10, 12), safeUntil: 0, cloudHits: 0 });
  for (const b of balloonPool) if (!b.ambient) b.hide();
  for (const c of clouds2) c.hide();
  ui.score.textContent = '0'; ui.combo.textContent = '×1'; ui.time.textContent = GAME_TIME;
  ui.timerBar.style.strokeDashoffset = 0; ui.timerBar.parentElement.parentElement.classList.remove('low');
}

function showResults() {
  audio.music(false); audio.end();
  const record = game.score > best && game.score > 0;
  if (record) { best = game.score; try { localStorage.setItem('ballonplatzer.best', best); } catch { /* */ } }
  // Spielzeit für die Startseite («Deine Bewegung»)
  try { const st = JSON.parse(localStorage.getItem('slope.stats')) || {}; st.ballon = (st.ballon || 0) + GAME_TIME; localStorage.setItem('slope.stats', JSON.stringify(st)); } catch { /* privat */ }
  $('finalScore').textContent = game.score;
  $('statPopped').textContent = game.popped;
  $('statCombo').textContent = game.bestCombo;
  $('statBest').textContent = best;
  $('resultsTitle').textContent = game.score >= 600 ? 'Ballon-Profi!' : game.score >= 300 ? 'Super gemacht!' : 'Gut gespielt!';
  ui.results.classList.toggle('record', record);
  for (const b of balloonPool) if (b.active && !b.ambient) { burst(b.g.position, [b.color, '#ffffff'], 20, 3); b.hide(); }
  for (const c of clouds2) if (c.active) { burst(c.g.position, ['#8b86a8', '#a9a4c4'], 16, 2.5); c.hide(); }
  burst(new THREE.Vector3(-3, 3, 0), BALLOON_COLORS, 80, 6);
  burst(new THREE.Vector3(3, 3, 0), BALLOON_COLORS, 80, 6);
  send({ t: 'result', score: game.score, record });
}

function hitBalloon(b, side) {
  b.hide();
  const isGold = b.kind === 'gold';
  game.combo = now - game.lastHit < 1.6 ? game.combo + 1 : 1;
  game.lastHit = now;
  game.bestCombo = Math.max(game.bestCombo, game.combo);
  const mult = game.combo >= 14 ? 4 : game.combo >= 9 ? 3 : game.combo >= 4 ? 2 : 1;
  if (mult > game.mult) { popupCenter(`Combo ×${mult}!`, '#e2574c'); audio.combo(mult); }
  game.mult = mult;
  const pts = (isGold ? 50 : 10) * mult;
  game.score += pts; game.popped++;
  ui.score.textContent = game.score; bump(ui.score);
  ui.combo.textContent = '×' + mult; if (game.combo > 1) bump(ui.comboPill);

  const pos = b.g.position.clone();
  burst(pos, isGold ? ['#ffd84d', '#ffc93d', '#fff3b0', '#ffffff'] : [b.color, b.color, '#ffffff', '#ffd84d'], isGold ? 60 : 34, isGold ? 5 : 4);
  ring(pos, isGold ? '#ffe27a' : '#ffffff');
  popupAt(pos, '+' + pts, isGold ? '#f2a900' : b.color);
  if (isGold) audio.gold(); else audio.pop(game.combo - 1);
  avatar.flash(side);
  send({ t: 'hit', gold: isGold });
}

function hitCloud(c) {
  c.hide();
  game.safeUntil = now + 1.5; // kurz unverwundbar nach einem Treffer
  game.cloudHits = (game.cloudHits || 0) + 1;
  game.score = Math.max(0, game.score - 10);
  game.combo = 0; game.mult = 1;
  ui.score.textContent = game.score; ui.combo.textContent = '×1';
  const pos = c.g.position.clone();
  burst(pos, ['#8b86a8', '#a9a4c4', '#6f6a8c', '#ffd84d'], 40, 3.5, 1.4);
  popupAt(pos, '−10', '#6f6a8c');
  audio.bad();
  shakeAmt = 0.35; avatar.shake = 1;
  const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  send({ t: 'bad' });
}

// Abstand Punkt -> Strecke (für schnelle Wischbewegungen)
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
const prevHand = { l: new THREE.Vector3(), r: new THREE.Vector3() };

function updatePlay(dt, realDt = dt) {
  const progress = 1 - game.time / GAME_TIME;
  game.time = Math.max(0, game.time - realDt);
  const secs = Math.ceil(game.time);
  if (ui.time.textContent != secs) {
    ui.time.textContent = secs;
    if (secs <= 5 && secs > 0) { audio.tick(); ui.timerBar.parentElement.parentElement.classList.add('low'); }
  }
  ui.timerBar.style.strokeDashoffset = TIMER_LEN * (1 - game.time / GAME_TIME);

  // Ballone spawnen – werden mit der Zeit schneller und häufiger
  game.spawnT -= dt;
  const active = balloonPool.filter((b) => b.active && !b.ambient).length;
  if (game.spawnT <= 0 && active < 10) {
    game.spawnT = lerp(1.05, 0.42, progress) * rand(0.8, 1.2);
    const gold = progress > 0.12 && Math.random() < 0.08;
    const center = demo ? demoShift : pose.shift;
    let x = clamp(center + (Math.random() + Math.random() - 1) * 3.2, -SPAWN_X, SPAWN_X);
    getBalloon().spawn({ x, speed: lerp(0.95, 1.6, progress) * rand(0.85, 1.15) * (gold ? 1.35 : 1), kind: gold ? 'gold' : 'normal' });
  }
  // Gewitterwolken: erst nach 10 s, höchstens 1 (gegen Ende 2) gleichzeitig.
  game.cloudT -= dt;
  const nClouds = clouds2.filter((c) => c.active).length;
  if (game.cloudT <= 0 && nClouds < (progress > 0.7 ? 2 : 1)) {
    game.cloudT = lerp(8, 4.5, progress) * rand(0.85, 1.2);
    // Zwei Bahnen vor der Figur: Höhe erhobene Hände oder Brusthöhe. Arme unten = sicher.
    const shY = (avatar.J.lSh.cur.y + avatar.J.rSh.cur.y) / 2;
    const y = Math.random() < 0.55 ? shY + rand(0.65, 0.8) : shY + rand(-0.1, 0.05);
    const fromLeft = Math.random() < 0.5;
    getCloud().spawn(fromLeft, y, rand(0.9, 1.3) + progress * 0.5, 1.1);
    popupAt(new THREE.Vector3(fromLeft ? -4.6 : 4.6, y + 0.7, 1.1), '⚡ Hände weg!', '#6f6a8c');
  }

  // Treffer prüfen
  const J = avatar.J;
  for (const b of balloonPool) {
    if (!b.active || b.ambient) continue;
    b.update(dt);
    if (b.y > 5.6) { b.hide(); continue; }
    if (b.age < 0.15) continue;
    for (const s of ['l', 'r']) {
      const h = J[s + 'Ha'].cur, p = prevHand[s];
      if (segDist(b.x, b.y, p.x, p.y, h.x, h.y) < BALLOON_R * b.scale + HAND_R) { hitBalloon(b, s); break; }
    }
    // Kopfball!
    if (b.active && Math.hypot(b.x - J.head.cur.x, b.y - (J.head.cur.y + 0.1)) < BALLOON_R + 0.72) hitBalloon(b, 'head');
  }
  for (const c of clouds2) {
    if (!c.active) continue;
    c.update(dt);
    if (Math.abs(c.x) > 8) { c.hide(); continue; }
    if (!c.dangerous || now < game.safeUntil) continue;
    // Nur die Hände zählen («Finger weg!»), mit kleinerem Trefferradius als bei Ballonen
    for (const s of ['l', 'r']) {
      const h = J[s + 'Ha'].cur, p = prevHand[s];
      if (segDist(c.x, c.y, p.x, p.y, h.x, h.y) < 0.36 + 0.12) { hitCloud(c); break; }
    }
  }
  if (game.time <= 0) setState('results');
}

// Deko-Ballone im Hintergrund (Startbildschirm & Resultat)
let ambientT = 0;
function updateAmbient(dt) {
  const want = state === 'lobby' || state === 'results' || state === 'ready';
  ambientT -= dt;
  if (want && ambientT <= 0) {
    ambientT = rand(0.5, 1.1);
    const x = pick([rand(-12, -3.5), rand(3.5, 12), rand(-12, 12)]);
    getBalloon().spawn({ x, y: -3, z: rand(-9, -3.5), speed: rand(0.5, 0.9), ambient: true, scale: rand(0.9, 1.3) });
  }
  for (const b of balloonPool) {
    if (!b.active || !b.ambient) continue;
    b.update(dt);
    if (b.y > 9) b.hide();
  }
}

/* ================================================================
   Hauptschleife
   ================================================================ */
const clock = new THREE.Clock();
let frameAcc = 0, frameN = 0, qualityChecks = 0;

function tick() {
  const realDt = Math.min(clock.getDelta(), 0.25); // echte Zeit für Timer & Gesten
  const dt = Math.min(realDt, 0.05);                // begrenzt für Physik
  now += realDt; stateT += realDt;

  // Avatar-Ziele: echte Pose, Maus-Demo oder Ruhe-Animation
  if (demo) {
    idlePose(now, demoShift, state === 'results' ? 'cheer' : 'pointer', pointer);
  } else if (!tracked()) {
    idlePose(now, 0, state === 'lobby' ? 'wave' : state === 'results' ? 'cheer' : 'idle');
  }
  prevHand.l.copy(avatar.J.lHa.cur); prevHand.r.copy(avatar.J.rHa.cur);
  avatar.update(dt, now);

  // Zustandslogik
  if (state === 'ready') {
    if (!tracked()) {
      gestureT = 0;
      setPrompt(true, 'Stell dich vor die Kamera', 'Das Handy muss dich von Kopf bis Fuss sehen', '📱');
    } else {
      gestureT = armsUp() ? gestureT + realDt : Math.max(0, gestureT - realDt * 2);
      setPrompt(true, demo ? 'Klick oder Leertaste zum Starten' : 'Beide Arme hoch zum Starten!', '', '🙌');
      if (gestureT > 0.8) setState('countdown');
    }
    ui.promptBar.style.strokeDashoffset = RING_LEN * (1 - clamp(gestureT / 0.8, 0, 1));
  } else if (state === 'countdown') {
    const n = 3 - Math.floor(stateT / 0.8);
    if (ui.countdown.dataset.n != n) {
      ui.countdown.dataset.n = n;
      ui.countdown.innerHTML = n > 0 ? `<span>${n}</span>` : '';
      if (n > 0) audio.tick();
    }
    if (stateT >= 2.4) setState('play');
  } else if (state === 'play') {
    const lost = !tracked();
    if (lost && !paused && stateT > 0.5) { paused = true; setPrompt(true, 'Pause', 'Komm zurück ins Bild der Kamera', '⏸️'); ui.prompt.classList.add('mid'); audio.music(false); }
    if (!lost && paused) { paused = false; setPrompt(false); ui.prompt.classList.remove('mid'); audio.music(true); }
    if (!paused) updatePlay(dt, realDt);
  } else if (state === 'results') {
    if (stateT > 3) {
      if (tracked()) {
        gestureT = armsUp() ? gestureT + realDt : Math.max(0, gestureT - realDt * 2);
        setPrompt(true, demo ? 'Klick für noch eine Runde' : 'Arme hoch für noch eine Runde!', '', '🔁', true);
        ui.promptBar.style.strokeDashoffset = RING_LEN * (1 - clamp(gestureT / 0.8, 0, 1));
        if (gestureT > 0.8) { ui.results.classList.remove('show'); setState('countdown'); }
      }
      if (stateT > 45 && !conn && !demo) setState('lobby');
    }
  }
  if (state !== 'play') {
    for (const c of clouds2) if (c.active) { c.update(dt); if (Math.abs(c.x) > 8) c.hide(); }
  }

  updateAmbient(dt);
  updateConfetti(dt);
  updateRings(dt);
  for (const c of clouds) { c.g.position.x += c.speed * dt; if (c.g.position.x > 45) c.g.position.x = -45; }

  // Kamera: sanftes Mitgehen + Wackeln bei Gewitter
  const focus = demo ? demoShift : (tracked() ? pose.shift : 0);
  shakeAmt = Math.max(0, shakeAmt - dt * 1.2);
  // Nahaufnahme beim Anpassen des Charakters
  showcaseT = Math.max(0, showcaseT - realDt);
  const wantZoom = state !== 'play' && state !== 'countdown' && (editorOpen || showcaseT > 0) ? 1 : 0;
  camZoom = lerp(camZoom, wantZoom, damp(3, realDt));
  const z = camZoom * camZoom * (3 - 2 * camZoom);
  const ax = avatar.J.head.cur.x;
  camera.position.set(
    lerp(focus * 0.18 + Math.sin(now * 0.3) * 0.15, ax - 0.35 + Math.sin(now * 0.5) * 0.3, z) + (Math.random() - 0.5) * shakeAmt,
    lerp(1.1 + Math.sin(now * 0.4) * 0.05, 0.8, z) + (Math.random() - 0.5) * shakeAmt,
    lerp(camDist, 7.4, z),
  );
  camera.lookAt(lerp(CAM_TARGET.x + focus * 0.12, ax - 0.75, z), lerp(CAM_TARGET.y, 0.05, z), 0);

  renderer.render(scene, camera);

  // Automatische Qualitätsanpassung für schwache TV-Browser
  frameAcc += dt; frameN++;
  if (frameAcc > 2 && qualityChecks < 3) {
    const avg = frameAcc / frameN; frameAcc = 0; frameN = 0; qualityChecks++;
    if (avg > 0.024 && pixelRatio > 1) { pixelRatio = 1; renderer.setPixelRatio(1); resize(); }
    else if (avg > 0.028 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => o.material && (o.material.needsUpdate = true)); }
  }
  requestAnimationFrame(tick);
}

/* ================================================================
   Verbindung zum Handy (PeerJS / WebRTC)
   ================================================================ */
let peer = null, conn = null, code = '', retries = 0;

function peerOptions() {
  // ?peer=host:port erlaubt einen eigenen PeerJS-Server (z. B. lokal zum Testen)
  const p = params.get('peer');
  if (!p) return { debug: 1 };
  const [host, port] = p.split(':');
  return { host, port: +port || 443, path: '/', secure: location.protocol === 'https:', debug: 1 };
}
function newCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]; return s; }

function startPeer() {
  if (!window.Peer) { setStatus('err', 'Verbindungsdienst nicht geladen'); return; }
  try { code = sessionStorage.getItem('ballonplatzer.code') || newCode(); } catch { code = newCode(); }
  setStatus('wait', 'Verbinde …');
  peer = new window.Peer(PEER_PREFIX + code, peerOptions());
  peer.on('open', () => {
    retries = 0;
    try { sessionStorage.setItem('ballonplatzer.code', code); } catch { /* */ }
    renderJoin();
    if (!conn) setStatus('wait', 'Warte auf Handy …');
  });
  peer.on('connection', (c) => {
    if (conn) { try { conn.close(); } catch { /* */ } }
    conn = c;
    c.on('open', () => {
      setStatus('ok', 'Handy verbunden');
      audio.whoosh();
      send({ t: 'state', s: state });
      if (state === 'lobby' && !demo) setState('ready');
    });
    c.on('data', onData);
    c.on('close', () => {
      if (conn !== c) return;
      conn = null; setStatus('wait', 'Handy getrennt – warte …');
      if (!demo && state !== 'play') setTimeout(() => { if (!conn && !demo) setState('lobby'); }, 4000);
    });
  });
  peer.on('disconnected', () => { setStatus('wait', 'Verbindung unterbrochen …'); setTimeout(() => peer && !peer.destroyed && peer.reconnect(), 1500); });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') {
      peer.destroy();
      if (++retries > 2) { try { sessionStorage.removeItem('ballonplatzer.code'); } catch { /* */ } }
      setTimeout(startPeer, 1500);
    } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(e.type)) {
      setStatus('err', 'Keine Verbindung zum Server – neuer Versuch …');
      setTimeout(() => { if (peer) peer.destroy(); startPeer(); }, 4000);
    } else {
      console.warn('Peer-Fehler', e.type, e);
    }
  });
}

function send(msg) { if (conn && conn.open) { try { conn.send(msg); } catch { /* */ } } }

function onData(msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'p') { if (msg.k) applyPose(msg.k, msg.w, msg.h); }
  else if (msg.t === 'char') applyCharacter(msg.c, true);
  else if (msg.t === 'hello') send({ t: 'state', s: state });
}

function controllerUrl() {
  const u = new URL('../controller.html', location.href);
  u.search = ''; u.hash = '';
  u.searchParams.set('c', code);
  if (params.get('peer')) u.searchParams.set('peer', params.get('peer'));
  return u.toString();
}

function renderJoin() {
  $('code').textContent = code;
  const url = controllerUrl();
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '').replace(/\?.*$/, '');
  if (!window.qrcode) { $('qr').innerHTML = '<small>QR nicht verfügbar</small>'; return; }
  const qr = window.qrcode(0, 'M'); qr.addData(url); qr.make();
  const n = qr.getModuleCount();
  const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  let dots = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (qr.isDark(r, c) && !inFinder(r, c)) dots += `<rect x="${c}" y="${r}" width="1.02" height="1.02" rx="0.28"/>`;
  }
  const finder = (x, y) => `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="0.6" fill="none" stroke="#3f325e" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.35" fill="#3f325e"/>`;
  $('qr').innerHTML = `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="QR-Code"><g fill="#3f325e">${dots}</g>${finder(0, 0)}${finder(n - 7, 0)}${finder(0, n - 7)}</svg>`;
}

/* ================================================================
   Eingaben: Maus-Demo, Tastatur/Fernbedienung, Buttons
   ================================================================ */
function setDemo(on) {
  demo = on;
  $('demoBtn').textContent = on ? 'Maus-Modus beenden' : 'Ohne Handy testen (Maus)';
  if (on) { audio.unlock(); updateSoundBtn(); setStatus('ok', 'Maus-Modus'); setState('ready'); }
  else setStatus(conn ? 'ok' : 'wait', conn ? 'Handy verbunden' : 'Warte auf Handy …');
  if (!on) setState(conn ? 'ready' : 'lobby');
}
$('demoBtn').addEventListener('click', (e) => { e.stopPropagation(); setDemo(!demo); });

const raycaster = new THREE.Raycaster();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
window.addEventListener('pointermove', (e) => {
  if (!demo) return;
  const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  pointer = raycaster.ray.intersectPlane(plane, new THREE.Vector3()) || pointer;
});
window.addEventListener('pointerdown', (e) => {
  audio.unlock(); updateSoundBtn();
  if (e.target.closest('button')) return;
  if (demo && (state === 'ready' || (state === 'results' && stateT > 2))) { ui.results.classList.remove('show'); setState('countdown'); }
});
window.addEventListener('keydown', (e) => {
  audio.unlock(); updateSoundBtn();
  const k = e.key.toLowerCase();
  if (k === 'd' && !e.repeat) setDemo(!demo);
  if (k === 'f') toggleFullscreen();
  if (k === 'c' && state !== 'play' && state !== 'countdown') openEditor(!editorOpen);
  if (k === 'escape') openEditor(false);
  if (k === 'm') { audio.setMuted(!audio.muted); updateSoundBtn(); }
  if (demo && (k === 'arrowleft' || k === 'a')) demoShift = clamp(demoShift - 0.4, -SHIFT_MAX, SHIFT_MAX);
  if (demo && (k === 'arrowright')) demoShift = clamp(demoShift + 0.4, -SHIFT_MAX, SHIFT_MAX);
  // Leertaste / OK-Taste der Fernbedienung startet
  if ((k === ' ' || k === 'enter') && (state === 'ready' || (state === 'results' && stateT > 2)) && tracked()) {
    ui.results.classList.remove('show'); setState('countdown');
  }
});

function updateSoundBtn() {
  const b = $('soundBtn');
  b.textContent = !audio.ready ? '🔇 Ton an' : audio.muted ? '🔇 Ton aus' : '🔊 Ton an';
}
$('soundBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (!audio.ready) audio.unlock(); else audio.setMuted(!audio.muted);
  setTimeout(updateSoundBtn, 50);
});
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
$('fsBtn').addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });

// Logo-Buchstaben einzeln einfärben
document.querySelectorAll('.logo .word').forEach((w, wi) => {
  const colors = ['#ff8fab', '#ffb470', '#ffd84d', '#6fe0b0', '#7cc8ff', '#a98bff', '#ff9ee0'];
  [...w.dataset.word].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'ch'; s.textContent = ch;
    s.style.setProperty('--c', colors[(i + wi * 3) % colors.length]);
    s.style.setProperty('--i', i + wi * 6);
    w.appendChild(s);
  });
});

/* ================================================================
   Charakter-Editor auf dem TV (Maus) + Outfit vom Handy
   ================================================================ */
function applyCharacter(c, fromPhone = false) {
  c = sanitize(c);
  avatar.setConfig(c);
  avatar.celebrate();
  saveConfig(CHAR_KEY, c);
  if (fromPhone) editor.set(c);
  if (state !== 'play' && state !== 'countdown') {
    showcaseT = Math.max(showcaseT, 2.5);
    const p = avatar.J.head.cur.clone(); p.y += 0.4;
    burst(p, [c.topColor, c.hairColor, c.bottomColor, '#ffffff'], 26, 3, 0.9);
    audio.pop(4);
  }
}
const editor = createEditor($('editorRoot'), avatar.cfg, (c) => applyCharacter(c));
function openEditor(on) {
  editorOpen = on;
  $('editorPanel').classList.toggle('show', on);
  ui.lobby.classList.toggle('editing', on);
}
$('charBtn').addEventListener('click', (e) => { e.stopPropagation(); audio.unlock(); openEditor(true); });
$('editorDone').addEventListener('click', (e) => { e.stopPropagation(); openEditor(false); });
$('editorPanel').addEventListener('pointerdown', (e) => e.stopPropagation());

/* ================================================================
   Start
   ================================================================ */
idlePose(0, 0, 'wave'); avatar.snap();
setState('lobby');
startPeer();
if (params.has('demo')) setDemo(true);
tick();

// Test-Hilfe (Konsole): window.__bp.applyPose(...)
window.__bp = { applyPose, get state() { return state; }, setState, game, avatar, clouds: clouds2 };
