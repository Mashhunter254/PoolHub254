'use strict';
// An organizer's public page: their badge, their record and what they run.
import { api } from '../api.js';
import {
  app, setRender, esc, empty, skeleton, eventCard, stat, avatar, num, toast, shareLink,
} from '../ui.js';

export default async function organizerPage(id) {
  setRender(() => organizerPage(id));
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const d = await api('/organizers/' + id);
  const o = d.organizer;

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div class="row" style="gap:16px">
        <span class="avatar-ring">${avatar(o.name, o.id, 'lg', o.avatar)}</span>
        <div>
          <div class="eyebrow">Organizer${o.verified ? ' · verified' : ''}</div>
          <h1 style="margin:6px 0 2px">${esc(o.name)}</h1>
          <p class="lead" style="margin:0">${d.own ? esc(o.email || '') : 'Runs tournaments on PoolHub'}</p>
        </div>
      </div>
      <div class="row">
        ${d.own ? '<a class="btn sm" href="#/me">Edit account</a><a class="btn primary sm" href="#/organize">Post an event</a>' : ''}
        <button class="btn sm" id="share">Share page</button>
      </div>
    </div>

    <div class="stats enter">
      ${stat(d.stats.events, 'Events run', o.id)}
      ${stat(d.stats.live, 'Running now', o.id)}
      ${stat(d.stats.players, 'Players hosted', o.id)}
      ${stat(d.stats.champions, 'Champions crowned', o.id)}
      ${stat('KES ' + num(d.stats.prize_pool), 'Prize money', o.id)}
    </div>

    ${!o.verified && d.own ? '<div class="notice warn">Your organizer account is not verified yet. You can post free events — ask an admin to verify you before charging entry fees or promoting events.</div>' : ''}

    <section class="enter">
      <div class="sec-head"><h2>Events</h2><span class="muted small">${d.events.length} total</span></div>
      ${d.events.length
        ? `<ul class="card list">${d.events.map(eventCard).join('')}</ul>`
        : `<div class="card">${empty('No events posted yet.')}</div>`}
    </section>
  </div>`;

  document.getElementById('share').addEventListener('click', async () => {
    toast(await shareLink(`/o/${o.id}`, o.name + ' on PoolHub'));
  });
}
