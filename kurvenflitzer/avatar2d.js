// Gezeichneter Fahrer (2D, SVG) mit allen Merkmalen aus dem Charakter-Editor:
// Hautfarbe, Frisur + Haarfarbe, Kopfbedeckung, Brille, Bart, Oberteil.
const DARK = '#2f2420';

function hairBack(c) {
  const h = c.hairColor;
  if (c.hair === 'long') return `<path d="M24 44 Q22 80 30 86 L70 86 Q78 80 76 44 Z" fill="${h}"/>`;
  if (c.hair === 'bun') return `<circle cx="50" cy="15" r="9" fill="${h}"/>`;
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
    default: return '';
  }
}
function glasses(c) {
  if (c.glasses === 'round') return `<g fill="none" stroke="${DARK}" stroke-width="2.4"><circle cx="40" cy="49" r="6.5"/><circle cx="60" cy="49" r="6.5"/><path d="M46.5 49h7"/></g>`;
  if (c.glasses === 'sun') return `<g fill="${DARK}"><rect x="31" y="44" width="16" height="10" rx="4"/><rect x="53" y="44" width="16" height="10" rx="4"/><rect x="46" y="46" width="8" height="2.5"/></g>`;
  return '';
}
function beard(c) {
  const h = c.hairColor;
  if (c.beard === 'beard') return `<path d="M29 52 Q30 76 50 78 Q70 76 71 52 Q66 62 58 61 Q50 66 42 61 Q34 62 29 52 Z" fill="${h}"/>`;
  if (c.beard === 'mustache') return `<path d="M40 61 Q45 56 50 59 Q55 56 60 61 Q55 63 50 61 Q45 63 40 61 Z" fill="${h}"/>`;
  return '';
}

export function avatarSvg(c, { body = true } = {}) {
  const eyes = c.glasses === 'sun' ? '' : `<circle cx="40" cy="49" r="3" fill="${DARK}"/><circle cx="60" cy="49" r="3" fill="${DARK}"/><circle cx="41" cy="48" r="1" fill="#fff"/><circle cx="61" cy="48" r="1" fill="#fff"/>`;
  const mouth = c.beard === 'beard' ? `<path d="M44 66 Q50 70 56 66" stroke="${DARK}" stroke-width="2.2" fill="none" stroke-linecap="round"/>` : `<path d="M43 63 Q50 69 57 63" stroke="${DARK}" stroke-width="2.4" fill="none" stroke-linecap="round"/>`;
  const torso = body ? `<path d="M18 100 Q18 80 36 76 L64 76 Q82 80 82 100 Z" fill="${c.topColor}"/><path d="M42 76 Q50 84 58 76" fill="${c.innerColor || '#f4efe6'}" opacity=".9"/>` : '';
  return `<svg viewBox="0 0 100 100" aria-hidden="true">${hairBack(c)}${torso}<rect x="44" y="68" width="12" height="10" rx="4" fill="${c.skin}"/>
    <circle cx="50" cy="46" r="24" fill="${c.skin}"/>
    <circle cx="35" cy="57" r="3.5" fill="#e2574c" opacity=".25"/><circle cx="65" cy="57" r="3.5" fill="#e2574c" opacity=".25"/>
    ${eyes}${beard(c)}${mouth}${glasses(c)}${hairFront(c)}${hat(c)}</svg>`;
}
