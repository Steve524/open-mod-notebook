// This script runs before React hydration to prevent theme flash
export const themeScript = `
(function() {
  try {
    var theme = JSON.parse(localStorage.getItem('theme-storage') || '{}').state?.theme || 'system';
    var systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var resolved = theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;

    // Mirror themeClassNames() from theme-store.ts: skins layer on a base scheme
    // (glass -> dark, claude -> light, claude-dark -> dark).
    var classes = resolved === 'glass' ? ['dark', 'glass']
      : resolved === 'claude' ? ['light', 'claude']
      : resolved === 'claude-dark' ? ['dark', 'claude-dark']
      : [resolved];
    document.documentElement.classList.remove('light', 'dark', 'glass', 'claude', 'claude-dark');
    document.documentElement.classList.add.apply(document.documentElement.classList, classes);
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (e) {
    // Fallback to light theme
    document.documentElement.classList.add('light');
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`