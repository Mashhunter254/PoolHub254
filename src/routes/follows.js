'use strict';
// Follow / unfollow a player or an event.
const { get, run } = require('../../db');
const { must, int } = require('../validate');
const { needLogin } = require('../auth');

function register(route) {
  route('POST', '/api/follow', needLogin, (ctx) => {
    const kind = ctx.body.kind;
    must(kind === 'player' || kind === 'event', 'Nothing to follow.');
    const id = int(ctx.body.id, 1, 1e12, 'Id');
    must(get(`SELECT id FROM ${kind === 'player' ? 'players' : 'events'} WHERE id = ?`, id), 'Not found.', 404);
    const has = get('SELECT 1 AS x FROM follows WHERE user_id = ? AND kind = ? AND target_id = ?', ctx.user.id, kind, id);
    if (has) run('DELETE FROM follows WHERE user_id = ? AND kind = ? AND target_id = ?', ctx.user.id, kind, id);
    else run('INSERT INTO follows (user_id, kind, target_id) VALUES (?, ?, ?)', ctx.user.id, kind, id);
    return { following: !has };
  });
}

module.exports = { register };
