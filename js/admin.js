// Admin-Ansicht: Kennzahlen, Verlauf, Spiele ein-/ausblenden, Nutzer verwalten.
// Die Rechte prüft die Datenbank (jede Admin-Funktion verlangt is_admin()).
import * as A from './account.js';
import { sanitize } from './character.js';
import { avatarSvg } from './avatar2d.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const date = (d) => (d ? new Date(d).toLocaleDateString('de-CH', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
const mins = (s) => Math.round((s || 0) / 60).toLocaleString('de-CH');

let users = [], me = null, onGamesChanged = () => {};
function msg(t, kind) { const el = $('aMsg'); el.textContent = t || ''; el.className = 'note' + (kind ? ' ' + kind : ''); }

async function loadStats() {
  const st = await A.adminStats(30);
  $('aUsers').textContent = st.users;
  $('aUsersNew').textContent = `${st.users_7d} neu in 7 Tagen`;
  $('aActive').textContent = st.active_7d;
  $('aPlays').textContent = Number(st.plays).toLocaleString('de-CH');
  $('aMin').textContent = mins(st.seconds);
  const days = st.per_day || [];
  const max = Math.max(1, ...days.map((d) => d.plays));
  $('aBars').innerHTML = days.map((d, i) => {
    const dt = new Date(d.day + 'T00:00');
    const label = i % 5 === 4 || i === days.length - 1 ? dt.toLocaleDateString('de-CH', { day: 'numeric', month: 'numeric' }) : '';
    const h = d.plays ? Math.max(4, Math.round((d.plays / max) * 100)) : 3;
    return `<div title="${dt.toLocaleDateString('de-CH')}: ${d.plays} Runden, ${mins(d.seconds)} Min., ${d.signups} neue Konten"><small>${d.signups ? '+' + d.signups : ''}</small><i class="${d.plays ? '' : 'zero'}" style="height:${h}%"></i><em>${label}</em></div>`;
  }).join('');
  return st;
}

function renderGames(games, perGame) {
  const by = new Map((perGame || []).map((g) => [g.id, g]));
  $('aGames').innerHTML = games.map((g) => {
    const s = by.get(g.id) || { plays: 0, seconds: 0, players: 0 };
    return `<div class="adm-game"><span class="t"><b>${esc(g.name)}</b><span>${s.plays} Runden · ${mins(s.seconds)} Min. · ${s.players} Spieler</span></span>
      <button type="button" class="switch" data-game="${esc(g.id)}" aria-pressed="${g.visible}" aria-label="${esc(g.name)} sichtbar"><span>${g.visible ? 'Sichtbar' : 'Ausgeblendet'}</span><i></i></button></div>`;
  }).join('');
  $('aGames').querySelectorAll('.switch').forEach((b) => b.addEventListener('click', async () => {
    const show = b.getAttribute('aria-pressed') !== 'true';
    b.disabled = true;
    try {
      await A.adminSetGameVisible(b.dataset.game, show);
      b.setAttribute('aria-pressed', show); b.querySelector('span').textContent = show ? 'Sichtbar' : 'Ausgeblendet';
      onGamesChanged();
    } catch (e) { msg(A.niceError(e), 'err'); }
    finally { b.disabled = false; }
  }));
}

function renderUsers() {
  const q = $('aSearch').value.trim().toLowerCase();
  const list = users.filter((u) => !q || (u.email || '').toLowerCase().includes(q) || (u.nickname || '').toLowerCase().includes(q));
  $('aTable').querySelector('tbody').innerHTML = list.map((u) => {
    const self = me && u.id === me.id;
    const status = u.banned ? '<span class="badge-s bad">Gesperrt</span>' : !u.confirmed ? '<span class="badge-s">Unbestätigt</span>' : '<span class="badge-s ok">Aktiv</span>';
    const access = u.pass_source === 'admin' ? '<span class="badge-s gift">Alle Spiele · geschenkt</span>'
      : u.pass_source ? '<span class="badge-s ok">Pass gekauft</span>' : '<span class="badge-s">Standard</span>';
    const gift = u.pass_source && u.pass_source !== 'admin' ? ''
      : `<button type="button" class="mini ${u.pass_source ? '' : 'gift'}" data-act="gift" data-id="${u.id}">${u.pass_source ? 'Zugriff entziehen' : 'Alle Spiele freischalten'}</button>`;
    const actions = self ? '<span class="badge-s">Du</span>' : `<span class="row-actions">
        ${gift}
        <button type="button" class="mini" data-act="ban" data-id="${u.id}">${u.banned ? 'Entsperren' : 'Sperren'}</button>
        <button type="button" class="mini danger" data-act="del" data-id="${u.id}">Löschen</button></span>`;
    return `<tr><td><span class="who"><span class="av">${avatarSvg(sanitize(u.character || {}), { body: false })}</span><b>${esc(u.nickname || '–')}</b></span></td>
      <td>${esc(u.email)}</td><td>${date(u.created_at)}</td><td>${date(u.last_played)}</td>
      <td>${u.plays}</td><td>${mins(u.seconds)}</td><td>${status}</td><td>${access}</td><td>${actions}</td></tr>`;
  }).join('') || '<tr><td colspan="9">Keine Nutzer gefunden.</td></tr>';
}

async function loadUsers() { users = await A.adminUsers(); renderUsers(); }

/* Verkäufe und Schalter «Kaufen» */
async function loadSales() {
  const [on, s] = await Promise.all([A.paymentsEnabled(), A.adminSales()]);
  const b = $('aPay');
  b.setAttribute('aria-pressed', on); b.querySelector('span').textContent = on ? 'Ein' : 'Aus';
  $('aSales').textContent = `${s.count} Käufe · CHF ${A.chf(s.rappen)} insgesamt · ${s.count_30d} Käufe / CHF ${A.chf(s.rappen_30d)} in 30 Tagen`;
}
$('aPay').addEventListener('click', async () => {
  const b = $('aPay'), on = b.getAttribute('aria-pressed') !== 'true';
  if (on && !confirm('Kaufen einschalten? Ab dann sind Boxring und Skicross nur noch mit Kauf oder Pass spielbar.')) return;
  b.disabled = true;
  try { await A.adminSetPayments(on); await loadSales(); msg(on ? 'Kaufen ist eingeschaltet.' : 'Kaufen ist aus, alle Spiele sind gratis.', 'ok'); }
  catch (e) { msg(A.niceError(e), 'err'); }
  finally { b.disabled = false; }
});

$('aTable').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const u = users.find((x) => x.id === b.dataset.id);
  if (!u) return;
  const who = u.nickname ? `${u.nickname} (${u.email})` : u.email;
  if (b.dataset.act === 'ban') {
    if (!u.banned && !confirm(`${who} sperren? Die Person kann sich danach nicht mehr anmelden.`)) return;
    b.disabled = true;
    try { await A.adminSetBanned(u.id, !u.banned); msg(u.banned ? `${who} ist wieder freigeschaltet.` : `${who} ist gesperrt.`, 'ok'); await loadUsers(); }
    catch (err) { msg(A.niceError(err), 'err'); b.disabled = false; }
  } else if (b.dataset.act === 'gift') {
    const grant = !u.pass_source;
    if (!grant && !confirm(`${who} den geschenkten Zugriff auf alle Spiele wieder entziehen?`)) return;
    b.disabled = true;
    try { await A.adminSetFullAccess(u.id, grant); msg(grant ? `${who} hat jetzt Zugriff auf alle Spiele.` : `${who} hat keinen geschenkten Zugriff mehr.`, 'ok'); await loadUsers(); }
    catch (err) { msg(A.niceError(err), 'err'); b.disabled = false; }
  } else if (b.dataset.act === 'del') {
    if (!confirm(`Konto von ${who} endgültig löschen? Alle Runden gehen verloren.`)) return;
    b.disabled = true;
    try { await A.adminDeleteUser(u.id); msg(`Konto von ${who} gelöscht.`, 'ok'); await Promise.all([loadUsers(), loadStats()]); }
    catch (err) { msg(A.niceError(err), 'err'); b.disabled = false; }
  }
});
$('aSearch').addEventListener('input', renderUsers);

export async function initAdmin({ user, games, onGames }) {
  me = user; onGamesChanged = onGames || onGamesChanged;
  try {
    const st = await loadStats();
    renderGames(games, st.per_game);
    await Promise.all([loadUsers(), loadSales()]);
  } catch (e) { msg('Admin-Daten konnten nicht geladen werden: ' + A.niceError(e), 'err'); }
}
export async function refreshAdmin(games) {
  try { const st = await loadStats(); renderGames(games, st.per_game); await Promise.all([loadUsers(), loadSales()]); } catch { /* */ }
}
