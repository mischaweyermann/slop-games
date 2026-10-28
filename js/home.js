// Startseite mit Konto: Willkommensschritt (Name + Figur), Profil-Ansicht und Statistik aus dem Konto.
import * as A from './account.js';
import { createEditor, sanitize, DEFAULT_CONFIG } from './character.js';
import { avatarSvg } from './avatar2d.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GAMES = Object.entries(A.GAMES).map(([id, g]) => ({ id, ...g }));

let profile = { nickname: null, character: null };
let plays = [];
let user = null;

/* ---------------- Profil anzeigen ---------------- */
function showAvatar(cfg) {
  const c = sanitize(cfg || DEFAULT_CONFIG);
  $('profAv').innerHTML = avatarSvg(c);
  const nav = $('railProfil');
  if (nav) nav.innerHTML = `<span class="rail-av">${avatarSvg(c, { body: false })}</span>`;
}
function showProfile() {
  const name = profile.nickname;
  $('profTitle').textContent = name ? `Hallo, ${name}!` : 'Dein Profil';
  $('profMail').textContent = user ? `Angemeldet mit ${user.email}` : '';
  showAvatar(profile.character);
}

let editor = null, draft = null;
function setupProfileEditor() {
  draft = sanitize(profile.character || DEFAULT_CONFIG);
  $('profNick').value = profile.nickname || '';
  if (!editor) editor = createEditor($('profEditor'), draft, (cfg) => { draft = cfg; $('profAv').innerHTML = avatarSvg(cfg); $('profMsg').textContent = ''; });
  else editor.set(draft);
}
function note(el, text, kind) { el.textContent = text || ''; el.className = 'note' + (kind ? ' ' + kind : ''); }

$('profSave').addEventListener('click', async () => {
  const nick = $('profNick').value.trim();
  if (!nick) return note($('profMsg'), 'Bitte gib einen Namen ein.', 'err');
  $('profSave').disabled = true;
  try {
    await A.saveProfile({ nickname: nick, character: draft });
    profile = { ...profile, nickname: nick, character: draft };
    showProfile();
    note($('profMsg'), 'Gespeichert – gilt ab sofort in allen Spielen.', 'ok');
  } catch (e) { note($('profMsg'), A.niceError(e), 'err'); }
  finally { $('profSave').disabled = false; }
});
$('profPwBtn').addEventListener('click', async () => {
  const pw = $('profPw').value;
  if (pw.length < 8) return note($('profPwMsg'), 'Mindestens 8 Zeichen.', 'err');
  $('profPwBtn').disabled = true;
  try { await A.updatePassword(pw); $('profPw').value = ''; note($('profPwMsg'), 'Passwort geändert.', 'ok'); }
  catch (e) { note($('profPwMsg'), A.niceError(e), 'err'); }
  finally { $('profPwBtn').disabled = false; }
});
$('logoutBtn').addEventListener('click', () => A.signOut()); // gate.js leitet danach zur Anmeldung
$('deleteBtn').addEventListener('click', async () => {
  if (!confirm('Konto wirklich löschen? Alle gespeicherten Runden gehen verloren.')) return;
  $('deleteBtn').disabled = true;
  try { await A.deleteAccount(); } catch (e) { alert(A.niceError(e)); $('deleteBtn').disabled = false; }
});

/* ---------------- Willkommen (erster Login) ---------------- */
function welcome() {
  const dlg = $('welcome');
  if (!dlg || typeof dlg.showModal !== 'function') return;
  let cfg = sanitize(profile.character || DEFAULT_CONFIG);
  let wEditor = null;
  dlg.addEventListener('cancel', (e) => e.preventDefault()); // erst Name und Figur wählen
  const step = (n) => {
    $('wStep1').hidden = n !== 1; $('wStep2').hidden = n !== 2;
    if (n === 1) $('wNick').focus();
    if (n === 2) {
      $('wAv').innerHTML = avatarSvg(cfg);
      if (!wEditor) wEditor = createEditor($('wEditor'), cfg, (c) => { cfg = c; $('wAv').innerHTML = avatarSvg(c); });
    }
  };
  $('wNext').onclick = () => {
    if (!$('wNick').value.trim()) { $('wErr').textContent = 'Bitte gib einen Namen ein.'; $('wErr').hidden = false; return; }
    $('wErr').hidden = true; step(2);
  };
  $('wNick').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('wNext').click(); } });
  $('wBack').onclick = () => step(1);
  $('wDone').onclick = async () => {
    const nick = $('wNick').value.trim();
    $('wDone').disabled = true;
    try {
      await A.saveProfile({ nickname: nick, character: cfg });
      profile = { ...profile, nickname: nick, character: cfg };
      showProfile(); setupProfileEditor();
      dlg.close();
    } catch (e) { $('wErr2').textContent = A.niceError(e); $('wErr2').hidden = false; }
    finally { $('wDone').disabled = false; }
  };
  dlg.showModal();
  step(1);
}

/* ---------------- Statistik aus dem Konto ---------------- */
const fmt = (t) => { const m = Math.floor(t / 60), s = Math.round(t - m * 60); return `${m}:${s < 10 ? '0' : ''}${s}`; };
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
function renderStats() {
  const real = plays.filter((p) => !p.imported);
  const per = GAMES.map((g) => {
    const list = plays.filter((p) => p.game === g.id), r = list.filter((p) => !p.imported);
    return { ...g, min: Math.round(list.reduce((a, p) => a + p.seconds, 0) / 60), n: r.length, w: r.filter((p) => p.won).length };
  });
  const total = per.reduce((a, g) => a + g.min, 0);
  // Startseite: Kreis
  $('totalMin').textContent = total;
  $('legend').innerHTML = per.map((g) => `<div><i style="background:${g.color}"></i><span>${g.name}</span><b>${g.min} Min.</b></div>`).join('');
  const C = 2 * Math.PI * 48;
  let off = 0;
  $('arcs').innerHTML = per.filter((g) => g.min > 0).map((g) => {
    const len = Math.max(4, C * Math.min(1, g.min / Math.max(60, total)) - 6);
    const el = `<circle cx="60" cy="60" r="48" fill="none" stroke="${g.color}" stroke-width="16" stroke-linecap="round" stroke-dasharray="${len} ${C}" stroke-dashoffset="${-off}"/>`;
    off += len + 6; return el;
  }).join('');
  $('statsEmpty').hidden = total > 0 || real.length > 0;
  // Seite «Deine Bewegung»
  $('kMin').textContent = total;
  $('kPlays').textContent = real.length;
  $('kWins').textContent = real.filter((p) => p.won).length;
  const fav = [...per].sort((a, b) => b.min - a.min)[0];
  $('kFav').textContent = fav && fav.min > 0 ? fav.name : '–';
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), label: i === 0 ? 'Heute' : d.toLocaleDateString('de-CH', { weekday: 'short' }), sec: 0, today: i === 0 }); }
  const byKey = new Map(days.map((x) => [x.key, x]));
  for (const p of real) { const x = byKey.get(dayKey(new Date(p.played_at))); if (x) x.sec += p.seconds; }
  const max = Math.max(5, ...days.map((x) => Math.round(x.sec / 60)));
  $('bars').innerHTML = days.map((x) => { const m = Math.round(x.sec / 60); return `<div class="bar ${x.today ? 'today' : ''}"><small>${m || ''}</small><i style="height:${(m / max) * 100}%"></i><em>${x.label}</em></div>`; }).join('');
  const hist = real.slice(0, 10);
  $('hist').hidden = !hist.length; $('histEmpty').hidden = !!hist.length;
  $('hist').querySelector('tbody').innerHTML = hist.map((p) => {
    const g = GAMES.find((x) => x.id === p.game) || GAMES[0];
    const res = p.game === 'boxring' ? (p.won ? 'Sieg' : 'Niederlage') : (p.won ? 'Sieg' : p.place ? p.place + '. Platz' : '–');
    const who = !p.players || p.players === 1 ? 'allein' : `${p.players} Spieler`;
    const dur = p.finish_time ? fmt(p.finish_time) : fmt(p.seconds);
    return `<tr><td>${new Date(p.played_at).toLocaleString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</td><td><span class="gdot" style="background:${g.color}"></span>${esc(g.name)}</td><td><b>${who}</b></td><td>${res}</td><td>${dur}</td></tr>`;
  }).join('');
}
window.renderStats = renderStats;

/* ---------------- Start ---------------- */
async function init() {
  user = await A.currentUser().catch(() => null);
  if (!user) return; // gate.js leitet zur Anmeldung weiter
  try { profile = (await A.getProfile()) || profile; } catch { /* trotzdem weiter */ }
  showProfile();
  setupProfileEditor();
  if (!profile.nickname) welcome();
  try { await A.importLocalStats(); } catch { /* */ }
  try { plays = await A.loadPlays(); } catch { plays = []; }
  renderStats();
}
init();
