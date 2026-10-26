// Kurvenflitzer – Welt: Strecke (Daten + Geometrie), Landschaft und Go-Karts.
import * as THREE from 'three';

export const HALF_W = 7;            // halbe Strassenbreite (m)
export const GRASS = HALF_W + 1.4;  // ab hier Wiese (bremst)
export const WALL = HALF_W + 8;     // Reifenstapel
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];


export const SPH = new THREE.SphereGeometry(1, 28, 18);
export const SPH_LO = new THREE.SphereGeometry(1, 16, 10);
export const CYL = new THREE.CylinderGeometry(1, 1, 1, 20);
export const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });
export const mesh = (geo, m, parent, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0], shadow = true) => {
  const o = new THREE.Mesh(geo, m); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r);
  o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
};

/* ================================================================
   Strecke: geschlossener Spline, abgetastet in N Punkte
   ================================================================ */
const CTRL = [[-40, 8], [-8, -35], [6, -105], [50, -152], [120, -162], [165, -125], [162, -68], [125, -30], [120, 20], [155, 65], [150, 122], [100, 162], [30, 170], [-35, 152], [-100, 152], [-150, 112], [-158, 58], [-112, 22]];
const curve = new THREE.CatmullRomCurve3(CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
export const N = 1000;
export const TRACK_LEN = curve.getLength();
export const SEG = TRACK_LEN / N;
export const T = []; // { p, t (Tangente), r (rechts), R (Kurvenradius), turn (+ rechts / − links) }
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

/* ---------- Landschaft (einmal pro Szene aufbauen) ---------- */
export function buildWorld(scene) {
  const roadTex = canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = '#8a4a50'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '60,40,90'},0.05)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    g.fillStyle = '#f7e9a6'; g.fillRect(6, 0, 6, h); g.fillRect(w - 12, 0, 6, h);
    g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
  });
  const curbTex = canvasTex(32, 64, (g, w, h) => {
    g.fillStyle = '#e2574c'; g.fillRect(0, 0, w, h / 2);
    g.fillStyle = '#f6e3e1'; g.fillRect(0, h / 2, w, h / 2);
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
    const ground = mesh(new THREE.CircleGeometry(800, 64), mat('#a85c5a', { roughness: 1 }), scene, [0, 0, 0], [1, 1, 1], [-Math.PI / 2, 0, 0], false);
    ground.receiveShadow = true;
    ribbon(-HALF_W - 4, -HALF_W - 1.3, 0.015, 10, null, '#c27a70');
    ribbon(HALF_W + 1.3, HALF_W + 4, 0.015, 10, null, '#c27a70');
    const hillMats = ['#a9555c', '#b8646a', '#c9767a', '#9c4a52'].map((c) => mat(c, { roughness: 1 }));
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + rand(-0.1, 0.1), d = rand(330, 430), r = rand(50, 110);
      mesh(SPH, pick(hillMats), scene, [Math.cos(a) * d, -r * 0.15, Math.sin(a) * d], [r, r * rand(0.3, 0.5), r], [0, 0, 0], false);
    }
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(600, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
        uniforms: { top: { value: new THREE.Color('#8e3a45') }, mid: { value: new THREE.Color('#e88a78') }, bottom: { value: new THREE.Color('#f8d2b4') } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 mid; uniform vec3 bottom; varying vec3 vP;
          void main(){ float h = vP.y; vec3 c = mix(bottom, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.15, 0.6, h));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
          }`,
      }),
    ));
    // Tiefstehende Abendsonne
    {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, 'rgba(255,244,220,1)'); grd.addColorStop(0.2, 'rgba(255,240,214,1)'); grd.addColorStop(0.36, 'rgba(255,214,170,.55)'); grd.addColorStop(1, 'rgba(255,200,160,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, fog: false, depthWrite: false, toneMapped: false }));
      s.position.set(330, 40, -470); s.scale.setScalar(240); scene.add(s);
    }
    const cloudMat = mat('#f9d7c6', { roughness: 1, emissive: '#ffd8c4', emissiveIntensity: 0.4 });
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
      for (let x = 0; x < 16; x++) for (let y = 0; y < 2; y++) { g.fillStyle = (x + y) % 2 ? '#3d1418' : '#f6e3e1'; g.fillRect(x * 16, y * 16, 16, 16); }
    }, false);
    const line = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, 1.8), new THREE.MeshStandardMaterial({ map: checker, roughness: 0.9 }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = -Math.atan2(s.t.x, -s.t.z);
    line.position.set(s.p.x, 0.05, s.p.z); line.receiveShadow = true; scene.add(line);

    const arch = new THREE.Group();
    const pillarMat = mat('#f6e3e1', { roughness: 0.6 });
    for (const side of [-1, 1]) {
      mesh(new THREE.CylinderGeometry(0.55, 0.65, 7, 20), pillarMat, arch, [side * (HALF_W + 2.2), 3.5, 0]);
      mesh(SPH, mat('#e8574f', { roughness: 0.4 }), arch, [side * (HALF_W + 2.2), 7.4, 0], [0.8, 0.8, 0.8]);
    }
    const bannerTex = canvasTex(1024, 160, (g, w, h) => {
      g.fillStyle = '#e8574f'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 40) { g.fillStyle = (x / 40) % 2 ? '#3d1418' : '#f6e3e1'; g.fillRect(x, 0, 40, 20); g.fillStyle = (x / 40) % 2 ? '#f6e3e1' : '#3d1418'; g.fillRect(x, h - 20, 40, 20); }
      g.fillStyle = '#f7e9a6'; g.font = '800 88px Poppins, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
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
    inst(new THREE.CylinderGeometry(0.11, 0.16, 1.2, 10), mat('#4b1c22', { roughness: 0.7 }), trunks,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 0.6 * s, z), q, new THREE.Vector3(s, s, s)));
    inst(SPH, mat('#ffffff', { roughness: 0.7 }), tops,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 1.65 * s, z), q, new THREE.Vector3(0.85 * s, 0.92 * s, 0.85 * s)),
      ['#7e3d45', '#6f2f37', '#9c4a52', '#8a3b44', '#e2574c', '#f2c94c']);
    inst(new THREE.ConeGeometry(0.7, 1.9, 18), mat('#ffffff', { roughness: 0.7 }), cones,
      ([x, z, s], m) => m.compose(new THREE.Vector3(x, 2.0 * s, z), q, new THREE.Vector3(s, s, s)),
      ['#6f2f37', '#7e3d45', '#9c4a52', '#e2574c']);

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
      tim.setColorAt(i, col.set(h ? (c ? '#e2574c' : '#f6e3e1') : '#3d1418'));
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
