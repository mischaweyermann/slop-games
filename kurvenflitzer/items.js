// Kurvenflitzer – Items: Definitionen, Symbole und 3D-Objekte (Item-Boxen, Wurfgeschosse, Symbole über den Karts).
import * as THREE from 'three';

// Wirkung auf die getroffene Person
export const ITEMS = {
  swap: {
    name: 'Spiegel-Lenkung', color: '#9b7fd1', dur: 7,
    hit: 'Links ↔ rechts vertauscht!', fx: 'Lenkung vertauscht',
    path: '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  reverse: {
    name: 'Rückwärtsgang', color: '#5aa9c9', dur: 6,
    hit: 'Du fährst rückwärts!', fx: 'Rückwärts',
    path: '<path d="M8 20V10a4.5 4.5 0 0 1 9 0v5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round"/><path d="M13.5 12.5 17 16l3.5-3.5" fill="none" stroke="#fff" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  stop: {
    name: 'Vollbremse', color: '#e2574c', dur: 2.6,
    hit: 'Vollbremsung!', fx: 'Gebremst',
    path: '<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z" fill="#fff"/><rect x="6.5" y="10.4" width="11" height="3.2" rx="1.2" fill="#e2574c"/>',
  },
  engine: {
    name: 'Motorausfall', color: '#f39a4c', dur: 15,
    hit: 'Motor aus!', fx: 'Motor aus – 3× Arme hoch!',
    path: '<path d="M14.8 4.2a4.6 4.6 0 0 0-5.7 5.9L3.6 15.6a1.9 1.9 0 0 0 0 2.7l2.1 2.1a1.9 1.9 0 0 0 2.7 0l5.5-5.5a4.6 4.6 0 0 0 5.9-5.7l-2.9 2.9-2.9-.8-.8-2.9z" fill="#fff"/>',
  },
};
export const ITEM_KEYS = Object.keys(ITEMS);
export const CRANKS = 3; // so oft Arme hoch, um den Motor wieder zu starten

export const itemSvg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ITEMS[k].path}</svg>`;

/* ---------- Texturen ---------- */
function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  draw(c.getContext('2d'), size, () => (tex.needsUpdate = true));
  return tex;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); }

const iconTex = {};
export function itemTexture(k) {
  if (iconTex[k]) return iconTex[k];
  iconTex[k] = canvasTex(128, (g, s, done) => {
    g.fillStyle = '#3d1418'; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 2, 0, 7); g.fill();
    g.fillStyle = ITEMS[k].color; g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 10, 0, 7); g.fill();
    const img = new Image();
    img.onload = () => { g.drawImage(img, s * 0.2, s * 0.2, s * 0.6, s * 0.6); done(); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="96" height="96">${ITEMS[k].path}</svg>`);
    done();
  });
  return iconTex[k];
}
const boxTex = canvasTex(128, (g, s) => {
  g.fillStyle = '#f7e9a6'; g.fillRect(0, 0, s, s);
  g.strokeStyle = '#e2574c'; g.lineWidth = 12; roundRect(g, 8, 8, s - 16, s - 16, 18); g.stroke();
  g.fillStyle = '#5a1f25'; g.font = '800 84px Poppins, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', s / 2, s / 2 + 6);
});

/* ---------- Item-Boxen auf der Strecke ---------- */
export function buildItemBoxes(scene, sample, trackLen) {
  const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
  const mat = new THREE.MeshStandardMaterial({ map: boxTex, roughness: 0.35, metalness: 0.05, emissive: '#f39a4c', emissiveIntensity: 0.18, transparent: true, opacity: 0.94 });
  const boxes = [];
  for (const f of [0.17, 0.42, 0.66, 0.88]) {
    const s = f * trackLen;
    for (const lane of [-4.6, -1.55, 1.55, 4.6]) {
      const sp = sample(s);
      const pos = sp.p.clone().addScaledVector(sp.r, lane).setY(1.25);
      const m = new THREE.Mesh(geo, mat);
      m.position.copy(pos); m.castShadow = true;
      scene.add(m);
      boxes.push({ pos, mesh: m, until: 0, phase: Math.random() * 6 });
    }
  }
  return boxes;
}
export function animateBoxes(boxes, now, dt) {
  for (const b of boxes) {
    const on = now >= b.until;
    const sc = b.mesh.scale.x + ((on ? 1 : 0.001) - b.mesh.scale.x) * Math.min(1, dt * (on ? 4 : 14));
    b.mesh.scale.setScalar(sc);
    b.mesh.visible = sc > 0.02;
    b.mesh.rotation.set(0.5, now * 1.4 + b.phase, 0.3);
    b.mesh.position.y = b.pos.y + Math.sin(now * 2.2 + b.phase) * 0.18;
  }
}

/* ---------- Symbol über einem Kart (zeigt allen, wer gerade getroffen ist) ---------- */
export function makeFxSprite() {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: itemTexture('swap'), depthTest: false, transparent: true }));
  s.scale.set(1.5, 1.5, 1); s.position.set(0, 3.1, -0.3); s.visible = false; s.renderOrder = 5;
  return s;
}

/* ---------- Wurfgeschoss ---------- */
export function makeProjectile(scene, kind) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: itemTexture(kind), depthTest: true, transparent: true }));
  s.scale.set(1.6, 1.6, 1);
  scene.add(s);
  return s;
}
