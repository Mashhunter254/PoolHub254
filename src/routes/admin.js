'use strict';
// Admin desk: verify organizers and approve or deny promotion requests.
const { get, all, run, EVENT_SQL } = require('../../db');
const { must } = require('../validate');
const { needRole } = require('../auth');
const { broadcast } = require('../live');

function register(route) {
  route('GET', '/api/admin/overview', needRole('admin'), () => ({
    organizers: all("SELECT id, name, email, phone, verified, created_at FROM users WHERE role = 'organizer' ORDER BY verified, id DESC"),
    promotions: all(EVENT_SQL + " WHERE e.promo_status = 'requested' ORDER BY e.starts_at"),
    vipEvents: all(EVENT_SQL + " WHERE e.status != 'finished' ORDER BY e.vip DESC, e.starts_at LIMIT 30"),
    counts: {
      users: get('SELECT COUNT(*) AS n FROM users').n,
      players: get('SELECT COUNT(*) AS n FROM players').n,
      events: get('SELECT COUNT(*) AS n FROM events').n,
      matches: get("SELECT COUNT(*) AS n FROM matches WHERE bye = 0").n,
    },
  }));

  route('POST', '/api/admin/organizers/:id/verify', needRole('admin'), (ctx) => {
    const u = get("SELECT id FROM users WHERE id = ? AND role = 'organizer'", ctx.params.id);
    must(u, 'Organizer not found.', 404);
    run('UPDATE users SET verified = ? WHERE id = ?', ctx.body.verified === false ? 0 : 1, u.id);
    return { ok: true };
  });

  route('POST', '/api/admin/events/:id/promotion', needRole('admin'), (ctx) => {
    const ev = get('SELECT id FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    const approve = ctx.body.approve !== false;
    run('UPDATE events SET promoted = ?, promo_status = ? WHERE id = ?', approve ? 1 : 0, approve ? 'approved' : 'denied', ev.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { ok: true };
  });

  route('POST', '/api/admin/events/:id/vip', needRole('admin'), (ctx) => {
    const ev = get('SELECT id FROM events WHERE id = ?', ctx.params.id);
    must(ev, 'Event not found.', 404);
    run('UPDATE events SET vip = ? WHERE id = ?', ctx.body.vip === false ? 0 : 1, ev.id);
    broadcast({ type: 'event', event_id: ev.id });
    return { ok: true };
  });
}

module.exports = { register };
