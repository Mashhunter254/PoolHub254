'use strict';
// A single match: the scoreboard, live scoring from the organizer's phone, the
// comment thread and the table/stream details.
const { get, all, run, getMatch, startMatch, recordFrame, walkover, HttpError } = require('../../db');
const { must, text, optText, int, cleanUrl } = require('../validate');
const { needLogin, canManage, isAdmin } = require('../auth');
const { broadcast } = require('../live');

const COMMENT_SQL = `
SELECT c.id, c.body, c.created_at, c.user_id, u.name AS author, u.avatar AS author_avatar
FROM comments c JOIN users u ON u.id = c.user_id WHERE c.match_id = ? ORDER BY c.id`;

function register(route) {
  route('GET', '/api/matches/:id', (ctx) => {
    const match = getMatch(ctx.params.id);
    must(match, 'Match not found.', 404);
    let h2h = null;
    if (match.p1 && match.p2) {
      const rows = all(
        `SELECT winner FROM matches WHERE status = 'finished' AND bye = 0 AND id != ?
         AND ((p1 = ? AND p2 = ?) OR (p1 = ? AND p2 = ?))`, match.id, match.p1, match.p2, match.p2, match.p1);
      h2h = {
        p1_wins: rows.filter((r) => r.winner === match.p1).length,
        p2_wins: rows.filter((r) => r.winner === match.p2).length,
      };
    }
    const can_manage = !!(ctx.user && canManage(ctx.user, match.organizer_id));
    return { match, h2h, can_manage, comments: all(COMMENT_SQL, match.id) };
  });

  route('POST', '/api/matches/:id/start', (ctx) => {
    const m = manage(ctx);
    const updated = startMatch(m.id);
    broadcast({ type: 'match', match_id: m.id, event_id: m.event_id });
    return updated;
  });

  route('POST', '/api/matches/:id/frame', (ctx) => {
    const m = manage(ctx);
    const side = int(ctx.body.side, 1, 2, 'Side');
    const delta = int(ctx.body.delta, -1, 1, 'Change', 1);
    must(delta !== 0, 'Change must be +1 or -1.');
    const updated = recordFrame(m.id, side, delta);
    broadcast({ type: 'match', match_id: m.id, event_id: m.event_id });
    return updated;
  });

  // Award the match to one side — a no-show, a forfeit or a withdrawal.
  route('POST', '/api/matches/:id/walkover', (ctx) => {
    const m = manage(ctx);
    const side = int(ctx.body.side, 1, 2, 'Side');
    const updated = walkover(m.id, side);
    broadcast({ type: 'match', match_id: m.id, event_id: m.event_id });
    return updated;
  });

  route('PUT', '/api/matches/:id', (ctx) => {
    const m = manage(ctx);
    const table = ctx.body.table_no === undefined ? m.table_no : optText(ctx.body.table_no, 20);
    const stream = ctx.body.stream_url === undefined ? m.stream_url : cleanUrl(ctx.body.stream_url);
    run('UPDATE matches SET table_no = ?, stream_url = ? WHERE id = ?', table, stream, m.id);
    broadcast({ type: 'match', match_id: m.id, event_id: m.event_id });
    return getMatch(m.id);
  });

  // ---------- comments ----------
  route('GET', '/api/matches/:id/comments', (ctx) => {
    const m = get('SELECT id FROM matches WHERE id = ?', ctx.params.id);
    must(m, 'Match not found.', 404);
    return all(COMMENT_SQL, m.id);
  });

  route('POST', '/api/matches/:id/comments', needLogin, (ctx) => {
    const m = get('SELECT id FROM matches WHERE id = ?', ctx.params.id);
    must(m, 'Match not found.', 404);
    const body = text(ctx.body.body, 1, 500, 'Comment');
    const id = Number(run('INSERT INTO comments (match_id, user_id, body) VALUES (?, ?, ?)', m.id, ctx.user.id, body).lastInsertRowid);
    const saved = all(COMMENT_SQL, m.id).find((c) => c.id === id);
    broadcast({ type: 'comment', match_id: m.id });
    return saved;
  });

  route('DELETE', '/api/matches/:id/comments/:cid', needLogin, (ctx) => {
    const c = get('SELECT * FROM comments WHERE id = ? AND match_id = ?', ctx.params.cid, ctx.params.id);
    must(c, 'Comment not found.', 404);
    if (c.user_id !== ctx.user.id && !isAdmin(ctx.user)) {
      throw new HttpError(403, 'You can only delete your own comments.');
    }
    run('DELETE FROM comments WHERE id = ?', c.id);
    broadcast({ type: 'comment', match_id: c.match_id });
    return { deleted: true };
  });
}

// Only the organizer who owns the event (or platform staff) may touch a match.
function manage(ctx) {
  needLogin(ctx);
  const m = getMatch(ctx.params.id);
  must(m, 'Match not found.', 404);
  must(canManage(ctx.user, m.organizer_id), 'Only the organizer can score this match.', 403);
  return m;
}

module.exports = { register };
