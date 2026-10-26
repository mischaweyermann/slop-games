// Kurvenflitzer – Cockpit in der Ich-Perspektive (Haube, Armaturen, Lenkrad, Hände).
// Jede Spielerin / jeder Spieler bekommt ein eigenes Cockpit, das an der eigenen Kamera hängt
// und nur auf deren Ebene (Layer) sichtbar ist.
import * as THREE from 'three';
import { SPH, SPH_LO, CYL, mat, mesh } from './world.js';

const damp = (k, dt) => 1 - Math.exp(-k * dt);
const UP = new THREE.Vector3(0, 1, 0);

export class Cockpit {
  constructor(camera, layer) {
    const c = this.group = new THREE.Group();
    camera.add(c);
    this.m = {
      body: mat('#e8574f', { roughness: 0.45 }),
      skin: mat('#ffdcc6', { roughness: 0.55 }),
      sleeve: mat('#e8574f', { roughness: 0.8 }),
      dark: mat('#3d1418', { roughness: 0.55 }),
    };
    const m = this.m;
    // Haube vorne + Seitenkästen
    mesh(SPH, m.body, c, [0, -1.2, -2.4], [0.95, 0.42, 1.9], [0, 0, 0], false);
    mesh(SPH, m.body, c, [0, -1.02, -3.9], [0.55, 0.2, 0.5], [0, 0, 0], false);
    for (const sx of [-1, 1]) mesh(SPH, m.body, c, [sx * 1.0, -1.12, -0.9], [0.36, 0.3, 1.2], [0, 0, 0], false);
    // Armaturenbrett + Lenksäule
    mesh(SPH, m.dark, c, [0, -0.62, -1.15], [0.55, 0.14, 0.22], [0, 0, 0], false);
    mesh(CYL, m.dark, c, [0, -0.5, -1.0], [0.03, 0.3, 0.03], [-1.1, 0, 0], false);
    // Lenkrad
    const w = this.wheel = new THREE.Group();
    w.position.set(0, -0.36, -0.85); w.rotation.x = -0.45; w.scale.setScalar(0.72); c.add(w);
    const rim = mat('#2a0e11', { roughness: 0.4 });
    mesh(new THREE.TorusGeometry(0.21, 0.03, 14, 48), rim, w, [0, 0, 0], [1, 1, 1], [0, 0, 0], false);
    for (const a of [Math.PI / 2 + 0.05, -Math.PI / 2 - 0.05, Math.PI]) {
      const s = mesh(CYL, rim, w, [Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0], [0.018, 0.2, 0.012], [0, 0, 0], false);
      s.rotation.z = a - Math.PI / 2;
    }
    this.hub = mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.04, 24), mat('#e2574c', { roughness: 0.35 }), w, [0, 0, 0.02], [1, 1, 1], [Math.PI / 2, 0, 0], false);
    mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), mat('#f7e9a6'), w, [0, 0.21, 0.03], [1, 1, 1], [0, 0, 0], false);
    // Griffpunkte (10 und 2 Uhr)
    this.grips = [-1, 1].map((sx) => {
      const a = Math.PI / 2 - sx * 1.05;
      return new THREE.Vector3(Math.cos(a) * 0.21, Math.sin(a) * 0.21, 0.02);
    });
    // Hände + Ärmel
    this.hands = [-1, 1].map((sx) => ({
      sx,
      fist: mesh(SPH, m.skin, c, [0, 0, 0], [0.047, 0.043, 0.05], [0, 0, 0], false),
      thumb: mesh(SPH_LO, m.skin, c, [0, 0, 0], [0.019, 0.019, 0.026], [0, 0, 0], false),
      sleeve: mesh(CYL, m.sleeve, c, [0, 0, 0], [0.05, 1, 0.05], [0, 0, 0], false),
      cuff: mesh(CYL, m.sleeve, c, [0, 0, 0], [0.05, 0.045, 0.05], [0, 0, 0], false),
      pos: new THREE.Vector3(sx * 0.35, -0.9, -0.35),
    }));
    c.traverse((o) => o.layers.set(layer));
    this._v = new THREE.Vector3(); this._w = new THREE.Vector3();
  }

  setColors(cfg, kartColor) {
    this.m.skin.color.set(cfg.skin);
    this.m.sleeve.color.set(cfg.topColor);
    this.m.body.color.set(kartColor);
  }

  set visible(v) { this.group.visible = v; }

  update(dt, steer, grip) {
    const w = this.wheel;
    w.rotation.z = -steer * 1.35;
    w.updateMatrix();
    for (const h of this.hands) {
      // Griffpunkt im Cockpit-Koordinatensystem (dreht mit dem Lenkrad)
      const g = this._v.copy(this.grips[h.sx < 0 ? 0 : 1]).applyMatrix4(w.matrix);
      const want = this._w.set(h.sx * 0.33, -0.86, -0.42).lerp(g, grip);
      h.pos.lerp(want, damp(18, dt));
      h.fist.position.copy(h.pos);
      h.thumb.position.copy(h.pos).add(this._w.set(-h.sx * 0.026, 0.03, 0.018));
      // Ärmel kommt von unten (Ellbogen ausserhalb des Bildes), damit die Hand nie verdeckt ist
      const elbow = this._w.set(h.sx * 0.34, -1.2, -0.5);
      const d = new THREE.Vector3().subVectors(h.pos, elbow);
      const len = d.length();
      h.sleeve.position.copy(elbow).addScaledVector(d, 0.38);
      h.sleeve.quaternion.setFromUnitVectors(UP, d.clone().normalize());
      h.sleeve.scale.set(0.046, len * 0.76, 0.046);
      h.cuff.position.copy(elbow).addScaledVector(d, 0.76);
      h.cuff.quaternion.copy(h.sleeve.quaternion);
    }
  }
}
