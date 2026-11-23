'use strict';
// Two players, every match they have played against each other.
import { api } from '../api.js';
import {
  app, setRender, esc, empty, skeleton, matchCard, stat, avatar, accentOf, toast, shareLink,
} from '../ui.js';

export default async function h2hPage(id, opp) {
  setRender(() => h2hPage(id, opp));
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const d = await api(`/players/${id}/vs/${opp}`);
  const first = (p) => esc(String(p.name || '').split(' ')[0]);
  const played = d.a_wins + d.b_wins;

  const side = (p, wins) => `<a class="board-side" href="#/player/${p.id}">
    ${avatar(p.name, p.id, 'lg', p.avatar)}
    <span class="n">${esc(p.name)}</span>
    <span class="muted tiny">Rating ${p.rating}${p.club ? ' · ' + esc(p.club) : ''}</span>
    <span class="num" style="font-size:1.6rem">${wins}</span>
  </a>`;

  app.innerHTML = `<div class="page stack">
    <div class="row enter">
      <a class="btn sm ghost" href="#/player/${d.a.id}">← ${esc(d.a.name)}</a>
      <a class="btn sm ghost" href="#/player/${d.b.id}">${esc(d.b.name)} →</a>
      <button class="btn sm right" id="share">Share this rivalry</button>
    </div>

    <section class="card board enter" style="--c1:${accentOf(d.a.id)};--c2:${accentOf(d.b.id)}">
      <div class="board-vs">
        ${side(d.a, d.a_wins)}
        <div class="board-sc">${d.a_wins}<span class="dash">–</span>${d.b_wins}</div>
        ${side(d.b, d.b_wins)}
      </div>
      <div class="board-meta">
        <span class="tag">${played} match${played === 1 ? '' : 'es'} played</span>
        ${d.a_wins === d.b_wins && played ? '<span class="tag">All square</span>' : ''}
      </div>
    </section>

    <div class="stats enter">
      ${stat(`${first(d.a)} ${d.a_wins}-${d.b_wins} ${first(d.b)}`, 'Head to head', d.a.id)}
      ${stat(d.a.rating, d.a.name.split(' ')[0] + ' rating', d.a.id)}
      ${stat(d.b.rating, d.b.name.split(' ')[0] + ' rating', d.b.id)}
    </div>

    <section class="enter">
      <div class="sec-head"><h2>Matches</h2></div>
      ${d.matches.length
        ? `<div class="grid-auto">${d.matches.map(matchCard).join('')}</div>`
        : `<div class="card">${empty('They have not met yet.')}</div>`}
    </section>
  </div>`;

  document.getElementById('share').addEventListener('click', async () => {
    toast(await shareLink(`/p/${d.a.id}`, `${d.a.name} head to head`));
  });
}
