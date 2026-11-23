'use strict';
// The activity feed: results and events from the players and events you follow,
// or everything the site is doing when you follow nobody.
import { api, state } from '../api.js';
import {
  app, setRender, esc, empty, skeleton, avatar, dateParts, statusPill,
} from '../ui.js';

export default async function activityPage() {
  setRender(activityPage);
  app.innerHTML = `<div class="stack">${skeleton(4)}</div>`;
  const d = await api('/activity');

  const resultItem = (it) => {
    const winnerName = it.winner === it.p1 ? it.p1_name : it.p2_name;
    const winnerId = it.winner === it.p1 ? it.p1 : it.p2;
    const winnerAvatar = it.winner === it.p1 ? it.p1_avatar : it.p2_avatar;
    const loserName = it.winner === it.p1 ? it.p2_name : it.p1_name;
    const line = it.winner === it.p1 ? `${it.s1}–${it.s2}` : `${it.s2}–${it.s1}`;
    return `<li><a class="item" href="#/match/${it.match_id}">
      ${avatar(winnerName, winnerId, '', winnerAvatar)}
      <div class="grow">
        <div class="title">${esc(winnerName)} beat ${esc(loserName)} <span class="muted">${line}</span></div>
        <div class="muted small">${esc(it.event_name)} · ${esc(rel(it.at))}</div>
      </div>
      <span class="tag">Result</span>
    </a></li>`;
  };

  const eventItem = (it) => `<li><a class="item" href="#/event/${it.event_id}">
    <div class="grow">
      <div class="title">${esc(it.name)}</div>
      <div class="muted small">${esc(it.venue)} · ${esc(it.game_type)} · ${esc(rel(it.at))}</div>
      ${it.champion ? `<div class="muted small">Champion: <b>${esc(it.champion)}</b></div>` : ''}
    </div>
    <div class="tr">
      ${statusPill(it.status)}
      <div class="muted tiny" style="margin-top:4px">${it.registered}/${it.max_players}</div>
    </div>
  </a></li>`;

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">${d.personalised ? 'What you follow' : 'Across PoolHub'}</div>
        <h1 style="margin-top:8px">Activity</h1>
        <p class="lead">${d.personalised
          ? 'Results from the players you follow and news from your events.'
          : 'Follow a player or an event to make this feed your own.'}</p>
      </div>
      ${!state.user ? '<a class="btn" href="#/login">Log in to personalise</a>' : ''}
    </div>
    ${d.items.length
      ? `<ul class="card list enter">${d.items.map((it) => (it.kind === 'result' ? resultItem(it) : eventItem(it))).join('')}</ul>`
      : `<div class="card enter">${empty('Nothing has happened yet. Follow a player or event to get started.', '<a class="btn" href="#/players">Browse players</a>')}</div>`}
  </div>`;
}

// "3 hours ago" style timestamps keep the feed readable.
function rel(at) {
  if (!at) return '';
  const s = String(at);
  const t = Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  if (!t) return '';
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.round(hours / 24);
  if (days < 7) return days + 'd ago';
  return dateParts(s.includes('T') ? s : s.replace(' ', 'T') + 'Z').full;
}
