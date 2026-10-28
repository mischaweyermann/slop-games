// Seiten nur mit Konto: ohne gültige Anmeldung geht es zur Login-Seite.
// Auf Spielseiten zusätzlich: ausgeblendete Spiele nur für den Admin.
import { sb, isAdmin } from './account.js';
const root = new URL('../', import.meta.url);
function toLogin() {
  const here = location.href.slice(root.href.length).split('#')[0];
  location.replace(new URL('login.html?next=' + encodeURIComponent(here), root).href);
}
async function checkGame() {
  const m = location.href.slice(root.href.length).match(/^([a-z0-9-]+)\//);
  if (!m) return;
  const { data } = await sb.from('games').select('visible').eq('id', m[1]).maybeSingle();
  if (data && data.visible === false && !(await isAdmin())) return location.replace(new URL('./#spiele', root).href);
  // Kostenpflichtiges Spiel ohne Kauf: zur Kaufseite
  const { data: ok, error } = await sb.rpc('has_access', { game: m[1] });
  if (!error && ok === false) location.replace(new URL('kaufen.html?p=' + encodeURIComponent(m[1]), root).href);
}
sb.auth.getSession().then(({ data }) => { if (!data.session) toLogin(); else checkGame().catch(() => {}); }).catch(() => {});
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') toLogin(); });
