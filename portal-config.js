const local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
window.PORTAL_CONFIG = Object.freeze({
  api: local && location.port !== '8787' ? 'http://127.0.0.1:8787' : local ? '' : 'https://waives-onboarding-intake.autumn-glitter-1f91.workers.dev',
});
