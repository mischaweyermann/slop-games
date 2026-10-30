// Münzen fürs Spielen: Der TV ist immer angemeldet und speichert jede Runde im Konto.
// Handys mit einem anderen Konto speichern ihre Runde zusätzlich selbst (siehe controller.js).
import { savePlay, currentUser } from './account.js';

// Konto am TV (das Handy vergleicht damit, damit dieselbe Runde nicht doppelt zählt)
export let tvUid = null;
currentUser().then((u) => { tvUid = u ? u.id : null; }).catch(() => {});

const COIN = '<svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="11" fill="#f2c94c" stroke="#5a1f25" stroke-width="2.5"/><path d="M13 7v12" stroke="#5a1f25" stroke-width="2.5" stroke-linecap="round"/></svg>';

// Runde speichern und das Ergebnis im Element el (z. B. auf der Resultat-Karte) anzeigen
export async function reward(el, play) {
  if (el) { el.hidden = false; el.className = 'results-coins wait'; el.innerHTML = `${COIN}<span>Münzen werden gutgeschrieben …</span>`; }
  let res = null;
  try { res = await savePlay(play); } catch (e) { console.warn('Runde nicht gespeichert', e); }
  if (!el) return res;
  if (!res) { el.className = 'results-coins off'; el.innerHTML = `${COIN}<span>Diese Runde konnte nicht gespeichert werden.</span>`; return res; }
  const fmt = (n) => Number(n || 0).toLocaleString('de-CH');
  if (res.earned > 0) {
    el.className = 'results-coins';
    el.innerHTML = `${COIN}<b class="plus">+${fmt(res.earned)}</b><span>Münzen fürs Konto · total ${fmt(res.coins)}</span>`;
    countUp(el.querySelector('.plus'), res.earned);
  } else if (play.seconds < 30) {
    el.className = 'results-coins off'; el.innerHTML = `${COIN}<span>Zu kurz für Münzen – ab 30 Sekunden gibt’s welche.</span>`;
  } else {
    el.className = 'results-coins off'; el.innerHTML = `${COIN}<span>Tageslimit von ${fmt(res.limit)} Münzen erreicht – morgen geht’s weiter.</span>`;
  }
  return res;
}
function countUp(b, to) {
  if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const t0 = performance.now(), dur = 900;
  const step = (t) => { const f = Math.min(1, (t - t0) / dur); b.textContent = '+' + Math.round(to * (1 - (1 - f) ** 3)); if (f < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
