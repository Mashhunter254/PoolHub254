'use strict';
// One match: the scoreboard, scoring controls for the organizer, the walkover
// option, the chat thread and head to head.
import { api, state } from '../api.js';
import {
  app, setRender, esc, scoreboard, stat, accentOf, avatar, streamEmbed, toast,
} from '../ui.js';

export default async function matchPage(id) {
  setRender(() => matchPage(id));
  const d = await api('/matches/' + id);
  const m = d.match;
  const stream = m.stream_url || m.event_stream;
  const firstName = (name) => String(name || '').split(' ')[0];

  const scorer = d.can_manage && m.status !== 'finished' ? `<section class="card card-pad stack">
    <div class="sec-head"><h2>Score this match</h2><span class="muted small">Race to ${m.race_to}</span></div>
    ${m.status !== 'live' ? '<button class="btn primary block" id="go-live">Start the match</button>' : ''}
    <div class="scorer">
      <button class="btn primary" data-side="1" data-delta="1" style="background:${accentOf(m.p1)};border-color:${accentOf(m.p1)};color:#06121f">
        +1 frame <small>${esc(firstName(m.p1_name))}</small></button>
      <button class="btn primary" data-side="2" data-delta="1" style="background:${accentOf(m.p2)};border-color:${accentOf(m.p2)};color:#06121f">
        +1 frame <small>${esc(firstName(m.p2_name))}</small></button>
      <div class="undo-row">
        <button class="btn sm" data-side="1" data-delta="-1">Undo ${esc(firstName(m.p1_name))}</button>
        <button class="btn sm" data-side="2" data-delta="-1">Undo ${esc(firstName(m.p2_name))}</button>
      </div>
    </div>
    <form class="grid2" id="meta-form">
      <div class="field"><label for="table_no">Table</label><input id="table_no" maxlength="20" value="${esc(m.table_no || '')}" placeholder="Table 3"></div>
      <div class="field"><label for="stream_url">Stream link for this match</label><input id="stream_url" type="url" value="${esc(m.stream_url || '')}" placeholder="https://"></div>
      <div><button class="btn sm" type="submit">Save details</button></div>
    </form>
    ${m.p1 && m.p2 ? `<div class="notice warn">
      <b>No show?</b> Settle it without frames:
      <div class="row" style="margin-top:10px">
        <button class="btn sm" data-wo="1">Award to ${esc(firstName(m.p1_name))}</button>
        <button class="btn sm" data-wo="2">Award to ${esc(firstName(m.p2_name))}</button>
      </div>
    </div>` : ''}
  </section>` : '';

  const canRemove = (c) => state.user && (c.user_id === state.user.id || ['admin', 'superadmin'].includes(state.user.role));
  const thread = `<section class="card card-pad stack enter">
    <div class="sec-head"><h2>Match chat</h2><span class="muted small">${d.comments.length} message${d.comments.length === 1 ? '' : 's'}</span></div>
    ${d.comments.length
      ? `<ul class="thread">${d.comments.map((c) => `<li class="msg" data-cid="${c.id}">
          ${avatar(c.author, c.user_id, 'sm', c.author_avatar)}
          <div class="grow">
            <div class="msg-head"><b>${esc(c.author)}</b><span class="muted tiny">${esc(ago(c.created_at))}</span></div>
            <p>${esc(c.body)}</p>
          </div>
          ${canRemove(c) ? '<button class="btn sm ghost" data-del="' + c.id + '" aria-label="Delete">×</button>' : ''}
        </li>`).join('')}</ul>`
      : '<p class="muted small">No comments yet. Be the first to say something.</p>'}
    ${state.user
      ? `<form class="row" id="cform">
          <input id="cbody" class="grow" maxlength="500" placeholder="Say something about this match" autocomplete="off">
          <button class="btn primary sm" type="submit">Post</button>
        </form>`
      : '<a class="btn sm" href="#/login">Log in to join the chat</a>'}
  </section>`;

  app.innerHTML = `<div class="page stack">
    <div class="row">
      <a class="btn sm ghost" href="#/event/${m.event_id}">← ${esc(m.event_name)}</a>
      <span class="muted small">${esc(m.venue || '')}</span>
    </div>
    ${scoreboard(m)}
    ${m.status === 'finished' && m.winner
      ? `<div class="notice">Winner: <b>${esc(m.winner === m.p1 ? m.p1_name : m.p2_name)}</b>${m.walkover ? ' · walkover' : ''}${m.rating_delta ? ` · +${m.rating_delta} rating` : ''}</div>`
      : (!m.p1 || !m.p2 ? '<div class="notice warn">Waiting for the previous round to finish.</div>' : '')}
    ${scorer}
    ${d.h2h ? `<section class="enter">
      <div class="sec-head"><h2>Head to head</h2></div>
      <div class="stats">
        ${stat(d.h2h.p1_wins, firstName(m.p1_name) + ' wins', m.p1)}
        ${stat(d.h2h.p2_wins, firstName(m.p2_name) + ' wins', m.p2)}
      </div>
      ${d.h2h.p1_wins + d.h2h.p2_wins === 0 ? '<p class="muted small" style="margin-top:10px">They have not played each other before.</p>'
        : `<div style="margin-top:14px"><a class="btn sm" href="#/player/${m.p1}/vs/${m.p2}">Full rivalry record</a></div>`}
    </section>` : ''}
    ${thread}
    ${stream ? `<section class="enter"><div class="sec-head"><h2>Watch</h2></div>${streamEmbed(stream)}</section>` : ''}
  </div>`;

  const post = async (path, body) => {
    try { await api(path, { method: 'POST', body }); matchPage(id); } catch (err) { toast(err.message); }
  };
  app.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => {
    post(`/matches/${m.id}/frame`, { side: Number(b.dataset.side), delta: Number(b.dataset.delta) });
  }));
  app.querySelectorAll('[data-wo]').forEach((b) => b.addEventListener('click', () => {
    const side = Number(b.dataset.wo);
    if (!confirm(`Award this match to ${side === 1 ? m.p1_name : m.p2_name} as a walkover?`)) return;
    post(`/matches/${m.id}/walkover`, { side });
  }));
  const go = document.getElementById('go-live');
  if (go) go.addEventListener('click', () => post(`/matches/${m.id}/start`));

  const form = document.getElementById('meta-form');
  if (form) form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/matches/' + m.id, { method: 'PUT', body: { table_no: form.table_no.value, stream_url: form.stream_url.value } });
      toast('Saved');
      matchPage(id);
    } catch (err) { toast(err.message); }
  });

  const cform = document.getElementById('cform');
  if (cform) cform.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const box = document.getElementById('cbody');
    const text = box.value.trim();
    if (!text) return;
    try {
      await api(`/matches/${m.id}/comments`, { method: 'POST', body: { body: text } });
      matchPage(id);
    } catch (err) { toast(err.message); }
  });

  app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/matches/${m.id}/comments/${b.dataset.del}`, { method: 'DELETE' });
      matchPage(id);
    } catch (err) { toast(err.message); }
  }));
}

// SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC; nudge it into a real moment.
function ago(v) {
  if (!v) return '';
  const t = new Date(String(v).includes('T') ? v : String(v).replace(' ', 'T') + 'Z').getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return new Date(t).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });
}
