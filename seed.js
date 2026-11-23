'use strict';
// Fills the database with demo data. Run: node seed.js   (add --reset to wipe first)
const { db, get, run, hashPassword, startEvent, startMatch, recordFrame, all } = require('./db');

if (process.argv.includes('--reset')) {
  db.exec(`DELETE FROM follows; DELETE FROM matches; DELETE FROM registrations; DELETE FROM events;
           DELETE FROM players; DELETE FROM users;`);
}
if (get('SELECT COUNT(*) AS n FROM users').n > 0) {
  console.log('Database already has data. Run "node seed.js --reset" to start over.');
  process.exit(0);
}

const PASSWORD = 'poolhub123';
const user = (name, email, role, verified = 0) =>
  Number(run('INSERT INTO users (name, email, pass, role, verified) VALUES (?, ?, ?, ?, ?)',
    name, email, hashPassword(PASSWORD), role, verified).lastInsertRowid);

user('PoolHub Owner', 'root@poolhub.test', 'superadmin', 1);
const admin = user('PoolHub Admin', 'admin@poolhub.test', 'admin', 1);
const org1 = user('Nairobi Pool League', 'league@poolhub.test', 'organizer', 1);
const org2 = user('Mombasa Cue Club', 'mombasa@poolhub.test', 'organizer', 0);
user('Demo Fan', 'fan@poolhub.test', 'fan');

const roster = [
  ['Brian Otieno', 'Nairobi', 'Westlands Cue House', '8-ball', 1420],
  ['Kevin Mwangi', 'Nairobi', 'Kasarani Pool Lounge', '8-ball', 1385],
  ['Faith Wanjiru', 'Thika', 'Blue Baize Club', '9-ball', 1350],
  ['Hassan Ali', 'Mombasa', 'Nyali Cue Club', '8-ball', 1310],
  ['Peter Kiprop', 'Eldoret', 'Rift Pool Hub', '9-ball', 1275],
  ['Mercy Achieng', 'Kisumu', 'Lakeside Cues', '8-ball', 1240],
  ['Dennis Kamau', 'Nairobi', 'Westlands Cue House', '9-ball', 1210],
  ['Amina Yusuf', 'Mombasa', 'Nyali Cue Club', '8-ball', 1180],
  ['Samuel Njoroge', 'Nakuru', 'Flamingo Pool Bar', '8-ball', 1150],
  ['Joy Chebet', 'Eldoret', 'Rift Pool Hub', '9-ball', 1120],
  ['Collins Odhiambo', 'Kisumu', 'Lakeside Cues', '8-ball', 1090],
  ['Lucy Wambui', 'Thika', 'Blue Baize Club', '8-ball', 1060],
  ['Victor Mutua', 'Machakos', 'Eastside Pool', '9-ball', 1030],
  ['Grace Naliaka', 'Nakuru', 'Flamingo Pool Bar', '8-ball', 1000],
  ['Tom Barasa', 'Kakamega', 'Western Cue Club', '8-ball', 970],
  ['Esther Moraa', 'Kisii', 'Gusii Pool Spot', '9-ball', 940],
].map(([name, location, club, game, rating], i) => {
  const uid = user(name, `player${i + 1}@poolhub.test`, 'player');
  const id = Number(run('INSERT INTO players (user_id, name, location, club, game_type, rating) VALUES (?, ?, ?, ?, ?, ?)',
    uid, name, location, club, game, rating).lastInsertRowid);
  return id;
});

const day = 864e5;
const when = (d, h = 14) => { const t = new Date(Date.now() + d * day); t.setHours(h, 0, 0, 0); return t.toISOString(); };
const event = (org, name, venue, location, game, d, fee, prize, max, race, desc, promoted = 0, stream = null, opts = {}) =>
  Number(run(`INSERT INTO events (organizer_id, name, venue, location, game_type, starts_at, entry_fee, prize, max_players, race_to, description, promoted, promo_status, stream_url, format, third_place)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    org, name, venue, location, game, when(d), fee, prize, max, race, desc, promoted, promoted ? 'approved' : 'none', stream,
    opts.format || 'knockout', opts.third_place ? 1 : 0).lastInsertRowid);
const register = (ev, ids) => ids.forEach((p) => run('INSERT INTO registrations (event_id, player_id) VALUES (?, ?)', ev, p));

// 1. Finished knockout event with a third-place play-off, played out so rankings and head-to-heads have history.
const done = event(org1, 'Westlands Open 2026', 'Westlands Cue House', 'Nairobi', '8-ball', -14, 500, 20000, 8, 4,
  'Single-elimination open. Race to 4. Rack and break rules: WPA.', 0, null, { third_place: 1 });
register(done, roster.slice(0, 8));
startEvent(done);
function playAll(eventId, pick) {
  for (let guard = 0; guard < 200; guard++) {
    const m = get("SELECT * FROM matches WHERE event_id = ? AND status = 'scheduled' ORDER BY round, pos LIMIT 1", eventId);
    if (!m) break;
    startMatch(m.id);
    const ev = get('SELECT race_to FROM events WHERE id = ?', eventId);
    const winnerSide = pick(m);
    const loserFrames = Math.max(0, ev.race_to - 1 - ((m.id + m.round) % 3));
    for (let i = 0; i < loserFrames; i++) recordFrame(m.id, winnerSide === 1 ? 2 : 1);
    for (let i = 0; i < ev.race_to; i++) recordFrame(m.id, winnerSide);
  }
}
const ratingOf = (id) => get('SELECT rating FROM players WHERE id = ?', id).rating;
playAll(done, (m) => (ratingOf(m.p1) >= ratingOf(m.p2) ? 1 : 2));

// 2. A live event, mid-tournament, with one match being scored right now.
const live = event(org1, 'Kasarani Friday Knockout', 'Kasarani Pool Lounge', 'Nairobi', '9-ball', 0, 300, 12000, 8, 5,
  'Weekly knockout night. Race to 5. Come early and watch from the rail.', 1, 'https://www.youtube.com/');
register(live, roster.slice(4, 12));
startEvent(live);
{
  const first = all("SELECT * FROM matches WHERE event_id = ? AND status = 'scheduled' ORDER BY pos", live);
  first.slice(0, 2).forEach((m) => {
    startMatch(m.id);
    for (let i = 0; i < 5; i++) recordFrame(m.id, 1);
  });
  const now = first[2];
  startMatch(now.id);
  [1, 2, 1, 1, 2, 1].forEach((side) => recordFrame(now.id, side));
  run("UPDATE matches SET table_no = 'Table 2' WHERE id = ?", now.id);
  const next = first[3];
  startMatch(next.id);
  [2, 2, 1].forEach((side) => recordFrame(next.id, side));
  run("UPDATE matches SET table_no = 'Table 1' WHERE id = ?", next.id);
}

// 3. A finished league round robin, so the standings table has something in it.
const leagueEv = event(org1, 'Nairobi Pool League: Round 4', 'Westlands Cue House', 'Nairobi', '8-ball', -7, 500, 25000, 8, 3,
  'Round robin league night. Three points for a win, one for a draw frame. Top four make the county final.', 0, null, { format: 'league' });
register(leagueEv, roster.slice(0, 6));
startEvent(leagueEv);
playAll(leagueEv, (m) => (ratingOf(m.p1) >= ratingOf(m.p2) ? 1 : 2));

// 4. A double-elimination event in progress: winners bracket, losers bracket and the grand final.
const doubleEv = event(org2, 'Mombasa Double Elimination Classic', 'Nyali Cue Club', 'Mombasa', '9-ball', 0, 800, 40000, 8, 5,
  'Lose once and you drop into the losers bracket. Lose twice and you are out.', 1, null, { format: 'double' });
register(doubleEv, roster.slice(6, 14));
startEvent(doubleEv);
all("SELECT * FROM matches WHERE event_id = ? AND stage = 'wb' AND status = 'scheduled' ORDER BY round, pos", doubleEv)
  .slice(0, 3).forEach((m, i) => {
    startMatch(m.id);
    for (let f = 0; f < 5; f++) recordFrame(m.id, i % 2 ? 2 : 1);
  });

// 5. Upcoming events open for registration.
const up1 = event(org1, 'Nairobi Pool League: Round 5', 'Westlands Cue House', 'Nairobi', '8-ball', 6, 500, 30000, 16, 5,
  'Monthly league round. Top 4 earn a place in the county final.', 1);
register(up1, roster.slice(0, 5));
const up2 = event(org2, 'Mombasa Beach Bash 9-Ball', 'Nyali Cue Club', 'Mombasa', '9-ball', 10, 0, 8000, 16, 7,
  'Free entry. Prize pool from local sponsors. Stalls and music after the final.');
register(up2, [roster[3], roster[7], roster[2]]);
event(org1, 'Thika Rookies Cup', 'Blue Baize Club', 'Thika', '8-ball', 17, 200, 5000, 32, 3,
  'Open to players under 1100 rating. Race to 3.');

console.log('Demo data created.');
console.log('Log in with any of these (password: ' + PASSWORD + '):');
console.log('  root@poolhub.test      (superadmin)');
console.log('  admin@poolhub.test     (admin)');
console.log('  league@poolhub.test    (verified organizer)');
console.log('  mombasa@poolhub.test   (organizer, not yet verified)');
console.log('  player1@poolhub.test   (player)');
console.log('  fan@poolhub.test       (fan)');
