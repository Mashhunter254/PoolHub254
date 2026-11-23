'use strict';
// Events: listing and filters, the event page, registration, the draw and promotion.
const {
  get, all, run, MATCH_SQL, EVENT_SQL, startEvent, leagueStandings,
} = require('../../db');
const { GAME_TYPES } = require('../constants');
const { must, text, optText, int, cleanUrl, cleanDate } = require('../validate');
const { needLogin, needRole, canManage, isAdmin } = require('../auth');
const { broadcast } = require('../live');
const { sendRaw } = require('../http');
const { toCsv, eventIcs } = require('../exports');

const FORMATS = ['knockout', 'league', 'double'];
const FORMAT_LABELS = { knockout: 'Knockout', league: 'League', double: 'Double elimination' };

const formatOf = (v) => (FORMATS.includes(v) ? v : 'knockout');
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

function register(route) {
  route('GET', '/api/events', (ctx) => {
    const q = ctx.query;
    const where = [];
    const args = [];
    if (['open', 'live', 'finished'].includes(q.status)) { where.push('e.status = ?'); args.push(q.status); }
    if (GAME_TYPES.includes(q.game_type)) { where.push('e.game_type = ?'); args.push(q.game_type); }
    if (FORMATS.includes(q.format)) { where.push('e.format = ?'); args.push(q.format); }
    if (q.q) {
      where.push('(e.name LIKE ? OR e.venue LIKE ? OR e.location LIKE ?)');
      const like = `%${String(q.q).slice(0, 60)}%`;
      args.push(like, like, like);
    }
    if (q.mine === '1') {
      needLogin(ctx);
      where.push('e.organizer_id = ?');
      args.push(ctx.user.id);
    }
    const order = q.status === 'finished' ? 'e.starts_at DESC' : 'e.promoted DESC, e.starts_at ASC';
    return all(`${EVENT_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${order} LIMIT 100`, ...args);
  });

  route('GET', '/api/events/:id', (ctx) => {
    const event = get(EVENT_SQL + ' WHERE e.id = ?', ctx.params.id);
    must(event, 'Event not found.', 404);
    const players = all(
      `SELECT p.id, p.name, p.location, p.club, p.rating, p.wins, p.losses,
              COALESCE(u.avatar, p.avatar) AS avatar
       FROM registrations r JOIN players p ON p.id = r.player_id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE r.event_id = ? ORDER BY p.rating DESC`, event.id);
    const matches = all(MATCH_SQL + ' WHERE m.event_id = ? ORDER BY m.round, m.pos', event.id);
    const rounds = event.rounds || matches.reduce((n, m) => Math.max(n, m.stage === 'wb' ? m.round : 0), 0);
    let me = { registered: false, following: false, can_manage: false, has_player: false };
    if (ctx.user) {
      const p = get('SELECT id FROM players WHERE user_id = ?', ctx.user.id);
      me = {
        has_player: !!p,
        registered: !!(p && get('SELECT 1 AS x FROM registrations WHERE event_id = ? AND player_id = ?', event.id, p.id)),
        following: !!get("SELECT 1 AS x FROM follows WHERE user_id = ? AND kind = 'event' AND target_id = ?", ctx.user.id, event.id),
        can_manage: !!canManage(ctx.user, event.organizer_id),
      };
    }
    const champion = event.champion_id ? get('SELECT id, name FROM players WHERE id = ?', event.champion_id) : null;
    return {
      event,
      players,
      matches,
      rounds,
      champion,
      standings: event.format === 'league' && event.status !== 'open' ? leagueStandings(event.id) : null,
      me,
    };
  });

  route('POST', '/api/events', needRole('organizer', 'admin'), (ctx) => {
    const b = ctx.body;
    const entry_fee = int(b.entry_fee, 0, 1e7, 'Entry fee', 0);
    must(entry_fee === 0 || isAdmin(ctx.user) || ctx.user.verified,
      'Ask an admin to verify your organizer account before posting events with an entry fee.', 403);
    const id = Number(run(
      `INSERT INTO events (organizer_id, name, venue, location, game_type, format, third_place, starts_at, entry_fee, prize, max_players, race_to, description, rules, stream_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ctx.user.id, text(b.name, 3, 80, 'Event name'), text(b.venue, 2, 80, 'Venue'), optText(b.location, 60),
      GAME_TYPES.includes(b.game_type) ? b.game_type : '8-ball', formatOf(b.format), flag(b.third_place),
      cleanDate(b.starts_at),
      entry_fee, int(b.prize, 0, 1e9, 'Prize', 0), int(b.max_players, 2, 128, 'Max players', 16),
      int(b.race_to, 1, 21, 'Race to', 5), optText(b.description, 1000), optText(b.rules, 2000),
      cleanUrl(b.stream_url)).lastInsertRowid);
    broadcast({ type: 'event', event_id: id });
    return get(EVENT_SQL + ' WHERE e.id = ?', id);
  });

  route('PUT', '/api/events/:id', needLogin, (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    must(canManage(ctx.user, ev.organizer_id), 'Only the organizer can change this event.', 403);
    const b = ctx.body;
    const fee = b.entry_fee === undefined ? ev.entry_fee : int(b.entry_fee, 0, 1e7, 'Entry fee');
    must(fee === 0 || isAdmin(ctx.user) || ctx.user.verified,
      'Ask an admin to verify your organizer account before posting events with an entry fee.', 403);
    const locked = ev.status !== 'open'; // once the draw is made only the blurb, rules and stream may change
    run(`UPDATE events SET name = ?, venue = ?, location = ?, game_type = ?, format = ?, third_place = ?, starts_at = ?,
         entry_fee = ?, prize = ?, max_players = ?, race_to = ?, description = ?, rules = ?, stream_url = ? WHERE id = ?`,
      b.name === undefined ? ev.name : text(b.name, 3, 80, 'Event name'),
      b.venue === undefined ? ev.venue : text(b.venue, 2, 80, 'Venue'),
      b.location === undefined ? ev.location : optText(b.location, 60),
      locked || !GAME_TYPES.includes(b.game_type) ? ev.game_type : b.game_type,
      locked || b.format === undefined ? ev.format : formatOf(b.format),
      locked ? ev.third_place : (b.third_place === undefined ? ev.third_place : flag(b.third_place)),
      locked || b.starts_at === undefined ? ev.starts_at : cleanDate(b.starts_at),
      locked ? ev.entry_fee : fee,
      b.prize === undefined ? ev.prize : int(b.prize, 0, 1e9, 'Prize'),
      locked || b.max_players === undefined ? ev.max_players : int(b.max_players, 2, 128, 'Max players'),
      locked || b.race_to === undefined ? ev.race_to : int(b.race_to, 1, 21, 'Race to'),
      b.description === undefined ? ev.description : optText(b.description, 1000),
      b.rules === undefined ? ev.rules : optText(b.rules, 2000),
      b.stream_url === undefined ? ev.stream_url : cleanUrl(b.stream_url),
      ev.id);
    broadcast({ type: 'event', event_id: ev.id });
    return get(EVENT_SQL + ' WHERE e.id = ?', ev.id);
  });

  route('POST', '/api/events/:id/register', needLogin, (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    must(ev.status === 'open', 'Registration for this event is closed.', 409);
    const p = get('SELECT id FROM players WHERE user_id = ?', ctx.user.id);
    must(p, 'Create a player profile to register for events.', 403);
    const count = get('SELECT COUNT(*) AS n FROM registrations WHERE event_id = ?', ev.id).n;
    must(count < ev.max_players, 'This event is full.', 409);
    run('INSERT OR IGNORE INTO registrations (event_id, player_id) VALUES (?, ?)', ev.id, p.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { registered: true };
  });

  route('DELETE', '/api/events/:id/register', needLogin, (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    must(ev.status === 'open', 'You can no longer withdraw after the event has started.', 409);
    const p = get('SELECT id FROM players WHERE user_id = ?', ctx.user.id);
    must(p, 'Create a player profile first.', 403);
    run('DELETE FROM registrations WHERE event_id = ? AND player_id = ?', ev.id, p.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { registered: false };
  });

  // Draw the bracket in the event's chosen format and take the event live.
  route('POST', '/api/events/:id/start', needLogin, (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    must(canManage(ctx.user, ev.organizer_id), 'Only the organizer can start this event.', 403);
    const result = startEvent(ev.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { ...result, format_label: FORMAT_LABELS[result.format] };
  });

  route('POST', '/api/events/:id/promote', needLogin, (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    must(canManage(ctx.user, ev.organizer_id), 'Only the organizer can promote this event.', 403);
    must(isAdmin(ctx.user) || ctx.user.verified, 'Ask an admin to verify your organizer account before promoting events.', 403);
    must(ev.status !== 'finished', 'Finished events cannot be promoted.', 409);
    must(!ev.promoted, 'This event is already promoted.', 409);
    run("UPDATE events SET promo_status = 'requested' WHERE id = ?", ev.id);
    return { promo_status: 'requested' };
  });

  // Every result in the event, downloadable for a spreadsheet.
  route('GET', '/api/events/:id/results.csv', (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    const rows = all(MATCH_SQL + ' WHERE m.event_id = ? AND m.bye = 0 ORDER BY m.round, m.pos', ev.id)
      .map((m) => ({
        round: m.stage === 'lb' ? 'Losers ' + (m.round - 100) : m.stage === 'gf' ? 'Grand final' : m.stage === 'third' ? 'Third place' : 'Round ' + m.round,
        table: m.table_no || '',
        p1: m.p1_name || '',
        s1: m.p1 ? m.s1 : '',
        s2: m.p2 ? m.s2 : '',
        p2: m.p2_name || '',
        winner: m.winner ? (m.winner === m.p1 ? m.p1_name : m.p2_name) : '',
        walkover: m.walkover ? 'yes' : '',
        status: m.status,
      }));
    sendRaw(ctx, 'text/csv; charset=utf-8', toCsv(rows, [
      { key: 'round', label: 'Round' }, { key: 'table', label: 'Table' },
      { key: 'p1', label: 'Player 1' }, { key: 's1', label: 'Score 1' }, { key: 's2', label: 'Score 2' },
      { key: 'p2', label: 'Player 2' }, { key: 'winner', label: 'Winner' },
      { key: 'walkover', label: 'Walkover' }, { key: 'status', label: 'Status' },
    ]), `poolhub-${slug(ev.name)}-results.csv`);
  });

  route('GET', '/api/events/:id/standings.csv', (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    const rows = leagueStandings(ev.id).map((p, i) => ({
      pos: i + 1, name: p.name, club: p.club || '', played: p.played,
      wins: p.wins, losses: p.losses, frames_for: p.frames_for, frames_against: p.frames_against,
      diff: p.diff, points: p.points, rating: p.rating,
    }));
    sendRaw(ctx, 'text/csv; charset=utf-8', toCsv(rows, [
      { key: 'pos', label: 'Pos' }, { key: 'name', label: 'Player' }, { key: 'club', label: 'Club' },
      { key: 'played', label: 'Played' }, { key: 'wins', label: 'Won' }, { key: 'losses', label: 'Lost' },
      { key: 'frames_for', label: 'Frames for' }, { key: 'frames_against', label: 'Frames against' },
      { key: 'diff', label: 'Diff' }, { key: 'points', label: 'Points' }, { key: 'rating', label: 'Rating' },
    ]), `poolhub-${slug(ev.name)}-standings.csv`);
  });

  // Adds the event to a phone or desktop calendar.
  route('GET', '/api/events/:id/calendar.ics', (ctx) => {
    const ev = get('SELECT * FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    const origin = 'http://' + (ctx.req.headers.host || 'localhost:3000');
    sendRaw(ctx, 'text/calendar; charset=utf-8', eventIcs(ev, origin), `poolhub-${slug(ev.name)}.ics`);
  });
}

const slug = (s) => String(s || 'event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'event';

module.exports = { register };
