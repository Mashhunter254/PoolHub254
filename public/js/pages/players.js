'use strict';
// The player directory: search anyone by name, club or town.
import { api } from '../api.js';
import { app, setRender, esc, skeleton, empty, playerRow } from '../ui.js';

let q = '';

export default async function playersPage() {
  setRender(playersPage);
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const list = await api('/players' + (q ? '?q=' + encodeURIComponent(q) : ''));

  app.innerHTML = `<div class="page stack">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">Directory</div>
        <h1 style="margin-top:8px">Players</h1>
        <p class="lead">${list.length} player${list.length === 1 ? '' : 's'} match. Search by name, club or town.</p>
      </div>
      <a class="btn" href="#/rankings">See the rankings</a>
    </div>
    <div class="field enter">
      <label class="muted small" for="pq">Find a player</label>
      <input id="pq" type="search" value="${esc(q)}" placeholder="Name, club or town">
    </div>
    ${list.length
      ? `<ul class="card list enter">${list.map((p, i) => playerRow(p, { rank: i + 1 })).join('')}</ul>`
      : `<div class="card enter">${empty('No players match that search.')}</div>`}
  </div>`;

  const box = document.getElementById('pq');
  let t;
  box.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      q = box.value.trim();
      // Keep the caret in the box while the list reloads.
      playersPage().then(() => {
        const n = document.getElementById('pq');
        n.focus();
        n.setSelectionRange(n.value.length, n.value.length);
      });
    }, 350);
  });
}
