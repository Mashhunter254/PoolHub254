'use strict';
// One event: the summary, the draw (bracket, league table or double elimination)
// and who has entered. Also carries the share / export / walkover controls.
import { api, state } from '../api.js';
import {
  app, setRender, esc, empty, playerRow, bracketBlock, standingsTable, streamEmbed, statusPill,
  dateParts, money, num, stat, pct, toast, shareLink, formatLabel, mapEmbed, avatar,
  photoControls, photoInput, wirePhotos,
} from '../ui.js';

let tab = 'overview';

export default async function eventPage(id) {
  setRender(() => eventPage(id));
  const d = await api('/events/' + id);
  const e = d.event;
  const dp = dateParts(e.starts_at);
  const hasBracket = d.matches.length > 0;
  const league = e.format === 'league';
  const showStandings = !!(d.standings && d.standings.length);
  if (tab === 'bracket' && !hasBracket) tab = 'overview';
  if (tab === 'standings' && !showStandings) tab = 'overview';

  const champion = d.champion;

  // ---------- actions ----------
  const actions = [];
  if (state.user) {
    actions.push(`<button class="btn sm" id="follow">${d.me.following ? 'Following' : 'Follow'}</button>`);
    if (e.status === 'open' && d.me.has_player) {
      actions.push(d.me.registered
        ? '<button class="btn sm" id="withdraw">Withdraw</button>'
        : '<button class="btn primary sm" id="register">Enter this event</button>');
    }
    if (e.status === 'open' && !d.me.has_player && state.user.role === 'fan') {
      actions.push('<a class="btn primary sm" href="#/me">Create a player profile to enter</a>');
    }
  } else {
    actions.push('<a class="btn primary sm" href="#/login">Log in to enter or follow</a>');
  }
  if (d.me.can_manage && e.status === 'open') actions.push('<button class="btn primary sm" id="start">Start and draw</button>');
  if (d.me.can_manage) actions.push(`<a class="btn sm" href="#/organize/${e.id}">Edit</a>`);
  if (d.me.can_manage && !e.promoted && e.promo_status !== 'requested' && e.status !== 'finished') {
    actions.push('<button class="btn sm" id="promote">Request promotion</button>');
  }

  // Share + export strip. Every visitor can do all of these.
  const exports = [`<button class="btn sm ghost" id="share">Share</button>`,
    `<a class="btn sm ghost" href="/api/events/${e.id}/calendar.ics">Add to calendar</a>`];
  if (hasBracket) {
    exports.push(`<a class="btn sm ghost" href="/api/events/${e.id}/results.csv" download>Results CSV</a>`);
    exports.push('<button class="btn sm ghost" id="print">Print draw</button>');
  }
  if (showStandings) exports.push(`<a class="btn sm ghost" href="/api/events/${e.id}/standings.csv" download>Standings CSV</a>`);

  const tabs = `<div class="seg" role="tablist" style="margin-bottom:18px">
    <button role="tab" data-tab="overview" aria-selected="${tab === 'overview'}">Overview</button>
    ${hasBracket ? `<button role="tab" data-tab="bracket" aria-selected="${tab === 'bracket'}">${league ? 'Fixtures' : 'Bracket'}</button>` : ''}
    ${showStandings ? `<button role="tab" data-tab="standings" aria-selected="${tab === 'standings'}">Table</button>` : ''}
    <button role="tab" data-tab="players" aria-selected="${tab === 'players'}">Players (${d.players.length})</button>
  </div>`;

  const overview = `<div class="cols">
    <div class="stack">
      ${d.me.can_manage && e.promo_status === 'requested' ? '<div class="notice">Your promotion request is waiting for an admin.</div>' : ''}
      ${champion ? `<div class="notice"><b>${hasBracket ? 'Champion' : 'Winner'}:</b> <a href="#/player/${champion.id}">${esc(champion.name)}</a></div>` : ''}
      ${e.stream_url ? `<section><div class="sec-head"><h2>Watch</h2></div>${streamEmbed(e.stream_url)}</section>` : ''}
      ${e.description ? `<section><div class="sec-head"><h2>About</h2></div><div class="card card-pad"><p style="margin:0">${esc(e.description)}</p></div></section>` : ''}
      ${e.rules ? `<section><div class="sec-head"><h2>Pool rules</h2></div><div class="card card-pad"><p class="rules-text">${esc(e.rules)}</p></div></section>` : ''}
      ${mapEmbed(e.venue, e.location)}
      ${hasBracket ? `<section><div class="sec-head"><h2>Entry list</h2><a href="#/event/${e.id}" data-goto="players">See all</a></div>
        <ul class="card list">${d.players.slice(0, 5).map((p, i) => playerRow({ ...p, club: null }, { rank: i + 1, note: p.location || '' })).join('')}</ul></section>` : ''}
    </div>
    <div class="card card-pad">
      <div class="sec-head"><h2>Details</h2>${statusPill(e.status)}</div>
      <div class="prog" style="margin:0 0 12px"><i style="width:${pct(e.registered, e.max_players)}%"></i></div>
      <ul class="list">
        <li class="item"><span class="grow muted">When</span><b>${esc(dp.full)}</b></li>
        <li class="item"><span class="grow muted">Venue</span><b>${esc(e.venue)}${e.location ? ', ' + esc(e.location) : ''}</b></li>
        <li class="item"><span class="grow muted">Game</span><b>${esc(e.game_type)} · race to ${e.race_to}</b></li>
        <li class="item"><span class="grow muted">Format</span><b>${esc(formatLabel(e.format))}${e.third_place ? ' · 3rd place' : ''}</b></li>
        <li class="item"><span class="grow muted">Entry</span><b>${money(e.entry_fee)}</b></li>
        <li class="item"><span class="grow muted">Prize pool</span><b>${e.prize ? 'KES ' + num(e.prize) : 'None'}</b></li>
        <li class="item"><span class="grow muted">Entries</span><b>${e.registered} of ${e.max_players}</b></li>
        <li class="item"><span class="grow muted">Organizer</span><a href="#/organizer/${e.organizer_id}">${esc(e.organizer_name)}${e.organizer_verified ? ' ✓' : ''}</a></li>
      </ul>
    </div>
  </div>`;

  const playersTab = d.players.length
    ? `<ul class="card list">${d.players.map((p, i) => playerRow({ ...p, club: null }, { rank: i + 1, note: p.location || '' })).join('')}</ul>`
    : `<div class="card">${empty('No players have entered yet.')}</div>`;

  // Organizers can give a photo to the players they run — for anyone who has no
  // account of their own to set one from.
  const photosBlock = d.me.can_manage && d.players.length ? `<section class="stack">
    <div class="sec-head"><h2>Player photos</h2><span class="muted small">${d.players.filter((p) => !p.avatar).length} without one</span></div>
    <p class="muted small">Players with an account set their own photo, and it wins over the one here.</p>
    ${photoInput}
    <ul class="card list">${d.players.map((p) => `<li class="item">
      ${avatar(p.name, p.id, '', p.avatar)}
      <div class="grow"><div class="title">${esc(p.name)}</div></div>
      ${photoControls(p.id, !!p.avatar)}
    </li>`).join('')}</ul>
  </section>` : '';

  // Organizers can hand a match to one side when someone fails to show.
  const pending = d.me.can_manage
    ? d.matches.filter((m) => !m.bye && m.p1 && m.p2 && m.status !== 'finished')
    : [];
  const walkoverBlock = pending.length ? `<section class="enter" style="margin-top:20px">
    <div class="sec-head"><h2>Award a walkover</h2></div>
    <p class="muted small">Use this when a player does not show up: the match is settled without frames.</p>
    <ul class="card list">${pending.map((m) => `<li class="item">
      <span class="grow title">${esc(m.p1_name)} <span class="muted">vs</span> ${esc(m.p2_name)}</span>
      <button class="btn sm" data-wo="${m.id}:1">${esc(String(m.p1_name).split(' ')[0])}</button>
      <button class="btn sm" data-wo="${m.id}:2">${esc(String(m.p2_name).split(' ')[0])}</button>
    </li>`).join('')}</ul>
  </section>` : '';

  const body = tab === 'bracket'
    ? bracketBlock(d) + walkoverBlock
    : tab === 'standings' ? standingsTable(d.standings)
      : tab === 'players' ? playersTab + photosBlock : overview;

  app.innerHTML = `<div class="page">
    <div class="page-head">
      <div>
        <div class="row">${statusPill(e.status)}${e.vip ? '<span class="pill vip">VIP</span>' : ''}${e.promoted ? '<span class="pill ad">Featured</span>' : ''}<span class="tag">${esc(formatLabel(e.format))}</span></div>
        <h1 style="margin:10px 0 6px">${esc(e.name)}</h1>
        <p class="lead">${esc(dp.full)} · ${esc(e.venue)}${e.location ? ', ' + esc(e.location) : ''}</p>
      </div>
      ${hasBracket ? `<div class="stats" style="min-width:260px">
        ${stat(d.rounds, 'Rounds', 0)}
        ${stat(d.matches.filter((m) => !m.bye && m.status !== 'finished').length, 'Matches left', 1)}
      </div>` : `<div class="stats" style="min-width:220px">
        ${stat(`${e.registered}/${e.max_players}`, 'Entries', 0)}
        ${stat(money(e.entry_fee).replace('KES ', ''), 'Entry', 1)}
      </div>`}
    </div>
    <div class="row" style="margin-bottom:12px">${actions.join('')}</div>
    <div class="row" style="margin-bottom:18px">${exports.join('')}</div>
    ${tabs}
    ${body}
  </div>`;

  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; eventPage(id); }));
  const goto = app.querySelector('[data-goto="players"]');
  if (goto) goto.addEventListener('click', (ev) => { ev.preventDefault(); tab = 'players'; eventPage(id); });

  app.querySelectorAll('[data-wo]').forEach((b) => b.addEventListener('click', async () => {
    const [mid, side] = b.dataset.wo.split(':');
    if (!confirm('Award this match as a walkover? It will count for the rankings.')) return;
    b.disabled = true;
    try {
      await api(`/matches/${mid}/walkover`, { method: 'POST', body: { side: Number(side) } });
      toast('Walkover recorded');
      eventPage(id);
    } catch (err) { toast(err.message); b.disabled = false; }
  }));

  const on = (sel, fn) => {
    const el = app.querySelector(sel);
    if (!el) return;
    el.addEventListener('click', async () => {
      el.disabled = true;
      try { await fn(); } catch (err) { toast(err.message); el.disabled = false; }
    });
  };
  on('#follow', async () => {
    const r = await api('/follow', { method: 'POST', body: { kind: 'event', id: e.id } });
    toast(r.following ? 'Following this event' : 'Unfollowed');
    eventPage(id);
  });
  on('#register', async () => { await api(`/events/${e.id}/register`, { method: 'POST' }); toast('You are in'); eventPage(id); });
  on('#withdraw', async () => { await api(`/events/${e.id}/register`, { method: 'DELETE' }); toast('You have withdrawn'); eventPage(id); });
  on('#start', async () => {
    if (!confirm(`Close entries and draw the ${formatLabel(e.format).toLowerCase()}? This cannot be undone.`)) {
      app.querySelector('#start').disabled = false;
      return;
    }
    const r = await api(`/events/${e.id}/start`, { method: 'POST' });
    tab = 'bracket';
    toast(r.format_label ? r.format_label + ' drawn' : 'Draw made');
    eventPage(id);
  });
  on('#promote', async () => { await api(`/events/${e.id}/promote`, { method: 'POST' }); toast('Promotion requested'); eventPage(id); });
  on('#share', async () => { toast(await shareLink(`/e/${e.id}`, e.name)); });
  wirePhotos(() => eventPage(id));
  on('#print', async () => {
    tab = 'bracket';
    await eventPage(id);
    window.print();
  });
}
