(function () {
  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
  }
  const saved = localStorage.getItem('mindmap-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  apply(saved);

  window.toggleTheme = function () {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    apply(next);
    localStorage.setItem('mindmap-theme', next);
  };
})();
