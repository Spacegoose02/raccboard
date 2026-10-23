// Apply the saved theme before first paint (a separate file so the CSP can forbid inline scripts).
try { var s = JSON.parse(localStorage.getItem('rackboard.settings') || '{}'); if (s.theme) document.documentElement.dataset.theme = s.theme; } catch (e) {}
