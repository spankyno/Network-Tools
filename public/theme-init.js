// Aplica el tema antes del primer pintado para evitar el destello (FOUC).
// Vive en un archivo propio para poder mantener una CSP sin 'unsafe-inline' en script-src.
(function () {
  try {
    var stored = localStorage.getItem('netcheck_theme');
    var isDark = stored ? stored === 'dark' : window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var cl = document.documentElement.classList;
    cl.toggle('dark', !!isDark);
    cl.toggle('light', !isDark);
  } catch (e) {}
})();
