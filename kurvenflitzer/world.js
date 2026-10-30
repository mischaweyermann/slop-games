// Kurvenflitzer – Welt: 3 Grand Prix mit je 4 Strecken (Daten + Geometrie), Landschaft je Cup,
// Strecken-Fallen (Turbo-Pads, Öl, Schanzen, Glatteis, Tiere auf der Strasse, Kuhglocken-Pendel …) und Go-Karts.
import * as THREE from 'three';

export const HALF_W = 7;            // halbe Strassenbreite (m)
export const GRASS = HALF_W + 1.4;  // ab hier Wiese (bremst)
export const WALL = HALF_W + 8;     // Reifenstapel
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export const SPH = new THREE.SphereGeometry(1, 28, 18);
export const SPH_LO = new THREE.SphereGeometry(1, 16, 10);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 20);
const SHARED = new Set([SPH, SPH_LO, CYL]);
export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
export const mesh = (geo, m, parent, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], shadow = true) => {
  const o = new THREE.Mesh(geo, m); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r);
  o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
};

/* ================================================================
   Grand Prix und Strecken
   ================================================================ */
export const THEMES = {
  abend: {
    road: '#8a4a50', line: '#f7e9a6', curb: ['#e2574c', '#f6e3e1'], ground: '#a85c5a', sand: '#c27a70',
    hills: ['#a9555c', '#b8646a', '#c9767a', '#9c4a52'], sky: ['#8e3a45', '#e88a78', '#f8d2b4'], fog: '#e7a593',
    hemi: ['#ffd9c2', '#7d3a40', 1.2], sun: ['#ffc9a0', 2.7], glow: [255, 240, 214], cloud: '#f9d7c6',
    trunk: '#4b1c22', tops: ['#7e3d45', '#6f2f37', '#9c4a52', '#8a3b44', '#e2574c', '#f2c94c'], cones: ['#6f2f37', '#7e3d45', '#9c4a52', '#e2574c'],
    deco: 'mushroom', animal: 'cow', bell: '#f2c94c', arch: '#e8574f', archText: '#f7e9a6', oil: '#2a1430', pad: '#f7e9a6',
  },
  schnee: {
    road: '#6f7d96', line: '#ffffff', curb: ['#5aa9c9', '#ffffff'], ground: '#eef3f8', sand: '#d5e1ee',
    hills: ['#ffffff', '#e6eef7', '#d3e0ee', '#c2d3e6'], sky: ['#4f6fa3', '#a9c4e6', '#eaf2fb'], fog: '#dbe7f3',
    hemi: ['#eef4ff', '#8aa0bf', 1.35], sun: ['#fff1de', 2.3], glow: [255, 250, 236], cloud: '#ffffff',
    trunk: '#5b3a2a', tops: ['#2f5d4e', '#3e6e5c', '#285246'], cones: ['#2f5d4e', '#3e6e5c', '#264a40'], snowCaps: true,
    deco: 'snowman', animal: 'marmot', bell: '#d9b84a', arch: '#5aa9c9', archText: '#ffffff', oil: '#2b3550', pad: '#bfe8ff',
  },
  schoggi: {
    road: '#5a3524', line: '#ffd7e2', curb: ['#f3a6b8', '#fff6ee'], ground: '#f5bfd0', sand: '#eaa3b8',
    hills: ['#f7c6d3', '#c88a6a', '#f2d3a6', '#e9a6c4'], sky: ['#7e4b8f', '#f39ab8', '#ffe0c8'], fog: '#f4c3cf',
    hemi: ['#ffe8f0', '#a0647a', 1.25], sun: ['#ffd8c4', 2.5], glow: [255, 236, 220], cloud: '#fff0f5',
    trunk: '#fff6ee', tops: ['#f3a6b8', '#9b7fd1', '#7fd1c1', '#f2c94c', '#e2574c'], cones: ['#8a4a32', '#6b3a26', '#a35d3f'],
    deco: 'candy', animal: 'gummy', bell: '#c88a6a', arch: '#f3a6b8', archText: '#5a3524', oil: '#d98a2b', pad: '#fff2a8',
  },
};

// Strecken: Kontrollpunkte (x, z) eines geschlossenen Splines + Fallen (Anzahl je Art)
export const TRACKS = [
  { name: 'Erdbeerring', ctrl: [[-40, 8], [-8, -35], [6, -105], [50, -152], [120, -162], [165, -125], [162, -68], [125, -30], [120, 20], [155, 65], [150, 122], [100, 162], [30, 170], [-35, 152], [-100, 152], [-150, 112], [-158, 58], [-112, 22]], features: { boost: 3 } },
  { name: 'Kuhweide', ctrl: [[-46, 156], [-145, 156], [-214, 128], [-238, 35], [-208, -49], [-164, -85], [-120, -167], [-77, -200], [1, -216], [109, -176], [139, -118], [159, -61], [214, 3], [241, 97], [200, 159], [80, 182], [16, 160]], features: { cows: 3, boost: 2 } },
  { name: 'Seeufer-Sprung', ctrl: [[123, 174], [210, 101], [201, 8], [107, -56], [88, -107], [47, -200], [-61, -208], [-132, -189], [-195, -74], [-212, -10], [-155, 59], [-87, 96], [-42, 188], [43, 234]], features: { ramp: 2, boost: 2, oil: 2 } },
  { name: 'Pilzpass', ctrl: [[142, 47], [97, 99], [86, 135], [39, 191], [0, 202], [-52, 182], [-81, 164], [-114, 101], [-115, 55], [-137, 0], [-175, -67], [-155, -159], [-106, -177], [-35, -150], [6, -146], [48, -141], [96, -148], [154, -128], [185, -55], [168, -4]], features: { hammer: 1, ramp: 1, cows: 2, oil: 3 } },

  { name: 'Pistenring', ctrl: [[86, -198], [154, -164], [215, -87], [202, 0], [204, 84], [169, 164], [115, 207], [12, 198], [-79, 216], [-127, 192], [-218, 129], [-230, 64], [-198, -29], [-178, -127], [-132, -201], [-79, -217], [10, -222]], features: { ice: 3, boost: 2 } },
  { name: 'Murmeli-Pass', ctrl: [[178, 74], [156, 117], [127, 165], [56, 184], [1, 179], [-105, 194], [-141, 161], [-160, 69], [-186, 29], [-233, -54], [-207, -123], [-130, -142], [-73, -157], [-30, -181], [58, -175], [105, -153], [132, -117], [205, -78], [230, -14]], features: { cows: 4, ice: 2 } },
  { name: 'Schanzentisch', ctrl: [[0, -228], [100, -221], [151, -190], [183, -133], [152, -48], [159, 4], [188, 72], [185, 136], [150, 187], [82, 225], [-3, 202], [-37, 182], [-82, 181], [-168, 166], [-201, 82], [-203, 30], [-175, -11], [-165, -76], [-141, -132], [-123, -183], [-65, -217]], features: { ramp: 3, ice: 2, boost: 2 } },
  { name: 'Glockenturm', ctrl: [[128, -82], [159, -54], [185, 6], [150, 45], [118, 59], [83, 91], [72, 121], [30, 143], [-25, 135], [-57, 98], [-107, 95], [-160, 91], [-176, 61], [-162, 3], [-139, -46], [-139, -87], [-100, -118], [-49, -111], [-14, -110], [10, -113], [60, -127], [107, -97]], features: { hammer: 3, cows: 2, ice: 2 } },

  { name: 'Praliné-Park', ctrl: [[-117, 7], [-146, -61], [-126, -120], [-66, -129], [-12, -158], [15, -154], [53, -103], [106, -93], [134, -73], [144, -12], [95, 30], [83, 95], [76, 154], [36, 193], [-39, 171], [-58, 125], [-71, 77], [-98, 36]], features: { choc: 3, boost: 3 } },
  { name: 'Karamell-Kreuz', ctrl: [[-50, 117], [-81, 82], [-151, 70], [-181, -4], [-108, -60], [-82, -76], [-59, -142], [1, -185], [57, -144], [87, -95], [155, -57], [153, 12], [106, 51], [90, 97], [73, 182], [13, 194]], features: { ramp: 2, oil: 3, choc: 2 } },
  { name: 'Gummibärli-Gasse', ctrl: [[-54, -182], [-6, -240], [63, -200], [57, -72], [112, -47], [191, -5], [202, 94], [94, 129], [37, 98], [6, 102], [-66, 207], [-135, 174], [-114, 44], [-119, -3], [-133, -63], [-103, -109]], features: { hammer: 2, cows: 4, boost: 2 } },
  { name: 'Grosses Finale', ctrl: [[157, -122], [213, -69], [197, -5], [117, 36], [99, 57], [109, 130], [88, 206], [24, 226], [-36, 171], [-61, 140], [-105, 127], [-161, 122], [-190, 62], [-168, -7], [-171, -59], [-176, -126], [-127, -155], [-50, -119], [-11, -121], [43, -193], [83, -202], [138, -151]], features: { ramp: 2, hammer: 2, cows: 2, oil: 2, choc: 2, boost: 2 } },
];
export const CUPS = [
  { id: 'abendrot', name: 'Abendrot-Cup', short: 'Abendrot', theme: 'abend', tracks: [0, 1, 2, 3], blurb: 'Kühe, Ölflecken und die erste Schanze' },
  { id: 'gletscher', name: 'Gletscher-Cup', short: 'Gletscher', theme: 'schnee', tracks: [4, 5, 6, 7], blurb: 'Glatteis, Murmeli und Riesen-Kuhglocken' },
  { id: 'schoggi', name: 'Schoggi-Cup', short: 'Schoggi', theme: 'schoggi', tracks: [8, 9, 10, 11], blurb: 'Klebrige Schoggi, Karamell und Gummibärli' },
];

/* ================================================================
   Aktuelle Strecke: geschlossener Spline, abgetastet in N Punkte
   ================================================================ */
export const N = 1000;
export let TRACK_LEN = 1, SEG = 1;
export const T = []; // { p, t (Tangente), r (rechts), R (Kurvenradius), turn (+ rechts / − links) }
export let TRACK = TRACKS[0];
export function setTrack(def) {
  TRACK = def;
  const curve = new THREE.CatmullRomCurve3(def.ctrl.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  TRACK_LEN = curve.getLength(); SEG = TRACK_LEN / N;
  const pts = curve.getSpacedPoints(N);
  T.length = 0;
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
setTrack(TRACKS[0]);
export const idxAt = (s) => Math.floor((((s / SEG) % N) + N) % N);
export const sample = (s) => {
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
export function nearest(pos, hint) {
  let best = hint, bd = Infinity;
  for (let o = -30; o <= 30; o++) {
    const i = (hint + o + N) % N;
    const d = (T[i].p.x - pos.x) ** 2 + (T[i].p.z - pos.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
export function nearestGlobal(pos) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < N; i += 4) { const d = (T[i].p.x - pos.x) ** 2 + (T[i].p.z - pos.z) ** 2; if (d < bd) { bd = d; best = i; } }
  return nearest(pos, best);
}
export const lateral = (pos, i) => (pos.x - T[i].p.x) * T[i].r.x + (pos.z - T[i].p.z) * T[i].r.z;
// Position entlang der Strecke (m) für einen Punkt in der Nähe von Index i
export const along = (pos, i) => i * SEG + (pos.x - T[i].p.x) * T[i].t.x + (pos.z - T[i].p.z) * T[i].t.z;
export function bounds() {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const s of T) { x0 = Math.min(x0, s.p.x); x1 = Math.max(x1, s.p.x); z0 = Math.min(z0, s.p.z); z1 = Math.max(z1, s.p.z); }
  return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, size: Math.max(x1 - x0, z1 - z0) };
}

/* ---------- Hilfen ---------- */
function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
// Zufall mit festem Startwert: dieselbe Strecke hat ihre Fallen immer am gleichen Ort
function seeded(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
// Alles einer Strecke wieder freigeben (beim Streckenwechsel)
export function disposeWorld(group) {
  if (!group) return;
  group.parent && group.parent.remove(group);
  group.traverse((o) => {
    if (o.geometry && !SHARED.has(o.geometry)) o.geometry.dispose();
    const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of ms) { for (const k of ['map', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
  });
}

/* ================================================================
   Landschaft einer Strecke (wird bei jedem Streckenwechsel neu gebaut)
   ================================================================ */
export function buildWorld(scene, def = TRACK, themeId = 'abend') {
  const th = THEMES[themeId] || THEMES.abend;
  const world = new THREE.Group(); world.name = 'world';
  scene.add(world);
  const B = bounds();

  const roadTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = th.road; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '40,30,60'},0.05)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = th.line; g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
    g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
  });
  const curbTex = canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = th.curb[0]; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = th.curb[1]; g.fillRect(0, h / 2, w, h / 2);
  });

  function ribbon(off0, off1, y, vScale, texture, color = '#ffffff', i0 = 0, i1 = N, extra = {}) {
    const pos = [], uv = [], idx = [];
    const n = i1 - i0;
    for (let k = 0; k <= n; k++) {
      const s = T[(i0 + k) % N];
      for (const [q, off] of [[0, off0], [1, off1]]) {
        pos.push(s.p.x + s.r.x * off, y, s.p.z + s.r.z * off);
        uv.push(q, (k * SEG) / vScale);
      }
      if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: texture, color, roughness: 0.95, ...extra }));
    m.receiveShadow = true; world.add(m);
    return m;
  }
  ribbon(-HALF_W, HALF_W, 0.03, 14, roadTex);
  ribbon(-HALF_W - 1.3, -HALF_W, 0.04, 4, curbTex);
  ribbon(HALF_W, HALF_W + 1.3, 0.04, 4, curbTex);

  // Boden, Saum, Hügel, Himmel
  {
    const ground = mesh(new THREE.CircleGeometry(800, 64), mat(th.ground, { roughness: 1 }), world, [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
    ground.receiveShadow = true;
    ribbon(-HALF_W - 4, -HALF_W - 1.3, 0.015, 10, null, th.sand);
    ribbon(HALF_W + 1.3, HALF_W + 4, 0.015, 10, null, th.sand);
    const hillMats = th.hills.map((c) => mat(c, { roughness: 1 }));
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand(-0.1, 0.1), d = rand(340, 440), r = rand(50, 110);
      mesh(SPH, pick(hillMats), world, [B.cx + Math.cos(a) * d, -r * 0.15, B.cz + Math.sin(a) * d], [r, r * rand(0.3, 0.5), r], [0, 0, 0], false);
    }
    world.add(new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
        uniforms: { top: { value: new THREE.Color(th.sky[0]) }, mid: { value: new THREE.Color(th.sky[1]) }, bottom: { value: new THREE.Color(th.sky[2]) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = vP.y; vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.15, 0.6, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    ));
    // Tiefstehende Sonne
    {
      const [r0, g0, b0] = th.glow;
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, `rgba(${r0},${g0},${b0},1)`); grd.addColorStop(0.2, `rgba(${r0},${g0},${b0},1)`); grd.addColorStop(0.36, `rgba(${r0},${g0 - 26},${b0 - 44},.55)`); grd.addColorStop(1, `rgba(${r0},${g0 - 40},${b0 - 60},0)`);
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, toneMapped: false }));
      s.position.set(330, 40, -470); s.scale.setScalar(240); world.add(s);
    }
    const cloudMat = mat(th.cloud, { roughness: 1, emissive: th.cloud, emissiveIntensity: 0.4 });
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group();
      [[0, 0, 1], [1.1, -0.2, 0.75], [-1.1, -0.25, 0.72], [0.45, 0.5, 0.7], [-0.4, 0.4, 0.65]].forEach(([x, y, r]) => mesh(SPH_LO, cloudMat, g, [x, y, 0], [r, r * 0.85, r * 0.8], [0, 0, 0], false));
      const a = rand(0, Math.PI * 2), d = rand(250, 420);
      g.position.set(Math.cos(a) * d, rand(60, 110), Math.sin(a) * d); g.scale.setScalar(rand(10, 18)); g.lookAt(0, g.position.y, 0);
      world.add(g);
    }
  }

  // Start/Ziel: Zielstreifen + Torbogen
  {
    const s = T[0];
    const checker = canvasTex(256, 32, (g) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#3d1418' : '#f6e3e1'; g.fillRect(x * 16, y * 16, 16, 16); }
    }, false);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.8), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.9 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.atan2(s.t.x, -s.t.z);
    line.position.set(s.p.x, 0.05, s.p.z); line.receiveShadow = true; world.add(line);

    const arch = new THREE.Group();
    const pillarMat = mat('#f6e3e1', { roughness: 0.6 });
    for (const side of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.55, 0.65, 7, 20), pillarMat, arch, [side * (HALF_W + 2.2), 3.5, 0]);
      mesh(SPH, mat(th.arch, { roughness: 0.4 }), arch, [side * (HALF_W + 2.2), 7.4, 0], [0.8, 0.8, 0.8]);
    }
    const bannerTex = canvasTex(1024, 160, (g, w, h) => {
      g.fillStyle = th.arch; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 40) { g.fillStyle = (x / 40) % 2 ? '#3d1418' : '#f6e3e1'; g.fillRect(x, 0, 40, 20); g.fillStyle = (x / 40) % 2 ? '#f6e3e1' : '#3d1418'; g.fillRect(x, h - 20, 40, 20); }
      g.fillStyle = th.archText; g.font = '800 80px Poppins, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(def.name.toUpperCase(), w / 2, h / 2 + 4, w - 60);
    }, false);
    const am = mat(th.arch);
    const banner = mesh(new THREE.BoxGeometry((HALF_W + 2.2) * 2 + 1.2, 1.9, 0.4), [am, am, am, am, new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 }), new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.7 })], arch, [0, 6.4, 0]);
    banner.castShadow = true;
    arch.position.set(s.p.x, 0, s.p.z);
    arch.rotation.y = Math.atan2(s.t.x, s.t.z);
    world.add(arch);

    // Ballone am Start
    const cols = ['#e8574f', '#f39a4c', '#f2c94c', '#5aa9c9', '#9b7fd1', '#7fb069', '#f3a6b8'];
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      const b = mesh(SPH, new THREE.MeshPhysicalMaterial({ color: pick(cols), roughness: 0.3, clearcoat: 0.7 }), arch,
        [side * (HALF_W + rand(3.5, 6)), rand(5, 9), rand(-3, 3)], [0.6, 0.72, 0.6]);
      b.userData.float = rand(0, 6);
    }
  }

  // Bäume, Deko, Reifenstapel – Abstand zur Strecke prüfen
  function farFromTrack(x, z, min) {
    for (let i = 0; i < N; i += 5) if ((T[i].p.x - x) ** 2 + (T[i].p.z - z) ** 2 < min * min) return false;
    return true;
  }
  {
    const trunks = [], tops = [], cones = [];
    let tries = 0;
    while (trunks.length < 170 && tries++ < 4000) {
      const x = rand(B.x0 - 90, B.x1 + 90), z = rand(B.z0 - 90, B.z1 + 90);
      if (!farFromTrack(x, z, WALL + 6)) continue;
      const s = rand(1.6, 3.2);
      trunks.push([x, z, s]);
      (Math.random() < 0.65 ? tops : cones).push([x, z, s]);
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    const inst = (geo, material, list, fn, colors) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((it, i) => { fn(it, m4); im.setMatrixAt(i, m4); if (colors) im.setColorAt(i, col.set(pick(colors))); });
      im.castShadow = true; im.receiveShadow = true; world.add(im);
    };
    const lolli = th.deco === 'candy'; // Schoggi-Land: Lollipops statt Bäume
    inst(new THREE.CylinderGeometry(lolli ? 0.07 : 0.11, lolli ? 0.07 : 0.16, 1.2, 10), mat(th.trunk, { roughness: 0.7 }), trunks,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 0.6 * s, z), q, new THREE.Vector3(s, s, s)));
    inst(SPH, mat('#ffffff', { roughness: lolli ? 0.3 : 0.7 }), tops,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 1.65 * s, z), q, new THREE.Vector3(0.85 * s, 0.92 * s, (lolli ? 0.35 : 0.85) * s)),
      th.tops);
    inst(new THREE.ConeGeometry(0.7, 1.9, 18), mat('#ffffff', { roughness: lolli ? 0.35 : 0.7 }), cones,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 2.0 * s, z), q, new THREE.Vector3(s, s, s)),
      th.cones);
    if (th.snowCaps) inst(new THREE.ConeGeometry(0.42, 0.75, 18), mat('#ffffff', { roughness: 0.9 }), cones,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 2.7 * s, z), q, new THREE.Vector3(s, s, s)));

    // Reifenstapel aussen in Kurven
    const tires = [];
    for (let i = 0; i < N; i += 3) {
      const s = T[i];
      if (s.R > 70) continue;
      const off = -s.turn * (WALL + 0.6); // Kurvenaussenseite
      const x = s.p.x + s.r.x * off, z = s.p.z + s.r.z * off;
      for (let h = 0; h < 2; h++) tires.push([x, z, h, (i / 3) % 2]);
    }
    if (tires.length) {
      const tireGeo = new THREE.TorusGeometry(0.42, 0.22, 10, 20); tireGeo.rotateX(Math.PI / 2);
      const tim = new THREE.InstancedMesh(tireGeo, mat('#ffffff', { roughness: 0.6 }), tires.length);
      tires.forEach(([x, z, h, c], i) => {
        m4.compose(new THREE.Vector3(x, 0.22 + h * 0.42, z), q, new THREE.Vector3(1, 1, 1)); tim.setMatrixAt(i, m4);
        tim.setColorAt(i, col.set(h ? (c ? th.curb[0] : th.curb[1]) : '#3d1418'));
      });
      tim.castShadow = true; world.add(tim);
    }

    // Deko am Streckenrand: Pilze, Schneemänner oder Bonbons
    for (let n = 0, t = 0; n < 40 && t < 800; t++) {
      const i = Math.floor(rand(0, N)), side = Math.random() < 0.5 ? -1 : 1;
      const s = T[i], off = side * rand(GRASS + 3, WALL - 1.5);
      const x = s.p.x + s.r.x * off, z = s.p.z + s.r.z * off;
      if (!farFromTrack(x, z, GRASS + 2)) continue;
      const g = new THREE.Group(); const k = rand(1.2, 2.2);
      if (th.deco === 'snowman') {
        const snow = mat('#ffffff', { roughness: 0.9 });
        mesh(SPH_LO, snow, g, [0, 0.32, 0], [0.34, 0.32, 0.34]);
        mesh(SPH_LO, snow, g, [0, 0.78, 0], [0.24, 0.23, 0.24]);
        mesh(new THREE.ConeGeometry(0.04, 0.22, 8), mat('#f39a4c'), g, [0, 0.8, 0.27], [1, 1, 1], [Math.PI / 2, 0, 0]);
        mesh(CYL, mat('#3d1418'), g, [0, 1.04, 0], [0.16, 0.16, 0.16]);
        g.rotation.y = Math.atan2(-s.r.x * side, -s.r.z * side);
      } else if (th.deco === 'candy') {
        const c = mat(pick(th.tops), { roughness: 0.25 });
        mesh(SPH_LO, c, g, [0, 0.3, 0], [0.32, 0.24, 0.24]);
        for (const sx of [-1, 1]) mesh(new THREE.ConeGeometry(0.16, 0.24, 10), c, g, [sx * 0.4, 0.3, 0], [1, 1, 1], [0, 0, sx * Math.PI / 2]);
        g.rotation.y = rand(0, 6);
      } else {
        mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.3, 12), mat('#f6ecdc'), g, [0, 0.15, 0]);
        mesh(new THREE.SphereGeometry(0.26, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), mat('#e8574f', { roughness: 0.45 }), g, [0, 0.27, 0], [1, 0.75, 1]);
      }
      g.position.set(x, 0, z); g.scale.setScalar(k); world.add(g); n++;
    }
  }

  const features = buildFeatures(world, def, th);
  return { group: world, features, theme: th };
}

/* ================================================================
   Strecken-Fallen
   ================================================================ */
// Masse: len = Länge entlang der Strecke, w = Breite quer
export const FEATURE_INFO = {
  boost: { name: 'Turbo-Pad', len: 6, w: 5 },
  oil: { name: 'Ölfleck', len: 6, w: 6 },
  choc: { name: 'Schoggi-Pfütze', len: 10, w: 8 },
  ice: { name: 'Glatteis', len: 36, w: HALF_W * 2 + 2.6 },
  ramp: { name: 'Schanze', len: 8, w: HALF_W * 2, h: 1.35 },
  cows: { name: 'Tiere', len: 4, w: 3 },
  hammer: { name: 'Kuhglocke', len: 3, w: 3 },
};
function placeFeatures(def) {
  const rng = seeded(TRACKS.indexOf(def) * 7919 + 17);
  const L = TRACK_LEN;
  const boxes = [0.17, 0.42, 0.66, 0.88].map((f) => f * L);
  const used = [];
  const R = (s) => T[idxAt(s)].R;
  const minR = (s, a, b) => { let m = 1e9; for (let d = a; d <= b; d += 3) m = Math.min(m, R(s + d)); return m; };
  const RULES = { // [Platzbedarf, Prüfung]
    ramp: [32, (s, strict) => minR(s, -25, 40) > (strict ? 110 : 62)],
    hammer: [14, (s, strict) => minR(s, -35, 10) > (strict ? 70 : 45)],
    cows: [16, (s, strict) => minR(s, -40, 10) > (strict ? 60 : 40)],
    ice: [22, (s, strict) => minR(s, -14, 14) < (strict ? 70 : 140)],
    boost: [8, (s, strict) => minR(s, -5, 20) > (strict ? 80 : 50)],
    oil: [8, (s, strict) => !strict || minR(s, 5, 30) < 80],
    choc: [9, () => true],
  };
  const order = ['ramp', 'hammer', 'cows', 'ice', 'boost', 'oil', 'choc'];
  const out = [];
  for (const type of order) {
    const count = (def.features || {})[type] || 0;
    const [half, ok] = RULES[type];
    for (let n = 0; n < count; n++) {
      for (let tries = 0; tries < 400; tries++) {
        const s = 70 + rng() * (L - 150);
        const strict = tries < 250;
        if (boxes.some((b) => Math.abs(b - s) < half + 16)) continue;
        if (used.some((u) => Math.abs(u.s - s) < u.half + half + (strict ? 30 : 16))) continue;
        if (!ok(s, strict)) continue;
        used.push({ s, half });
        let off = 0;
        if (type === 'boost') off = [-3.5, 0, 3.5][Math.floor(rng() * 3)];
        if (type === 'oil' || type === 'choc') off = (rng() - 0.5) * 7;
        out.push({ type, s, off, phase: rng() * Math.PI * 2, speed: 0.75 + rng() * 0.5 });
        break;
      }
    }
  }
  return out.sort((a, b) => a.s - b.s);
}

function buildFeatures(world, def, th) {
  const list = placeFeatures(def);
  const arrowTex = canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, w, h);
    for (let k = 0; k < 2; k++) {
      const y = 18 + k * 56;
      g.fillStyle = th.pad; g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w - 6, y + 34); g.lineTo(w - 20, y + 40); g.lineTo(w / 2, y + 20); g.lineTo(20, y + 40); g.lineTo(6, y + 34); g.closePath(); g.fill();
    }
  }, false);
  for (const f of list) {
    Object.assign(f, FEATURE_INFO[f.type]);
    const sp = sample(f.s);
    f.i = sp.i;
    const head = Math.atan2(sp.t.x, sp.t.z);
    const at = (lat, y = 0) => sp.p.clone().addScaledVector(sp.r, lat).setY(y);
    if (f.type === 'boost') {
      const g = new THREE.Group();
      mesh(new THREE.PlaneGeometry(f.w, f.len), new THREE.MeshStandardMaterial({ color: '#3d1418', roughness: 0.5, emissive: '#3d1418' }), g, [0, 0.055, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
      f.glow = mesh(new THREE.PlaneGeometry(f.w * 0.9, f.len * 0.9), new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true, toneMapped: false }), g, [0, 0.065, 0], [1, 1, 1], [-Math.PI / 2, 0, Math.PI], false);
      g.position.copy(at(f.off)); g.rotation.y = head; world.add(g);
      f.obj = g;
    } else if (f.type === 'oil' || f.type === 'choc') {
      const g = new THREE.Group();
      const color = f.type === 'choc' ? '#4a2416' : th.oil;
      const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1, metalness: f.type === 'oil' && th.oil !== '#d98a2b' ? 0.6 : 0.1 });
      const blob = (x, z, sx, sz) => mesh(new THREE.CircleGeometry(1, 28), m, g, [x, 0.06, z], [sx, sz, 1], [-Math.PI / 2, 0, 0], false);
      blob(0, 0, f.w / 2, f.len / 2);
      blob(f.w * 0.32, f.len * 0.3, f.w * 0.22, f.len * 0.2);
      blob(-f.w * 0.3, -f.len * 0.32, f.w * 0.18, f.len * 0.16);
      if (f.type === 'choc') for (let k = 0; k < 5; k++) mesh(SPH_LO, m, g, [rand(-1, 1) * f.w * 0.3, 0.08, rand(-1, 1) * f.len * 0.3], [0.25, 0.12, 0.25], [0, 0, 0], false);
      g.position.copy(at(f.off)); g.rotation.y = head; world.add(g);
      f.obj = g;
    } else if (f.type === 'ice') {
      const i0 = idxAt(f.s - f.len / 2), n = Math.round(f.len / SEG);
      const pos = [], idx = [];
      for (let k = 0; k <= n; k++) {
        const s = T[(i0 + k) % N];
        for (const off of [-f.w / 2, f.w / 2]) pos.push(s.p.x + s.r.x * off, 0.07, s.p.z + s.r.z * off);
        if (k < n) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
      const ice = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ color: '#cfefff', roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.72, emissive: '#7fc8ff', emissiveIntensity: 0.15 }));
      ice.receiveShadow = true; world.add(ice);
      // Warnschilder
      for (const side of [-1, 1]) {
        const sg = new THREE.Group();
        mesh(CYL, mat('#3d1418'), sg, [0, 1, 0], [0.08, 2, 0.08]);
        mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.08, 3), mat('#ffffff', { emissive: '#5aa9c9', emissiveIntensity: 0.3 }), sg, [0, 2.4, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
        const s0 = sample(f.s - f.len / 2 - 10);
        sg.position.copy(s0.p.clone().addScaledVector(s0.r, side * (HALF_W + 2.8))); sg.rotation.y = Math.atan2(s0.t.x, s0.t.z) + Math.PI;
        world.add(sg);
      }
      f.obj = ice;
    } else if (f.type === 'ramp') {
      const g = new THREE.Group();
      const stripe = canvasTex(256, 64, (c, w, h) => { for (let x = 0; x < w; x += 32) { c.fillStyle = (x / 32) % 2 ? th.curb[0] : th.curb[1]; c.fillRect(x, 0, 32, h); } });
      const slope = Math.hypot(f.len, f.h), ang = Math.atan2(f.h, f.len);
      mesh(new THREE.BoxGeometry(f.w, 0.22, slope), new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.6 }), g, [0, f.h / 2, 0], [1, 1, 1], [-ang, 0, 0]);
      for (const sx of [-1, 1]) {
        const side = new THREE.Shape(); side.moveTo(-f.len / 2, 0); side.lineTo(f.len / 2, 0); side.lineTo(f.len / 2, f.h); side.closePath();
        const sg = new THREE.ExtrudeGeometry(side, { depth: 0.3, bevelEnabled: false });
        const sm = mesh(sg, mat('#3d1418'), g, [sx * (f.w / 2 + 0.05) - 0.15, 0, 0], [1, 1, 1], [0, -Math.PI / 2, 0]);
        sm.position.x = sx * (f.w / 2) + (sx < 0 ? 0 : 0.3);
      }
      g.position.copy(at(0)); g.rotation.y = head; world.add(g);
      f.obj = g;
    } else if (f.type === 'cows') {
      f.animal = makeAnimal(th.animal);
      world.add(f.animal);
      f.lat = 0; f.pos = new THREE.Vector3();
    } else if (f.type === 'hammer') {
      const g = new THREE.Group();
      const post = mat('#4b1c22', { roughness: 0.7 });
      for (const sx of [-1, 1]) mesh(new THREE.BoxGeometry(0.7, 11, 0.7), post, g, [sx * (HALF_W + 2.2), 5.5, 0]);
      mesh(new THREE.BoxGeometry((HALF_W + 2.2) * 2 + 1.4, 0.8, 0.9), post, g, [0, 11, 0]);
      const pivot = new THREE.Group(); pivot.position.set(0, 10.6, 0); g.add(pivot);
      mesh(CYL, mat('#c99a2e', { roughness: 0.5, metalness: 0.4 }), pivot, [0, -3.6, 0], [0.09, 7.2, 0.09]);
      const bell = new THREE.Group(); bell.position.set(0, -8.3, 0); pivot.add(bell);
      const pts = [[0, 1.4], [0.55, 1.35], [0.85, 1.1], [1.05, 0.4], [1.25, -0.6], [1.45, -1.0], [1.42, -1.1]].map(([x, y]) => new THREE.Vector2(x, y));
      mesh(new THREE.LatheGeometry(pts, 28), new THREE.MeshStandardMaterial({ color: th.bell, metalness: 0.75, roughness: 0.25, side: THREE.DoubleSide }), bell);
      mesh(new THREE.TorusGeometry(0.98, 0.16, 10, 28), mat('#e2574c', { roughness: 0.4 }), bell, [0, 0.55, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);
      mesh(SPH_LO, mat('#3d1418'), bell, [0, -1.05, 0], [0.32, 0.32, 0.32]);
      g.position.copy(at(0)); g.rotation.y = head; world.add(g);
      f.obj = g; f.pivot = pivot; f.lat = 0; f.y = 10; f.dir = 1;
    }
  }
  return list;
}

// Tiere, die über die Strasse spazieren (je nach Cup)
function makeAnimal(kind) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body); g.userData.body = body;
  const legs = [];
  if (kind === 'marmot') { // Murmeli
    const fur = mat('#a0754d', { roughness: 0.9 }), light = mat('#e8cfa8', { roughness: 0.9 });
    mesh(SPH, fur, body, [0, 0.9, 0], [0.62, 0.85, 0.55]);
    mesh(SPH, light, body, [0, 0.85, 0.32], [0.42, 0.62, 0.32]);
    mesh(SPH, fur, body, [0, 1.75, 0.08], [0.42, 0.38, 0.4]);
    mesh(SPH_LO, light, body, [0, 1.65, 0.42], [0.2, 0.15, 0.12]);
    for (const sx of [-1, 1]) {
      mesh(SPH_LO, mat('#2a0e11'), body, [sx * 0.17, 1.82, 0.4], [0.06, 0.07, 0.04]);
      mesh(SPH_LO, fur, body, [sx * 0.3, 2.07, -0.02], [0.1, 0.1, 0.06]);
      mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), mat('#ffffff'), body, [sx * 0.05, 1.53, 0.5]);
    }
    for (const [x, z] of [[-0.3, 0.2], [0.3, 0.2], [-0.3, -0.2], [0.3, -0.2]]) legs.push(mesh(SPH_LO, fur, g, [x, 0.15, z], [0.16, 0.18, 0.2]));
    g.scale.setScalar(1.25);
  } else if (kind === 'gummy') { // Gummibärli
    const col = pick(['#e2574c', '#f2c94c', '#7fb069', '#f39a4c', '#9b7fd1']);
    const gm = new THREE.MeshPhysicalMaterial({ color: col, roughness: 0.15, transmission: 0.35, thickness: 1, clearcoat: 1 });
    mesh(SPH, gm, body, [0, 1.1, 0], [0.7, 0.85, 0.55]);
    mesh(SPH, gm, body, [0, 2.15, 0], [0.55, 0.5, 0.48]);
    for (const sx of [-1, 1]) {
      mesh(SPH_LO, gm, body, [sx * 0.42, 2.55, 0], [0.18, 0.18, 0.14]);
      mesh(SPH_LO, gm, body, [sx * 0.7, 1.35, 0.1], [0.22, 0.32, 0.2]);
      mesh(SPH_LO, mat('#2a0e11'), body, [sx * 0.18, 2.25, 0.44], [0.07, 0.08, 0.04]);
    }
    for (const [x, z] of [[-0.35, 0.05], [0.35, 0.05]]) legs.push(mesh(SPH_LO, gm, g, [x, 0.3, z], [0.3, 0.35, 0.3]));
    g.scale.setScalar(1.3);
  } else { // Kuh
    const white = mat('#fbf7f0', { roughness: 0.8 }), dark = mat('#3d1418', { roughness: 0.8 }), pink = mat('#f3a6b8', { roughness: 0.6 });
    mesh(SPH, white, body, [0, 1.45, 0], [0.75, 0.62, 1.25]);
    for (const [x, y, z, r] of [[0.5, 1.6, 0.3, 0.38], [-0.45, 1.5, -0.4, 0.42], [0.1, 1.95, -0.6, 0.3]]) mesh(SPH_LO, dark, body, [x, y, z], [r, r * 0.8, r]);
    const head = new THREE.Group(); head.position.set(0, 1.95, 1.25); body.add(head);
    mesh(SPH, white, head, [0, 0, 0], [0.45, 0.42, 0.5]);
    mesh(SPH_LO, pink, head, [0, -0.15, 0.42], [0.32, 0.22, 0.18]);
    for (const sx of [-1, 1]) {
      mesh(SPH_LO, dark, head, [sx * 0.2, 0.12, 0.38], [0.06, 0.07, 0.04]);
      mesh(new THREE.ConeGeometry(0.06, 0.28, 8), mat('#f7e9a6'), head, [sx * 0.3, 0.42, -0.05], [1, 1, 1], [0, 0, -sx * 0.6]);
      mesh(SPH_LO, white, head, [sx * 0.5, 0.15, -0.05], [0.2, 0.08, 0.12]);
    }
    // Kuhglocke um den Hals
    mesh(new THREE.ConeGeometry(0.16, 0.26, 12), new THREE.MeshStandardMaterial({ color: '#f2c94c', metalness: 0.7, roughness: 0.3 }), body, [0, 1.25, 1.18]);
    for (const [x, z] of [[-0.42, 0.75], [0.42, 0.75], [-0.42, -0.75], [0.42, -0.75]]) legs.push(mesh(CYL, white, g, [x, 0.45, z], [0.14, 0.9, 0.14]));
  }
  g.userData.legs = legs;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

// Bewegte Fallen pro Bild: Tiere laufen quer über die Strasse, Glocken schwingen, Pads leuchten
export function animateFeatures(features, now) {
  for (const f of features) {
    if (f.type === 'cows') {
      const range = HALF_W + 3.5;
      const ph = now * f.speed * 0.55 + f.phase;
      f.lat = Math.sin(ph) * range;
      const dir = Math.cos(ph) >= 0 ? 1 : -1;
      const sp = sample(f.s);
      f.pos.copy(sp.p).addScaledVector(sp.r, f.lat);
      const a = f.animal;
      a.position.copy(f.pos);
      a.rotation.y = Math.atan2(sp.r.x * dir, sp.r.z * dir);
      const step = Math.sin(now * 9 + f.phase);
      a.userData.body.position.y = Math.abs(step) * 0.08;
      a.userData.legs.forEach((l, k) => { l.rotation.x = (k % 2 ? 1 : -1) * step * 0.4; });
    } else if (f.type === 'hammer') {
      const w = 1.55 * f.speed;
      const ang = Math.sin(now * w + f.phase) * 0.98;
      f.dir = Math.cos(now * w + f.phase) >= 0 ? 1 : -1;
      f.pivot.rotation.z = ang;
      // Glocke: seitlich (positiv = rechts, also gegen den Drehsinn um z gespiegelt) und Höhe der Unterkante
      f.lat = -Math.sin(ang) * 8.3;
      f.dir = -f.dir;
      f.y = 10.6 - Math.cos(ang) * 8.3 - 1.1;
    } else if (f.type === 'boost' && f.glow) {
      f.glow.material.opacity = 0.65 + 0.35 * Math.sin(now * 8);
    }
  }
}

/* ================================================================
   Autos: kleine Go-Karts mit Chibi-Fahrern
   ================================================================ */
const SKINS = ['#ffdcc6', '#f6c6a4', '#e3a97f', '#c08158', '#8d5b3d'];
export function makeKart(scene, color, helmet, skin = pick(SKINS)) {
  const g = new THREE.Group();
  const body = mat(color, { roughness: 0.45, metalness: 0.05 });
  const dark = mat('#2a0e11', { roughness: 0.6 });
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
