'use strict';
// Accounts: register, log in, read the session, and manage the player profile.
const { get, run, tx, hashPassword, checkPassword, HttpError } = require('../../db');
const { GAME_TYPES } = require('../constants');
const { must, text, optText, cleanEmail, cleanAvatar } = require('../validate');
const {
  newToken, publicUser, needLogin,
  checkLoginAllowed, noteLoginFailure, clearLoginFailures,
} = require('../auth');

function register(route) {
  route('POST', '/api/auth/register', (ctx) => {
    const b = ctx.body;
    const name = text(b.name, 2, 60, 'Name');
    const email = cleanEmail(b.email);
    must(String(b.password || '').length >= 8, 'Password must be at least 8 characters.');
    const role = ['fan', 'player', 'organizer'].includes(b.role) ? b.role : 'fan';
    must(!get('SELECT id FROM users WHERE email = ?', email), 'An account with this email already exists. Log in instead.', 409);
    return tx(() => {
      const id = Number(run('INSERT INTO users (name, email, phone, pass, role) VALUES (?, ?, ?, ?, ?)',
        name, email, optText(b.phone, 30), hashPassword(String(b.password)), role).lastInsertRowid);
      if (role === 'player') {
        run('INSERT INTO players (user_id, name, location, game_type) VALUES (?, ?, ?, ?)',
          id, name, optText(b.location, 60), GAME_TYPES.includes(b.game_type) ? b.game_type : null);
      }
      const user = get('SELECT * FROM users WHERE id = ?', id);
      return { token: newToken(id), user: publicUser(user) };
    });
  });

  route('POST', '/api/auth/login', (ctx) => {
    const email = String(ctx.body.email || '').trim().toLowerCase();
    const key = ctx.ip + '|' + email;
    checkLoginAllowed(key);
    const user = get('SELECT * FROM users WHERE email = ?', email);
    if (!user || !checkPassword(String(ctx.body.password || ''), user.pass)) {
      noteLoginFailure(key);
      throw new HttpError(401, 'Email or password is incorrect.');
    }
    must(!user.banned, 'This account has been suspended. Contact an administrator.', 403);
    clearLoginFailures(key);
    return { token: newToken(user.id), user: publicUser(user) };
  });

  route('GET', '/api/me', needLogin, (ctx) => ({
    user: ctx.user,
    player: get('SELECT * FROM players WHERE user_id = ?', ctx.user.id) || null,
  }));

  route('POST', '/api/me/player', needLogin, (ctx) => {
    must(['fan', 'player'].includes(ctx.user.role), 'Only fans can create a player profile.', 403);
    const existing = get('SELECT * FROM players WHERE user_id = ?', ctx.user.id);
    if (existing) return existing;
    return tx(() => {
      run("UPDATE users SET role = 'player' WHERE id = ?", ctx.user.id);
      const id = Number(run('INSERT INTO players (user_id, name, location, game_type) VALUES (?, ?, ?, ?)',
        ctx.user.id, ctx.user.name, optText(ctx.body.location, 60),
        GAME_TYPES.includes(ctx.body.game_type) ? ctx.body.game_type : null).lastInsertRowid);
      return get('SELECT * FROM players WHERE id = ?', id);
    });
  });

  route('PUT', '/api/me/player', needLogin, (ctx) => {
    const p = get('SELECT * FROM players WHERE user_id = ?', ctx.user.id);
    must(p, 'Create a player profile first.', 404);
    const b = ctx.body;
    run('UPDATE players SET name = ?, location = ?, club = ?, game_type = ? WHERE id = ?',
      text(b.name, 2, 60, 'Name'), optText(b.location, 60), optText(b.club, 60),
      GAME_TYPES.includes(b.game_type) ? b.game_type : null, p.id);
    return get('SELECT * FROM players WHERE id = ?', p.id);
  });

  // Account details: display name, sign-in email, phone and avatar.
  route('PUT', '/api/me', needLogin, (ctx) => {
    const u = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    must(u, 'Account not found.', 404);
    const b = ctx.body;
    const name = b.name === undefined ? u.name : text(b.name, 2, 60, 'Name');
    const email = b.email === undefined ? u.email : cleanEmail(b.email);
    must(!get('SELECT id FROM users WHERE email = ? AND id != ?', email, u.id),
      'Another account already uses that email.', 409);
    const avatar = b.avatar === undefined ? u.avatar : cleanAvatar(b.avatar);
    run('UPDATE users SET name = ?, email = ?, phone = ?, avatar = ? WHERE id = ?',
      name, email, b.phone === undefined ? u.phone : optText(b.phone, 30), avatar, u.id);
    // Keep the linked player card in step when it shared the old account name.
    if (name !== u.name) run('UPDATE players SET name = ? WHERE user_id = ? AND name = ?', name, u.id, u.name);
    return { user: publicUser(get('SELECT * FROM users WHERE id = ?', u.id)) };
  });

  route('PUT', '/api/me/password', needLogin, (ctx) => {
    const u = get('SELECT * FROM users WHERE id = ?', ctx.user.id);
    must(checkPassword(String(ctx.body.current || ''), u.pass), 'Your current password is not right.', 403);
    const next = String(ctx.body.password || '');
    must(next.length >= 8, 'Password must be at least 8 characters.');
    must(next !== String(ctx.body.current || ''), 'Choose a password different from the current one.');
    run('UPDATE users SET pass = ? WHERE id = ?', hashPassword(next), u.id);
    return { ok: true };
  });
}

module.exports = { register };
