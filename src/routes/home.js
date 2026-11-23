'use strict';
// The home feed and the live feed that drives the ticker and the Live screen.
const { get, all, getSetting, MATCH_SQL, EVENT_SQL } = require('../../db');
const { HOUSE_RULES } = require('../constants');

function register(route) {
  route('GET', '/api/home', (ctx) => {
    const live = all(MATCH_SQL + " WHERE m.status = 'live' ORDER BY m.id DESC LIMIT 12");
    const ongoing = all(EVENT_SQL + " WHERE e.status = 'live' ORDER BY e.starts_at DESC LIMIT 10");
    const promoted = all(EVENT_SQL + " WHERE e.promoted = 1 AND e.status != 'finished' ORDER BY e.starts_at LIMIT 5");
    const vip = all(EVENT_SQL + ` WHERE e.status != 'finished' AND (e.vip = 1 OR e.promoted = 1 OR e.entry_fee > 0)
                                  ORDER BY e.vip DESC, e.promoted DESC, e.starts_at LIMIT 8`);
    const upcoming = all(EVENT_SQL + " WHERE e.status = 'open' ORDER BY e.starts_at LIMIT 30");
    const results = all(MATCH_SQL + " WHERE m.status = 'finished' AND m.bye = 0 ORDER BY m.id DESC LIMIT 10");
    const top = all('SELECT id, name, location, rating, wins, losses, titles FROM players ORDER BY rating DESC, wins DESC LIMIT 5');
    let following = null;
    if (ctx.user) {
      following = {
        events: all(EVENT_SQL + ` JOIN follows f ON f.target_id = e.id AND f.kind = 'event' AND f.user_id = ?
                                  WHERE e.status != 'finished' ORDER BY e.starts_at LIMIT 10`, ctx.user.id),
        players: all(`SELECT p.id, p.name, p.rating FROM players p JOIN follows f ON f.target_id = p.id AND f.kind = 'player'
                      WHERE f.user_id = ? ORDER BY p.rating DESC LIMIT 10`, ctx.user.id),
      };
    }
    return { live, ongoing, promoted, vip, upcoming, results, top, following, house_rules: getSetting('house_rules', HOUSE_RULES) };
  });

  // One call for everything that is happening right now: the ticker, the Live page and its counters.
  route('GET', '/api/live', () => ({
    live: all(MATCH_SQL + " WHERE m.status = 'live' AND m.bye = 0 ORDER BY m.id DESC LIMIT 20"),
    next: all(MATCH_SQL + " WHERE m.status = 'scheduled' AND m.bye = 0 AND m.p1 IS NOT NULL AND m.p2 IS NOT NULL ORDER BY m.id LIMIT 20"),
    events: all(EVENT_SQL + " WHERE e.status = 'live' ORDER BY e.starts_at DESC LIMIT 20"),
    counts: {
      live_matches: get("SELECT COUNT(*) AS n FROM matches WHERE status = 'live' AND bye = 0").n,
      live_events: get("SELECT COUNT(*) AS n FROM events WHERE status = 'live'").n,
      open_events: get("SELECT COUNT(*) AS n FROM events WHERE status = 'open'").n,
      players: get('SELECT COUNT(*) AS n FROM players').n,
      frames: get('SELECT COALESCE(SUM(s1 + s2), 0) AS n FROM matches WHERE bye = 0').n,
    },
  }));

  // The activity feed. Signed in, it follows the players and events you follow;
  // signed out it falls back to what the whole site is doing.
  route('GET', '/api/activity', (ctx) => {
    const items = [];
    let followedPlayers = [];
    let followedEvents = [];
    if (ctx.user) {
      followedPlayers = all("SELECT target_id AS id FROM follows WHERE user_id = ? AND kind = 'player'", ctx.user.id).map((r) => r.id);
      followedEvents = all("SELECT target_id AS id FROM follows WHERE user_id = ? AND kind = 'event'", ctx.user.id).map((r) => r.id);
      const own = get('SELECT id FROM players WHERE user_id = ?', ctx.user.id);
      if (own) followedPlayers.push(own.id);
    }

    if (followedPlayers.length) {
      const marks = followedPlayers.map(() => '?').join(',');
      for (const m of all(`${MATCH_SQL} WHERE m.status = 'finished' AND m.bye = 0
          AND (m.p1 IN (${marks}) OR m.p2 IN (${marks})) ORDER BY m.id DESC LIMIT 25`,
      ...followedPlayers, ...followedPlayers)) {
        items.push({
          kind: 'result', at: m.finished_at, match_id: m.id, event_id: m.event_id, event_name: m.event_name,
          p1: m.p1, p1_name: m.p1_name, p1_avatar: m.p1_avatar,
          p2: m.p2, p2_name: m.p2_name, p2_avatar: m.p2_avatar,
          s1: m.s1, s2: m.s2, winner: m.winner,
        });
      }
    }

    if (followedEvents.length) {
      const marks = followedEvents.map(() => '?').join(',');
      for (const e of all(`${EVENT_SQL} WHERE e.id IN (${marks}) ORDER BY e.starts_at DESC LIMIT 25`, ...followedEvents)) {
        items.push({
          kind: 'event', at: e.starts_at, event_id: e.id, name: e.name, venue: e.venue,
          status: e.status, game_type: e.game_type, registered: e.registered, max_players: e.max_players,
          champion: e.champion_id ? (get('SELECT name FROM players WHERE id = ?', e.champion_id) || {}).name : null,
        });
      }
    }

    if (!items.length) {
      for (const m of all(MATCH_SQL + " WHERE m.status = 'finished' AND m.bye = 0 ORDER BY m.id DESC LIMIT 15")) {
        items.push({
          kind: 'result', at: m.finished_at, match_id: m.id, event_id: m.event_id, event_name: m.event_name,
          p1: m.p1, p1_name: m.p1_name, p1_avatar: m.p1_avatar,
          p2: m.p2, p2_name: m.p2_name, p2_avatar: m.p2_avatar,
          s1: m.s1, s2: m.s2, winner: m.winner,
        });
      }
      for (const e of all(EVENT_SQL + " WHERE e.status = 'open' ORDER BY e.created_at DESC LIMIT 10")) {
        items.push({
          kind: 'event', at: e.created_at, event_id: e.id, name: e.name, venue: e.venue, status: e.status,
          game_type: e.game_type, registered: e.registered, max_players: e.max_players, champion: null,
        });
      }
    }

    const when = (v) => {
      if (!v) return 0;
      const s = String(v);
      return Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + 'Z') || 0;
    };
    items.sort((a, b) => when(b.at) - when(a.at));
    return { items: items.slice(0, 40), personalised: !!(followedPlayers.length || followedEvents.length) };
  });
}

module.exports = { register };
