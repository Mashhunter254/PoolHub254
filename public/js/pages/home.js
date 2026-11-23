'use strict';
// Home: what is on the tables right now, then what is coming up.
import { api } from '../api.js';
import {
  app, setRender, esc, skeleton, empty, eventCard, matchCard, playerRow, dateParts, money, accentOf, pct,
} from '../ui.js';

// One slide in the top carousel: a live table, or an upcoming VIP / featured / paid event.
function liveSlide(m) {
  return `<a class="rail-card is-live" href="#/match/${m.id}" style="--c1:${accentOf(m.p1)};--c2:${accentOf(m.p2)}">
    <div class="rail-top"><span class="pill live">Live</span><span class="rail-sc">${m.s1}<span class="dash">–</span>${m.s2}</span></div>
    <div>
      <h3 class="rail-title">${esc(m.p1_name)} <span class="muted">vs</span> ${esc(m.p2_name)}</h3>
      <p class="muted small">${esc(m.event_name)} · race to ${m.race_to}${m.table_no ? ' · ' + esc(m.table_no) : ''}</p>
    </div>
    <span class="rail-cta">Open the scoreboard →</span>
  </a>`;
}

function eventSlide(e) {
  const d = dateParts(e.starts_at);
  const badges = `${e.vip ? '<span class="pill vip">VIP</span>' : ''}${e.promoted ? '<span class="pill ad">Featured</span>' : ''}${e.entry_fee > 0 ? `<span class="pill">${money(e.entry_fee)}</span>` : ''}`;
  // VIP keeps its own gold; every other slide cycles the shared four-colour set.
  const tint = e.vip
    ? '--c1:#ffd23f;--c2:#ff9b2f'
    : `--c1:${accentOf(e.id)};--c2:${accentOf((Number(e.id) || 0) + 1)}`;
  return `<a class="rail-card" href="#/event/${e.id}" style="${tint}">
    <div class="rail-top"><span class="pill ${e.status === 'live' ? 'live' : 'open'}">${e.status === 'live' ? 'Live' : 'Upcoming'}</span><span class="rail-date"><b>${esc(d.day)}</b> ${esc(d.mon)}</span></div>
    <div>
      <h3 class="rail-title">${esc(e.name)}</h3>
      <p class="muted small">${esc(e.venue)}${e.location ? ', ' + esc(e.location) : ''} · ${esc(d.time)}</p>
    </div>
    <div class="rail-meta">${badges}${e.prize > 0 ? `<span class="pill">KES ${esc(e.prize)}</span>` : ''}</div>
    <div class="prog"><i style="width:${pct(e.registered, e.max_players)}%"></i></div>
  </a>`;
}

// Builds the swipeable hero rail and wires up the dots.
function railBlock(live, vip) {
  const slides = [
    ...live.slice(0, 4).map(liveSlide),
    ...vip.map(eventSlide),
  ];
  if (!slides.length) return '';
  const dots = slides.length > 1
    ? `<div class="rail-dots" id="rail-dots" aria-label="Carousel slides">${slides.map((_, i) => `<button type="button"${i === 0 ? ' aria-current="true"' : ''} aria-label="Slide ${i + 1}"></button>`).join('')}</div>`
    : '';
  return `<section class="enter" aria-label="Live and featured">
    <div class="rail-track" id="rail">${slides.join('')}</div>
    ${dots}
  </section>`;
}

let railTimer = null;

function wireRail() {
  clearInterval(railTimer);
  railTimer = null;
  const rail = document.getElementById('rail');
  if (!rail) return;
  const dots = [...document.querySelectorAll('#rail-dots button')];
  if (!dots.length) return;

  const step = () => (rail.children[0] ? rail.children[0].offsetWidth + 12 : 1);
  const index = () => Math.min(dots.length - 1, Math.max(0, Math.round(rail.scrollLeft / step())));
  const sync = () => {
    const i = index();
    dots.forEach((d, n) => d.setAttribute('aria-current', n === i ? 'true' : 'false'));
  };
  const go = (n) => rail.scrollTo({ left: (n >= dots.length ? 0 : n) * step(), behavior: 'smooth' });

  rail.addEventListener('scroll', sync, { passive: true });
  dots.forEach((d, n) => d.addEventListener('click', () => { go(n); start(); }));
  sync();

  // Auto-advance through the slides, pausing while the reader is touching or hovering.
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function start() {
    clearInterval(railTimer);
    railTimer = setInterval(() => go(index() + 1), 4500);
  }
  function stop() {
    clearInterval(railTimer);
    railTimer = null;
  }
  if (reduce || dots.length < 2) return;
  start();
  ['pointerdown', 'mouseenter'].forEach((ev) => rail.addEventListener(ev, stop));
  ['pointerup', 'mouseleave'].forEach((ev) => rail.addEventListener(ev, start));
}

export default async function homePage() {
  setRender(homePage);
  app.innerHTML = `<div class="stack">${skeleton(3)}</div>`;
  const d = await api('/home');

  const next = d.upcoming[0];
  let fallback;
  if (next) {
    const dp = dateParts(next.starts_at);
    fallback = `<section class="card card-pad enter">
      <div class="eyebrow">Next up</div>
      <h1 style="margin:10px 0 6px">${esc(next.name)}</h1>
      <p class="lead">${esc(dp.full)} · ${esc(next.venue)}${next.location ? ', ' + esc(next.location) : ''} · ${money(next.entry_fee)}</p>
      <div class="row" style="margin-top:16px">
        <a class="btn primary" href="#/event/${next.id}">View event</a>
        <a class="btn ghost" href="#/events">All events</a>
      </div>
    </section>`;
  } else {
    fallback = `<section class="card card-pad enter">
      <div class="eyebrow">PoolHub</div>
      <h1 style="margin:10px 0 6px">Pool, scored live</h1>
      <p class="lead">Follow tournaments, watch brackets fill up and see every frame land on the scoreboard as it happens.</p>
      <div class="row" style="margin-top:16px">
        <a class="btn primary" href="#/register">Create an account</a>
        <a class="btn ghost" href="#/organize">Post an event</a>
      </div>
    </section>`;
  }

  const hero = railBlock(d.live, d.vip) || fallback;

  const liveStrip = d.live.length
    ? `<div class="strip">${d.live.map(matchCard).join('')}</div>`
    : `<div class="card">${empty('No match is being scored right now. The next event is below.')}</div>`;

  // Each band of the home screen cycles the app's three colours, so the headings
  // and their star rules step through the set in a fixed order.
  const TONES = ['--p1', '--p2', '--p3'];
  const tone = (i) => ` style="--s:var(${TONES[i % TONES.length]})"`;

  const following = d.following && (d.following.events.length || d.following.players.length)
    ? `<section class="enter"${tone(2)}><div class="sec-head"><h2>You follow</h2></div><ul class="card list">
        ${d.following.events.map(eventCard).join('')}
        ${d.following.players.map((p) => playerRow({ ...p, wins: null, losses: null }, { note: 'Player' })).join('')}
      </ul></section>`
    : '';

  app.innerHTML = `<div class="page stack home">
    ${hero}
    <div class="home-body stack">
      <section class="enter"${tone(0)}>
        <div class="sec-head"><h2>Live tables</h2><a href="#/live">Live centre</a></div>
        ${liveStrip}
      </section>
      ${d.promoted.length ? `<section class="enter"${tone(1)}>
        <div class="sec-head"><h2>Featured events</h2><a href="#/events">All events</a></div>
        <ul class="card list">${d.promoted.map(eventCard).join('')}</ul>
      </section>` : ''}
      ${following}
      <div class="cols">
        <section class="enter"${tone(3)}>
          <div class="sec-head"><h2>Coming up</h2><a href="#/events">See all</a></div>
          <ul class="card list">${d.upcoming.length
            ? d.upcoming.slice(0, 6).map(eventCard).join('')
            : empty('No upcoming events yet.', '<a class="btn primary" href="#/organize">Post an event</a>')}</ul>
        </section>
        <section class="enter"${tone(0)}>
          <div class="sec-head"><h2>Top players</h2><a href="#/rankings">Full rankings</a></div>
          <ul class="card list">${d.top.map((p, i) => playerRow({ ...p, club: null }, { rank: i + 1, note: p.location || '' })).join('')}</ul>
        </section>
      </div>
      <section class="enter"${tone(1)}>
        <div class="sec-head"><h2>Latest results</h2></div>
        ${d.results.length ? `<div class="grid-auto">${d.results.map(matchCard).join('')}</div>` : `<div class="card">${empty('No finished matches yet.')}</div>`}
      </section>
      ${d.house_rules ? `<section class="enter"${tone(2)}>
        <div class="sec-head"><h2>House rules</h2></div>
        <div class="card card-pad"><p class="rules-text">${esc(d.house_rules)}</p></div>
      </section>` : ''}
    </div>
  </div>`;

  wireRail();
}
