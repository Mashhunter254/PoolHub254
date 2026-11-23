'use strict';
// A player's profile: record, form, rivals and what they are entered in.
import { api, state } from '../api.js';
import {
  app, setRender, esc, empty, matchCard, eventCard, stat, avatar, pct, toast, cAttr, shareLink,
} from '../ui.js';

export default async function playerPage(id) {
  setRender(() => playerPage(id));
  const d = await api('/players/' + id);
  const p = d.player;
  const total = p.wins + p.losses;

  app.innerHTML = `<div class="page stack">
    <div class="row enter" style="gap:16px">
      <span class="avatar-ring" ${cAttr(p.id)}>${avatar(p.name, p.id, 'lg', p.avatar)}</span>
      <div class="grow">
        <div class="eyebrow">Rank #${d.rank}</div>
        <h1 style="margin:6px 0 4px">${esc(p.name)}</h1>
        <p class="lead" style="margin:0">${esc(p.location || 'Location not set')}${p.club ? ' · ' + esc(p.club) : ''}${p.game_type ? ' · ' + esc(p.game_type) : ''}</p>
      </div>
      <button class="btn sm ghost" id="share">Share</button>
      ${state.user && !d.own ? `<button class="btn sm" id="follow">${d.following ? 'Following' : 'Follow'}</button>` : ''}
      ${d.own ? '<a class="btn sm" href="#/me">Edit profile</a>' : ''}
    </div>

    <section class="enter">
      <div class="sec-head"><h2>Rivals</h2><span class="muted small">Tap one to see the full rivalry</span></div>
      ${d.h2h.length
        ? `<ul class="card list">${d.h2h.map((r) => `<li><a class="item" href="#/player/${p.id}/vs/${r.id}">
            ${avatar(r.name, r.id, '', r.avatar)}
            <span class="grow title">${esc(r.name)}</span>
            <span class="num">${r.wins}<span class="muted">-</span>${r.losses}</span>
          </a></li>`).join('')}</ul>`
        : `<div class="card">${empty('No rivals yet.')}</div>`}
    </section>

    <div class="stats enter">
      ${stat('#' + d.rank, 'Rank', p.id)}
      ${stat(p.rating, 'Rating', p.id)}
      ${stat(`${p.wins}-${p.losses}`, 'Won-lost', p.id)}
      ${stat(total ? pct(p.wins, total) + '%' : '–', 'Win rate', p.id)}
      ${stat(`${p.frames_won}-${p.frames_lost}`, 'Frames', p.id)}
      ${stat(p.titles, p.titles === 1 ? 'Title' : 'Titles', p.id)}
    </div>

    ${d.upcoming.length ? `<section class="enter">
      <div class="sec-head"><h2>Entered events</h2></div>
      <ul class="card list">${d.upcoming.map(eventCard).join('')}</ul>
    </section>` : ''}

    <section class="enter">
      <div class="sec-head"><h2>Recent matches</h2></div>
      ${d.recent.length
        ? `<div class="grid-auto">${d.recent.map(matchCard).join('')}</div>`
        : `<div class="card">${empty('No matches played yet.')}</div>`}
    </section>
  </div>`;

  const f = document.getElementById('follow');
  if (f) f.addEventListener('click', async () => {
    try {
      const r = await api('/follow', { method: 'POST', body: { kind: 'player', id: p.id } });
      toast(r.following ? 'Following ' + p.name : 'Unfollowed');
      playerPage(id);
    } catch (err) { toast(err.message); }
  });
  document.getElementById('share').addEventListener('click', async () => {
    toast(await shareLink(`/p/${p.id}`, p.name + ' on PoolHub'));
  });
}
