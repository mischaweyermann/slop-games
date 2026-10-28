// Steuerung-Modal: öffnet sich über den Button unter dem QR-Code
(function () {
  var dlg = document.getElementById('ctrlDialog'), btn = document.getElementById('ctrlBtn');
  if (!dlg || !btn || typeof dlg.showModal !== 'function') { if (btn) btn.hidden = true; return; }
  btn.addEventListener('click', function () { dlg.showModal(); });
  dlg.addEventListener('click', function (e) {
    if (e.target === dlg || e.target.closest('[data-ctrl-close]')) dlg.close();
  });
  // Solange das Modal offen ist, gehen Tasten nicht ans Spiel (ausser Esc und Tab)
  window.addEventListener('keydown', function (e) {
    if (dlg.open && e.key !== 'Escape' && e.key !== 'Tab') e.stopPropagation();
  }, true);
  dlg.addEventListener('close', function () { btn.focus(); });
})();
