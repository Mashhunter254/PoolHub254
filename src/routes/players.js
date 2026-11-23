'use strict';
// Player search, one player's record, head-to-head, organizer profiles and rankings.
const { get, all, run, MATCH_SQL, EVENT_SQL } = require('../../db');
const { must, cleanAvatar } = require('../validate');
const { needLogin, canManage } = require('../auth');
const { sendRaw } = require('../http');
const { toCsv } = require('../exports');

// The account photo is the player's own choice, so it wins; a card with no account
// behind it (added by an organizer) falls back to the photo kept on the card.
const PLAYER_SQL = `SELECT p.*, u.avatar AS acct_avatar, u.verified AS verified
FROM players p LEFT JOIN users u ON u.id = p.user_id`;
const shape = (p) => { if (p) { p.avatar = p.acct_avatar || p.avatar || null; delete p.acct_avatar; } return p; };

function register(route) {
  route('GET', '/api/players', (ctx) => {
    const args = [];
    let where = '';
    if (ctx.query.q) {
      where = 'WHERE p.name LIKE ? OR p.location LIKE ? OR p.club LIKE ?';
      const like = `%${String(ctx.query.q).slice(0, 60)}%`;
      args.push(like, like, like);
    }
    return all(`${PLAYER_SQL} ${where} ORDER BY p.rating DESC, p.wins DESC LIMIT 200`, ...args).map(shape);
  });

  route('GET', '/api/players/:id', (ctx) => {
    const player = shape(get(PLAYER_SQL + ' WHERE p.id = ?', ctx.params.id));
    must(player, 'Player not found.', 404);
    const rank = get('SELECT COUNT(*) + 1 AS r FROM players WHERE rating > ?', player.rating).r;
    const recent = all(MATCH_SQL + " WHERE (m.p1 = ? OR m.p2 = ?) AND m.status = 'finished' AND m.bye = 0 ORDER BY m.id DESC LIMIT 15",
      player.id, player.id);
    const upcoming = all(
      `${EVENT_SQL} JOIN registrations r ON r.event_id = e.id AND r.player_id = ?
       WHERE e.status != 'finished' ORDER BY e.starts_at`, player.id);
    const played = all("SELECT p1, p2, winner FROM matches WHERE status = 'finished' AND bye = 0 AND (p1 = ? OR p2 = ?)", player.id, player.id);
    const records = new Map();
    for (const m of played) {
      const opp = m.p1 === player.id ? m.p2 : m.p1;
      const r = records.get(opp) || { id: opp, wins: 0, losses: 0 };
      if (m.winner === player.id) r.wins++; else r.losses++;
      records.set(opp, r);
    }
    const h2h = [...records.values()]
      .sort((a, b) => (b.wins + b.losses) - (a.wins + a.losses)).slice(0, 8)
      .map((r) => ({ ...r, ...get('SELECT p.name, COALESCE(u.avatar, p.avatar) AS avatar FROM players p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?', r.id) }));
    const following = ctx.user
      ? !!get("SELECT 1 AS x FROM follows WHERE user_id = ? AND kind = 'player' AND target_id = ?", ctx.user.id, player.id) : false;
    const own = !!(ctx.user && player.user_id === ctx.user.id);
    delete player.user_id;
    return { player, rank, recent, upcoming, h2h, following, own };
  });

  // Everything the two of them have played against each other.
  route('GET', '/api/players/:id/vs/:opp', (ctx) => {
    const sides = `SELECT p.id, p.name, p.rating, p.club, p.location, COALESCE(u.avatar, p.avatar) AS avatar
      FROM players p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?`;
    const a = get(sides, ctx.params.id);
    const b = get(sides, ctx.params.opp);
    must(a && b, 'Player not found.', 404);
    const matches = all(
      `${MATCH_SQL} WHERE m.bye = 0 AND m.status = 'finished'
       AND ((m.p1 = ? AND m.p2 = ?) OR (m.p1 = ? AND m.p2 = ?)) ORDER BY m.id DESC LIMIT 50`,
      a.id, b.id, b.id, a.id);
    const a_wins = matches.filter((m) => m.winner === a.id).length;
    return { a, b, matches, a_wins, b_wins: matches.length - a_wins };
  });

  route('GET', '/api/rankings', () => all(
    `SELECT p.id, p.name, p.location, p.club, p.rating, p.wins, p.losses, p.frames_won, p.frames_lost, p.titles,
            COALESCE(u.avatar, p.avatar) AS avatar
     FROM players p LEFT JOIN users u ON u.id = p.user_id
     ORDER BY p.rating DESC, p.wins DESC LIMIT 200`));

  // The player's own photo, or one an organizer/admin adds for a card with no account.
  route('PUT', '/api/players/:id/avatar', needLogin, (ctx) => {
    const p = get('SELECT id, user_id FROM players WHERE id = ?', ctx.params.id);
    must(p, 'Player not found.', 404);
    const runsTheirEvent = !!get(
      `SELECT 1 AS x FROM registrations r JOIN events e ON e.id = r.event_id
       WHERE r.player_id = ? AND e.organizer_id = ?`, p.id, ctx.user.id);
    must(ctx.user.id === p.user_id || runsTheirEvent || canManage(ctx.user, 0), 'You cannot change this photo.', 403);
    must(ctx.body.avatar !== undefined, 'Pick an image first.');
    const avatar = cleanAvatar(ctx.body.avatar);
    run('UPDATE players SET avatar = ? WHERE id = ?', avatar, p.id);
    return { ok: true, avatar };
  });

  route('GET', '/api/rankings.csv', (ctx) => {
    const rows = all(
      `SELECT p.name, p.club, p.location, p.rating, p.wins, p.losses, p.frames_won, p.frames_lost, p.titles
       FROM players p ORDER BY p.rating DESC, p.wins DESC LIMIT 200`)
      .map((p, i) => ({
        pos: i + 1, ...p,
        win_pct: p.wins + p.losses ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0,
      }));
    sendRaw(ctx, 'text/csv; charset=utf-8', toCsv(rows, [
      { key: 'pos', label: 'Rank' }, { key: 'name', label: 'Player' }, { key: 'club', label: 'Club' },
      { key: 'location', label: 'Location' }, { key: 'rating', label: 'Rating' },
      { key: 'wins', label: 'Won' }, { key: 'losses', label: 'Lost' }, { key: 'win_pct', label: 'Win %' },
      { key: 'frames_won', label: 'Frames won' }, { key: 'frames_lost', label: 'Frames lost' },
      { key: 'titles', label: 'Titles' },
    ]), 'poolhub-rankings.csv');
  });

  // An organizer's public page: who they are and what they run.
  route('GET', '/api/organizers/:id', (ctx) => {
    const u = get("SELECT id, name, verified, avatar, created_at FROM users WHERE id = ? AND role IN ('organizer','admin')", ctx.params.id);
    must(u, 'Organizer not found.', 404);
    const events = all(EVENT_SQL + ' WHERE e.organizer_id = ? ORDER BY e.starts_at DESC LIMIT 60', u.id);
    const stats = {
      events: get('SELECT COUNT(*) AS n FROM events WHERE organizer_id = ?', u.id).n,
      live: get("SELECT COUNT(*) AS n FROM events WHERE organizer_id = ? AND status = 'live'", u.id).n,
      finished: get("SELECT COUNT(*) AS n FROM events WHERE organizer_id = ? AND status = 'finished'", u.id).n,
      players: get('SELECT COUNT(DISTINCT r.player_id) AS n FROM registrations r JOIN events e ON e.id = r.event_id WHERE e.organizer_id = ?', u.id).n,
      prize_pool: get('SELECT COALESCE(SUM(prize), 0) AS n FROM events WHERE organizer_id = ?', u.id).n,
      champions: all('SELECT DISTINCT champion_id FROM events WHERE organizer_id = ? AND champion_id IS NOT NULL', u.id).length,
    };
    const own = !!(ctx.user && ctx.user.id === u.id);
    if (own) {
      const full = get('SELECT email, phone FROM users WHERE id = ?', u.id);
      u.email = full.email;
      u.phone = full.phone;
    }
    return { organizer: u, events, stats, own };
  });
}

module.exports = { register };
