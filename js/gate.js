// Seiten nur mit Konto: ohne gültige Anmeldung geht es zur Login-Seite
import { sb } from './account.js';
const root = new URL('../', import.meta.url);
function toLogin() {
  const here = location.href.slice(root.href.length).split('#')[0];
  location.replace(new URL('login.html?next=' + encodeURIComponent(here), root).href);
}
sb.auth.getSession().then(({ data }) => { if (!data.session) toLogin(); }).catch(() => {});
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') toLogin(); });
