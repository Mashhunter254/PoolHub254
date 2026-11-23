'use strict';
// Live centre: every match on a table right now, plus what is next.
import { api } from '../api.js';
import { app, setRender, skeleton, empty, eventCard, matchCard, stat, rerender } from '../ui.js';

export default async function livePage() {
  setRender(livePage);
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const d = await api('/live');
  const c = d.counts;

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div>
        <div class="eyebrow"><span class="nav-dot"></span>Live centre</div>
        <h1 style="margin-top:8px">On the tables</h1>
        <p class="lead">Every frame appears here the moment an organizer scores it.</p>
      </div>
      <button class="btn sm" id="refresh">Refresh</button>
    </div>

    <div class="stats enter">
      ${stat(c.live_matches, 'Matches live', 0)}
      ${stat(c.live_events, 'Events running', 1)}
      ${stat(c.open_events, 'Open for entry', 2)}
      ${stat(c.players, 'Ranked players', 3)}
      ${stat(c.frames, 'Frames played', 4)}
    </div>

    <section class="enter">
      <div class="sec-head"><h2>Live now</h2></div>
      ${d.live.length
        ? `<div class="grid-auto">${d.live.map(matchCard).join('')}</div>`
        : `<div class="card">${empty('No match is live at the moment. Check the schedule below.')}</div>`}
    </section>

    ${d.events.length ? `<section class="enter">
      <div class="sec-head"><h2>Events running</h2><a href="#/events">All events</a></div>
      <ul class="card list">${d.events.map(eventCard).join('')}</ul>
    </section>` : ''}

    <section class="enter">
      <div class="sec-head"><h2>Next on the tables</h2></div>
      ${d.next.length
        ? `<div class="grid-auto">${d.next.map(matchCard).join('')}</div>`
        : `<div class="card">${empty('Nothing is queued up yet.')}</div>`}
    </section>
  </div>`;

  document.getElementById('refresh').addEventListener('click', () => rerender());
}
