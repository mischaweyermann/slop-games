// Bild der Figur für Profil, Editor, Handy, Lobbys und Admin.
// Gerendert wird die echte 3D-Chibi-Figur aus den Spielen (js/avatar3d.js) als kleines Bild.
// Nur wenn das Gerät kein WebGL kann, kommt die einfache gezeichnete Figur (drawnSvg) zum Zug.
import * as THREE from 'three';
import { Avatar, D } from './avatar3d.js';

let R = null; // { renderer, scene, cam, av }
const cache = new Map();

function setup() {
  if (R !== null) return R;
  try {
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight('#fff1e6', '#7d2a2e', 1.6));
    const key = new THREE.DirectionalLight('#ffffff', 2.1); key.position.set(2.5, 5, 6); scene.add(key);
    const rim = new THREE.DirectionalLight('#ffd9c2', 0.9); rim.position.set(-4, 3, -3); scene.add(rim);
    const av = new Avatar(scene);
    standing(av);
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
    R = { renderer, scene, cam, av };
  } catch { R = false; }
  return R;
}

// Lockere Grundstellung, Arme leicht vom Körper weg
function standing(av) {
  const J = av.J, hipY = 0.94, shY = hipY + D.torso;
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'l' : 'r';
    J[k + 'Hip'].tgt.set(D.hipHalf * s, hipY, 0);
    J[k + 'Kn'].tgt.set(D.hipHalf * s * 1.05, hipY - D.thigh, 0.03);
    J[k + 'An'].tgt.set(D.hipHalf * s * 1.1, hipY - D.thigh - D.shin, 0);
    J[k + 'Sh'].tgt.set(D.shoulderHalf * s, shY, 0.03);
    J[k + 'El'].tgt.set((D.shoulderHalf + 0.12) * s, shY - D.upperArm * 0.95, 0.06);
    J[k + 'Ha'].tgt.set((D.shoulderHalf + 0.18) * s, shY - D.upperArm * 0.95 - D.foreArm * 0.95, 0.14);
  }
  J.head.tgt.set(0, shY + D.neck, 0.08);
  av.snap();
  av.update(0, 0);
}

function render(c, body) {
  const r = setup();
  if (!r) return null;
  const { renderer, scene, cam, av } = r;
  av.setConfig(c);
  av.hop = 0; av.happy = 0; av.shake = 0; av.blink = 0; av.blinkAt = 99;
  av.update(0, 0);
  const head = av.J.head.cur;
  // Leicht schräg von vorn, damit Umhang und Flügel zu sehen sind
  const yaw = c.back && c.back !== 'none' ? 0.85 : 0.3;
  av.root.rotation.y = yaw;
  av.head.rotation.y = 0;
  const size = body ? 320 : 220;
  renderer.setSize(size, size, false);
  // Ausschnitt: Brustbild (body) bzw. Kopf, mit Platz für Hüte und Hörner
  if (body) { cam.position.set(0, head.y - 0.45, 9.2); cam.lookAt(0, head.y - 0.6, 0); }
  else { cam.position.set(0, head.y + 0.3, 7.0); cam.lookAt(0, head.y + 0.22, 0); }
  cam.aspect = 1; cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  return renderer.domElement.toDataURL('image/png');
}

export function avatarSvg(c, { body = true } = {}) {
  const key = (body ? 'b' : 'h') + JSON.stringify(c || {});
  let html = cache.get(key);
  if (!html) {
    const url = render(c || {}, body);
    html = url ? `<img class="av3d" src="${url}" alt="" draggable="false" style="width:100%;height:100%;object-fit:contain;display:block">` : drawnSvg(c || {}, { body });
    if (cache.size > 300) cache.clear();
    cache.set(key, html);
  }
  return html;
}

// Gezeichneter Fahrer (2D, SVG) mit allen Merkmalen aus dem Charakter-Editor:
// Hautfarbe, Frisur + Haarfarbe, Kopfbedeckung, Brille, Bart, Oberteil.
const DARK = '#2f2420';

function hairBack(c) {
  const h = c.hairColor;
  if (c.hair === 'long') return `<path d="M24 44 Q22 80 30 86 L70 86 Q78 80 76 44 Z" fill="${h}"/>`;
  if (c.hair === 'bun' && (!c.hat || c.hat === 'none')) return `<circle cx="50" cy="15" r="9" fill="${h}"/>`;
  return '';
}
function hairFront(c) {
  const h = c.hairColor;
  switch (c.hair) {
    case 'short': return `<path d="M26 44 Q26 18 50 18 Q74 18 74 44 Q66 30 50 31 Q34 30 26 44 Z" fill="${h}"/>`;
    case 'bun': return `<path d="M26 44 Q26 20 50 20 Q74 20 74 44 Q64 30 50 30 Q36 30 26 44 Z" fill="${h}"/>`;
    case 'long': return `<path d="M25 50 Q24 18 50 18 Q76 18 75 50 Q70 32 56 30 Q44 36 30 34 Q27 40 25 50 Z" fill="${h}"/>`;
    case 'curly': return [[30, 32], [38, 23], [50, 19], [62, 23], [70, 32], [27, 42], [73, 42]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="${h}"/>`).join('');
    case 'spiky': return `<path d="M26 44 L28 26 L35 32 L38 16 L45 27 L50 12 L55 27 L62 16 L65 32 L72 26 L74 44 Q62 31 50 32 Q38 31 26 44 Z" fill="${h}"/>`;
    case 'side': return `<path d="M25 46 Q24 32 31 30 Q30 40 32 46 Z M75 46 Q76 32 69 30 Q70 40 68 46 Z" fill="${h}"/>`;
    default: return '';
  }
}
function hat(c) {
  const k = c.hatColor;
  switch (c.hat) {
    case 'cap': return `<path d="M26 36 Q27 14 50 14 Q73 14 74 36 Z" fill="${k}"/><path d="M50 33 Q72 30 86 36 Q72 40 50 38 Z" fill="${k}" opacity=".85"/><circle cx="50" cy="15" r="2.5" fill="#fff" opacity=".6"/>`;
    case 'beanie': return `<path d="M25 38 Q25 12 50 12 Q75 12 75 38 Z" fill="${k}"/><rect x="23" y="32" width="54" height="9" rx="4" fill="${k}" opacity=".8"/><circle cx="50" cy="11" r="5" fill="${k}"/>`;
    case 'bucket': return `<path d="M32 33 L36 14 Q50 9 64 14 L68 33 Z" fill="${k}"/><path d="M20 34 Q50 26 80 34 Q50 42 20 34 Z" fill="${k}" opacity=".9"/>`;
    case 'party': return `<path d="M38 26 L50 0 L62 26 Z" fill="${k}"/><path d="M42 18 L58 18 M45 10 L55 10" stroke="#fff" stroke-width="2.5" opacity=".7"/><circle cx="50" cy="2" r="4" fill="#fff"/>`;
    case 'crown': return `<path d="M32 30 L32 14 L41 22 L50 10 L59 22 L68 14 L68 30 Z" fill="#f2c94c" stroke="#c99a2e" stroke-width="1.5" stroke-linejoin="round"/><circle cx="50" cy="22" r="2.5" fill="#e2574c"/>`;
    // Garderobe
    case 'cat': return `<path d="M27 37 Q50 16 73 37" stroke="${k}" stroke-width="4.5" fill="none" stroke-linecap="round"/><path d="M27 31 L29 9 L44 22 Z" fill="${k}"/><path d="M73 31 L71 9 L56 22 Z" fill="${k}"/><path d="M31 26 L32 15 L40 22 Z" fill="#f3a6b8"/><path d="M69 26 L68 15 L60 22 Z" fill="#f3a6b8"/>`;
    case 'cowboy': return `<path d="M34 31 Q32 11 42 10 Q50 15 58 10 Q68 11 66 31 Z" fill="${k}"/><rect x="34" y="25" width="32" height="5" fill="#3b2a20" opacity=".5"/><path d="M12 29 Q22 37 50 36 Q78 37 88 29 Q88 39 50 41 Q12 39 12 29 Z" fill="${k}"/>`;
    case 'viking': return `<path d="M27 30 Q11 26 11 7 Q19 19 31 22 Z" fill="#f4efe6" stroke="#c9bfae" stroke-width="1.2"/><path d="M73 30 Q89 26 89 7 Q81 19 69 22 Z" fill="#f4efe6" stroke="#c9bfae" stroke-width="1.2"/><path d="M26 38 Q26 14 50 14 Q74 14 74 38 Z" fill="#a9b4bf"/><rect x="24" y="33" width="52" height="7" rx="3" fill="#7d8894"/><rect x="48" y="14" width="4" height="22" fill="#7d8894"/><circle cx="34" cy="36.5" r="1.4" fill="#e2e8ee"/><circle cx="66" cy="36.5" r="1.4" fill="#e2e8ee"/>`;
    case 'astro': return `<rect x="30" y="70" width="40" height="9" rx="4.5" fill="#e8f4fb" stroke="#b9c9d4" stroke-width="1.2"/><circle cx="50" cy="46" r="31" fill="#bfe6ff" fill-opacity=".22" stroke="#e8f4fb" stroke-width="3.5"/><path d="M31 30 Q37 21 47 19" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".85"/><circle cx="76" cy="40" r="2.5" fill="#e2574c"/>`;
    default: return '';
  }
}
function glasses(c) {
  if (c.glasses === 'round') return `<g fill="none" stroke="${DARK}" stroke-width="2.4"><circle cx="40" cy="49" r="6.5"/><circle cx="60" cy="49" r="6.5"/><path d="M46.5 49h7"/></g>`;
  if (c.glasses === 'sun') return `<g fill="${DARK}"><rect x="31" y="44" width="16" height="10" rx="4"/><rect x="53" y="44" width="16" height="10" rx="4"/><rect x="46" y="46" width="8" height="2.5"/></g>`;
  if (c.glasses === 'heart') {
    const h = (x) => `<path d="M${x} 56 C${x - 11} 49 ${x - 8} 40 ${x} 45 C${x + 8} 40 ${x + 11} 49 ${x} 56 Z"/>`;
    return `<g fill="#e8574f" stroke="#b83a33" stroke-width="1.2" stroke-linejoin="round">${h(39)}${h(61)}</g><path d="M47 48h6" stroke="#b83a33" stroke-width="2"/>`;
  }
  if (c.glasses === 'star') {
    const st = (cx) => { let d = ''; for (let i = 0; i < 10; i++) { const r = i % 2 ? 4.2 : 9.5, a = -Math.PI / 2 + (i * Math.PI) / 5; d += `${i ? 'L' : 'M'}${(cx + Math.cos(a) * r).toFixed(1)} ${(49 + Math.sin(a) * r).toFixed(1)} `; } return `<path d="${d}Z"/>`; };
    return `<g fill="#f2c94c" stroke="#c99a2e" stroke-width="1.2" stroke-linejoin="round">${st(39)}${st(61)}</g><path d="M47 49h6" stroke="#c99a2e" stroke-width="2"/>`;
  }
  return '';
}
function beard(c) {
  const h = c.hairColor;
  if (c.beard === 'beard') return `<path d="M29 52 Q30 76 50 78 Q70 76 71 52 Q66 62 58 61 Q50 66 42 61 Q34 62 29 52 Z" fill="${h}"/>`;
  if (c.beard === 'mustache') return `<path d="M40 61 Q45 56 50 59 Q55 56 60 61 Q55 63 50 61 Q45 63 40 61 Z" fill="${h}"/>`;
  return '';
}

// Rücken: hinter dem Körper (Umhang, Flügel) und davor (Schliesse)
function backBehind(c) {
  if (c.back === 'cape') return `<path d="M27 78 Q5 88 4 100 L96 100 Q95 88 73 78 Z" fill="#d9443c"/><path d="M27 78 Q12 86 9 100" stroke="#b5352e" stroke-width="2" fill="none"/><path d="M73 78 Q88 86 91 100" stroke="#b5352e" stroke-width="2" fill="none"/>`;
  if (c.back === 'wings') {
    const w = (m) => `<path transform="${m}" d="M33 82 Q8 72 4 46 Q14 54 20 53 Q10 62 22 68 Q14 72 28 76 Z" fill="#ffffff" stroke="#d6e1ea" stroke-width="1.4" stroke-linejoin="round"/>`;
    return w('') + w('translate(100 0) scale(-1 1)');
  }
  return '';
}
function backFront(c) {
  if (c.back === 'cape') return `<circle cx="37" cy="79" r="3" fill="#f2c94c"/><circle cx="63" cy="79" r="3" fill="#f2c94c"/>`;
  return '';
}
function topDetails(c) {
  if (c.top === 'tracksuit') return `<path d="M30 82 L25 100 M70 82 L75 100" stroke="#fff" stroke-width="3.2" opacity=".9"/><path d="M50 80 V100" stroke="${c.innerColor || '#f4efe6'}" stroke-width="2"/><path d="M40 75 Q50 81 60 75 L60 80 Q50 85 40 80 Z" fill="${c.topColor}" stroke="#fff" stroke-width="1" opacity=".95"/>`;
  return '';
}

function drawnSvg(c, { body = true } = {}) {
  const eyes = ['sun', 'heart', 'star'].includes(c.glasses) ? '' : `<circle cx="40" cy="49" r="3" fill="${DARK}"/><circle cx="60" cy="49" r="3" fill="${DARK}"/><circle cx="41" cy="48" r="1" fill="#fff"/><circle cx="61" cy="48" r="1" fill="#fff"/>`;
  const mouth = c.beard === 'beard' ? `<path d="M44 66 Q50 70 56 66" stroke="${DARK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` : `<path d="M43 63 Q50 69 57 63" stroke="${DARK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const torso = body ? `${backBehind(c)}<path d="M18 100 Q18 80 36 76 L64 76 Q82 80 82 100 Z" fill="${c.topColor}"/><path d="M42 76 Q50 84 58 76" fill="${c.innerColor || '#f4efe6'}" opacity=".9"/>${topDetails(c)}${backFront(c)}` : '';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${hairBack(c)}${torso}<rect x="44" y="68" width="12" height="10" rx="4" fill="${c.skin}"/>
    <circle cx="50" cy="46" r="24" fill="${c.skin}"/>
    <circle cx="35" cy="57" r="3.5" fill="#e2574c" opacity=".25"/><circle cx="65" cy="57" r="3.5" fill="#e2574c" opacity=".25"/>
    ${eyes}${beard(c)}${mouth}${glasses(c)}${hairFront(c)}${hat(c)}</svg>`;
}
