// Startseite mit Konto: Willkommensschritt (Name + Figur), Profil-Ansicht und Statistik aus dem Konto.
import * as A from './account.js';
import { createEditor, sanitize, DEFAULT_CONFIG, SHOP, BASE } from './character.js';
import { avatarSvg } from './avatar2d.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GAMES = Object.entries(A.GAMES).map(([id, g]) => ({ id, ...g }));

let profile = { nickname: null, character: null };
let ownedSkins = new Set();
let plays = [];
let user = null;

/* ---------------- Profil anzeigen ---------------- */
function showAvatar(cfg) {
  const c = sanitize(cfg || DEFAULT_CONFIG);
  $('profAv').innerHTML = avatarSvg(c, { body: false });
  if ($('profFig')) $('profFig').innerHTML = avatarSvg(c, { body: true });
  const nav = $('railProfil');
  if (nav) nav.innerHTML = `<span class="rail-av">${avatarSvg(c, { body: false })}</span>`;
}
function showProfile() {
  const name = profile.nickname;
  $('profTitle').textContent = name ? `Hallo, ${name}!` : 'Dein Profil';
  const hello = $('helloName'); if (hello) hello.textContent = name || 'schön bist du da';
  $('profMail').textContent = user ? `Angemeldet mit ${user.email}` : '';
  showAvatar(profile.character);
}

function setupNameField() { $('profNick').value = profile.nickname || ''; }
function note(el, text, kind) { el.textContent = text || ''; el.className = 'note' + (kind ? ' ' + kind : ''); }

$('profSave').addEventListener('click', async () => {
  const nick = $('profNick').value.trim();
  if (!nick) return note($('profMsg'), 'Bitte gib einen Namen ein.', 'err');
  $('profSave').disabled = true;
  try {
    await A.saveProfile({ nickname: nick });
    profile = { ...profile, nickname: nick };
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
      $('wAv').innerHTML = avatarSvg(cfg, { body: false });
      if (!wEditor) wEditor = createEditor($('wEditor'), cfg, (c) => { cfg = c; $('wAv').innerHTML = avatarSvg(c, { body: false }); }, { owned: ownedSkins, hideLocked: true });
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
      showProfile(); setupNameField(); setFigure(cfg, false);
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
// Startseite erst einblenden, wenn Spiele und Pass-Banner feststehen (sonst springt der Inhalt nachträglich)
const startReady = () => { if (typeof window.sgReady === 'function') window.sgReady(); };
async function init() {
  applyGames(false).catch(() => document.documentElement.classList.remove('g-wait'));
  user = await A.currentUser().catch(() => null);
  if (!user) return startReady(); // gate.js leitet zur Anmeldung weiter
  const shopData = loadShop(); // parallel zu Profil und Admin-Prüfung laden
  try { profile = (await A.getProfile()) || profile; } catch { /* trotzdem weiter */ }
  showProfile();
  setupNameField();
  setupFigureEditor();
  if (!profile.nickname) welcome();
  const admin = await A.isAdmin().catch(() => false);
  await applyGames(admin);
  if (admin) {
    $('railAdmin').hidden = false;
    const ad = await import('./admin.js');
    ad.initAdmin({ user, games, onGames: () => applyGames(true, true) });
    addEventListener('hashchange', () => { if (location.hash === '#admin') ad.refreshAdmin(games); });
  } else {
    const noAdmin = () => { if (location.hash === '#admin') location.hash = '#start'; };
    noAdmin(); addEventListener('hashchange', noAdmin);
  }
  applyShop(admin, shopData).catch(() => {}).finally(startReady);
  initWardrobe().catch(() => {});
  try { await A.importLocalStats(); } catch { /* */ }
  try { plays = await A.loadPlays(); } catch { plays = []; }
  renderStats();
}

/* ---------------- Garderobe ---------------- */
let skins = [], wallet = { coins: 0, gems: 0 }, pick = null, shopOn = false;
const ERR = {
  not_enough: 'Dafür reicht dein Guthaben noch nicht.',
  owned: 'Das hast du schon.',
  gems_only: 'Dieses Teil gibt es nur mit Juwelen.',
  login: 'Bitte melde dich nochmals an.',
};
let live = null; // was gerade im Editor eingestellt ist
const myCfg = () => sanitize(live || profile.character || DEFAULT_CONFIG);
let gEditor = null, saveT = 0, itemsT = 0;
function setupFigureEditor() {
  live = sanitize(profile.character || DEFAULT_CONFIG);
  if (gEditor) return gEditor.set(live);
  gEditor = createEditor($('gdEditor'), live, (cfg) => { pick = null; setFigure(cfg, true); }, {
    owned: ownedSkins,
    onLocked: (id) => { pick = id; wdNote(''); renderWardrobe(); if (matchMedia('(max-width: 860px)').matches) $('gdFig').scrollIntoView({ behavior: 'smooth', block: 'center' }); },
  });
}
// Figur übernehmen; mit autosave kurz warten und dann im Konto speichern
function setFigure(cfg, autosave) {
  live = sanitize(cfg);
  if (gEditor) gEditor.set(live);
  showAvatar(live);
  renderStage(); // grosse Figur sofort, die Vorschaubilder kurz danach
  clearTimeout(itemsT); itemsT = setTimeout(renderWardrobe, 350);
  if (!autosave) return;
  clearTimeout(saveT);
  wdNote('');
  saveT = setTimeout(async () => {
    try {
      await A.saveProfile({ character: live });
      profile = { ...profile, character: live };
      wdNote('Gespeichert – gilt in allen Spielen.', 'ok');
    } catch (e) { wdNote(A.niceError(e), 'err'); }
  }, 700);
}
const withItem = (s) => ({ ...myCfg(), [s.slot]: s.value });
const fmtN = (n) => Number(n || 0).toLocaleString('de-CH');
function priceHtml(s) {
  return `<span class="wd-price">${s.price_coins ? `<span><i class="coin"></i>${fmtN(s.price_coins)}</span>` : ''}<span><i class="gem"></i>${fmtN(s.price_gems)}</span></span>`;
}
function renderWallet() {
  $('gdCoins').textContent = fmtN(wallet.coins); $('gdGems').textContent = fmtN(wallet.gems);
  $('wCoins').textContent = fmtN(wallet.coins); $('wGems').textContent = fmtN(wallet.gems);
}
function renderWardrobe() {
  const cfg = myCfg();
  $('gdItems').innerHTML = skins.map((s) => {
    const own = ownedSkins.has(s.id), worn = own && cfg[s.slot] === s.value;
    const badge = worn ? '<span class="wd-badge on">Angezogen</span>' : own ? '<span class="wd-badge">Gekauft</span>' : !s.price_coins ? '<span class="wd-badge excl">Exklusiv</span>' : '';
    return `<button type="button" class="wd-item${pick === s.id ? ' sel' : ''}" data-id="${s.id}" aria-pressed="${pick === s.id}"><span class="pic">${avatarSvg(withItem(s), { body: s.slot === 'back' || s.slot === 'top' })}</span>${badge}<b>${esc(s.name)}</b>${own ? '<span class="wd-price">Gehört dir</span>' : priceHtml(s)}</button>`;
  }).join('');
  renderStage();
}
function renderStage() {
  const s = skins.find((x) => x.id === pick);
  const cfg = s ? withItem(s) : myCfg();
  $('gdFig').innerHTML = avatarSvg(cfg, { body: true });
  const act = $('gdActions'); act.innerHTML = '';
  if (!s) { $('gdName').textContent = 'Deine Figur'; $('gdInfo').textContent = skins.length ? 'Wähle ein Teil zum Anprobieren.' : ''; return; }
  $('gdName').textContent = s.name;
  const own = ownedSkins.has(s.id), worn = own && myCfg()[s.slot] === s.value;
  const btn = (html, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'pill' + (cls ? ' ' + cls : ''); b.innerHTML = html; b.onclick = () => fn(b); act.appendChild(b); return b; };
  if (worn) {
    $('gdInfo').textContent = 'Trägst du gerade.';
    btn('Ausziehen', 'dark', (b) => equip(s, false, b));
  } else if (own) {
    $('gdInfo').textContent = 'Gehört dir.';
    btn('Anziehen', '', (b) => equip(s, true, b));
  } else {
    $('gdInfo').innerHTML = s.price_coins ? `Kostet ${fmtN(s.price_coins)} Münzen oder ${fmtN(s.price_gems)} Juwelen.` : `Exklusiv: nur mit Juwelen, ${fmtN(s.price_gems)} Stück.`;
    if (s.price_coins) btn(`<i class="coin"></i>Für ${fmtN(s.price_coins)} Münzen`, wallet.coins >= s.price_coins ? '' : 'dark', (b) => buy(s, 'coins', b));
    btn(`<i class="gem"></i>Für ${fmtN(s.price_gems)} Juwelen`, wallet.gems >= s.price_gems && !s.price_coins ? '' : 'dark', (b) => buy(s, 'gems', b));
  }
}
function wdNote(t, kind) { const el = $('gdMsg'); el.textContent = t || ''; el.className = 'note' + (kind ? ' ' + kind : ''); }
async function buy(s, currency, b) {
  const price = currency === 'coins' ? s.price_coins : s.price_gems;
  const have = currency === 'coins' ? wallet.coins : wallet.gems;
  const unit = currency === 'coins' ? 'Münzen' : 'Juwelen';
  if (have < price) {
    if (currency === 'coins') return wdNote(`Dir fehlen noch ${fmtN(price - have)} Münzen – weiterspielen lohnt sich!`, 'err');
    wdNote(`Dir fehlen noch ${fmtN(price - have)} Juwelen.`, 'err');
    if (shopOn) { const a = document.createElement('a'); a.className = 'pill dark'; a.href = 'kaufen.html?p=juwelen-500'; a.innerHTML = '<i class="gem"></i>Juwelen holen'; $('gdActions').appendChild(a); }
    return;
  }
  if (!confirm(`${s.name} für ${fmtN(price)} ${unit} kaufen?`)) return;
  b.disabled = true; wdNote('');
  try {
    wallet = await A.buySkin(s.id, currency);
    ownedSkins.add(s.id);
    if (gEditor) gEditor.setOwned(ownedSkins);
    renderWallet();
    await equip(s, true, null);
    wdNote(`${s.name} gehört jetzt dir und ist angezogen.`, 'ok');
  } catch (e) { wdNote(ERR[e.code] || A.niceError(e), 'err'); b.disabled = false; }
}
async function equip(s, on, b) {
  if (b) b.disabled = true;
  const cfg = { ...myCfg(), [s.slot]: on ? s.value : BASE[s.slot] };
  try {
    clearTimeout(saveT);
    await A.saveProfile({ character: cfg });
    profile = { ...profile, character: cfg };
    if (on) pick = null;
    setFigure(cfg, false);
    if (b) wdNote(on ? `${s.name} angezogen – gilt in allen Spielen.` : `${s.name} ausgezogen.`, 'ok');
  } catch (e) { wdNote(A.niceError(e), 'err'); if (b) b.disabled = false; }
}
$('gdItems').addEventListener('click', (e) => {
  const b = e.target.closest('.wd-item'); if (!b) return;
  pick = pick === b.dataset.id ? null : b.dataset.id; wdNote(''); renderWardrobe();
});
async function initWardrobe() {
  try { [skins, ownedSkins] = await Promise.all([A.loadSkins(), A.loadOwnedSkins()]); } catch { skins = []; }
  skins = skins.filter((s) => SHOP[s.id]); // nur Teile, die diese Version zeichnen kann
  if (gEditor) gEditor.setOwned(ownedSkins);
  renderWardrobe();
}

/* ---------------- Preise, Käufe, Münzen und Juwelen ---------------- */
function loadShop() {
  return Promise.all([
    A.paymentsEnabled().catch(() => false), A.loadProducts().catch(() => []), A.loadOwned().catch(() => new Set()), A.loadWallet().catch(() => ({ coins: 0, gems: 0 })),
  ]);
}
async function applyShop(admin, data = loadShop()) {
  const [on, products, owned, w] = await data;
  wallet = w; shopOn = on || admin;
  renderWallet();
  const names = [...owned].map((i) => (i === 'pass' ? 'Early-Supporter-Pass' : (A.GAMES[i] || {}).name)).filter(Boolean);
  $('wOwned').textContent = names.length ? `Gekauft: ${names.join(', ')}` : '';
  $('wBuy').hidden = !(on || admin);
  if (!on) return; // solange die Bezahlung aus ist, sind alle Spiele frei
  const hasPass = owned.has('pass');
  // Pass-Banner auf der Startseite, solange man den Pass noch nicht hat
  const pass = products.find((p) => p.kind === 'pass');
  if (pass && !hasPass) { $('passPrice').textContent = `CHF ${A.chf(pass.price_rappen)}`; window.showPromo ? window.showPromo() : ($('passPromo').hidden = false); }
  for (const p of products.filter((x) => x.kind === 'game')) {
    if (hasPass || owned.has(p.game_id)) continue;
    const price = `CHF ${A.chf(p.price_rappen)}`;
    document.querySelectorAll(`[data-game="${p.game_id}"]`).forEach((el) => {
      if (el.closest('#aGames') || el.tagName === 'BUTTON') return;
      if (el.classList.contains('tile')) {
        const thumb = el.querySelector('.thumb');
        if (thumb && !thumb.querySelector('.price')) thumb.insertAdjacentHTML('beforeend', `<span class="tag price">${price}</span>`);
        const go = el.querySelector('.go'); if (go) go.textContent = `Freischalten für ${price} →`;
      } else if (el.classList.contains('game') && !el.querySelector('.price-chip')) {
        el.querySelector('.t')?.insertAdjacentHTML('afterend', `<span class="price-chip">${price}</span>`);
      }
    });
  }
}

/* ---------------- Ausgeblendete Spiele ---------------- */
let games = [];
const gamesReady = A.loadGames().catch(() => null); // sofort laden, nicht erst nach dem Profil
async function applyGames(admin, fresh = false) {
  const list = fresh ? await A.loadGames().catch(() => null) : await gamesReady;
  if (!list) { document.documentElement.classList.remove('g-wait'); return; }
  games = list;
  const hidden = new Set(games.filter((g) => !g.visible).map((g) => g.id));
  document.querySelectorAll('[data-game]').forEach((el) => {
    if (el.closest('#aGames')) return;
    const off = hidden.has(el.dataset.game);
    if (admin) { el.hidden = false; el.classList.toggle('off-game', off); el.title = off ? 'Ausgeblendet – nur für Admins sichtbar' : ''; }
    else el.hidden = off;
  });
  if (typeof window.showSlide === 'function') window.showSlide(0);
  document.documentElement.classList.remove('g-wait');
}
init();
