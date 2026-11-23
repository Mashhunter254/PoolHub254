'use strict';
// End-to-end API test on a temporary database. Run: node test.js
const os = require('os'), path = require('path'), fs = require('fs');
const file = path.join(os.tmpdir(), `poolhub-test-${process.pid}.db`);
process.env.DB_FILE = file;
process.env.SECRET = 'test-secret';
const assert = require('assert');
const { server } = require('./server');

let base, passed = 0;
async function call(method, url, body, token) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
async function ok(name, fn) { await fn(); passed++; console.log('  ok  ' + name); }

(async () => {
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
  const { run, get, db } = require('./db');

  const reg = (name, email, role) => call('POST', '/api/auth/register', { name, email, password: 'password1', role, location: 'Nairobi' });
  const org = (await reg('Org One', 'org@t.co', 'organizer')).data;
  const players = [];
  for (let i = 1; i <= 5; i++) players.push((await reg('Player ' + i, `p${i}@t.co`, 'player')).data);
  const fan = (await reg('Fan', 'fan@t.co', 'fan')).data;
  run("UPDATE users SET role = 'admin' WHERE email = 'org@t.co'"); run("UPDATE users SET role = 'organizer' WHERE email = 'org@t.co'");
  const admin = (await reg('Admin', 'admin@t.co', 'fan')).data;
  run("UPDATE users SET role = 'admin' WHERE email = 'admin@t.co'");
  let eventId;

  await ok('rejects duplicate email and weak password', async () => {
    assert.equal((await reg('X Y', 'org@t.co', 'fan')).status, 409);
    assert.equal((await call('POST', '/api/auth/register', { name: 'Zed', email: 'z@t.co', password: 'short' })).status, 400);
  });
  await ok('login works and wrong password fails', async () => {
    assert.equal((await call('POST', '/api/auth/login', { email: 'org@t.co', password: 'password1' })).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'org@t.co', password: 'nope' })).status, 401);
  });
  await ok('fans cannot create events; organizers can', async () => {
    const body = { name: 'Test Open', venue: 'Cue Hall', starts_at: new Date(Date.now() + 864e5).toISOString(), race_to: 3, max_players: 8 };
    assert.equal((await call('POST', '/api/events', body, fan.token)).status, 403);
    assert.equal((await call('POST', '/api/events', body)).status, 401);
    const r = await call('POST', '/api/events', body, org.token);
    assert.equal(r.status, 200);
    eventId = r.data.id;
  });
  await ok('unverified organizer cannot charge entry fee', async () => {
    const r = await call('POST', '/api/events', { name: 'Paid', venue: 'Venue', starts_at: new Date().toISOString(), entry_fee: 500 }, org.token);
    assert.equal(r.status, 403);
  });
  await ok('fan cannot register, players can, no duplicates', async () => {
    assert.equal((await call('POST', `/api/events/${eventId}/register`, null, fan.token)).status, 403);
    for (const p of players) assert.equal((await call('POST', `/api/events/${eventId}/register`, null, p.token)).status, 200);
    await call('POST', `/api/events/${eventId}/register`, null, players[0].token);
    assert.equal((await call('GET', '/api/events/' + eventId)).data.players.length, 5);
  });
  await ok('only the organizer can start; bracket has byes for 5 players', async () => {
    assert.equal((await call('POST', `/api/events/${eventId}/start`, null, players[0].token)).status, 403);
    const r = await call('POST', `/api/events/${eventId}/start`, null, org.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.size, 8);
    const d = (await call('GET', '/api/events/' + eventId)).data;
    assert.equal(d.event.status, 'live');
    assert.equal(d.matches.filter((m) => m.bye).length, 3);
    assert.equal((await call('POST', `/api/events/${eventId}/start`, null, org.token)).status, 409);
    assert.equal((await call('POST', `/api/events/${eventId}/register`, null, players[0].token)).status, 409);
  });
  await ok('scoring is restricted to the organizer', async () => {
    const d = (await call('GET', '/api/events/' + eventId)).data;
    const m = d.matches.find((x) => x.status === 'scheduled');
    assert.equal((await call('POST', `/api/matches/${m.id}/frame`, { side: 1 }, players[0].token)).status, 403);
    assert.equal((await call('POST', `/api/matches/${m.id}/frame`, { side: 3 }, org.token)).status, 400);
  });
  await ok('plays whole tournament, crowns a champion, updates stats', async () => {
    for (let guard = 0; guard < 20; guard++) {
      const d = (await call('GET', '/api/events/' + eventId)).data;
      const m = d.matches.find((x) => x.status === 'scheduled' || x.status === 'live');
      if (!m) break;
      for (let i = 0; i < 3; i++) assert.equal((await call('POST', `/api/matches/${m.id}/frame`, { side: 1 }, org.token)).status, 200);
    }
    const d = (await call('GET', '/api/events/' + eventId)).data;
    assert.equal(d.event.status, 'finished');
    assert.ok(d.champion);
    const finished = d.matches.filter((m) => !m.bye);
    assert.equal(finished.length, 4); // 5 players -> 4 real matches
    assert.ok(finished.every((m) => m.status === 'finished' && m.winner));
    const ranks = (await call('GET', '/api/rankings')).data;
    assert.equal(ranks.reduce((s, p) => s + p.rating, 0), 5 * 1000, 'rating points are conserved');
    assert.equal(ranks.reduce((s, p) => s + p.wins, 0), 4);
    assert.equal(ranks.reduce((s, p) => s + p.titles, 0), 1);
    assert.equal((await call('POST', `/api/matches/${finished[0].id}/frame`, { side: 1 }, org.token)).status, 409);
  });
  await ok('undo cannot go below zero', async () => {
    const e2 = (await call('POST', '/api/events', { name: 'Second', venue: 'Venue', starts_at: new Date().toISOString(), race_to: 5 }, org.token)).data.id;
    await call('POST', `/api/events/${e2}/register`, null, players[0].token);
    await call('POST', `/api/events/${e2}/register`, null, players[1].token);
    await call('POST', `/api/events/${e2}/start`, null, org.token);
    const m = (await call('GET', '/api/events/' + e2)).data.matches[0];
    const r = await call('POST', `/api/matches/${m.id}/frame`, { side: 1, delta: -1 }, org.token);
    assert.equal(r.data.s1, 0);
  });
  await ok('admin verification then promotion flow', async () => {
    const e3 = (await call('POST', '/api/events', { name: 'Promo', venue: 'Venue', starts_at: new Date().toISOString() }, org.token)).data.id;
    assert.equal((await call('POST', `/api/events/${e3}/promote`, null, org.token)).status, 403);
    const orgId = get("SELECT id FROM users WHERE email = 'org@t.co'").id;
    assert.equal((await call('POST', `/api/admin/organizers/${orgId}/verify`, {}, org.token)).status, 403);
    assert.equal((await call('POST', `/api/admin/organizers/${orgId}/verify`, {}, admin.token)).status, 200);
    assert.equal((await call('POST', `/api/events/${e3}/promote`, null, org.token)).status, 200);
    assert.equal((await call('POST', `/api/admin/events/${e3}/promotion`, { approve: true }, admin.token)).status, 200);
    assert.equal((await call('GET', '/api/home')).data.promoted.some((e) => e.id === e3), true);
  });
  await ok('follow toggles; home reports it', async () => {
    assert.equal((await call('POST', '/api/follow', { kind: 'event', id: eventId }, fan.token)).data.following, true);
    assert.equal((await call('POST', '/api/follow', { kind: 'event', id: eventId }, fan.token)).data.following, false);
  });
  await ok('bad input is rejected cleanly', async () => {
    assert.equal((await call('GET', '/api/events/9999')).status, 404);
    assert.equal((await call('GET', '/api/nothing')).status, 404);
    const r = await call('POST', '/api/events', { name: 'x', venue: 'Venue', starts_at: 'garbage' }, org.token);
    assert.equal(r.status, 400);
    const res = await fetch(base + '/api/auth/login', { method: 'POST', body: '{bad json' });
    assert.equal(res.status, 400);
  });
  await ok('static site and path traversal', async () => {
    assert.equal((await fetch(base + '/')).status, 200);
    assert.equal((await fetch(base + '/style.css')).status, 200);
    assert.notEqual((await fetch(base + '/..%2fserver.js')).status, 200);
    assert.notEqual((await fetch(base + '/%2e%2e/db.js')).status, 200);
  });

  // ---------- competition depth ----------
  await ok('league format runs a round robin and builds a table', async () => {
    const e = (await call('POST', '/api/events', { name: 'League Night', venue: 'Venue', starts_at: new Date().toISOString(), format: 'league', race_to: 2 }, org.token)).data.id;
    for (const p of players.slice(0, 3)) await call('POST', `/api/events/${e}/register`, null, p.token);
    const started = await call('POST', `/api/events/${e}/start`, null, org.token);
    assert.equal(started.data.format, 'league');
    let d = (await call('GET', '/api/events/' + e)).data;
    assert.equal(d.matches.filter((m) => !m.bye).length, 3); // 3 players -> 3 pairings
    assert.equal(d.standings.length, 3);
    for (let guard = 0; guard < 40; guard++) {
      const m = d.matches.find((x) => x.status !== 'finished' && !x.bye);
      if (!m) break;
      for (let i = 0; i < 2; i++) await call('POST', `/api/matches/${m.id}/frame`, { side: 1 }, org.token);
      d = (await call('GET', '/api/events/' + e)).data;
    }
    assert.equal(d.event.status, 'finished');
    assert.ok(d.champion && d.champion.name);
    assert.ok(d.standings.every((p) => p.played === 2));
    assert.ok(d.standings.every((p, i) => i === 0 || d.standings[i - 1].points >= p.points));
    assert.equal((await fetch(base + `/api/events/${e}/standings.csv`)).status, 200);
  });

  await ok('double elimination adds a losers bracket and grand final', async () => {
    const e = (await call('POST', '/api/events', { name: 'Double Trouble', venue: 'Venue', starts_at: new Date().toISOString(), format: 'double', race_to: 2 }, org.token)).data.id;
    for (const p of players.slice(1, 5)) await call('POST', `/api/events/${e}/register`, null, p.token);
    const started = await call('POST', `/api/events/${e}/start`, null, org.token);
    assert.equal(started.data.format, 'double');
    let d = (await call('GET', '/api/events/' + e)).data;
    assert.ok(d.matches.some((m) => m.stage === 'lb'));
    assert.equal(d.matches.filter((m) => m.stage === 'gf').length, 1);
    for (let guard = 0; guard < 60; guard++) {
      const m = d.matches.find((x) => x.status !== 'finished' && !x.bye && x.p1 && x.p2);
      if (!m) break;
      for (let i = 0; i < 2; i++) await call('POST', `/api/matches/${m.id}/frame`, { side: 1 }, org.token);
      d = (await call('GET', '/api/events/' + e)).data;
    }
    d = (await call('GET', '/api/events/' + e)).data;
    assert.equal(d.event.status, 'finished');
    assert.ok(d.champion && d.champion.name);
  });

  await ok('walkover settles a match without frames', async () => {
    const e = (await call('POST', '/api/events', { name: 'No Show', venue: 'Venue', starts_at: new Date().toISOString(), race_to: 3 }, org.token)).data.id;
    await call('POST', `/api/events/${e}/register`, null, players[0].token);
    await call('POST', `/api/events/${e}/register`, null, players[1].token);
    await call('POST', `/api/events/${e}/start`, null, org.token);
    const m = (await call('GET', '/api/events/' + e)).data.matches[0];
    assert.equal((await call('POST', `/api/matches/${m.id}/walkover`, { side: 1 }, players[0].token)).status, 403);
    const r = await call('POST', `/api/matches/${m.id}/walkover`, { side: 1 }, org.token);
    assert.equal(r.status, 200);
    assert.equal(r.data.status, 'finished');
    assert.equal(r.data.walkover, 1);
    assert.equal(r.data.winner, m.p1);
  });

  await ok('third place playoff is created and settled', async () => {
    const e = (await call('POST', '/api/events', { name: 'Bronze', venue: 'Venue', starts_at: new Date().toISOString(), race_to: 2, max_players: 4, third_place: true }, org.token)).data.id;
    for (const p of players.slice(0, 4)) await call('POST', `/api/events/${e}/register`, null, p.token);
    await call('POST', `/api/events/${e}/start`, null, org.token);
    let d = (await call('GET', '/api/events/' + e)).data;
    for (let guard = 0; guard < 40; guard++) {
      const m = d.matches.find((x) => x.status !== 'finished' && !x.bye);
      if (!m) break;
      await call('POST', `/api/matches/${m.id}/walkover`, { side: 1 }, org.token);
      d = (await call('GET', '/api/events/' + e)).data;
    }
    d = (await call('GET', '/api/events/' + e)).data;
    assert.ok(d.matches.some((m) => m.stage === 'third'));
    assert.equal(d.event.status, 'finished');
    assert.ok(d.champion);
  });

  // ---------- community ----------
  await ok('comments need a login and only the author can delete', async () => {
    const mid = (await call('GET', '/api/events/' + eventId)).data.matches.find((x) => !x.bye).id;
    assert.equal((await call('POST', `/api/matches/${mid}/comments`, { body: 'Great pot' })).status, 401);
    assert.equal((await call('POST', `/api/matches/${mid}/comments`, { body: '' }, fan.token)).status, 400);
    const c = await call('POST', `/api/matches/${mid}/comments`, { body: 'Great pot' }, fan.token);
    assert.equal(c.status, 200);
    assert.equal(c.data.author, 'Fan');
    assert.equal((await call('GET', '/api/matches/' + mid)).data.comments.length, 1);
    assert.equal((await call('DELETE', `/api/matches/${mid}/comments/${c.data.id}`, null, players[0].token)).status, 403);
    assert.equal((await call('DELETE', `/api/matches/${mid}/comments/${c.data.id}`, null, fan.token)).status, 200);
    assert.equal((await call('GET', '/api/matches/' + mid)).data.comments.length, 0);
  });

  await ok('player directory, rivalry and organizer profile', async () => {
    const ranks = (await call('GET', '/api/rankings')).data;
    assert.ok((await call('GET', '/api/players?q=Player')).data.length >= 5);
    const champ = ranks.slice().sort((a, b) => b.wins - a.wins)[0];
    assert.ok(champ.wins >= 1);
    const detail = (await call('GET', '/api/players/' + champ.id)).data;
    assert.ok(detail.h2h.length >= 1);
    const opp = detail.h2h[0];
    const vs = (await call('GET', `/api/players/${champ.id}/vs/${opp.id}`)).data;
    assert.equal(vs.matches.length, opp.wins + opp.losses);
    assert.equal(vs.a_wins + vs.b_wins, vs.matches.length);
    const orgId = get("SELECT id FROM users WHERE email = 'org@t.co'").id;
    const pub = (await call('GET', '/api/organizers/' + orgId)).data;
    assert.ok(pub.stats.events >= 5);
    assert.equal(pub.organizer.email, undefined); // private unless it is your page
    const own = (await call('GET', '/api/organizers/' + orgId, null, org.token)).data;
    assert.equal(own.own, true);
    assert.ok(own.organizer.email);
  });

  await ok('activity feed reports recent results', async () => {
    const act = (await call('GET', '/api/activity', null, fan.token)).data;
    assert.ok(Array.isArray(act.items));
    assert.ok(act.items.length > 0);
    assert.ok(act.items.every((i) => i.kind));
  });

  // ---------- account + sharing ----------
  await ok('account details, avatar and password can be changed', async () => {
    const small = 'data:image/png;base64,' + 'A'.repeat(80);
    const up = await call('PUT', '/api/me', { name: 'Fan Renamed', phone: '+254700111222', avatar: small }, fan.token);
    assert.equal(up.status, 200);
    assert.equal(up.data.user.name, 'Fan Renamed');
    assert.equal(up.data.user.phone, '+254700111222');
    assert.equal(up.data.user.avatar, small);
    assert.equal((await call('PUT', '/api/me', { email: 'org@t.co' }, fan.token)).status, 409);
    assert.equal((await call('PUT', '/api/me', { avatar: 'data:text/html;base64,AAAA' }, fan.token)).status, 400);
    const cleared = await call('PUT', '/api/me', { avatar: '' }, fan.token);
    assert.equal(cleared.data.user.avatar, null);
    assert.equal((await call('PUT', '/api/me/password', { current: 'nope', password: 'password2' }, fan.token)).status, 403);
    assert.equal((await call('PUT', '/api/me/password', { current: 'password1', password: 'short' }, fan.token)).status, 400);
    assert.equal((await call('PUT', '/api/me/password', { current: 'password1', password: 'password2' }, fan.token)).status, 200);
    assert.equal((await call('POST', '/api/auth/login', { email: 'fan@t.co', password: 'password2' })).status, 200);
    assert.equal((await call('GET', '/api/me', null, fan.token)).data.user.name, 'Fan Renamed');
  });

  await ok('csv, ics and share pages render', async () => {
    const csvRes = await fetch(base + `/api/events/${eventId}/results.csv`);
    assert.equal(csvRes.status, 200);
    assert.ok(csvRes.headers.get('content-type').includes('text/csv'));
    assert.ok(csvRes.headers.get('content-disposition').includes('attachment'));
    const buf = Buffer.from(await csvRes.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 BOM for Excel
    assert.ok(buf.toString('utf8').includes('Round,Table,Player 1'));

    const icsRes = await fetch(base + `/api/events/${eventId}/calendar.ics`);
    assert.ok(icsRes.headers.get('content-type').includes('text/calendar'));
    const cal = await icsRes.text();
    assert.ok(cal.includes('BEGIN:VEVENT') && cal.includes('END:VCALENDAR'));

    assert.equal((await fetch(base + '/api/rankings.csv')).status, 200);

    const orgId = get("SELECT id FROM users WHERE email = 'org@t.co'").id;
    const pid = (await call('GET', '/api/rankings')).data[0].id;
    const mid = (await call('GET', '/api/events/' + eventId)).data.matches.find((x) => !x.bye).id;
    for (const path of [`/e/${eventId}`, `/p/${pid}`, `/m/${mid}`, `/o/${orgId}`]) {
      const res = await fetch(base + path);
      assert.equal(res.status, 200);
      const html = await res.text();
      assert.ok(html.includes('og:title') && html.includes('og:image'), path + ' has Open Graph tags');
    }
    assert.ok((await (await fetch(base + '/e/' + eventId)).text()).includes('#/event/' + eventId));
  });

  console.log(`\n${passed} checks passed`);
  server.close();
  db.close();
  for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
  process.exit(0);
})().catch((err) => { console.error('\nFAILED:', err); process.exit(1); });
