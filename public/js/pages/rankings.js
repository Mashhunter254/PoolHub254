'use strict';
// The rankings table.
import { api } from '../api.js';
import { app, setRender, esc, skeleton, avatar, pct, toast, shareLink } from '../ui.js';

export default async function rankingsPage() {
  setRender(rankingsPage);
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const rows = await api('/rankings');

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">Standings</div>
        <h1 style="margin-top:8px">Rankings</h1>
        <p class="lead">Elo-style ratings. Every tournament match moves the number.</p>
      </div>
      <div class="row">
        <a class="btn sm ghost" href="/api/rankings.csv" download>Download CSV</a>
        <button class="btn sm ghost" id="share">Share</button>
      </div>
    </div>
    <div class="field enter">
      <label class="muted small" for="pq">Find a player</label>
      <input id="pq" type="search" placeholder="Name, town or club">
    </div>
    <div class="card table-wrap enter">
      <table class="t">
        <thead><tr>
          <th>#</th><th>Player</th><th>Rating</th><th>W</th><th>L</th>
          <th class="hide-sm">Win %</th><th class="hide-sm">Frames</th><th class="hide-sm">Titles</th>
        </tr></thead>
        <tbody id="ptb">${rows.map((p, i) => `<tr data-s="${esc([p.name, p.location, p.club].filter(Boolean).join(' ').toLowerCase())}">
          <td><span class="medal${i < 3 ? ' g' + (i + 1) : ''}">${i + 1}</span></td>
          <td><a class="row" href="#/player/${p.id}" style="gap:10px;flex-wrap:nowrap">
            ${avatar(p.name, p.id, '', p.avatar)}
            <span style="min-width:0"><b>${esc(p.name)}</b><div class="muted small">${esc(p.location || '')}</div></span>
          </a></td>
          <td><b>${p.rating}</b></td>
          <td>${p.wins}</td>
          <td>${p.losses}</td>
          <td class="hide-sm">${p.wins + p.losses ? pct(p.wins, p.wins + p.losses) + '%' : '–'}</td>
          <td class="hide-sm">${p.frames_won}-${p.frames_lost}</td>
          <td class="hide-sm">${p.titles}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </div>`;

  document.getElementById('pq').addEventListener('input', (ev) => {
    const q = ev.target.value.trim().toLowerCase();
    document.querySelectorAll('#ptb tr').forEach((tr) => { tr.hidden = !!q && !tr.dataset.s.includes(q); });
  });
  document.getElementById('share').addEventListener('click', async () => {
    toast(await shareLink('#/rankings', 'PoolHub rankings'));
  });
}
