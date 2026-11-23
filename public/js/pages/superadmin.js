'use strict';
// The superadmin desk: every account, event and player on the platform, with bans,
// role changes and data exports. Reachable only by the superadmin role.
import { api, state } from '../api.js';
import {
  app, setRender, esc, empty, avatar, stat, num, statusPill, dateParts, money, toast,
  photoControls, photoInput, wirePhotos,
} from '../ui.js';

const ROLES = ['fan', 'player', 'organizer', 'admin', 'superadmin'];
let tab = 'users';
let query = '';

const kb = (bytes) => (bytes > 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');

export default async function superAdminPage() {
  if (!state.user || state.user.role !== 'superadmin') {
    setRender(null);
    app.innerHTML = `<div class="page">${empty('Superadmins only.', '<a class="btn" href="#/">Back to home</a>')}</div>`;
    return;
  }
  setRender(superAdminPage);
  const d = await api('/superadmin/overview');
  const me = state.user.id;

  const tabs = `<div class="seg" role="tablist" style="margin-bottom:18px">
    <button role="tab" data-tab="users" aria-selected="${tab === 'users'}">Users (${d.users.length})</button>
    <button role="tab" data-tab="events" aria-selected="${tab === 'events'}">Events (${d.events.length})</button>
    <button role="tab" data-tab="players" aria-selected="${tab === 'players'}">Players (${d.players.length})</button>
    <button role="tab" data-tab="system" aria-selected="${tab === 'system'}">System</button>
  </div>`;

  // ---------- users ----------
  const q = query.trim().toLowerCase();
  const shown = q
    ? d.users.filter((u) => [u.name, u.email, u.role].join(' ').toLowerCase().includes(q))
    : d.users;
  const userRow = (u) => `<tr>
    <td>${avatar(u.name, u.id, 'sm')}</td>
    <td>
      <div class="title">${esc(u.name)}${u.id === me ? ' <span class="muted tiny">(you)</span>' : ''}</div>
      <div class="muted tiny">${esc(u.email)}${u.phone ? ' · ' + esc(u.phone) : ''}</div>
    </td>
    <td>
      <select class="sel" data-role="${u.id}" aria-label="Role for ${esc(u.name)}"${u.id === me ? ' disabled' : ''}>
        ${ROLES.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}
      </select>
    </td>
    <td>${u.events ? `<span class="tag">${num(u.events)} event${u.events > 1 ? 's' : ''}</span>` : ''}</td>
    <td>${u.banned ? '<span class="pill hot">Banned</span>' : '<span class="pill ok">Active</span>'}</td>
    <td>${u.verified ? '<span class="pill open">Verified</span>' : '<span class="muted tiny">—</span>'}</td>
    <td class="tr nowrap">
      <button class="btn sm" data-verify="${u.id}" data-on="${u.verified ? 0 : 1}">${u.verified ? 'Unverify' : 'Verify'}</button>
      <button class="btn sm${u.banned ? '' : ' danger'}" data-ban="${u.id}" data-on="${u.banned ? 0 : 1}"${u.id === me ? ' disabled' : ''}>${u.banned ? 'Unban' : 'Ban'}</button>
      <button class="btn sm danger" data-del-user="${u.id}"${u.id === me ? ' disabled' : ''}>Delete</button>
    </td>
  </tr>`;

  const usersTab = `<section class="stack">
    <div class="row">
      <input class="sel grow" id="user-search" placeholder="Search name, email or role…" value="${esc(query)}">
      <span class="muted small nowrap">${shown.length} shown</span>
    </div>
    ${shown.length ? `<div class="card table-wrap"><table class="t">
      <thead><tr>
        <th></th><th>Account</th><th>Role</th><th>Organizes</th><th>Status</th><th>Verified</th><th></th>
      </tr></thead>
      <tbody>${shown.map(userRow).join('')}</tbody>
    </table></div>` : `<div class="card card-pad">${empty('No accounts match that search.')}</div>`}
  </section>`;

  // ---------- events ----------
  const eventRow = (e) => `<tr>
    <td>${statusPill(e.status)}</td>
    <td>
      <a class="title" href="#/event/${e.id}">${esc(e.name)}</a>
      <div class="muted tiny">${esc(e.venue)} · ${esc(e.organizer_name)}</div>
    </td>
    <td class="nowrap">${esc(dateParts(e.starts_at).full)}</td>
    <td class="nowrap">${money(e.entry_fee)}</td>
    <td class="nowrap">${num(e.registered)}/${num(e.max_players)}</td>
    <td class="tr nowrap">
      <button class="btn sm${e.promoted ? ' primary' : ''}" data-feature="${e.id}" data-on="${e.promoted ? 0 : 1}">Featured</button>
      <button class="btn sm${e.vip ? ' primary' : ''}" data-vip="${e.id}" data-on="${e.vip ? 0 : 1}">VIP</button>
      <button class="btn sm danger" data-del-event="${e.id}">Delete</button>
    </td>
  </tr>`;

  const eventsTab = `<section class="stack">
    ${d.events.length ? `<div class="card table-wrap"><table class="t">
      <thead><tr><th>Status</th><th>Event</th><th>Starts</th><th>Entry</th><th>Entries</th><th></th></tr></thead>
      <tbody>${d.events.map(eventRow).join('')}</tbody>
    </table></div>` : `<div class="card card-pad">${empty('No events yet.')}</div>`}
  </section>`;

  // ---------- players ----------
  const playerRow = (p) => `<tr>
    <td>${avatar(p.name, p.id, 'sm', p.avatar)}</td>
    <td>
      <a class="title" href="#/player/${p.id}">${esc(p.name)}</a>
      ${p.owner_banned ? '<span class="pill hot">Banned</span>' : ''}
    </td>
    <td><input class="sel" type="number" min="0" max="10000" style="width:6.5rem" value="${esc(p.rating)}" data-rating="${p.id}" aria-label="Rating for ${esc(p.name)}"></td>
    <td class="nowrap">${num(p.wins)}–${num(p.losses)}</td>
    <td class="nowrap">${num(p.titles)}</td>
    <td class="tr nowrap">
      ${photoControls(p.id, !!p.avatar)}
      <button class="btn sm" data-save-rating="${p.id}">Save</button>
      <button class="btn sm danger" data-del-player="${p.id}">Delete</button>
    </td>
  </tr>`;

  const playersTab = `<section class="stack">
    <p class="muted small">A player card with no account behind it can still have a photo — add one here.</p>
    ${photoInput}
    ${d.players.length ? `<div class="card table-wrap"><table class="t">
      <thead><tr><th></th><th>Player</th><th>Rating</th><th>W–L</th><th>Titles</th><th></th></tr></thead>
      <tbody>${d.players.map(playerRow).join('')}</tbody>
    </table></div>` : `<div class="card card-pad">${empty('No players yet.')}</div>`}
  </section>`;

  // ---------- system ----------
  const systemTab = `<section class="stack">
    <div class="stats">
      ${stat(num(d.counts.users), 'Accounts')}
      ${stat(num(d.counts.staff), 'Staff')}
      ${stat(num(d.counts.banned), 'Banned')}
      ${stat(num(d.counts.events), 'Events')}
      ${stat(num(d.counts.live), 'Live events')}
      ${stat(num(d.counts.matches), 'Matches')}
      ${stat(num(d.counts.players), 'Players')}
      ${stat(num(d.counts.registrations), 'Entries')}
      ${stat(num(d.counts.comments), 'Comments')}
    </div>
    <div class="card card-pad">
      <div class="sec-head"><h2>Data exports</h2></div>
      <p class="lead">Download the whole table as CSV for a backup or a spreadsheet.</p>
      <div class="row" style="margin-top:12px">
        <a class="btn sm" href="/api/superadmin/export/users" download>Users CSV</a>
        <a class="btn sm" href="/api/superadmin/export/events" download>Events CSV</a>
        <a class="btn sm" href="/api/superadmin/export/players" download>Players CSV</a>
      </div>
    </div>
    <div class="card card-pad">
      <div class="sec-head"><h2>House rules</h2></div>
      <p class="lead">The usual rules shown to everyone on the home page. Organizers can still add their own rules to a single event.</p>
      <textarea id="house-rules" class="sel" rows="8" maxlength="2000" style="margin-top:12px;width:100%" placeholder="Write one rule per line.">${esc(d.house_rules || '')}</textarea>
      <div class="row" style="margin-top:12px">
        <button class="btn primary" id="save-house-rules">Save rules</button>
      </div>
    </div>
    <div class="card card-pad">
      <div class="sec-head"><h2>Storage</h2></div>
      <p class="lead">SQLite database file is ${kb(d.bytes)} on disk.</p>
      <p class="muted small" style="margin:0">To wipe and reload the demo data, stop the server and run <code>node seed.js --reset</code>.</p>
    </div>
  </section>`;

  const body = tab === 'events' ? eventsTab : tab === 'players' ? playersTab : tab === 'system' ? systemTab : usersTab;

  app.innerHTML = `<div class="page stack console">
    <div class="page-head">
      <div>
        <div class="eyebrow">Platform control</div>
        <h1 style="margin-top:8px">Super admin</h1>
        <p class="lead">Every account, event and player — plus bans and data exports.</p>
      </div>
      <div class="row">${tabs}</div>
    </div>
    ${body}
  </div>`;

  // ---------- wiring ----------
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; superAdminPage(); }));

  const search = document.getElementById('user-search');
  if (search) {
    search.addEventListener('input', () => {
      query = search.value;
      // Redraw the table only, so the field keeps focus while typing.
      const list = app.querySelector('tbody');
      if (!list) return;
      const needle = query.trim().toLowerCase();
      const rows = needle
        ? d.users.filter((u) => [u.name, u.email, u.role].join(' ').toLowerCase().includes(needle))
        : d.users;
      list.innerHTML = rows.map(userRow).join('');
      wireRowActions();
      const count = app.querySelector('.row .muted.small');
      if (count) count.textContent = rows.length + ' shown';
    });
  }

  const post = (b, path, body, msg) => {
    b.disabled = true;
    api(path, { method: 'POST', body })
      .then(() => { toast(msg); superAdminPage(); })
      .catch((err) => { toast(err.message); b.disabled = false; });
  };

  const remove = (b, path, msg) => {
    b.disabled = true;
    api(path, { method: 'DELETE' })
      .then(() => { toast(msg); superAdminPage(); })
      .catch((err) => { toast(err.message); b.disabled = false; });
  };

  function wireRowActions() {
    app.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => {
      const on = b.dataset.on === '1';
      post(b, `/superadmin/users/${b.dataset.verify}/verify`, { verified: on }, on ? 'Verified' : 'Verification removed');
    }));
    app.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', () => {
      const on = b.dataset.on === '1';
      if (on && !confirm('Ban this account? They will be signed out and blocked from logging in.')) return;
      post(b, `/superadmin/users/${b.dataset.ban}/ban`, { banned: on }, on ? 'Account banned' : 'Account reinstated');
    }));
    app.querySelectorAll('[data-del-user]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this account for good? This cannot be undone.')) return;
      remove(b, `/superadmin/users/${b.dataset.delUser}`, 'Account deleted');
    }));
    app.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', () => {
      post(s, `/superadmin/users/${s.dataset.role}/role`, { role: s.value }, 'Role updated');
    }));
    app.querySelectorAll('[data-feature]').forEach((b) => b.addEventListener('click', () => {
      post(b, `/superadmin/events/${b.dataset.feature}/flags`, { promoted: b.dataset.on === '1' }, 'Event updated');
    }));
    app.querySelectorAll('[data-vip]').forEach((b) => b.addEventListener('click', () => {
      post(b, `/superadmin/events/${b.dataset.vip}/flags`, { vip: b.dataset.on === '1' }, 'Event updated');
    }));
    app.querySelectorAll('[data-del-event]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this event, its draw and every match in it?')) return;
      remove(b, `/superadmin/events/${b.dataset.delEvent}`, 'Event deleted');
    }));
    app.querySelectorAll('[data-save-rating]').forEach((b) => b.addEventListener('click', () => {
      const input = app.querySelector(`[data-rating="${b.dataset.saveRating}"]`);
      b.disabled = true;
      api(`/superadmin/players/${b.dataset.saveRating}`, { method: 'PUT', body: { rating: Number(input.value) } })
        .then(() => { toast('Rating saved'); superAdminPage(); })
        .catch((err) => { toast(err.message); b.disabled = false; });
    }));
    app.querySelectorAll('[data-del-player]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Delete this player card?')) return;
      remove(b, `/superadmin/players/${b.dataset.delPlayer}`, 'Player deleted');
    }));
  }

  wireRowActions();

  const rulesBtn = document.getElementById('save-house-rules');
  if (rulesBtn) {
    rulesBtn.addEventListener('click', () => {
      const rules = document.getElementById('house-rules').value;
      rulesBtn.disabled = true;
      api('/superadmin/house-rules', { method: 'PUT', body: { rules } })
        .then(() => { toast('House rules saved'); superAdminPage(); })
        .catch((err) => { toast(err.message); rulesBtn.disabled = false; });
    });
  }

  wirePhotos(superAdminPage);
}
