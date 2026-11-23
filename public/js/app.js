'use strict';
// Entry point: boot the session, draw the first page, then keep it live.
import { loadSession, onSession, state } from './api.js';
import { initials, esc } from './ui.js';
import { route } from './router.js';
import { refreshTicker } from './ticker.js';

// Keep the account chip in the header in step with the session.
function syncAccount() {
  const av = document.getElementById('acct-av');
  const name = document.getElementById('acct-name');
  if (!av || !name) return;
  if (state.user) {
    av.classList.toggle('pic', !!state.user.avatar);
    av.innerHTML = state.user.avatar
      ? `<img src="${esc(state.user.avatar)}" alt="">`
      : esc(initials(state.user.name));
    name.textContent = state.user.name.split(' ')[0];
  } else {
    av.classList.remove('pic');
    av.textContent = '?';
    name.textContent = 'Log in';
  }
}
onSession(syncAccount);

// Live scores over SSE. Coalesce bursts and never rebuild while someone types.
function connectLive() {
  if (!window.EventSource) return;
  const es = new EventSource('/api/stream');
  let t;
  es.onmessage = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      refreshTicker();
      const el = document.activeElement;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      route();
    }, 250);
  };
}

window.addEventListener('hashchange', route);

(async () => {
  await loadSession();
  syncAccount();
  await route();
  await refreshTicker();
  connectLive();
})();
