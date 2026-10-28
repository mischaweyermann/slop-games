// Seiten nur mit Konto: ohne gültige Anmeldung geht es zur Login-Seite.
// Auf Spielseiten zusätzlich: ausgeblendete Spiele nur für den Admin.
import { sb, isAdmin } from './account.js';
const root = new URL('../', import.meta.url);
function toLogin() {
  const here = location.href.slice(root.href.length).split('#')[0];
  location.replace(new URL('login.html?next=' + encodeURIComponent(here), root).href);
}
// Spielseiten sind unsichtbar (<style id="gate-hold">), bis feststeht, dass man hier spielen darf
const reveal = () => document.getElementById('gate-hold')?.remove();
setTimeout(reveal, 6000); // falls die Datenbank nicht antwortet, trotzdem anzeigen
async function checkGame() {
  const m = location.href.slice(root.href.length).match(/^([a-z0-9-]+)\//);
  if (!m) return reveal();
  const { data } = await sb.from('games').select('visible').eq('id', m[1]).maybeSingle();
  if (data && data.visible === false && !(await isAdmin())) return location.replace(new URL('./#spiele', root).href);
  // Kostenpflichtiges Spiel ohne Kauf: zur Kaufseite
  const { data: ok, error } = await sb.rpc('has_access', { game: m[1] });
  if (!error && ok === false) return location.replace(new URL('kaufen.html?p=' + encodeURIComponent(m[1]), root).href);
  reveal();
}
sb.auth.getSession().then(({ data }) => { if (!data.session) toLogin(); else checkGame().catch(reveal); }).catch(reveal);
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') toLogin(); });
