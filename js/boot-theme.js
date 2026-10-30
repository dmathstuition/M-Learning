/* Applies the saved theme before first paint to avoid a light/dark flash. */
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('ml.theme') || '"light"');
    document.documentElement.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
  } catch (e) { /* storage unavailable: default theme */ }
})();
