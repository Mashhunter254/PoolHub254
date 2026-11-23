'use strict';
// Post a new event or edit one you already run.
import { api, state } from '../api.js';
import { app, setRender, esc, empty, toInputDate, GAMES, FORMATS, toast } from '../ui.js';
import { loginPage } from './account.js';

export default async function organizePage(id) {
  setRender(null);
  if (!state.user) return loginPage();
  if (!['organizer', 'admin'].includes(state.user.role)) {
    app.innerHTML = `<div class="page">${empty(
      'Only tournament organizers can post events. Create an organizer account to continue.',
      '<a class="btn primary" href="#/register">Create organizer account</a>',
    )}</div>`;
    return;
  }

  let e = {
    name: '', venue: '', location: '', game_type: '8-ball',
    starts_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    entry_fee: 0, prize: 0, max_players: 16, race_to: 5,
    format: 'knockout', third_place: 0,
    description: '', stream_url: '', status: 'open',
  };
  if (id) e = (await api('/events/' + id)).event;
  const locked = e.status !== 'open';

  app.innerHTML = `<div class="page" style="max-width:660px;margin:0 auto">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">${id ? 'Edit' : 'New'}</div>
        <h1 style="margin-top:8px">${id ? 'Edit event' : 'Post an event'}</h1>
        <p class="lead">${locked ? 'The bracket is drawn, so only the description, prize and stream link can change now.' : 'Fill in the details and it goes live on the events board straight away.'}</p>
      </div>
    </div>
    <form class="card card-pad form enter" id="eform" novalidate>
      <div class="field"><label for="name">Event name</label><input id="name" value="${esc(e.name)}" required maxlength="80"></div>
      <div class="grid2">
        <div class="field"><label for="venue">Venue</label><input id="venue" value="${esc(e.venue)}" required></div>
        <div class="field"><label for="location">Town</label><input id="location" value="${esc(e.location || '')}"></div>
      </div>
      <div class="grid2">
        <div class="field"><label for="game_type">Game</label><select id="game_type" ${locked ? 'disabled' : ''}>
          ${GAMES.map((g) => `<option ${e.game_type === g ? 'selected' : ''}>${g}</option>`).join('')}
        </select></div>
        <div class="field"><label for="starts_at">Start</label><input id="starts_at" type="datetime-local" value="${toInputDate(e.starts_at)}" ${locked ? 'disabled' : ''} required></div>
      </div>
      <div class="grid3">
        <div class="field"><label for="entry_fee">Entry fee (KES)</label><input id="entry_fee" type="number" min="0" value="${e.entry_fee}" ${locked ? 'disabled' : ''}></div>
        <div class="field"><label for="prize">Prize pool (KES)</label><input id="prize" type="number" min="0" value="${e.prize}"></div>
        <div class="field"><label for="max_players">Max players</label><input id="max_players" type="number" min="2" max="128" value="${e.max_players}" ${locked ? 'disabled' : ''}></div>
      </div>
      <div class="field"><label for="race_to">Race to (frames to win a match)</label><input id="race_to" type="number" min="1" max="21" value="${e.race_to}" ${locked ? 'disabled' : ''}></div>
      <div class="grid2">
        <div class="field"><label for="format">Format</label><select id="format" ${locked ? 'disabled' : ''}>
          ${FORMATS.map((f) => `<option value="${f.value}" ${e.format === f.value ? 'selected' : ''}>${f.label}</option>`).join('')}
        </select></div>
        <div class="field"><label for="third_place">Third-place play-off</label>
          <label class="row" style="gap:8px;font-weight:500;padding:10px 0">
            <input id="third_place" type="checkbox" ${e.third_place ? 'checked' : ''} ${locked ? 'disabled' : ''}>
            <span class="muted small">Semi-final losers play for 3rd</span>
          </label>
        </div>
      </div>
      <div class="field"><label for="description">Description</label><textarea id="description" maxlength="1000" rows="4">${esc(e.description || '')}</textarea></div>
      <div class="field"><label for="rules">Pool rules</label><textarea id="rules" maxlength="2000" rows="6" placeholder="World Rules apply. Foul on a miss is a ball in hand.&#10;Rack your own. Call the pocket on the 8.">${esc(e.rules || '')}</textarea><span class="hint">The rules players should read before they shoot — one per line reads best.</span></div>
      <div class="field"><label for="stream_url">Live stream link</label><input id="stream_url" type="url" value="${esc(e.stream_url || '')}" placeholder="https://www.youtube.com/watch?v=..."><span class="hint">Paste a YouTube or other live link. Viewers watch straight from the event page.</span></div>
      <div class="error" id="err" role="alert"></div>
      <div class="row">
        <button class="btn primary" type="submit">${id ? 'Save changes' : 'Post event'}</button>
        <a class="btn" href="${id ? '#/event/' + id : '#/me'}">Cancel</a>
      </div>
    </form>
  </div>`;

  const f = document.getElementById('eform');
  f.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    const btn = f.querySelector('button[type="submit"]');
    btn.disabled = true;
    const v = (k) => (f.elements[k] ? f.elements[k].value : undefined);
    const body = {
      name: v('name'), venue: v('venue'), location: v('location'),
      description: v('description'), rules: v('rules'), stream_url: v('stream_url'), prize: v('prize'),
    };
    if (!locked) Object.assign(body, {
      game_type: v('game_type'),
      starts_at: v('starts_at') ? new Date(v('starts_at')).toISOString() : '',
      entry_fee: v('entry_fee'), max_players: v('max_players'), race_to: v('race_to'),
      format: v('format'),
      third_place: !!(f.elements.third_place && f.elements.third_place.checked),
    });
    try {
      const saved = await api(id ? '/events/' + id : '/events', { method: id ? 'PUT' : 'POST', body });
      toast(id ? 'Changes saved' : 'Event posted');
      location.hash = '#/event/' + saved.id;
    } catch (err2) {
      err.textContent = err2.message;
      btn.disabled = false;
    }
  });
}
