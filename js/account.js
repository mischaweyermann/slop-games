// Konten und Statistiken über Supabase (Login per E-Mail-Code).
// Der Schlüssel ist öffentlich; geschützt wird über die Zugriffsregeln (RLS) in der Datenbank.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const SUPABASE_URL = 'https://viqonxeoaaffqigpwami.supabase.co';
const SUPABASE_KEY = 'sb_publishable_COhg1ihl3PKsP3UKpp5-Vg_JK1d20Wv';

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'slop.auth' },
});

export const GAMES = {
  kurvenflitzer: { name: 'Kurvenflitzer', color: '#e2574c' },
  boxring: { name: 'Boxring', color: '#5aa9c9' },
  skicross: { name: 'Skicross', color: '#f7e9a6' },
};

export async function currentUser() {
  const { data } = await sb.auth.getSession();
  return data.session ? data.session.user : null;
}
export function onAuth(fn) {
  const { data } = sb.auth.onAuthStateChange((_ev, session) => fn(session ? session.user : null));
  return () => data.subscription.unsubscribe();
}

// Anmelden mit E-Mail und Passwort
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw error;
  return data.user;
}
// Konto erstellen; mit E-Mail-Bestätigung kommt erst nach dem Klick auf den Link eine Sitzung
export async function signUp(email, password, redirectTo) {
  const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } });
  if (error) throw error;
  return { user: data.user, needsConfirm: !data.session };
}
export async function resetPassword(email, redirectTo) {
  const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo });
  if (error) throw error;
}
export async function updatePassword(password) {
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
}
export async function signOut() { await sb.auth.signOut(); }

// Profil (Name + Figur). Wird zusätzlich lokal abgelegt, damit alle Spiele die Figur kennen.
const CHAR_KEY = 'ballonplatzer.character';
const NAME_KEY = 'slop.name';
function cacheLocal(p) {
  try {
    if (p && p.nickname) localStorage.setItem(NAME_KEY, p.nickname);
    if (p && p.character) localStorage.setItem(CHAR_KEY, JSON.stringify(p.character));
  } catch { /* privat */ }
}
export async function getProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('nickname, character, created_at').eq('id', user.id).maybeSingle();
  if (error) throw error;
  const p = data || { nickname: null, character: null };
  cacheLocal(p);
  return p;
}
export async function saveProfile({ nickname, character }) {
  const user = await currentUser();
  if (!user) throw new Error('Nicht angemeldet');
  const row = { id: user.id };
  if (nickname !== undefined) row.nickname = String(nickname || '').trim().slice(0, 24) || null;
  if (character !== undefined) row.character = character || null;
  const { error } = await sb.from('profiles').upsert(row);
  if (error) throw error;
  cacheLocal(row);
  return row;
}
export async function setNickname(nickname) { return (await saveProfile({ nickname })).nickname; }

// Eine gespielte Runde speichern
export async function savePlay({ game, seconds, place = null, players = null, finishTime = null, won = null }) {
  if (!GAMES[game]) return false;
  const user = await currentUser();
  if (!user) return false;
  const row = {
    user_id: user.id, game,
    seconds: Math.max(0, Math.min(7200, Math.round(seconds || 0))),
    place: place >= 1 && place <= 8 ? place : null,
    players: players >= 1 && players <= 8 ? players : null,
    finish_time: finishTime > 0 && finishTime < 3600 ? +(+finishTime).toFixed(1) : null,
    won: won == null ? null : !!won,
  };
  const { error } = await sb.from('plays').insert(row);
  if (error) throw error;
  return true;
}

export async function loadPlays(limit = 500) {
  const { data, error } = await sb.from('plays')
    .select('game, seconds, place, players, finish_time, won, imported, played_at')
    .order('played_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

// Bisherige Minuten aus diesem Browser einmalig ins Konto übernehmen
export async function importLocalStats() {
  const user = await currentUser();
  if (!user) return 0;
  const flag = 'slop.imported.' + user.id;
  try { if (localStorage.getItem(flag)) return 0; } catch { return 0; }
  let st = {};
  try { st = JSON.parse(localStorage.getItem('slope.stats')) || {}; } catch { /* */ }
  const rows = ['kurvenflitzer', 'boxring', 'skicross']
    .filter((g) => st[g] > 0)
    .map((g) => ({ user_id: user.id, game: g, seconds: Math.round(st[g]), imported: true }));
  if (rows.length) {
    const { error } = await sb.from('plays').insert(rows);
    if (error) throw error;
  }
  try { localStorage.setItem(flag, '1'); } catch { /* */ }
  return rows.length;
}

export async function deleteAccount() {
  const { error } = await sb.rpc('delete_account');
  if (error) throw error;
  await sb.auth.signOut();
}

export function niceError(e) {
  const m = String((e && e.message) || e || '');
  if (/invalid login credentials/i.test(m)) return 'E-Mail oder Passwort stimmt nicht.';
  if (/email not confirmed/i.test(m)) return 'Bitte bestätige zuerst deine E-Mail-Adresse – tipp auf den Link in der E-Mail.';
  if (/already registered|already exists/i.test(m)) return 'Für diese E-Mail gibt es schon ein Konto. Melde dich an.';
  if (/password/i.test(m) && /(least|short|weak|characters)/i.test(m)) return 'Das Passwort ist zu kurz oder zu einfach (mindestens 8 Zeichen).';
  if (/same.*password|different from the old/i.test(m)) return 'Das neue Passwort muss anders sein als das alte.';
  if (/rate limit|too many|seconds/i.test(m)) return 'Zu viele Versuche. Bitte warte einen Moment und versuch es dann nochmals.';
  if (/email/i.test(m) && /valid/i.test(m)) return 'Diese E-Mail-Adresse sieht nicht richtig aus.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Prüf dein Internet.';
  return 'Das hat nicht geklappt. Versuch es nochmals.';
}

// Erlaubte Rücksprungziele nach dem Login (nur Seiten von Slop Games)
export function safeNext(n) {
  n = String(n || '').split('#')[0];
  return /^(?:index\.html|konto\.html|controller\.html|kurvenflitzer\/|boxring\/|skicross\/)?(?:\?[\w=&%.:-]*)?$/.test(n) ? n : '';
}

/* ---------------- Spiele und Admin ---------------- */
export async function loadGames() {
  const { data, error } = await sb.from('games').select('id, name, visible, sort').order('sort');
  if (error) throw error;
  return data || [];
}
export async function isAdmin() {
  const { data, error } = await sb.rpc('is_admin');
  return !error && !!data;
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
export const adminUsers = () => rpc('admin_users');
export const adminStats = (days = 30) => rpc('admin_stats', { days });
export const adminSetBanned = (target, ban) => rpc('admin_set_banned', { target, ban });
export const adminDeleteUser = (target) => rpc('admin_delete_user', { target });
export const adminSetGameVisible = (game, show) => rpc('admin_set_game_visible', { game, show });
