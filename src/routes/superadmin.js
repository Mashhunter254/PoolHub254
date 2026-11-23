'use strict';
// The superadmin desk: every account, event and player, plus bans and data exports.
// Everything here is gated on the superadmin role; admins keep the smaller admin desk.
const fs = require('fs');
const { get, all, run, getSetting, setSetting, EVENT_SQL } = require('../../db');
const { must, int, cleanAvatar } = require('../validate');
const { HOUSE_RULES } = require('../constants');
const { needRole } = require('../auth');
const { broadcast } = require('../live');
const { sendRaw } = require('../http');
const { toCsv } = require('../exports');

const ROLES = ['fan', 'player', 'organizer', 'admin', 'superadmin'];

// The platform must never be left without someone who can run it.
function keepOneSuperadmin(id) {
  const others = get("SELECT COUNT(*) AS n FROM users WHERE role = 'superadmin' AND id != ?", id).n;
  must(others > 0, 'There must always be at least one superadmin.', 409);
}

function findUser(id) {
  const u = get('SELECT * FROM users WHERE id = ?', id);
  must(u, 'Account not found.', 404);
  return u;
}

function register(route) {
  route('GET', '/api/superadmin/overview', needRole('superadmin'), () => {
    const dbFile = get('PRAGMA database_list').file;
    return {
      users: all(`SELECT u.id, u.name, u.email, u.phone, u.role, u.verified, u.banned, u.created_at,
                    (SELECT COUNT(*) FROM events e WHERE e.organizer_id = u.id) AS events
                  FROM users u ORDER BY u.banned DESC, u.id`),
      events: all(EVENT_SQL + ' ORDER BY e.starts_at DESC LIMIT 200'),
      players: all(`SELECT p.id, p.name, p.rating, p.wins, p.losses, p.titles, p.user_id,
                      COALESCE(u.avatar, p.avatar) AS avatar, u.banned AS owner_banned
                    FROM players p LEFT JOIN users u ON u.id = p.user_id
                    ORDER BY p.rating DESC LIMIT 200`),
      counts: {
        users: get('SELECT COUNT(*) AS n FROM users').n,
        staff: get("SELECT COUNT(*) AS n FROM users WHERE role IN ('admin','superadmin')").n,
        banned: get('SELECT COUNT(*) AS n FROM users WHERE banned = 1').n,
        events: get('SELECT COUNT(*) AS n FROM events').n,
        live: get("SELECT COUNT(*) AS n FROM events WHERE status = 'live'").n,
        matches: get('SELECT COUNT(*) AS n FROM matches WHERE bye = 0').n,
        players: get('SELECT COUNT(*) AS n FROM players').n,
        registrations: get('SELECT COUNT(*) AS n FROM registrations').n,
        comments: get('SELECT COUNT(*) AS n FROM comments').n,
      },
      bytes: dbFile && fs.existsSync(dbFile) ? fs.statSync(dbFile).size : 0,
      house_rules: getSetting('house_rules', HOUSE_RULES),
    };
  });

  // The "usual rules" shown on the home page. One editable copy for the whole site.
  route('PUT', '/api/superadmin/house-rules', needRole('superadmin'), (ctx) => {
    const rules = String(ctx.body.rules ?? '').trim();
    must(rules.length <= 2000, 'Rules must be 2000 characters or fewer.');
    setSetting('house_rules', rules);
    broadcast({ type: 'settings' });
    return { ok: true, rules };
  });

  // Ban or reinstate an account, in case of a report. Existing sessions stop working at once.
  route('POST', '/api/superadmin/users/:id/ban', needRole('superadmin'), (ctx) => {
    const u = findUser(ctx.params.id);
    must(u.id !== ctx.user.id, 'You cannot ban your own account.', 409);
    if (u.role === 'superadmin') keepOneSuperadmin(u.id);
    run('UPDATE users SET banned = ? WHERE id = ?', ctx.body.banned === false ? 0 : 1, u.id);
    return { ok: true };
  });

  route('POST', '/api/superadmin/users/:id/role', needRole('superadmin'), (ctx) => {
    const u = findUser(ctx.params.id);
    const role = String(ctx.body.role || '');
    must(ROLES.includes(role), 'Pick a valid role.', 400);
    must(u.id !== ctx.user.id, 'You cannot change your own role.', 409);
    if (u.role === 'superadmin' && role !== 'superadmin') keepOneSuperadmin(u.id);
    run('UPDATE users SET role = ? WHERE id = ?', role, u.id);
    return { ok: true };
  });

  route('POST', '/api/superadmin/users/:id/verify', needRole('superadmin'), (ctx) => {
    const u = findUser(ctx.params.id);
    run('UPDATE users SET verified = ? WHERE id = ?', ctx.body.verified === false ? 0 : 1, u.id);
    return { ok: true };
  });

  route('DELETE', '/api/superadmin/users/:id', needRole('superadmin'), (ctx) => {
    const u = findUser(ctx.params.id);
    must(u.id !== ctx.user.id, 'You cannot delete your own account.', 409);
    if (u.role === 'superadmin') keepOneSuperadmin(u.id);

    const owned = get('SELECT COUNT(*) AS n FROM events WHERE organizer_id = ?', u.id).n;
    must(owned === 0, `This account still organizes ${owned} event${owned > 1 ? 's' : ''}. Delete those first.`, 409);

    const p = get('SELECT * FROM players WHERE user_id = ?', u.id);
    if (p) {
      const played = get('SELECT COUNT(*) AS n FROM matches WHERE bye = 0 AND (p1 = ? OR p2 = ?)', p.id, p.id).n;
      must(played === 0, 'This player has match history and cannot be removed.', 409);
      run('DELETE FROM registrations WHERE player_id = ?', p.id);
      run('DELETE FROM players WHERE id = ?', p.id);
    }
    run('DELETE FROM users WHERE id = ?', u.id);
    return { deleted: true };
  });

  // Feature / VIP toggles for any event, with no promotion request needed.
  route('POST', '/api/superadmin/events/:id/flags', needRole('superadmin'), (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    const promoted = ctx.body.promoted === undefined ? ev.promoted : (ctx.body.promoted ? 1 : 0);
    const vip = ctx.body.vip === undefined ? ev.vip : (ctx.body.vip ? 1 : 0);
    run('UPDATE events SET promoted = ?, vip = ? WHERE id = ?', promoted, vip, ev.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { ok: true };
  });

  route('DELETE', '/api/superadmin/events/:id', needRole('superadmin'), (ctx) => {
    const ev = get('SELECT id FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    // Matches, registrations and comments cascade off the event.
    run('DELETE FROM events WHERE id = ?', ev.id);
    broadcast({ type: 'event', event_id: ev.id, deleted: true });
    return { deleted: true };
  });

  route('PUT', '/api/superadmin/players/:id', needRole('superadmin'), (ctx) => {
    const p = get('SELECT * FROM players WHERE id = ?', ctx.params.id);
    must(p, 'Player not found.', 404);
    const rating = int(ctx.body.rating, 0, 10000, 'Rating');
    // An admin can also stand in for a player card that has no account of its own.
    const avatar = ctx.body.avatar === undefined ? p.avatar : cleanAvatar(ctx.body.avatar);
    run('UPDATE players SET rating = ?, avatar = ? WHERE id = ?', rating, avatar, p.id);
    return { ok: true };
  });

  route('DELETE', '/api/superadmin/players/:id', needRole('superadmin'), (ctx) => {
    const p = get('SELECT * FROM players WHERE id = ?', ctx.params.id);
    must(p, 'Player not found.', 404);
    const played = get('SELECT COUNT(*) AS n FROM matches WHERE bye = 0 AND (p1 = ? OR p2 = ?)', p.id, p.id).n;
    must(played === 0, 'This player has match history and cannot be removed.', 409);
    run('DELETE FROM registrations WHERE player_id = ?', p.id);
    run('DELETE FROM players WHERE id = ?', p.id);
    if (p.user_id) run("UPDATE users SET role = 'fan' WHERE id = ? AND role = 'player'", p.user_id);
    return { deleted: true };
  });

  // CSV downloads: the whole user, event or player table.
  route('GET', '/api/superadmin/export/:kind', needRole('superadmin'), (ctx) => {
    const day = new Date().toISOString().slice(0, 10);
    const kind = ctx.params.kind;
    let rows;
    let columns;
    if (kind === 'users') {
      rows = all('SELECT id, name, email, phone, role, verified, banned, created_at FROM users ORDER BY id');
      columns = [
        { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'email', label: 'Email' },
        { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' }, { key: 'verified', label: 'Verified' },
        { key: 'banned', label: 'Banned' }, { key: 'created_at', label: 'Created' },
      ];
    } else if (kind === 'events') {
      rows = all(EVENT_SQL + ' ORDER BY e.starts_at');
      columns = [
        { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'organizer_name', label: 'Organizer' },
        { key: 'venue', label: 'Venue' }, { key: 'location', label: 'Location' }, { key: 'game_type', label: 'Game' },
        { key: 'format', label: 'Format' }, { key: 'starts_at', label: 'Starts' }, { key: 'entry_fee', label: 'Entry fee' },
        { key: 'registered', label: 'Registered' }, { key: 'max_players', label: 'Max players' },
        { key: 'status', label: 'Status' }, { key: 'promoted', label: 'Featured' }, { key: 'vip', label: 'VIP' },
      ];
    } else if (kind === 'players') {
      rows = all('SELECT id, name, location, club, game_type, rating, wins, losses, titles FROM players ORDER BY rating DESC');
      columns = [
        { key: 'id', label: 'ID' }, { key: 'name', label: 'Name' }, { key: 'location', label: 'Location' },
        { key: 'club', label: 'Club' }, { key: 'game_type', label: 'Game' }, { key: 'rating', label: 'Rating' },
        { key: 'wins', label: 'Wins' }, { key: 'losses', label: 'Losses' }, { key: 'titles', label: 'Titles' },
      ];
    } else {
      must(false, 'Unknown export.', 404);
    }
    sendRaw(ctx, 'text/csv; charset=utf-8', toCsv(rows, columns), `poolhub-${kind}-${day}.csv`);
  });
}

module.exports = { register };
