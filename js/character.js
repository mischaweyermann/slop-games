// Charakter-Daten (Optionen, Presets) und der Editor – wird von TV und Handy gemeinsam genutzt.
import { avatarSvg } from './avatar2d.js';

export const SKIN = ['#ffdcc6', '#f6c6a4', '#e3a97f', '#c08158', '#8d5b3d', '#5e3b28'];
export const HAIR_COLORS = ['#2f2420', '#5e3d2b', '#9a6440', '#d39a55', '#ecd08a', '#e2dcd4', '#b8503a', '#6a5aa3'];
export const CLOTH = ['#e8574f', '#f39a4c', '#f2c94c', '#7fb069', '#5f7d4e', '#5aa9c9', '#3d5a80', '#9b7fd1', '#f3a6b8', '#f4efe6', '#3b3b45', '#c69c6d'];
export const PANTS = ['#3d5a80', '#6f8fb5', '#3b3b45', '#7a5a43', '#c69c6d', '#5f7d4e', '#e8574f', '#f4efe6'];
export const SHOES = ['#f4efe6', '#3b3b45', '#e8574f', '#f39a4c', '#5aa9c9', '#7fb069', '#9b7fd1', '#7a5a43'];

export const OPTIONS = {
  hair: [['short', 'Kurz'], ['bun', 'Dutt'], ['curly', 'Locken'], ['long', 'Lang'], ['spiky', 'Wuschel'], ['side', 'Opa'], ['none', 'Glatze']],
  hat: [['none', 'Keine'], ['cap', 'Cap'], ['beanie', 'Mütze'], ['bucket', 'Fischerhut'], ['party', 'Partyhut'], ['crown', 'Krone']],
  glasses: [['none', 'Keine'], ['round', 'Rund'], ['sun', 'Sonnenbrille']],
  beard: [['none', 'Keiner'], ['beard', 'Vollbart'], ['mustache', 'Schnauz']],
  top: [['tshirt', 'T-Shirt'], ['longsleeve', 'Pulli'], ['hoodie', 'Hoodie'], ['jacket', 'Jacke']],
  bottom: [['long', 'Lange Hose'], ['shorts', 'Shorts']],
};

export const PRESETS = [
  { name: 'Mia', cfg: { skin: SKIN[0], hair: 'bun', hairColor: HAIR_COLORS[2], hat: 'none', hatColor: CLOTH[0], glasses: 'none', beard: 'none', top: 'tshirt', topColor: CLOTH[0], innerColor: CLOTH[9], bottom: 'long', bottomColor: PANTS[1], shoes: SHOES[0] } },
  { name: 'Leo', cfg: { skin: SKIN[2], hair: 'short', hairColor: HAIR_COLORS[0], hat: 'cap', hatColor: CLOTH[5], glasses: 'none', beard: 'none', top: 'tshirt', topColor: CLOTH[2], innerColor: CLOTH[9], bottom: 'shorts', bottomColor: PANTS[4], shoes: SHOES[3] } },
  { name: 'Opa Ruedi', cfg: { skin: SKIN[1], hair: 'side', hairColor: HAIR_COLORS[5], hat: 'none', hatColor: CLOTH[4], glasses: 'round', beard: 'beard', top: 'jacket', topColor: CLOTH[4], innerColor: CLOTH[9], bottom: 'long', bottomColor: PANTS[3], shoes: SHOES[7] } },
  { name: 'Nala', cfg: { skin: SKIN[4], hair: 'curly', hairColor: HAIR_COLORS[0], hat: 'none', hatColor: CLOTH[8], glasses: 'none', beard: 'none', top: 'longsleeve', topColor: CLOTH[7], innerColor: CLOTH[9], bottom: 'long', bottomColor: PANTS[2], shoes: SHOES[2] } },
  { name: 'Kai', cfg: { skin: SKIN[2], hair: 'spiky', hairColor: HAIR_COLORS[4], hat: 'none', hatColor: CLOTH[1], glasses: 'sun', beard: 'none', top: 'hoodie', topColor: CLOTH[5], innerColor: CLOTH[9], bottom: 'shorts', bottomColor: PANTS[0], shoes: SHOES[1] } },
  { name: 'Zoe', cfg: { skin: SKIN[0], hair: 'long', hairColor: HAIR_COLORS[6], hat: 'bucket', hatColor: CLOTH[2], glasses: 'none', beard: 'none', top: 'tshirt', topColor: CLOTH[9], innerColor: CLOTH[9], bottom: 'long', bottomColor: PANTS[5], shoes: SHOES[4] } },
  { name: 'Ben', cfg: { skin: SKIN[3], hair: 'short', hairColor: HAIR_COLORS[1], hat: 'beanie', hatColor: CLOTH[0], glasses: 'round', beard: 'mustache', top: 'hoodie', topColor: CLOTH[10], innerColor: CLOTH[9], bottom: 'long', bottomColor: PANTS[1], shoes: SHOES[0] } },
  { name: 'Königin Lu', cfg: { skin: SKIN[5], hair: 'long', hairColor: HAIR_COLORS[0], hat: 'crown', hatColor: CLOTH[2], glasses: 'none', beard: 'none', top: 'jacket', topColor: CLOTH[7], innerColor: CLOTH[2], bottom: 'long', bottomColor: PANTS[2], shoes: SHOES[6] } },
];
export const DEFAULT_CONFIG = PRESETS[0].cfg;

const COLOR_KEYS = { skin: SKIN, hairColor: HAIR_COLORS, hatColor: CLOTH, topColor: CLOTH, innerColor: CLOTH, bottomColor: PANTS, shoes: SHOES };

// Nur bekannte Werte durchlassen (der TV bekommt die Daten vom Handy)
export function sanitize(c) {
  const out = { ...DEFAULT_CONFIG };
  if (!c || typeof c !== 'object') return out;
  for (const [k, list] of Object.entries(OPTIONS)) if (list.some(([v]) => v === c[k])) out[k] = c[k];
  for (const [k, list] of Object.entries(COLOR_KEYS)) if (list.includes(c[k])) out[k] = c[k];
  return out;
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
export function randomConfig() {
  const c = {};
  for (const [k, list] of Object.entries(OPTIONS)) c[k] = pick(list)[0];
  for (const [k, list] of Object.entries(COLOR_KEYS)) c[k] = pick(list);
  if (Math.random() < 0.6) c.hat = 'none';
  if (Math.random() < 0.6) c.beard = 'none';
  if (Math.random() < 0.5) c.glasses = 'none';
  return sanitize(c);
}

export function loadConfig(key) {
  try { return sanitize(JSON.parse(localStorage.getItem(key))); } catch { return { ...DEFAULT_CONFIG }; }
}
export function saveConfig(key, cfg) { try { localStorage.setItem(key, JSON.stringify(cfg)); } catch { /* privat */ } }

/* ---------------- Editor (HTML) ---------------- */
const TABS = [
  ['Kopf', [
    ['Hautfarbe', 'skin', 'color'],
    ['Frisur', 'hair', 'option'],
    ['Haarfarbe', 'hairColor', 'color'],
    ['Kopfbedeckung', 'hat', 'option'],
    ['Farbe Kopfbedeckung', 'hatColor', 'color', (c) => c.hat !== 'none' && c.hat !== 'crown'],
    ['Brille', 'glasses', 'option'],
    ['Bart', 'beard', 'option'],
  ]],
  ['Oberteil', [
    ['Art', 'top', 'option'],
    ['Farbe', 'topColor', 'color'],
    ['Farbe innen', 'innerColor', 'color', (c) => c.top === 'jacket'],
  ]],
  ['Hose & Schuhe', [
    ['Hose', 'bottom', 'option'],
    ['Farbe Hose', 'bottomColor', 'color'],
    ['Schuhe', 'shoes', 'color'],
  ]],
];

export function createEditor(root, initial, onChange) {
  let cfg = sanitize(initial);
  let tab = 0;
  root.classList.add('ce');
  root.innerHTML = '';

  const presets = document.createElement('div');
  presets.className = 'ce-presets';
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'ce-preset';
    b.innerHTML = `<span class="ce-face2">${avatarSvg(sanitize(p.cfg))}</span>${p.name}`;
    b.addEventListener('click', () => update({ ...p.cfg }));
    presets.appendChild(b);
  });
  const dice = document.createElement('button');
  dice.type = 'button'; dice.className = 'ce-preset dice'; dice.innerHTML = '<span class="ce-dice">🎲</span>Zufall';
  dice.addEventListener('click', () => update(randomConfig()));
  presets.appendChild(dice);

  const tabs = document.createElement('div'); tabs.className = 'ce-tabs';
  const body = document.createElement('div'); body.className = 'ce-body';
  root.append(presets, tabs, body);

  function update(next) {
    cfg = sanitize(next);
    render();
    onChange && onChange(cfg);
  }

  function render() {
    tabs.innerHTML = '';
    TABS.forEach(([name], i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ce-tab' + (i === tab ? ' active' : ''); b.textContent = name;
      b.addEventListener('click', () => { tab = i; render(); });
      tabs.appendChild(b);
    });
    body.innerHTML = '';
    for (const [label, key, kind, cond] of TABS[tab][1]) {
      if (cond && !cond(cfg)) continue;
      const row = document.createElement('div'); row.className = 'ce-row';
      const l = document.createElement('div'); l.className = 'ce-label'; l.textContent = label;
      const opts = document.createElement('div'); opts.className = 'ce-opts ' + kind;
      if (kind === 'color') {
        COLOR_KEYS[key].forEach((col) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'ce-swatch' + (cfg[key] === col ? ' active' : '');
          b.style.setProperty('--c', col); b.setAttribute('aria-label', label + ' ' + col);
          b.addEventListener('click', () => update({ ...cfg, [key]: col }));
          opts.appendChild(b);
        });
      } else {
        OPTIONS[key].forEach(([v, name]) => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = 'ce-chip' + (cfg[key] === v ? ' active' : ''); b.textContent = name;
          b.addEventListener('click', () => update({ ...cfg, [key]: v }));
          opts.appendChild(b);
        });
      }
      row.append(l, opts); body.appendChild(row);
    }
  }
  render();
  return {
    get config() { return cfg; },
    set(next) { cfg = sanitize(next); render(); },
  };
}
