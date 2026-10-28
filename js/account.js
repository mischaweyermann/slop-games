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

// Schritt 1: Code per E-Mail anfordern (die E-Mail enthält auch einen Link)
export async function requestCode(email, redirectTo) {
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo || location.origin + '/konto.html' },
  });
  if (error) throw error;
}
// Schritt 2: sechsstelligen Code bestätigen
export async function verifyCode(email, code) {
  const { data, error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.replace(/\s/g, ''), type: 'email' });
  if (error) throw error;
  return data.user;
}
export async function signOut() { await sb.auth.signOut(); }

export async function getProfile() {
  const user = await currentUser();
  if (!user) return null;
  const { data, error } = await sb.from('profiles').select('nickname, created_at').eq('id', user.id).maybeSingle();
  if (error) throw error;
  return data || { nickname: null };
}
export async function setNickname(nickname) {
  const user = await currentUser();
  if (!user) throw new Error('Nicht angemeldet');
  const clean = String(nickname || '').trim().slice(0, 24) || null;
  const { error } = await sb.from('profiles').upsert({ id: user.id, nickname: clean });
  if (error) throw error;
  return clean;
}

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
  if (/rate limit|too many|seconds/i.test(m)) return 'Zu viele Versuche. Bitte warte einen Moment und versuch es dann nochmals.';
  if (/email/i.test(m) && /valid/i.test(m) && !/token|otp/i.test(m)) return 'Diese E-Mail-Adresse sieht nicht richtig aus.';
  if (/expired|invalid/i.test(m)) return 'Der Code ist falsch oder abgelaufen. Fordere einen neuen an.';
  if (/fetch|network/i.test(m)) return 'Keine Verbindung. Prüf dein Internet.';
  return 'Das hat nicht geklappt. Versuch es nochmals.';
}
