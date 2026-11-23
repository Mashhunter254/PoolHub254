'use strict';
// Hash router: maps the address bar to a page module and keeps the nav in sync.
import { app, empty, setRender } from './ui.js';

import homePage from './pages/home.js';
import livePage from './pages/live.js';
import eventsPage from './pages/events.js';
import eventPage from './pages/event.js';
import matchPage from './pages/match.js';
import rankingsPage from './pages/rankings.js';
import playerPage from './pages/player.js';
import playersPage from './pages/players.js';
import h2hPage from './pages/h2h.js';
import organizerPage from './pages/organizer.js';
import activityPage from './pages/activity.js';
import organizePage from './pages/organize.js';
import adminPage from './pages/admin.js';
import superAdminPage from './pages/superadmin.js';
import { loginPage, registerPage, mePage } from './pages/account.js';

// [pattern, handler, nav name] — order matters, first match wins.
const routes = [
  [/^\/?$/, () => homePage(), 'home'],
  [/^\/live$/, () => livePage(), 'live'],
  [/^\/events$/, () => eventsPage(), 'events'],
  [/^\/event\/(\d+)$/, (m) => eventPage(m[1]), 'events'],
  [/^\/match\/(\d+)$/, (m) => matchPage(m[1]), 'events'],
  [/^\/rankings$/, () => rankingsPage(), 'rankings'],
  [/^\/players$/, () => playersPage(), 'players'],
  [/^\/player\/(\d+)\/vs\/(\d+)$/, (m) => h2hPage(m[1], m[2]), 'players'],
  [/^\/player\/(\d+)$/, (m) => playerPage(m[1]), 'players'],
  [/^\/organizer\/(\d+)$/, (m) => organizerPage(m[1]), 'players'],
  [/^\/activity$/, () => activityPage(), 'activity'],
  [/^\/organize(?:\/(\d+))?$/, (m) => organizePage(m[1]), 'me'],
  [/^\/admin$/, () => adminPage(), 'me'],
  [/^\/superadmin$/, () => superAdminPage(), 'me'],
  [/^\/login$/, () => loginPage(), 'me'],
  [/^\/register$/, () => registerPage(), 'me'],
  [/^\/me$/, () => mePage(), 'me'],
];

function markNav(nav) {
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

export async function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  for (const [re, fn, nav] of routes) {
    const m = re.exec(path);
    if (!m) continue;
    markNav(nav);
    try {
      await fn(m);
    } catch (err) {
      setRender(null);
      app.innerHTML = `<div class="page">${empty(err.message, '<a class="btn" href="#/">Back to home</a>')}</div>`;
    }
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
    return;
  }
  markNav('home');
  setRender(null);
  app.innerHTML = `<div class="page">${empty('This page does not exist.', '<a class="btn primary" href="#/">Go home</a>')}</div>`;
}
