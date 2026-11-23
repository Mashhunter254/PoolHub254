'use strict';
// Shared pieces: formatting, the player colour system, and the cards every page reuses.
import { api } from './api.js';

export const app = document.getElementById('app');
export const GAMES = ['8-ball', '9-ball', '10-ball', 'snooker', 'straight pool'];
export const FORMATS = [
  { value: 'knockout', label: 'Knockout (single elimination)' },
  { value: 'league', label: 'League (everyone plays everyone)' },
  { value: 'double', label: 'Double elimination' },
];
export const formatLabel = (v) => (FORMATS.find((f) => f.value === v) || FORMATS[0]).label.replace(/ \(.*/, '');

let renderFn = null;
export const setRender = (fn) => { renderFn = fn; };
export const rerender = () => { if (renderFn) renderFn(); };

// ---------- formatting ----------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
export const initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
export const num = (n) => Number(n || 0).toLocaleString('en-KE');
export const money = (n) => (n > 0 ? 'KES ' + num(n) : 'Free');
export const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function dateParts(iso) {
  const d = new Date(iso);
  return {
    day: d.toLocaleDateString('en-KE', { day: 'numeric' }),
    mon: d.toLocaleDateString('en-KE', { month: 'short' }),
    time: d.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' }),
    full: d.toLocaleString('en-KE', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
  };
}

export function toInputDate(iso) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// ---------- player colours ----------
// Three accent colours, mirrored by the --p1..--p3 tokens in style.css.
const PALETTE = ['#00e5c0', '#ff4d94', '#7a6a9c'];
export const colorIndexOf = (id) => Math.abs(Number(id) || 0) % PALETTE.length;
export const accentOf = (id) => (id ? PALETTE[colorIndexOf(id)] : 'var(--surface-3)');
export const cAttr = (id) => `data-c="${colorIndexOf(id)}"`;

// ---------- score-change flash ----------
const seen = new Map();
// Returns ' flash' the first time a score moves up, so the number can pop.
export function flash(key, value) {
  const prev = seen.get(key);
  seen.set(key, value);
  return prev !== undefined && value > prev ? ' flash' : '';
}

// ---------- small bits ----------
export const skeleton = (n = 4) => Array.from({ length: n }, () => '<div class="skeleton"></div>').join('');
export const empty = (msg, cta = '') => `<div class="empty"><p>${esc(msg)}</p>${cta}</div>`;

export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2800);
}

export const statusPill = (s) => (s === 'live'
  ? '<span class="pill live">Live</span>'
  : s === 'finished' ? '<span class="pill done">Finished</span>' : '<span class="pill open">Open</span>');

// Uploaded avatars are shown as a picture; everyone else gets their initials.
export const avatar = (name, id, cls = '', img = null) => (img
  ? `<span class="avatar pic ${cls}" ${cAttr(id)}><img src="${esc(img)}" alt="" loading="lazy"></span>`
  : `<span class="avatar ${cls}" ${cAttr(id)}>${esc(initials(name))}</span>`);

export const stat = (value, label, id) => `<div class="stat" ${id ? cAttr(id) : ''}><b>${esc(value)}</b><span>${esc(label)}</span></div>`;

// Copies a share link to the clipboard, or hands it to the phone's share sheet.
export async function shareLink(path, title = 'PoolHub') {
  const url = location.origin + path;
  try {
    if (navigator.share) { await navigator.share({ title, url }); return 'Shared'; }
    await navigator.clipboard.writeText(url);
    return 'Link copied';
  } catch {
    return 'Could not share — copy the address bar instead';
  }
}

// ---------- match card ----------
export function matchCard(m) {
  const done = m.status === 'finished';
  const lead = (side) => (m.status === 'live' && (side === 1 ? m.s1 > m.s2 : m.s2 > m.s1) ? ' lead' : '');
  const cls = (side) => {
    if (done) return m.winner && m.winner === (side === 1 ? m.p1 : m.p2) ? ' won' : ' lost';
    return '';
  };
  const row = (side) => {
    const name = side === 1 ? m.p1_name : m.p2_name;
    const id = side === 1 ? m.p1 : m.p2;
    const score = side === 1 ? m.s1 : m.s2;
    return `<div class="mrow${cls(side)}${lead(side)}${id ? '' : ' tbd'}" ${cAttr(id)}>
      <span class="bar"></span>
      <span class="nm">${esc(name || 'To be decided')}</span>
      <span class="sc${id && !done ? flash('m' + m.id + 's' + side, score) : ''}">${id ? score : ''}</span>
    </div>`;
  };
  return `<a class="mcard${m.status === 'live' ? ' is-live' : ''}" href="#/match/${m.id}">
    <div class="mcard-top">
      <span class="mcard-ev">${esc(m.event_name)}</span>${statusPill(m.status)}
    </div>
    ${row(1)}${row(2)}
    <div class="mcard-foot">
      <span>Race to ${m.race_to}</span>
      <span>${m.table_no ? esc(m.table_no) : esc(m.venue || '')}</span>
    </div>
  </a>`;
}

// Compact rows for the home / live strips where a full card would be noisy.
export const matchMcard = matchCard;

// ---------- scoreboard ----------
export function scoreboard(m, { hrefs = true } = {}) {
  const side = (n) => {
    const id = n === 1 ? m.p1 : m.p2;
    const name = n === 1 ? m.p1_name : m.p2_name;
    const rating = n === 1 ? m.p1_rating : m.p2_rating;
    const inner = `${avatar(name || '?', id, 'lg', n === 1 ? m.p1_avatar : m.p2_avatar)}
      <span class="n">${esc(name || 'To be decided')}</span>
      ${rating ? `<span class="muted tiny">Rating ${rating}</span>` : ''}`;
    return hrefs && id
      ? `<a class="board-side" href="#/player/${id}">${inner}</a>`
      : `<div class="board-side">${inner}</div>`;
  };
  const score = (n) => (n === 1 ? m.s1 : m.s2);
  const known = m.p1 && m.p2;
  const bump = known ? flash('board' + m.id, score(1) * 100 + score(2)) : '';
  return `<section class="card board" style="--c1:${accentOf(m.p1)};--c2:${accentOf(m.p2)}">
    <div class="board-vs">
      ${side(1)}
      <div class="board-sc${bump}">${known ? `${score(1)}<span class="dash">–</span>${score(2)}` : '<span class="muted" style="font-size:.4em">TBD</span>'}</div>
      ${side(2)}
    </div>
    <div class="board-meta">
      ${statusPill(m.status)}
      <span class="tag">${esc(m.game_type || '')}</span>
      <span class="tag">Race to ${m.race_to}</span>
      ${m.table_no ? `<span class="tag">${esc(m.table_no)}</span>` : ''}
    </div>
  </section>`;
}

// ---------- event card ----------
export function eventCard(e) {
  const d = dateParts(e.starts_at);
  const full = e.max_players ? e.registered >= e.max_players : false;
  return `<li><a class="ecard" href="#/event/${e.id}">
    <div class="datebox"><b>${esc(d.day)}</b><span>${esc(d.mon)}</span></div>
    <div class="grow">
      <div class="title">${esc(e.name)}</div>
      <div class="muted small">${esc(e.venue)}${e.location ? ', ' + esc(e.location) : ''} · ${esc(d.time)}</div>
      <div class="meta">
        ${statusPill(e.status)}
        <span class="tag">${esc(e.game_type)}</span>
        ${e.format && e.format !== 'knockout' ? `<span class="tag">${esc(formatLabel(e.format))}</span>` : ''}
        <span class="tag">${money(e.entry_fee)}</span>
        ${e.prize > 0 ? `<span class="tag">KES ${num(e.prize)} prize</span>` : ''}
        ${e.vip && e.status !== 'finished' ? '<span class="pill vip">VIP</span>' : ''}
        ${e.promoted && e.status !== 'finished' ? '<span class="pill ad">Featured</span>' : ''}
      </div>
      <div class="prog"><i style="width:${pct(e.registered, e.max_players)}%"></i></div>
      <div class="muted tiny" style="margin-top:6px">
        ${e.registered}/${e.max_players} registered${full ? ' · full' : ''}${e.organizer_name ? ' · ' + esc(e.organizer_name) : ''}
      </div>
    </div>
  </a></li>`;
}

// ---------- player row ----------
export function playerRow(p, { rank, note } = {}) {
  const medal = rank <= 3 ? ` g${rank}` : '';
  return `<li><a class="item" href="#/player/${p.id}">
    ${rank ? `<span class="medal${medal}">${rank}</span>` : ''}
    ${avatar(p.name, p.id, '', p.avatar)}
    <div class="grow">
      <div class="title">${esc(p.name)}</div>
      <div class="muted small">${esc(note ?? [p.location, p.club].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="tr">
      <div class="num">${p.rating}</div>
      <div class="muted tiny">${p.wins ?? 0}W ${p.losses ?? 0}L</div>
    </div>
  </a></li>`;
}

// ---------- league table ----------
export function standingsTable(rows) {
  return `<div class="card table-wrap"><table class="t">
    <thead><tr>
      <th>#</th><th>Player</th><th>P</th><th>W</th><th>L</th>
      <th class="hide-sm">Frames</th><th class="hide-sm">Diff</th><th>Pts</th>
    </tr></thead>
    <tbody>${rows.map((p, i) => `<tr>
      <td><span class="medal${i < 3 ? ' g' + (i + 1) : ''}">${i + 1}</span></td>
      <td><a class="row" href="#/player/${p.id}" style="gap:10px;flex-wrap:nowrap">
        ${avatar(p.name, p.id, '', p.avatar)}
        <span style="min-width:0"><b>${esc(p.name)}</b><div class="muted small">${esc(p.club || '')}</div></span>
      </a></td>
      <td>${p.played}</td><td>${p.wins}</td><td>${p.losses}</td>
      <td class="hide-sm">${p.frames_for}-${p.frames_against}</td>
      <td class="hide-sm">${p.diff > 0 ? '+' : ''}${p.diff}</td>
      <td><b>${p.points}</b></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

// ---------- bracket ----------
// Knockout has a single ladder; double elimination adds a losers side, a grand
// final and, optionally, a third-place playoff. All of them are columns here.
export function bracketBlock(d) {
  const stageOf = (m) => m.stage || 'wb';
  const roundName = (r) => (r === d.rounds ? 'Final' : r === d.rounds - 1 ? 'Semi-finals' : r === d.rounds - 2 ? 'Quarter-finals' : 'Round ' + r);

  const row = (m, side) => {
    const id = side === 1 ? m.p1 : m.p2;
    const name = side === 1 ? m.p1_name : m.p2_name;
    const scored = id && !m.bye;
    const won = m.status === 'finished' && m.winner && m.winner === id;
    const lost = m.status === 'finished' && m.winner && m.winner !== id;
    return `<div class="p${won ? ' w' : ''}${lost ? ' l' : ''}${name ? '' : ' tbd'}" ${cAttr(id)}>
      <span class="bar"></span>
      <span>${esc(name || (m.bye ? 'Bye' : 'To be decided'))}</span>
      <span class="s">${scored ? (side === 1 ? m.s1 : m.s2) : ''}</span>
    </div>`;
  };

  const columns = [];
  const wbRounds = [...new Set(d.matches.filter((m) => stageOf(m) === 'wb').map((m) => m.round))].sort((a, b) => a - b);
  const spread = wbRounds.length > 1;
  for (const r of wbRounds) {
    columns.push({
      title: spread ? 'Winners · ' + roundName(r) : roundName(r),
      matches: d.matches.filter((m) => stageOf(m) === 'wb' && m.round === r),
    });
  }
  const lbRounds = [...new Set(d.matches.filter((m) => stageOf(m) === 'lb').map((m) => m.round))].sort((a, b) => a - b);
  lbRounds.forEach((r, i) => {
    columns.push({
      title: 'Losers R' + (i + 1),
      matches: d.matches.filter((m) => stageOf(m) === 'lb' && m.round === r),
    });
  });
  for (const [stage, title] of [['gf', 'Grand final'], ['third', 'Third place']]) {
    const matches = d.matches.filter((m) => stageOf(m) === stage);
    if (matches.length) columns.push({ title, matches });
  }

  return `<div class="bracket-wrap"><div class="bracket">${columns.map((col) => `<div class="round">
    <div class="round-title">${esc(col.title)}</div>
    <div class="round-matches">${col.matches.map((m) => {
      const inner = row(m, 1) + row(m, 2);
      return m.bye || !(m.p1 && m.p2)
        ? `<div class="bm">${inner}</div>`
        : `<a class="bm ${m.status}" href="#/match/${m.id}" aria-label="${esc(m.p1_name)} versus ${esc(m.p2_name)}">${inner}</a>`;
    }).join('')}</div>
  </div>`).join('')}</div></div>`;
}

// ---------- stream ----------
export function streamEmbed(url) {
  if (!url) return '';
  let u;
  try { u = new URL(url); } catch { return ''; }
  let src = null;
  if (u.hostname.endsWith('youtube.com') && u.searchParams.get('v')) src = 'https://www.youtube.com/embed/' + encodeURIComponent(u.searchParams.get('v'));
  else if (u.hostname.endsWith('youtube.com') && u.pathname.startsWith('/live/')) src = 'https://www.youtube.com/embed/' + encodeURIComponent(u.pathname.split('/')[2] || '');
  else if (u.hostname === 'youtu.be') src = 'https://www.youtube.com/embed/' + encodeURIComponent(u.pathname.slice(1));
  if (src) return `<iframe class="embed" src="${esc(src)}" title="Live stream" allow="accelerometer; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`;
  return `<a class="btn primary" href="${esc(u.toString())}" target="_blank" rel="noopener noreferrer">Watch the stream</a>`;
}

// ---------- map ----------
// A real, interactive Google Map of the venue. Uses the keyless embed endpoint,
// so no API key or billing is needed. Falls back to a search link if the venue
// is unknown.
export function mapEmbed(venue, location) {
  const place = [venue, location].filter(Boolean).join(', ').trim();
  if (!place) return '';
  const q = encodeURIComponent(place);
  const find = 'https://www.google.com/maps/search/?api=1&query=' + q;
  return `<section class="enter"><div class="sec-head"><h2>Where</h2><a href="${esc(find)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></div>
    <div class="card card-pad">
      <p style="margin:0 0 12px"><b>${esc(venue || place)}</b>${location ? ` <span class="muted">· ${esc(location)}</span>` : ''}</p>
      <iframe class="embed map" src="https://www.google.com/maps?q=${q}&amp;output=embed" title="Map of ${esc(place)}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>
    </div>
  </section>`;
}

// ---------- photos ----------
// Photos come off phones at several megabytes, so redraw them on a canvas and
// step the size/quality down until the encoded image fits the 90KB budget.
export function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read that image.'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a usable image.'));
      img.onload = () => {
        try { resolve(encodePhoto(img)); } catch (e) { reject(e); }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function encodePhoto(img) {
  for (const max of [320, 256, 200, 160]) {
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * s));
    const h = Math.max(1, Math.round(img.height * s));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.55, 0.45]) {
      const out = c.toDataURL('image/jpeg', q);
      if (out.length <= 90 * 1024) return out;
    }
  }
  throw new Error('That image is too large — try a smaller one.');
}

// A set-the-photo control for staff and organizers, used on player cards whose
// owner has no account to set one from. Drop `photoInput` in the markup, place
// `photoControls()` next to each player, then call `wirePhotos(redraw)`.
export const photoControls = (id, hasPhoto) => `<button class="btn sm ghost" type="button" data-photo="${id}">${hasPhoto ? 'Change' : 'Add'}</button>${hasPhoto ? `<button class="btn sm ghost" type="button" data-photo-clear="${id}">Remove</button>` : ''}`;
export const photoInput = '<input id="photo-file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>';

export function wirePhotos(redraw) {
  const input = document.getElementById('photo-file');
  if (!input) return;
  let target = null;
  const save = async (id, data) => {
    try {
      await api('/players/' + id + '/avatar', { method: 'PUT', body: { avatar: data } });
      toast(data ? 'Photo saved' : 'Photo removed');
      redraw();
    } catch (e) { toast(e.message); }
  };
  document.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => { target = b.dataset.photo; input.click(); }));
  document.querySelectorAll('[data-photo-clear]').forEach((b) => b.addEventListener('click', () => save(b.dataset.photoClear, '')));
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (!file || !target) return;
    try { await save(target, await shrinkPhoto(file)); } catch (e) { toast(e.message); }
  });
}
