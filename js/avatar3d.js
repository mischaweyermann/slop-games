// Chibi-Figur (3D) im Toy-Look: grosser Kopf, kleiner Körper, Frisur, Hut, Brille, Bart und Kleidung aus dem Charakter-Editor.
// Wird im Boxring benutzt (mit Boxhandschuhen).
// Die Gelenkpositionen (J.*.tgt) werden von aussen gesetzt; die Figur folgt weich.
import * as THREE from 'three';
import { DEFAULT_CONFIG, sanitize } from './character.js';

// Masse in Welt-Einheiten
export const D = {
  hipHalf: 0.19, shoulderHalf: 0.36, torso: 0.74, neck: 0.8,
  upperArm: 0.42, foreArm: 0.4, thigh: 0.42, shin: 0.4,
  head: { x: 0.88, y: 0.82, z: 0.8 },
};
export const JOINTS = ['head', 'lSh', 'rSh', 'lEl', 'rEl', 'lHa', 'rHa', 'lHip', 'rHip', 'lKn', 'rKn', 'lAn', 'rAn'];

const UP = new THREE.Vector3(0, 1, 0);
const SPH = new THREE.SphereGeometry(1, 36, 24);
const SPH_LO = new THREE.SphereGeometry(1, 20, 14);
const CYL = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
const DOME = new THREE.SphereGeometry(1, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2);
const HAIRCAP = new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, 1.62);
const TORSO = (() => {
  const prof = [[0.001, -0.5], [0.72, -0.5], [0.95, -0.42], [1, -0.25], [0.98, 0.05], [0.9, 0.28], [0.72, 0.44], [0.4, 0.52], [0.001, 0.54]];
  const curve = new THREE.SplineCurve(prof.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.LatheGeometry(curve.getPoints(30), 40);
})();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

const fabric = (color) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.78, sheen: 0.6, sheenRoughness: 0.6, sheenColor: new THREE.Color('#ffffff') });
const clay = (color, extra = {}) => new THREE.MeshPhysicalMaterial({ color, roughness: 0.62, sheen: 0.25, sheenColor: new THREE.Color('#ffffff'), ...extra });

export class Avatar {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);

    this.m = {
      skin: new THREE.MeshStandardMaterial({ color: '#ffdcc6', roughness: 0.55, emissive: '#ff6b8a', emissiveIntensity: 0 }),
      skinHand: { l: null, r: null },
      top: fabric('#e8574f'), inner: fabric('#f4efe6'), bottom: fabric('#6f8fb5'),
      shoe: clay('#f4efe6', { roughness: 0.5 }), sole: clay('#fbf7f0', { roughness: 0.7 }),
      hair: clay('#5e3d2b', { roughness: 0.75 }), hat: fabric('#e8574f'),
      gold: new THREE.MeshPhysicalMaterial({ color: '#f2c94c', metalness: 0.85, roughness: 0.28, clearcoat: 1 }),
      dark: new THREE.MeshStandardMaterial({ color: '#241c1a', roughness: 0.35 }),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      cheek: new THREE.MeshBasicMaterial({ color: '#ff8f8f', transparent: true, opacity: 0.28, depthWrite: false }),
      lens: new THREE.MeshPhysicalMaterial({ color: '#1d1b26', roughness: 0.08, metalness: 0.3, clearcoat: 1 }),
      frame: clay('#3b3b45', { roughness: 0.4 }),
      // Garderobe
      metal: new THREE.MeshPhysicalMaterial({ color: '#a9b4bf', metalness: 0.7, roughness: 0.32, clearcoat: 0.6 }),
      horn: clay('#f4efe6', { roughness: 0.5 }),
      pink: clay('#f3a6b8'),
      heart: new THREE.MeshPhysicalMaterial({ color: '#e8574f', roughness: 0.2, clearcoat: 1 }),
      star: new THREE.MeshPhysicalMaterial({ color: '#f2c94c', roughness: 0.25, metalness: 0.3, clearcoat: 1 }),
      glass: new THREE.MeshPhysicalMaterial({ color: '#cfeeff', transparent: true, opacity: 0.2, roughness: 0.05, clearcoat: 1, depthWrite: false, side: THREE.DoubleSide }),
      suit: clay('#eef5fa', { roughness: 0.55 }),
      stripe: fabric('#ffffff'),
      cape: Object.assign(fabric('#d9443c'), { side: THREE.DoubleSide }),
      feather: clay('#ffffff', { roughness: 0.7 }),
    };
    this.m.skinHand.l = this.m.skin.clone();
    this.m.skinHand.r = this.m.skin.clone();

    const mk = (geo, mat, parent = this.root) => { const o = new THREE.Mesh(geo, mat); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
    this.mk = mk;

    this.J = {};
    for (const n of JOINTS) this.J[n] = { cur: new THREE.Vector3(), tgt: new THREE.Vector3() };

    // Beine
    this.legs = {};
    for (const s of ['l', 'r']) {
      this.legs[s] = {
        hip: mk(SPH, this.m.bottom), thigh: mk(CYL, this.m.bottom), knee: mk(SPH, this.m.bottom), shin: mk(CYL, this.m.bottom),
        cuff: mk(CYL, this.m.bottom), shoe: mk(SPH, this.m.shoe), sole: mk(SPH, this.m.sole),
      };
    }
    // Arme
    this.arms = {};
    for (const s of ['l', 'r']) {
      this.arms[s] = {
        sh: mk(SPH, this.m.top), upper: mk(CYL, this.m.top), sleeve: mk(CYL, this.m.top), elbow: mk(SPH, this.m.top),
        fore: mk(CYL, this.m.top), hand: mk(SPH, this.m.skinHand[s]),
      };
    }
    // Rumpf
    this.pelvis = mk(SPH, this.m.bottom);
    this.torsoFrame = new THREE.Group(); this.root.add(this.torsoFrame);
    this.torso = mk(TORSO, this.m.top, this.torsoFrame);
    this.torso.scale.set(0.42, D.torso * 1.12, 0.35);
    this.topExtras = new THREE.Group(); this.torsoFrame.add(this.topExtras);
    this.backG = new THREE.Group(); this.torsoFrame.add(this.backG);

    // Kopf
    this.head = new THREE.Group(); this.root.add(this.head);
    const skull = mk(SPH, this.m.skin, this.head); skull.scale.set(D.head.x, D.head.y, D.head.z);
    for (const s of [-1, 1]) {
      const ear = mk(SPH_LO, this.m.skin, this.head); ear.position.set(0.85 * s, -0.1, -0.02); ear.scale.set(0.1, 0.15, 0.09);
      const c = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), this.m.cheek);
      c.position.set(0.44 * s, -0.22, 0.672); c.rotation.y = 0.55 * s; this.head.add(c);
    }
    this.eyes = [-1, 1].map((s) => {
      const g = new THREE.Group(); g.position.set(0.27 * s, -0.04, 0.75); this.head.add(g);
      const e = new THREE.Mesh(SPH_LO, this.m.dark); e.scale.set(0.05, 0.066, 0.03); g.add(e);
      const hl = new THREE.Mesh(SPH_LO, this.m.white); hl.scale.setScalar(0.014); hl.position.set(0.015, 0.025, 0.026); g.add(hl);
      return g;
    });
    this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 8, 20, Math.PI), this.m.dark);
    this.mouth.position.set(0, -0.3, 0.74); this.mouth.rotation.set(-0.35, 0, Math.PI); this.head.add(this.mouth);
    this.hairG = new THREE.Group(); this.head.add(this.hairG);
    this.hatG = new THREE.Group(); this.head.add(this.hatG);
    this.glassesG = new THREE.Group(); this.head.add(this.glassesG);
    this.beardG = new THREE.Group(); this.head.add(this.beardG);

    this.blinkAt = 2; this.blink = 0; this.happy = 0; this.shake = 0; this.hop = 0;
    this.follow = 28; // Handy filtert bereits, daher hier wenig Verzögerung
    this.cfg = null;
    this.setConfig(DEFAULT_CONFIG);
  }

  /* ---------- Aussehen ---------- */
  setConfig(c) {
    c = sanitize(c);
    this.cfg = c;
    const m = this.m;
    m.skin.color.set(c.skin); if (!this.handScale) { m.skinHand.l.color.set(c.skin); m.skinHand.r.color.set(c.skin); }
    m.hair.color.set(c.hairColor); m.hat.color.set(c.hatColor);
    m.top.color.set(c.topColor); m.inner.color.set(c.innerColor);
    m.bottom.color.set(c.bottomColor); m.shoe.color.set(c.shoes);

    const short = c.top === 'tshirt';
    for (const s of ['l', 'r']) {
      const a = this.arms[s];
      a.elbow.material = short ? m.skin : m.top;
      a.fore.material = short ? m.skin : m.top;
      a.upper.material = short ? m.skin : m.top;
      a.sleeve.visible = true;
      const l = this.legs[s];
      l.shin.material = c.bottom === 'shorts' ? m.skin : m.bottom;
      l.knee.material = c.bottom === 'shorts' ? m.skin : m.bottom;
    }
    this.style = {
      upperR: short ? 0.1 : 0.12, foreR: short ? 0.095 : 0.11, sleeveLen: short ? 0.55 : 1, sleeveR: short ? 0.135 : 0.125,
      thighR: 0.15, shinR: c.bottom === 'shorts' ? 0.1 : 0.135, shorts: c.bottom === 'shorts',
    };
    this.buildTopExtras(c); this.buildBack(c); this.buildHair(c); this.buildHat(c); this.buildGlasses(c); this.buildBeard(c);
    this.mouth.visible = c.beard !== 'beard';
  }

  clear(g) { while (g.children.length) g.remove(g.children[0]); }
  add(g, geo, mat, p = [0, 0, 0], s = [1, 1, 1], r = [0, 0, 0]) {
    const o = this.mk(geo, mat, g); o.position.set(...p); o.scale.set(...s); o.rotation.set(...r); return o;
  }

  buildTopExtras(c) {
    const g = this.topExtras; this.clear(g); const m = this.m;
    if (c.top === 'hoodie') {
      this.add(g, new THREE.TorusGeometry(0.3, 0.11, 14, 32), m.top, [0, 0.38, -0.14], [1, 1, 1], [Math.PI / 2 - 0.5, 0, 0]);
      this.add(g, SPH_LO, m.top, [0, -0.17, 0.3], [0.24, 0.1, 0.07]);
      for (const s of [-1, 1]) this.add(g, CYL, m.inner, [0.08 * s, 0.17, 0.33], [0.016, 0.2, 0.016], [0.25, 0, 0]);
    } else if (c.top === 'jacket') {
      this.add(g, SPH, m.inner, [0, 0.02, 0.28], [0.13, 0.36, 0.08]);
      for (const s of [-1, 1]) this.add(g, SPH_LO, m.top, [0.14 * s, 0.33, 0.21], [0.12, 0.05, 0.1], [0.5, 0, -0.5 * s]);
      this.add(g, SPH_LO, m.frame, [0.16, -0.08, 0.31], [0.022, 0.022, 0.02]);
    } else if (c.top === 'tracksuit') {
      this.add(g, CYL, m.top, [0, 0.42, 0.01], [0.2, 0.12, 0.17]); // Stehkragen
      this.add(g, new THREE.TorusGeometry(0.2, 0.025, 10, 28), m.stripe, [0, 0.48, 0.01], [1, 1, 0.85], [Math.PI / 2, 0, 0]);
      this.add(g, CYL, m.inner, [0, 0.03, 0.345], [0.014, 0.78, 0.014]); // Reissverschluss
      for (const s of [-1, 1]) this.add(g, CYL, m.stripe, [0.37 * s, 0.02, 0.1], [0.022, 0.72, 0.022], [0.05, 0, 0.12 * s]);
    } else {
      this.add(g, new THREE.TorusGeometry(0.19, 0.03, 10, 28), m.top, [0, 0.39, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0]);
    }
  }

  // Umhang oder Flügel auf dem Rücken
  buildBack(c) {
    const g = this.backG; this.clear(g); const m = this.m;
    if (c.back === 'cape') {
      this.add(g, new THREE.CylinderGeometry(0.42, 0.8, 1.2, 32, 1, true, Math.PI / 2 + 0.1, Math.PI - 0.2), m.cape, [0, -0.16, -0.04], [1, 1, 0.95]);
      for (const s of [-1, 1]) this.add(g, SPH_LO, m.gold, [0.2 * s, 0.4, 0.24], [0.05, 0.05, 0.04]);
    } else if (c.back === 'wings') {
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      shape.bezierCurveTo(0.25, 0.35, 0.65, 0.62, 1.0, 0.6);
      shape.bezierCurveTo(0.85, 0.42, 0.9, 0.3, 0.82, 0.22);
      shape.bezierCurveTo(0.72, 0.18, 0.7, 0.05, 0.6, 0.0);
      shape.bezierCurveTo(0.5, -0.05, 0.45, -0.2, 0.32, -0.22);
      shape.bezierCurveTo(0.2, -0.24, 0.1, -0.15, 0, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 16 });
      for (const s of [-1, 1]) this.add(g, geo, m.feather, [0.1 * s, 0.12, -0.3], [1.45 * s, 1.45, 1], [0, -0.45 * s, 0]);
    }
  }

  buildHair(c) {
    const g = this.hairG; this.clear(g); const m = this.m.hair; const hatOn = c.hat !== 'none' && c.hat !== 'cat';
    const cap = () => this.add(g, HAIRCAP, m, [0, 0.03, -0.03], [0.915, 0.865, 0.845], [-0.62, 0, 0]);
    const fringe = () => [-0.36, -0.05, 0.3].forEach((x, i) => this.add(g, SPH, m, [x, 0.5 - Math.abs(x) * 0.22, 0.56 - Math.abs(x) * 0.18], [0.3, 0.17, 0.2], [0.75, 0, (i - 1) * -0.45]));
    switch (c.hair) {
      case 'short': cap(); fringe(); break;
      case 'bun': cap(); fringe(); if (!hatOn) this.add(g, SPH, m, [0, 0.86, -0.2], [0.25, 0.23, 0.25]); break;
      case 'curly': {
        cap(); fringe();
        if (!hatOn) {
          for (let i = 0; i < 22; i++) {
            const th = 0.15 + (i % 3) * 0.42, ph = i * 2.4;
            const p = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
            p.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.42);
            this.add(g, SPH_LO, m, [p.x * 0.9, p.y * 0.86 + 0.02, p.z * 0.84 - 0.02], [0.2, 0.2, 0.2]);
          }
        }
        break;
      }
      case 'long':
        cap(); fringe();
        this.add(g, SPH, m, [0, -0.32, -0.38], [0.82, 0.84, 0.48]);
        for (const s of [-1, 1]) this.add(g, SPH, m, [0.78 * s, -0.3, 0.08], [0.16, 0.44, 0.22], [0, 0, 0.12 * s]);
        break;
      case 'spiky':
        cap();
        if (!hatOn) [[-0.3, 0.7, 0.25, 0.5], [0, 0.82, 0.12, 0], [0.32, 0.72, 0.2, -0.5], [0, 0.72, -0.35, 0]].forEach(([x, y, z, rz]) =>
          this.add(g, new THREE.ConeGeometry(0.17, 0.42, 16), m, [x, y, z], [1, 1, 1], [z * 0.8, 0, rz]));
        break;
      case 'side':
        for (const s of [-1, 1]) this.add(g, SPH, m, [0.76 * s, 0.08, -0.18], [0.24, 0.3, 0.42]);
        this.add(g, SPH, m, [0, 0.06, -0.62], [0.62, 0.32, 0.26]);
        break;
      default: break;
    }
  }

  buildHat(c) {
    const g = this.hatG; this.clear(g); const m = this.m.hat;
    switch (c.hat) {
      case 'cap':
        this.add(g, DOME, m, [0, 0.2, -0.02], [0.95, 0.74, 0.9], [-0.12, 0, 0]);
        this.add(g, new THREE.CylinderGeometry(0.5, 0.5, 0.05, 36), m, [0, 0.22, 0.78], [1, 1, 0.9], [0.18, 0, 0]);
        this.add(g, SPH_LO, m, [0, 0.93, -0.1], [0.07, 0.05, 0.07]);
        break;
      case 'beanie':
        this.add(g, DOME, m, [0, 0.16, -0.02], [0.96, 0.86, 0.91], [-0.12, 0, 0]);
        this.add(g, new THREE.TorusGeometry(0.88, 0.12, 14, 48), m, [0, 0.19, -0.02], [1, 1, 0.94], [Math.PI / 2 - 0.12, 0, 0]);
        this.add(g, SPH, this.m.inner, [0, 1.06, -0.12], [0.18, 0.18, 0.18]);
        break;
      case 'bucket':
        this.add(g, DOME, m, [0, 0.22, -0.02], [0.92, 0.72, 0.88], [-0.08, 0, 0]);
        { const brim = this.add(g, new THREE.CylinderGeometry(0.98, 1.25, 0.16, 48, 1, true), m, [0, 0.16, -0.02], [1, 1, 1], [-0.08, 0, 0]); brim.material = m.clone(); brim.material.side = THREE.DoubleSide; }
        break;
      case 'party':
        this.add(g, new THREE.ConeGeometry(0.34, 0.9, 32), m, [0.18, 1.12, 0], [1, 1, 1], [0, 0, -0.28]);
        this.add(g, SPH, this.m.inner, [0.31, 1.56, 0], [0.11, 0.11, 0.11]);
        for (let i = 0; i < 5; i++) this.add(g, SPH_LO, this.m.inner, [0.2 + Math.cos(i * 1.3) * 0.2, 0.92 + (i % 3) * 0.15, Math.sin(i * 1.3) * 0.22], [0.035, 0.035, 0.035]);
        break;
      case 'crown': {
        const ring = this.add(g, new THREE.CylinderGeometry(0.46, 0.42, 0.24, 10, 1, true), this.m.gold, [0, 0.82, -0.05], [1, 1, 1], [-0.12, 0, 0]);
        ring.material = this.m.gold.clone(); ring.material.side = THREE.DoubleSide;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          this.add(g, new THREE.ConeGeometry(0.08, 0.2, 10), this.m.gold, [Math.sin(a) * 0.44, 1.02, Math.cos(a) * 0.44 - 0.07], [1, 1, 1], [-0.12, 0, 0]);
          this.add(g, SPH_LO, this.m.gold, [Math.sin(a) * 0.44, 1.14, Math.cos(a) * 0.44 - 0.08], [0.04, 0.04, 0.04]);
        }
        this.add(g, SPH_LO, new THREE.MeshPhysicalMaterial({ color: '#e8574f', roughness: 0.1, clearcoat: 1 }), [0, 0.82, 0.38], [0.06, 0.06, 0.04]);
        break;
      }
      // Garderobe
      case 'cat':
        this.add(g, new THREE.TorusGeometry(0.84, 0.045, 10, 48, Math.PI), m, [0, 0.12, -0.06], [1, 1, 1], [-0.3, 0, 0]);
        for (const s of [-1, 1]) {
          this.add(g, new THREE.ConeGeometry(0.3, 0.55, 4), m, [0.5 * s, 1.0, -0.06], [1, 1, 0.5], [0, Math.PI / 4, -0.38 * s]);
          this.add(g, new THREE.ConeGeometry(0.18, 0.36, 4), this.m.pink, [0.49 * s, 0.97, 0.04], [1, 1, 0.3], [0, Math.PI / 4, -0.38 * s]);
        }
        break;
      case 'cowboy':
        this.add(g, new THREE.CylinderGeometry(0.62, 0.7, 0.62, 32), m, [0, 0.78, -0.04], [1, 1, 0.9], [-0.1, 0, 0]);
        this.add(g, new THREE.SphereGeometry(0.62, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2), m, [0, 1.08, -0.07], [1, 0.32, 0.9], [-0.1, 0, 0]);
        this.add(g, new THREE.CylinderGeometry(0.71, 0.71, 0.1, 32, 1, true), this.m.dark, [0, 0.55, -0.02], [1, 1, 0.9], [-0.1, 0, 0]);
        { const brim = this.add(g, new THREE.TorusGeometry(1.0, 0.33, 10, 48), m, [0, 0.46, -0.02], [1, 1, 0.09], [Math.PI / 2 - 0.1, 0, 0]); brim.scale.set(1, 0.95, 0.12); }
        break;
      case 'viking':
        this.add(g, DOME, this.m.metal, [0, 0.18, -0.02], [0.96, 0.86, 0.92], [-0.1, 0, 0]);
        this.add(g, new THREE.TorusGeometry(0.89, 0.07, 12, 48), this.m.metal, [0, 0.2, -0.02], [1, 1, 0.94], [Math.PI / 2 - 0.1, 0, 0]);
        this.add(g, new THREE.BoxGeometry(0.1, 0.9, 0.1), this.m.metal, [0, 0.62, 0.43], [1, 1, 1], [-0.62, 0, 0]);
        for (const s of [-1, 1]) {
          const horn = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.45 * s, 0.05, 0), new THREE.Vector3(0.55 * s, 0.55, -0.05)), 16, 0.09, 12, false);
          const h = this.add(g, horn, this.m.horn, [0.72 * s, 0.42, -0.05]);
          const tip = this.add(g, new THREE.ConeGeometry(0.09, 0.22, 12), this.m.horn, [0.72 * s + 0.56 * s, 0.42 + 0.64, -0.1], [1, 1, 1], [0, 0, -0.2 * s]);
          h.castShadow = tip.castShadow = true;
        }
        break;
      case 'astro':
        this.add(g, SPH, this.m.glass, [0, 0.02, 0], [1.18, 1.12, 1.1]);
        this.add(g, new THREE.TorusGeometry(0.62, 0.12, 14, 40), this.m.suit, [0, -0.92, -0.02], [1, 1, 0.9], [Math.PI / 2, 0, 0]);
        this.add(g, SPH_LO, this.m.heart, [0.9, -0.55, 0.3], [0.06, 0.06, 0.06]);
        break;
      default: break;
    }
  }

  buildGlasses(c) {
    const g = this.glassesG; this.clear(g);
    if (c.glasses === 'round') {
      for (const s of [-1, 1]) this.add(g, new THREE.TorusGeometry(0.14, 0.022, 10, 32), this.m.frame, [0.27 * s, -0.04, 0.79]);
      this.add(g, CYL, this.m.frame, [0, -0.01, 0.82], [0.016, 0.26, 0.016], [0, 0, Math.PI / 2]);
    } else if (c.glasses === 'sun') {
      for (const s of [-1, 1]) this.add(g, SPH, this.m.lens, [0.27 * s, -0.04, 0.78], [0.19, 0.13, 0.05]);
      this.add(g, CYL, this.m.frame, [0, 0, 0.82], [0.018, 0.2, 0.018], [0, 0, Math.PI / 2]);
    } else if (c.glasses === 'heart' || c.glasses === 'star') {
      const sh = new THREE.Shape();
      if (c.glasses === 'heart') {
        sh.moveTo(0, -0.15); sh.bezierCurveTo(-0.2, -0.02, -0.17, 0.15, 0, 0.07); sh.bezierCurveTo(0.17, 0.15, 0.2, -0.02, 0, -0.15);
      } else {
        for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.075 : 0.17, a = Math.PI / 2 + (i * Math.PI) / 5; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) sh.lineTo(x, y); else sh.moveTo(x, y); }
        sh.closePath();
      }
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
      const mat = c.glasses === 'heart' ? this.m.heart : this.m.star;
      for (const s of [-1, 1]) this.add(g, geo, mat, [0.27 * s, -0.04, 0.77]);
      this.add(g, CYL, mat, [0, -0.01, 0.8], [0.016, 0.2, 0.016], [0, 0, Math.PI / 2]);
    }
  }

  buildBeard(c) {
    const g = this.beardG; this.clear(g); const m = this.m.hair;
    if (c.beard === 'beard') {
      this.add(g, SPH, m, [0, -0.54, 0.4], [0.58, 0.34, 0.38]);
      for (const s of [-1, 1]) this.add(g, SPH, m, [0.6 * s, -0.3, 0.3], [0.16, 0.26, 0.28]);
      for (const s of [-1, 1]) this.add(g, SPH_LO, m, [0.11 * s, -0.24, 0.76], [0.14, 0.06, 0.07], [0, 0, -0.3 * s]);
    } else if (c.beard === 'mustache') {
      for (const s of [-1, 1]) this.add(g, SPH_LO, m, [0.09 * s, -0.22, 0.765], [0.13, 0.055, 0.06], [0, 0, -0.3 * s]);
    }
  }

  // Boxhandschuhe statt Hände
  setGloves(color) {
    for (const s of ['l', 'r']) {
      const g = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 0.8, clearcoatRoughness: 0.25, emissive: '#ffffff', emissiveIntensity: 0 });
      this.m.skinHand[s] = g; this.arms[s].hand.material = g;
    }
    this.handScale = 0.23;
  }

  /* ---------- Animation ---------- */
  snap() { for (const n of JOINTS) this.J[n].cur.copy(this.J[n].tgt); }
  flash(side) { if (side === 'l' || side === 'r') this.m.skinHand[side].emissiveIntensity = 0.9; this.happy = 1; }
  celebrate() { this.hop = 1; this.happy = 1; }

  update(dt, t) {
    const J = this.J, k = damp(this.follow, dt);
    for (const n of JOINTS) J[n].cur.lerp(J[n].tgt, k);
    const st = this.style;
    const tmp = new THREE.Vector3(), a2 = new THREE.Vector3();

    const seg = (mesh, a, b, r, from = 0, to = 1) => {
      tmp.subVectors(b, a); const len = Math.max(tmp.length(), 0.001);
      a2.copy(a).addScaledVector(tmp, (from + to) / 2);
      mesh.position.copy(a2);
      mesh.quaternion.setFromUnitVectors(UP, tmp.divideScalar(len));
      mesh.scale.set(r, len * (to - from), r);
    };

    // Hüpfer bei neuem Outfit
    this.hop = Math.max(0, this.hop - dt * 2.2);
    this.root.position.y = Math.sin(this.hop * Math.PI) * 0.35;

    for (const s of ['l', 'r']) {
      const L = this.legs[s];
      L.hip.position.copy(J[s + 'Hip'].cur); L.hip.scale.setScalar(st.thighR + 0.01);
      seg(L.thigh, J[s + 'Hip'].cur, J[s + 'Kn'].cur, st.thighR);
      L.knee.position.copy(J[s + 'Kn'].cur); L.knee.scale.setScalar(st.shorts ? st.shinR : st.shinR + 0.005);
      seg(L.shin, J[s + 'Kn'].cur, J[s + 'An'].cur, st.shinR);
      L.cuff.visible = st.shorts;
      if (st.shorts) seg(L.cuff, J[s + 'Hip'].cur, J[s + 'Kn'].cur, st.thighR + 0.02, 0.62, 0.9);
      L.shoe.position.copy(J[s + 'An'].cur).add(tmp.set(0, -0.04, 0.07)); L.shoe.scale.set(0.15, 0.12, 0.22);
      L.sole.position.copy(J[s + 'An'].cur).add(tmp.set(0, -0.1, 0.07)); L.sole.scale.set(0.155, 0.045, 0.225);

      const A = this.arms[s];
      A.sh.position.copy(J[s + 'Sh'].cur); A.sh.scale.setScalar(st.sleeveR + 0.01);
      seg(A.upper, J[s + 'Sh'].cur, J[s + 'El'].cur, st.upperR);
      seg(A.sleeve, J[s + 'Sh'].cur, J[s + 'El'].cur, st.sleeveR, 0, st.sleeveLen);
      A.elbow.position.copy(J[s + 'El'].cur); A.elbow.scale.setScalar(st.foreR + 0.004);
      seg(A.fore, J[s + 'El'].cur, J[s + 'Ha'].cur, st.foreR);
      A.hand.position.copy(J[s + 'Ha'].cur); A.hand.scale.set((this.handScale || 0.14), (this.handScale || 0.14) * 0.92, (this.handScale || 0.14) * 1.12);
      const hm = this.m.skinHand[s]; hm.emissiveIntensity = Math.max(0, hm.emissiveIntensity - dt * 3);
    }

    const sh = new THREE.Vector3().addVectors(J.lSh.cur, J.rSh.cur).multiplyScalar(0.5);
    const hip = new THREE.Vector3().addVectors(J.lHip.cur, J.rHip.cur).multiplyScalar(0.5);
    const dir = tmp.subVectors(sh, hip); const len = Math.max(dir.length(), 0.3); dir.divideScalar(len);
    this.torsoFrame.position.lerpVectors(hip, sh, 0.5).addScaledVector(dir, 0.04);
    this.torsoFrame.quaternion.setFromUnitVectors(UP, dir);
    this.torsoFrame.scale.set(1, len / D.torso, 1);
    this.pelvis.position.copy(hip).addScaledVector(dir, 0.02); this.pelvis.quaternion.copy(this.torsoFrame.quaternion);
    this.pelvis.scale.set(0.37, 0.2, 0.3);

    // Kopf
    this.head.position.copy(J.head.cur);
    const nx = J.head.cur.x - sh.x, ny = J.head.cur.y - sh.y;
    const tilt = clamp(-Math.atan2(nx, Math.max(ny, 0.1)), -0.5, 0.5);
    this.shake = Math.max(0, this.shake - dt * 2);
    this.head.rotation.z = tilt + Math.sin(t * 40) * this.shake * 0.12;
    this.head.rotation.y = Math.sin(t * 0.7) * 0.06;

    this.blinkAt -= dt;
    if (this.blinkAt < 0) { this.blink = 1; this.blinkAt = 2 + Math.random() * 3; }
    this.blink = Math.max(0, this.blink - dt * 7);
    const eyeY = this.shake > 0.2 ? 0.25 : 1 - Math.sin(this.blink * Math.PI) * 0.9;
    this.eyes.forEach((e) => (e.scale.y = eyeY));
    this.happy = Math.max(0, this.happy - dt * 2.5);
    this.mouth.scale.set(1 + this.happy * 0.5, 1 + this.happy * 0.9, 1);
    this.mouth.rotation.z = this.shake > 0.2 ? 0 : Math.PI;
  }
}
