// Steuerung-Modal: öffnet sich beim ersten Öffnen des Spiels von selbst und jederzeit über den Button unter dem QR-Code.
// «Nicht mehr anzeigen» merkt sich das pro Spiel; einfach schliessen = beim nächsten Mal wieder.
(function () {
  var dlg = document.getElementById('ctrlDialog'), btn = document.getElementById('ctrlBtn');
  if (!dlg || !btn || typeof dlg.showModal !== 'function') { if (btn) btn.hidden = true; return; }
  var game = (location.pathname.match(/\/([a-z0-9-]+)\/(?:index\.html)?$/) || [])[1] || 'spiel';
  var KEY = 'slop.ctrl.hide.' + game;
  var hidden = function () { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };

  // Fusszeile mit «Nicht mehr anzeigen» und «Los geht’s»
  var foot = document.createElement('div');
  foot.className = 'ctrl-foot';
  foot.innerHTML = '<label class="ctrl-skip"><input type="checkbox" id="ctrlSkip"><span>Nicht mehr automatisch anzeigen</span></label>' +
    '<button class="ctrl-go" type="button" data-ctrl-close>Los geht’s</button>';
  dlg.appendChild(foot);
  var skip = foot.querySelector('#ctrlSkip');

  function open() { skip.checked = hidden(); dlg.showModal(); }
  btn.addEventListener('click', open);
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg || e.target.closest('[data-ctrl-close]')) dlg.close();
  });
  dlg.addEventListener('close', function () {
    try { if (skip.checked) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch (e) { /* */ }
    btn.focus();
  });
  // Solange das Modal offen ist, gehen Tasten nicht ans Spiel (ausser Esc und Tab)
  window.addEventListener('keydown', function (e) {
    if (dlg.open && e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
  }, true);

  // Automatisch öffnen, sobald die Spielseite sichtbar ist (gate.js prüft zuerst den Zugang)
  if (hidden()) return;
  var tries = 0, t = setInterval(function () {
    if (document.getElementById('gate-hold') && ++tries < 60) return;
    clearInterval(t);
    if (!dlg.open && document.visibilityState !== 'hidden') setTimeout(open, 350);
  }, 150);
})();
