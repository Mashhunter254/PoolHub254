'use strict';
// The admin desk: platform counts, promotion requests and organizer verification.
import { api, state } from '../api.js';
import { app, setRender, esc, empty, avatar, stat, toast, money } from '../ui.js';

export default async function adminPage() {
  if (!state.user || !['admin', 'superadmin'].includes(state.user.role)) {
    setRender(null);
    app.innerHTML = `<div class="page">${empty('Admins only.', '<a class="btn" href="#/">Back to home</a>')}</div>`;
    return;
  }
  setRender(adminPage);
  const d = await api('/admin/overview');

  app.innerHTML = `<div class="page stack console">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">Control room</div>
        <h1 style="margin-top:8px">Admin desk</h1>
        <p class="lead">Approve the featured slots and keep the organizer list honest.</p>
      </div>
    </div>

    <div class="stats enter">
      ${stat(d.counts.users, 'Accounts')}
      ${stat(d.counts.players, 'Players')}
      ${stat(d.counts.events, 'Events')}
      ${stat(d.counts.matches, 'Matches')}
    </div>

    <section class="stack">
      <div class="sec-head"><h2>Promotion requests</h2><span class="muted small">${d.promotions.length} waiting</span></div>
      ${d.promotions.length ? `<ul class="card list">${d.promotions.map((e) => `<li class="item">
        <div class="grow">
          <a class="title" href="#/event/${e.id}">${esc(e.name)}</a>
          <div class="muted small">${esc(e.organizer_name)}</div>
        </div>
        <div class="row" style="gap:8px">
          <button class="btn primary sm" data-promo="${e.id}" data-approve="1">Approve</button>
          <button class="btn sm" data-promo="${e.id}" data-approve="0">Deny</button>
        </div>
      </li>`).join('')}</ul>` : `<div class="card card-pad">${empty('No promotion requests waiting.')}</div>`}
    </section>

    <section class="stack">
      <div class="sec-head"><h2>VIP events</h2><span class="muted small">Top of the home carousel</span></div>
      ${d.vipEvents.length ? `<ul class="card list">${d.vipEvents.map((e) => `<li class="item">
        <div class="grow">
          <a class="title" href="#/event/${e.id}">${esc(e.name)}</a>
          <div class="muted small">${esc(e.venue)} · ${money(e.entry_fee)} entry</div>
        </div>
        ${e.promoted ? '<span class="pill ad">Featured</span>' : ''}
        <button class="btn sm${e.vip ? ' primary' : ''}" data-vip="${e.id}" data-on="${e.vip ? 0 : 1}">${e.vip ? 'VIP' : 'Make VIP'}</button>
      </li>`).join('')}</ul>` : `<div class="card card-pad">${empty('No open events to feature.')}</div>`}
    </section>

    <section class="stack">
      <div class="sec-head"><h2>Organizers</h2><span class="muted small">${d.organizers.length} total</span></div>
      ${d.organizers.length ? `<ul class="card list">${d.organizers.map((o) => `<li class="item">
        ${avatar(o.name, o.id)}
        <div class="grow">
          <div class="title">${esc(o.name)}</div>
          <div class="muted small">${esc(o.email)}</div>
        </div>
        ${o.verified ? '<span class="pill ok">Verified</span>' : '<span class="pill open">Unverified</span>'}
        <button class="btn sm" data-verify="${o.id}" data-on="${o.verified ? 0 : 1}">${o.verified ? 'Remove verification' : 'Verify'}</button>
      </li>`).join('')}</ul>` : `<div class="card card-pad">${empty('No organizers yet.')}</div>`}
    </section>
  </div>`;

  const act = (sel, fn) => app.querySelectorAll(sel).forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await fn(b); adminPage(); } catch (err) { toast(err.message); b.disabled = false; }
  }));

  act('[data-promo]', (b) => api(`/admin/events/${b.dataset.promo}/promotion`, {
    method: 'POST', body: { approve: b.dataset.approve === '1' },
  }));
  act('[data-verify]', (b) => api(`/admin/organizers/${b.dataset.verify}/verify`, {
    method: 'POST', body: { verified: b.dataset.on === '1' },
  }));
  act('[data-vip]', (b) => api(`/admin/events/${b.dataset.vip}/vip`, {
    method: 'POST', body: { vip: b.dataset.on === '1' },
  }));
}
