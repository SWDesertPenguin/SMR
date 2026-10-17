// Runs before the first paint. This is a classic script, so it blocks parsing, while
// renderer.js is a module that only runs afterwards; without this a dark user sees
// the light page for a moment. It mirrors resolveTheme() in pure.mjs (settings file,
// then the old localStorage value, then the OS colour scheme) and renderer.js
// applies the same answer again once it loads.
(function () {
  var settings = (window.md && window.md.settings) || {};
  var theme = settings.theme;
  if (theme !== 'light' && theme !== 'dark') {
    try { theme = localStorage.getItem('theme'); } catch (_) { theme = null; }
  }
  if (theme !== 'light' && theme !== 'dark') theme = settings.systemDark ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
})();
