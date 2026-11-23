'use strict';
// Log in, register, and the account screen (identity, photo and password).
import { api, state, setSession, loadSession } from '../api.js';
import { app, setRender, esc, empty, eventCard, GAMES, toast, avatar, stat, shrinkPhoto } from '../ui.js';

function authPage(mode = 'login') {
  setRender(null);
  const reg = mode === 'register';
  app.innerHTML = `<div class="page" style="max-width:470px;margin:0 auto">
    <div class="page-head enter">
      <div>
        <div class="eyebrow">${reg ? 'New account' : 'Welcome back'}</div>
        <h1 style="margin-top:8px">${reg ? 'Join PoolHub' : 'Log in'}</h1>
        <p class="lead">${reg ? 'Follow events, enter tournaments or run your own.' : 'Pick up where you left off.'}</p>
      </div>
    </div>
    <form class="card card-pad form enter" id="auth" novalidate>
      ${reg ? '<div class="field"><label for="name">Full name</label><input id="name" autocomplete="name" required></div>' : ''}
      <div class="field"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required></div>
      <div class="field"><label for="password">Password</label><input id="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>${reg ? '<span class="hint">At least 8 characters.</span>' : ''}</div>
      ${reg ? `<div class="field"><label for="role">Joining as</label><select id="role">
          <option value="fan">A fan</option>
          <option value="player">A player</option>
          <option value="organizer">A tournament organizer</option>
        </select></div>
        <div class="field" id="loc-field" hidden><label for="location">Town</label><input id="location" autocomplete="address-level2"></div>` : ''}
      <div class="error" id="err" role="alert"></div>
      <button class="btn primary block" type="submit">${reg ? 'Create account' : 'Log in'}</button>
    </form>
    <p class="muted" style="margin-top:14px;text-align:center">
      ${reg ? 'Already registered? <a href="#/login" style="color:var(--accent)">Log in</a>'
            : 'New here? <a href="#/register" style="color:var(--accent)">Create an account</a>'}
    </p>
  </div>`;

  const role = document.getElementById('role');
  if (role) role.addEventListener('change', () => { document.getElementById('loc-field').hidden = role.value !== 'player'; });

  document.getElementById('auth').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = document.getElementById('err');
    err.textContent = '';
    const val = (id) => (document.getElementById(id) ? document.getElementById(id).value : undefined);
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api(reg ? '/auth/register' : '/auth/login', {
        method: 'POST',
        body: { name: val('name'), email: val('email'), password: val('password'), role: val('role'), location: val('location') },
      });
      setSession(r.token, r.user);
      await loadSession();
      toast('Welcome, ' + r.user.name.split(' ')[0]);
      location.hash = '#/';
    } catch (e) {
      err.textContent = e.message;
      btn.disabled = false;
    }
  });
}

export const loginPage = () => authPage('login');
export const registerPage = () => authPage('register');

export async function mePage() {
  if (!state.user) return loginPage();
  setRender(null);
  const u = state.user;
  const mine = ['organizer', 'admin'].includes(u.role) ? await api('/events?mine=1') : [];
  const p = state.player;

  // ---------- identity ----------
  // undefined = leave the photo alone; '' = remove it; data URL = replace it.
  let photo;

  const accountBlock = `<section class="card card-pad stack enter">
    <div class="sec-head"><h2>Account</h2><span class="muted small">${esc(u.role)}${u.verified ? ' · verified' : ''}</span></div>
    <form class="form" id="aform">
      <div class="row" style="gap:16px;align-items:center;flex-wrap:wrap">
        <span id="avprev">${avatar(u.name, u.id, 'lg', u.avatar)}</span>
        <div class="stack" style="gap:8px">
          <label class="btn sm" for="avfile">Change photo</label>
          <input id="avfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
          <button class="btn sm ghost" type="button" id="avclear" ${u.avatar ? '' : 'hidden'}>Remove photo</button>
          <span class="muted tiny">Square images look best — we shrink them for you.</span>
        </div>
      </div>
      <div class="grid2">
        <div class="field"><label for="an">Display name</label><input id="an" value="${esc(u.name)}" required maxlength="60"></div>
        <div class="field"><label for="aph">Phone</label><input id="aph" value="${esc(u.phone || '')}" placeholder="+254 700 000 000" maxlength="30"></div>
      </div>
      <div class="field"><label for="ae">Email</label><input id="ae" type="email" value="${esc(u.email)}" required></div>
      <div><button class="btn primary" type="submit">Save account</button></div>
    </form>
  </section>`;

  const passwordBlock = `<section class="card card-pad stack enter">
    <div class="sec-head"><h2>Password</h2></div>
    <form class="form" id="pwform">
      <div class="field"><label for="pw-cur">Current password</label><input id="pw-cur" type="password" autocomplete="current-password" required></div>
      <div class="grid2">
        <div class="field"><label for="pw-new">New password</label><input id="pw-new" type="password" autocomplete="new-password" required><span class="hint">At least 8 characters.</span></div>
        <div class="field"><label for="pw-rep">Repeat new password</label><input id="pw-rep" type="password" autocomplete="new-password" required></div>
      </div>
      <div><button class="btn primary" type="submit">Change password</button></div>
    </form>
  </section>`;

  const playerBlock = p
    ? `<section class="card card-pad stack enter">
        <div class="sec-head"><h2>Player profile</h2><a href="#/player/${p.id}">Public page</a></div>
        <form class="form" id="pform">
          <div class="field"><label for="pn">Name</label><input id="pn" value="${esc(p.name)}" required></div>
          <div class="grid2">
            <div class="field"><label for="pl">Town</label><input id="pl" value="${esc(p.location || '')}"></div>
            <div class="field"><label for="pc">Club</label><input id="pc" value="${esc(p.club || '')}"></div>
          </div>
          <div class="field"><label for="pg">Main game</label><select id="pg">
            <option value="">Not set</option>${GAMES.map((g) => `<option ${p.game_type === g ? 'selected' : ''}>${g}</option>`).join('')}
          </select></div>
          <div><button class="btn primary" type="submit">Save profile</button></div>
        </form>
      </section>`
    : u.role === 'fan'
      ? `<section class="card card-pad stack enter">
          <h2>Play in tournaments</h2>
          <p class="muted">Create a player profile to enter events and build a ranking.</p>
          <div><button class="btn primary" id="mkplayer">Create player profile</button></div>
        </section>`
      : '';

  const organizerBlock = ['organizer', 'admin'].includes(u.role)
    ? `<section class="enter">
        <div class="sec-head"><h2>Your events</h2>
          <span class="row">
            <a class="btn sm" href="#/organizer/${u.id}">Public organizer page</a>
            <a class="btn primary sm" href="#/organize">Post an event</a>
          </span>
        </div>
        ${u.role === 'organizer' && !u.verified
          ? '<div class="notice warn" style="margin-bottom:12px">Not verified yet. You can post free events now — an admin must verify you before you charge entry fees or promote events.</div>' : ''}
        ${mine.length ? `<ul class="card list">${mine.map(eventCard).join('')}</ul>` : `<div class="card">${empty('You have not posted any events yet.')}</div>`}
      </section>`
    : '';

  app.innerHTML = `<div class="page stack">
    <div class="page-head">
      <div class="row" style="gap:14px">
        ${avatar(u.name, u.id, 'lg', u.avatar)}
        <div>
          <div class="eyebrow">${esc(u.role)}${u.verified ? ' · verified' : ''}</div>
          <h1 style="margin:6px 0 2px">${esc(u.name)}</h1>
          <p class="lead" style="margin:0">${esc(u.email)}</p>
        </div>
      </div>
      <div class="row">
        ${['admin', 'superadmin'].includes(u.role) ? '<a class="btn sm" href="#/admin">Admin desk</a>' : ''}
        ${u.role === 'superadmin' ? '<a class="btn sm primary" href="#/superadmin">Super admin</a>' : ''}
        <button class="btn sm" id="logout">Log out</button>
      </div>
    </div>
    ${p ? `<div class="stats">
      ${stat('#' + (await api('/players/' + p.id).then((x) => x.rank).catch(() => '–')), 'Rank', p.id)}
      ${stat(p.rating, 'Rating', p.id)}
      ${stat(`${p.wins}-${p.losses}`, 'Won-lost', p.id)}
      ${stat(p.titles, 'Titles', p.id)}
    </div>` : ''}
    ${accountBlock}
    ${passwordBlock}
    ${playerBlock}
    ${organizerBlock}
  </div>`;

  document.getElementById('logout').addEventListener('click', () => {
    setSession('', null);
    state.player = null;
    toast('Logged out');
    location.hash = '#/';
  });

  // ---------- account ----------
  const af = document.getElementById('aform');
  const fileInput = document.getElementById('avfile');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    try {
      photo = await shrinkPhoto(file);
      document.getElementById('avprev').innerHTML = avatar(af.an.value || u.name, u.id, 'lg', photo);
      document.getElementById('avclear').hidden = false;
    } catch (e) { toast(e.message); }
  });
  document.getElementById('avclear').addEventListener('click', () => {
    photo = '';
    document.getElementById('avprev').innerHTML = avatar(af.an.value || u.name, u.id, 'lg', null);
    document.getElementById('avclear').hidden = true;
    fileInput.value = '';
  });
  af.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = af.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await api('/me', {
        method: 'PUT',
        body: { name: af.an.value, email: af.ae.value, phone: af.aph.value, avatar: photo },
      });
      setSession(state.token, r.user);
      await loadSession();
      toast('Account saved');
      mePage();
    } catch (e) {
      toast(e.message);
      btn.disabled = false;
    }
  });

  // ---------- password ----------
  const pw = document.getElementById('pwform');
  pw.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const next = document.getElementById('pw-new').value;
    if (next !== document.getElementById('pw-rep').value) return toast('The two new passwords do not match.');
    const btn = pw.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await api('/me/password', {
        method: 'PUT',
        body: { current: document.getElementById('pw-cur').value, password: next },
      });
      toast('Password changed');
      pw.reset();
    } catch (e) { toast(e.message); }
    btn.disabled = false;
  });

  const mk = document.getElementById('mkplayer');
  if (mk) mk.addEventListener('click', async () => {
    try {
      await api('/me/player', { method: 'POST', body: {} });
      await loadSession();
      toast('Player profile created');
      mePage();
    } catch (e) { toast(e.message); }
  });

  const pf = document.getElementById('pform');
  if (pf) pf.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('/me/player', {
        method: 'PUT',
        body: { name: pf.pn.value, location: pf.pl.value, club: pf.pc.value, game_type: pf.pg.value },
      });
      await loadSession();
      toast('Profile saved');
    } catch (e) { toast(e.message); }
  });
}
