// Spielende für alle Spiele: «Nochmal» (bzw. «Weiter») oder «Zur Übersicht» (Lobby mit QR-Code).
// Bedienbar per Geste (im Spiel), per Klick/Fernbedienung, über die Handys – und nach einer Weile automatisch zur Übersicht.
const $ = (id) => document.getElementById(id);

export function endMenu({ again, menu, autoSec = 40 }) {
  const card = $('results');
  const hint = $('resultsHint');
  if (hint) hint.hidden = true;
  const coins = document.createElement('div');
  coins.className = 'results-coins'; coins.id = 'resultsCoins'; coins.hidden = true;
  const actions = document.createElement('div');
  actions.className = 'results-actions';
  actions.innerHTML = `<button class="r-btn" type="button" data-a="again"><b></b><span></span><i></i></button>
    <button class="r-btn alt" type="button" data-a="menu"><b>Zur Übersicht</b><span></span><i></i></button>`;
  const auto = document.createElement('div');
  auto.className = 'results-auto';
  card.append(coins, actions, auto);
  const [bAgain, bMenu] = actions.querySelectorAll('.r-btn');
  let open = false, done = false;
  const fire = (a) => { if (!open || done) return; done = true; (a === 'menu' ? menu : again)(); };
  bAgain.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); fire('again'); });
  bMenu.addEventListener('click', (e) => { e.stopPropagation(); e.currentTarget.blur(); fire('menu'); });
  addEventListener('keydown', (e) => { if (open && (e.key === 'Escape' || e.key === 'Backspace')) { e.preventDefault(); fire('menu'); } }, true);

  return {
    coins,
    // beim Wechsel in die Resultate aufrufen
    show({ againLabel = 'Nochmal', againHint = 'Beide Hände hoch', menuHint = 'Klicken oder am Handy' } = {}) {
      open = true; done = false; coins.hidden = true;
      bAgain.querySelector('b').textContent = againLabel;
      bAgain.querySelector('span').textContent = againHint;
      bMenu.querySelector('span').textContent = menuHint;
      bAgain.style.setProperty('--f', 0); bMenu.style.setProperty('--f', 0);
    },
    hide() { open = false; },
    // pro Bild: Fortschritt der Gesten (0..1) und automatischer Wechsel zur Übersicht
    update(stateT, upF = 0, downF = 0) {
      if (!open) return;
      bAgain.style.setProperty('--f', Math.min(1, upF)); bMenu.style.setProperty('--f', Math.min(1, downF));
      const left = Math.ceil(autoSec - stateT);
      const txt = left <= 15 && left > 0 ? `Zur Übersicht in ${left} s` : '';
      if (auto.textContent !== txt) auto.textContent = txt;
      if (stateT >= autoSec) fire('menu');
    },
    // Nachricht vom Handy ({ t: 'end', a: 'again' | 'menu' })
    phone(a) { fire(a === 'menu' ? 'menu' : 'again'); },
  };
}
