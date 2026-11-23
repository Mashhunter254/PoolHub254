'use strict';
// Events list with search and filters.
import { api } from '../api.js';
import { app, setRender, esc, skeleton, empty, eventCard, GAMES, FORMATS } from '../ui.js';

const filters = { status: '', game_type: '', format: '', q: '' };

export default async function eventsPage() {
  setRender(eventsPage);
  const f = filters;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const list = await api('/events' + (qs ? '?' + qs : ''));
  const chip = (key, val, label) => `<button class="chip" data-key="${key}" data-val="${esc(val)}" aria-pressed="${f[key] === val}">${esc(label)}</button>`;

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">Tournaments</div>
        <h1 style="margin-top:8px">Events</h1>
        <p class="lead">${list.length} event${list.length === 1 ? '' : 's'} match these filters.</p>
      </div>
      <a class="btn primary" href="#/organize">Post an event</a>
    </div>
    <div class="field enter">
      <label class="muted small" for="q">Search by name, venue or town</label>
      <input id="q" type="search" value="${esc(f.q)}" placeholder="Search events">
    </div>
    <div class="chips enter" role="group" aria-label="Status">
      ${chip('status', '', 'All')}${chip('status', 'live', 'Live')}${chip('status', 'open', 'Open')}${chip('status', 'finished', 'Finished')}
    </div>
    <div class="chips enter" role="group" aria-label="Game type">
      ${chip('game_type', '', 'Any game')}${GAMES.map((g) => chip('game_type', g, g)).join('')}
    </div>
    <div class="chips enter" role="group" aria-label="Format">
      ${chip('format', '', 'Any format')}${FORMATS.map((x) => chip('format', x.value, x.label.replace(/ \(.*/, ''))).join('')}
    </div>
    ${list.length
      ? `<ul class="card list enter">${list.map(eventCard).join('')}</ul>`
      : `<div class="card enter">${empty('No events match these filters.', '<a class="btn" href="#/events" id="clear">Clear filters</a>')}</div>`}
  </div>`;

  app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    filters[b.dataset.key] = b.dataset.val;
    eventsPage();
  }));

  const clear = document.getElementById('clear');
  if (clear) clear.addEventListener('click', (ev) => {
    ev.preventDefault();
    Object.assign(filters, { status: '', game_type: '', format: '', q: '' });
    eventsPage();
  });

  const q = document.getElementById('q');
  let t;
  q.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      filters.q = q.value.trim();
      // Keep the caret in the box while the list reloads.
      eventsPage().then(() => {
        const n = document.getElementById('q');
        n.focus();
        n.setSelectionRange(n.value.length, n.value.length);
      });
    }, 350);
  });
}
