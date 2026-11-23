'use strict';
// Database + core tournament logic (draws, scoring, standings, ratings).
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const db = new DatabaseSync(process.env.DB_FILE || path.join(__dirname, 'poolhub.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  pass TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('fan','player','organizer','admin','superadmin')),
  verified INTEGER NOT NULL DEFAULT 0,
  banned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  user_id INTEGER UNIQUE REFERENCES users(id),
  name TEXT NOT NULL,
  location TEXT,
  club TEXT,
  game_type TEXT,
  rating INTEGER NOT NULL DEFAULT 1000,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  frames_won INTEGER NOT NULL DEFAULT 0,
  frames_lost INTEGER NOT NULL DEFAULT 0,
  titles INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  venue TEXT NOT NULL,
  location TEXT,
  game_type TEXT NOT NULL DEFAULT '8-ball',
  format TEXT NOT NULL DEFAULT 'knockout',
  starts_at TEXT NOT NULL,
  entry_fee INTEGER NOT NULL DEFAULT 0,
  prize INTEGER NOT NULL DEFAULT 0,
  max_players INTEGER NOT NULL DEFAULT 16,
  race_to INTEGER NOT NULL DEFAULT 5,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','live','finished')),
  promoted INTEGER NOT NULL DEFAULT 0,
  promo_status TEXT NOT NULL DEFAULT 'none' CHECK (promo_status IN ('none','requested','approved','denied')),
  stream_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS registrations (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, player_id)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  pos INTEGER NOT NULL,
  p1 INTEGER REFERENCES players(id),
  p2 INTEGER REFERENCES players(id),
  s1 INTEGER NOT NULL DEFAULT 0,
  s2 INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','live','finished')),
  winner INTEGER REFERENCES players(id),
  bye INTEGER NOT NULL DEFAULT 0,
  rating_delta INTEGER,
  table_no TEXT,
  stream_url TEXT,
  UNIQUE (event_id, round, pos)
);
CREATE TABLE IF NOT EXISTS follows (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('player','event')),
  target_id INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, target_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, starts_at);
CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id, round, pos);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_comments_match ON comments(match_id, id);
`);

const get = (sql, ...args) => db.prepare(sql).get(...args);
const all = (sql, ...args) => db.prepare(sql).all(...args);
const run = (sql, ...args) => db.prepare(sql).run(...args);

// Site-wide key/value settings (house rules and the like), editable by a superadmin.
const getSetting = (key, fallback = null) => {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
};
const setSetting = (key, value) => run(
  `INSERT INTO settings (key, value) VALUES (?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, String(value ?? ''));

// SQLite has no "ADD COLUMN IF NOT EXISTS", so older files are upgraded by hand.
function addColumn(table, column, definition) {
  if (all(`PRAGMA table_info(${table})`).some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumn('users', 'avatar', 'TEXT');
addColumn('users', 'banned', 'INTEGER NOT NULL DEFAULT 0');
addColumn('players', 'avatar', 'TEXT');
addColumn('events', 'third_place', 'INTEGER NOT NULL DEFAULT 0');
addColumn('events', 'rounds', 'INTEGER');
addColumn('events', 'entry_size', 'INTEGER');
addColumn('events', 'champion_id', 'INTEGER REFERENCES players(id)');
addColumn('events', 'vip', 'INTEGER NOT NULL DEFAULT 0');
addColumn('events', 'rules', 'TEXT');
addColumn('matches', 'stage', "TEXT NOT NULL DEFAULT 'wb'");
addColumn('matches', 'walkover', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'finished_at', 'TEXT');

// Files created before the superadmin role carry a narrower CHECK constraint, and
// SQLite cannot drop one in place — so the users table is rebuilt once, in place.
const usersTable = get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'");
if (usersTable && !usersTable.sql.includes('superadmin')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`CREATE TABLE users_rebuild (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      pass TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('fan','player','organizer','admin','superadmin')),
      verified INTEGER NOT NULL DEFAULT 0,
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      avatar TEXT
    )`);
    db.exec(`INSERT INTO users_rebuild (id, name, email, phone, pass, role, verified, banned, created_at, avatar)
             SELECT id, name, email, phone, pass, role, verified, banned, created_at, avatar FROM users`);
    db.exec('DROP TABLE users');
    db.exec('ALTER TABLE users_rebuild RENAME TO users');
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
  const broken = all('PRAGMA foreign_key_check');
  if (broken.length) throw new Error('users rebuild broke foreign keys: ' + JSON.stringify(broken));
}

function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// ---------- passwords ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
}
function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// ---------- shared SQL ----------
const MATCH_SQL = `
SELECT m.*, e.name AS event_name, e.race_to, e.stream_url AS event_stream, e.organizer_id,
       e.game_type, e.venue, e.format AS event_format,
       a.name AS p1_name, a.rating AS p1_rating, COALESCE(ua.avatar, a.avatar) AS p1_avatar,
       b.name AS p2_name, b.rating AS p2_rating, COALESCE(ub.avatar, b.avatar) AS p2_avatar
FROM matches m
JOIN events e ON e.id = m.event_id
LEFT JOIN players a ON a.id = m.p1
LEFT JOIN players b ON b.id = m.p2
LEFT JOIN users ua ON ua.id = a.user_id
LEFT JOIN users ub ON ub.id = b.user_id`;

// Events joined with their organizer and live registration count.
const EVENT_SQL = `
SELECT e.*, u.name AS organizer_name, u.verified AS organizer_verified,
       (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS registered
FROM events e JOIN users u ON u.id = e.organizer_id`;

const getMatch = (id) => get(MATCH_SQL + ' WHERE m.id = ?', id);

// ---------- bracket vocabulary ----------
// Losers-bracket rounds are stored offset so the (event, round, pos) uniqueness still holds.
const STAGE = { WB: 'wb', LB: 'lb', GF: 'gf', THIRD: 'third' };
const LB_BASE = 100;
const GF_ROUND = 2000;
const THIRD_ROUND = 2001;
const lbRoundsFor = (k) => Math.max(1, 2 * k - 2);

// ---------- low level helpers ----------
function newMatch(eventId, stage, round, pos, status = 'pending') {
  return Number(run('INSERT INTO matches (event_id, stage, round, pos, status) VALUES (?, ?, ?, ?, ?)',
    eventId, stage, round, pos, status).lastInsertRowid);
}

const slotOf = (pos) => (pos % 2 === 0 ? 'p1' : 'p2');

// Drop a player into a slot and promote the match to "scheduled" once both are known.
function fill(matchId, column, playerId) {
  run(`UPDATE matches SET ${column} = ? WHERE id = ?`, playerId, matchId);
  const m = get('SELECT * FROM matches WHERE id = ?', matchId);
  if (m.p1 && m.p2 && m.status === 'pending') run("UPDATE matches SET status = 'scheduled' WHERE id = ?", matchId);
  return m;
}

const findMatch = (eventId, stage, round, pos) =>
  get('SELECT * FROM matches WHERE event_id = ? AND stage = ? AND round = ? AND pos = ?', eventId, stage, round, pos);

const roundDone = (eventId, stage, round) =>
  get("SELECT COUNT(*) AS n FROM matches WHERE event_id = ? AND stage = ? AND round = ? AND status != 'finished'",
    eventId, stage, round).n === 0;

function setSlot(eventId, stage, round, pos, column, playerId) {
  const t = findMatch(eventId, stage, round, pos);
  if (t) fill(t.id, column, playerId);
}

function crown(eventId, winnerId) {
  run("UPDATE events SET status = 'finished', champion_id = ? WHERE id = ?", winnerId, eventId);
  if (winnerId) run('UPDATE players SET titles = titles + 1 WHERE id = ?', winnerId);
}

// ---------- draws ----------
// Standard seeding so the top seeds meet as late as possible and get the byes.
function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

const bracketSize = (count) => { let s = 2; while (s < count) s *= 2; return s; };

// Knockout: a single-elimination ladder, with byes when the field is not a power of two.
function buildKnockout(ev, players) {
  const size = bracketSize(players.length);
  const rounds = Math.log2(size);
  const ids = {};
  for (let r = 1; r <= rounds; r++) {
    for (let i = 0; i < size / 2 ** r; i++) ids[`${r}-${i}`] = newMatch(ev.id, STAGE.WB, r, i);
  }
  const slots = seedOrder(size).map((seed) => players[seed - 1] || null);
  for (let i = 0; i < size / 2; i++) {
    const a = slots[2 * i];
    const b = slots[2 * i + 1];
    const id = ids[`1-${i}`];
    if (a && b) {
      run("UPDATE matches SET p1 = ?, p2 = ?, status = 'scheduled' WHERE id = ?", a.id, b.id, id);
    } else {
      const w = a || b;
      run("UPDATE matches SET p1 = ?, p2 = ?, status = 'finished', winner = ?, bye = 1 WHERE id = ?",
        a ? a.id : null, b ? b.id : null, w.id, id);
      if (rounds > 1) setSlot(ev.id, STAGE.WB, 2, Math.floor(i / 2), slotOf(i), w.id);
    }
  }
  return { format: 'knockout', rounds, size };
}

// League: everyone plays everyone once (circle method), so the table decides it.
function buildLeague(ev, players) {
  const pool = players.map((p) => p.id);
  if (pool.length % 2) pool.push(null); // a phantom player gives somebody the bye each round
  const rounds = pool.length - 1;
  const half = pool.length / 2;
  let rest = pool.slice(1);
  for (let r = 0; r < rounds; r++) {
    const field = [pool[0], ...rest];
    let pos = 0;
    for (let i = 0; i < half; i++) {
      const a = field[i];
      const b = field[field.length - 1 - i];
      if (!a || !b) continue;
      const id = newMatch(ev.id, STAGE.WB, r + 1, pos++, 'scheduled');
      run('UPDATE matches SET p1 = ?, p2 = ? WHERE id = ?', a, b, id);
    }
    rest = [rest[rest.length - 1], ...rest.slice(0, -1)];
  }
  return { format: 'league', rounds, size: players.length };
}

// Double elimination: a winners bracket, a losers bracket shaped by it, then one grand final.
function buildDouble(ev, players) {
  const size = bracketSize(players.length);
  const k = Math.log2(size);
  const lb = lbRoundsFor(k);
  const ids = {};
  for (let r = 1; r <= k; r++) {
    for (let i = 0; i < size / 2 ** r; i++) ids[`${r}-${i}`] = newMatch(ev.id, STAGE.WB, r, i);
  }
  for (let j = 1; j <= lb; j++) {
    const count = Math.max(1, size / 2 ** (Math.ceil(j / 2) + 1));
    for (let i = 0; i < count; i++) newMatch(ev.id, STAGE.LB, LB_BASE + j, i);
  }
  newMatch(ev.id, STAGE.GF, GF_ROUND, 0);

  const slots = seedOrder(size).map((seed) => players[seed - 1] || null);
  for (let i = 0; i < size / 2; i++) {
    const a = slots[2 * i];
    const b = slots[2 * i + 1];
    const id = ids[`1-${i}`];
    if (a && b) {
      run("UPDATE matches SET p1 = ?, p2 = ?, status = 'scheduled' WHERE id = ?", a.id, b.id, id);
    } else {
      const w = a || b;
      run("UPDATE matches SET p1 = ?, p2 = ?, status = 'finished', winner = ?, bye = 1 WHERE id = ?",
        a ? a.id : null, b ? b.id : null, w.id, id);
      routeWbWinner(ev.id, k, 1, i, w.id); // a bye produces no loser to drop down
    }
  }
  return { format: 'double', rounds: k, size };
}

// ---------- routing between rounds ----------
function routeWbWinner(eventId, k, round, pos, winnerId) {
  if (round < k) setSlot(eventId, STAGE.WB, round + 1, Math.floor(pos / 2), slotOf(pos), winnerId);
  else setSlot(eventId, STAGE.GF, GF_ROUND, 0, 'p1', winnerId);
}

// A losers-bracket match is settled once every feeder round has finished, so byes
// caused by empty feeder slots can be spotted and walked through.
function lbRoundReady(eventId, j) {
  if (j === 1) return roundDone(eventId, STAGE.WB, 1);
  if (j % 2 === 1) return roundDone(eventId, STAGE.LB, LB_BASE + j - 1);
  return roundDone(eventId, STAGE.WB, j / 2 + 1);
}

function advanceLb(eventId, k, j, pos, winnerId) {
  const lb = lbRoundsFor(k);
  if (j >= lb) return setSlot(eventId, STAGE.GF, GF_ROUND, 0, 'p2', winnerId);
  const next = j + 1;
  const column = j % 2 === 1 ? 'p1' : slotOf(pos);
  const nextPos = j % 2 === 1 ? pos : Math.floor(pos / 2);
  setSlot(eventId, STAGE.LB, LB_BASE + next, nextPos, column, winnerId);
}

function resolveLbRound(eventId, k, j) {
  let changed = false;
  const ms = all('SELECT * FROM matches WHERE event_id = ? AND stage = ? AND round = ? ORDER BY pos',
    eventId, STAGE.LB, LB_BASE + j);
  for (const m of ms) {
    if (m.status !== 'pending') continue;
    changed = true;
    if (m.p1 && m.p2) {
      run("UPDATE matches SET status = 'scheduled' WHERE id = ?", m.id);
      continue;
    }
    const w = m.p1 || m.p2;
    run("UPDATE matches SET status = 'finished', winner = ?, bye = 1 WHERE id = ?", w, m.id);
    if (w) advanceLb(eventId, k, j, m.pos, w);
  }
  return changed;
}

// Settle every losers round whose feeders are complete, cascading where they chain.
function progressLb(eventId, k) {
  const lb = lbRoundsFor(k);
  for (let pass = 0; pass <= lb; pass++) {
    let changed = false;
    for (let j = 1; j <= lb; j++) if (lbRoundReady(eventId, j) && resolveLbRound(eventId, k, j)) changed = true;
    if (!changed) return;
  }
}

// ---------- third place playoff ----------
function placeThird(eventId, loserId) {
  let t = get('SELECT * FROM matches WHERE event_id = ? AND stage = ?', eventId, STAGE.THIRD);
  if (!t) {
    newMatch(eventId, STAGE.THIRD, THIRD_ROUND, 0);
    t = get('SELECT * FROM matches WHERE event_id = ? AND stage = ?', eventId, STAGE.THIRD);
  }
  fill(t.id, t.p1 ? 'p2' : 'p1', loserId);
}

// If only one player ever reached the playoff, they take third by default.
// When both semi-final losers made it, the playoff still has to be played.
function settleThird(eventId) {
  const t = get("SELECT * FROM matches WHERE event_id = ? AND stage = ? AND status != 'finished'", eventId, STAGE.THIRD);
  if (!t) return;
  if (t.p1 && t.p2) return;
  const w = t.p1 || t.p2;
  if (w) run("UPDATE matches SET status = 'finished', winner = ?, bye = 1 WHERE id = ?", w, t.id);
  else run('DELETE FROM matches WHERE id = ?', t.id);
}

// ---------- league standings ----------
function leagueStandings(eventId) {
  const rows = new Map(all(
    `SELECT p.id, p.name, p.club, p.rating, COALESCE(u.avatar, p.avatar) AS avatar
     FROM registrations r JOIN players p ON p.id = r.player_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE r.event_id = ?`, eventId
  ).map((p) => [p.id, { ...p, played: 0, wins: 0, losses: 0, frames_for: 0, frames_against: 0, points: 0 }]));
  const ms = all(
    `SELECT p1, p2, s1, s2, winner FROM matches
     WHERE event_id = ? AND status = 'finished' AND bye = 0 AND p1 IS NOT NULL AND p2 IS NOT NULL`, eventId);
  for (const m of ms) {
    const a = rows.get(m.p1);
    const b = rows.get(m.p2);
    if (!a || !b) continue;
    a.played++;
    b.played++;
    a.frames_for += m.s1;
    a.frames_against += m.s2;
    b.frames_for += m.s2;
    b.frames_against += m.s1;
    if (m.winner === m.p1) { a.wins++; a.points += 3; b.losses++; } else { b.wins++; b.points += 3; a.losses++; }
  }
  return [...rows.values()]
    .map((p) => ({ ...p, diff: p.frames_for - p.frames_against }))
    .sort((a, b) => b.points - a.points || b.diff - a.diff || b.frames_for - a.frames_for || b.rating - a.rating);
}

const leagueDone = (eventId) =>
  get("SELECT COUNT(*) AS n FROM matches WHERE event_id = ? AND status != 'finished'", eventId).n === 0;

// ---------- starting an event ----------
function startEvent(eventId) {
  return tx(() => {
    const ev = get('SELECT * FROM events WHERE id = ?', eventId);
    if (!ev) throw new HttpError(404, 'Event not found.');
    if (ev.status !== 'open') throw new HttpError(409, 'The draw for this event has already been made.');
    const players = all(
      `SELECT p.id, p.rating FROM registrations r JOIN players p ON p.id = r.player_id
       WHERE r.event_id = ? ORDER BY p.rating DESC, p.id`, eventId);
    if (players.length < 2) throw new HttpError(400, 'At least 2 registered players are needed to start the event.');
    const format = ['league', 'double'].includes(ev.format) ? ev.format : 'knockout';
    const info = format === 'league' ? buildLeague(ev, players)
      : format === 'double' ? buildDouble(ev, players)
        : buildKnockout({ ...ev, id: eventId }, players);
    run("UPDATE events SET status = 'live', format = ?, rounds = ?, entry_size = ? WHERE id = ?",
      format, info.rounds, info.size, eventId);
    return { ...info, players: players.length };
  });
}

// ---------- scoring ----------
function finishMatch(m, s1, s2) {
  const winner = s1 > s2 ? m.p1 : m.p2;
  const loser = winner === m.p1 ? m.p2 : m.p1;
  const winnerFrames = winner === m.p1 ? s1 : s2;
  const loserFrames = winner === m.p1 ? s2 : s1;

  // The third-place playoff is a dead rubber, so it never moves ratings.
  if (m.stage === STAGE.THIRD) {
    run("UPDATE matches SET status = 'finished', winner = ?, finished_at = datetime('now') WHERE id = ?", winner, m.id);
    return;
  }

  const w = get('SELECT rating FROM players WHERE id = ?', winner);
  const l = get('SELECT rating FROM players WHERE id = ?', loser);
  const expected = 1 / (1 + 10 ** ((l.rating - w.rating) / 400));
  const delta = Math.max(1, Math.round(32 * (1 - expected)));

  run("UPDATE matches SET status = 'finished', winner = ?, rating_delta = ?, finished_at = datetime('now') WHERE id = ?",
    winner, delta, m.id);
  run('UPDATE players SET rating = rating + ?, wins = wins + 1, frames_won = frames_won + ?, frames_lost = frames_lost + ? WHERE id = ?',
    delta, winnerFrames, loserFrames, winner);
  run('UPDATE players SET rating = rating - ?, losses = losses + 1, frames_won = frames_won + ?, frames_lost = frames_lost + ? WHERE id = ?',
    delta, loserFrames, winnerFrames, loser);

  const ev = get('SELECT * FROM events WHERE id = ?', m.event_id);
  const k = ev.rounds || 0;

  if (ev.format === 'league') {
    if (leagueDone(m.event_id)) crown(m.event_id, leagueStandings(m.event_id)[0]?.id || null);
    return;
  }

  if (ev.format === 'double') {
    if (m.stage === STAGE.WB) {
      routeWbWinner(m.event_id, k, m.round, m.pos, winner);
      // The loser drops into the losers bracket, which may then cascade byes.
      const j = m.round === 1 ? 1 : 2 * (m.round - 1);
      const pos = m.round === 1 ? Math.floor(m.pos / 2) : m.pos;
      const column = m.round === 1 ? slotOf(m.pos) : 'p2';
      setSlot(m.event_id, STAGE.LB, LB_BASE + j, pos, column, loser);
    } else if (m.stage === STAGE.LB) {
      advanceLb(m.event_id, k, m.round - LB_BASE, m.pos, winner);
    } else if (m.stage === STAGE.GF) {
      crown(m.event_id, winner);
    }
    progressLb(m.event_id, k);
    return;
  }

  // Knockout
  if (m.round < k) setSlot(m.event_id, STAGE.WB, m.round + 1, Math.floor(m.pos / 2), slotOf(m.pos), winner);
  else crown(m.event_id, winner);
  if (ev.third_place && m.round === k - 1 && loser) placeThird(m.event_id, loser);
  if (m.round === k) settleThird(m.event_id);
}

function startMatch(matchId) {
  return tx(() => {
    const m = getMatch(matchId);
    if (!m) throw new HttpError(404, 'Match not found.');
    if (m.status === 'finished') throw new HttpError(409, 'This match is finished.');
    if (!m.p1 || !m.p2) throw new HttpError(409, 'Both players must be known before the match can start.');
    run("UPDATE matches SET status = 'live' WHERE id = ?", matchId);
    return getMatch(matchId);
  });
}

// side: 1 or 2. delta: +1 (frame won) or -1 (undo). The match ends when someone reaches race_to.
function recordFrame(matchId, side, delta = 1) {
  return tx(() => {
    const m = getMatch(matchId);
    if (!m) throw new HttpError(404, 'Match not found.');
    if (m.status === 'finished') throw new HttpError(409, 'This match is finished.');
    if (!m.p1 || !m.p2) throw new HttpError(409, 'Both players must be known before scoring.');
    let { s1, s2 } = m;
    const clamp = (v) => Math.max(0, Math.min(m.race_to, v));
    if (side === 1) s1 = clamp(s1 + delta); else s2 = clamp(s2 + delta);
    run("UPDATE matches SET s1 = ?, s2 = ?, status = 'live' WHERE id = ?", s1, s2, matchId);
    if (s1 >= m.race_to || s2 >= m.race_to) finishMatch(getMatch(matchId), s1, s2);
    return getMatch(matchId);
  });
}

// Hand the match to one side: the score lands on race_to, the other side stays on nil.
function walkover(matchId, side) {
  return tx(() => {
    const m = getMatch(matchId);
    if (!m) throw new HttpError(404, 'Match not found.');
    if (m.status === 'finished') throw new HttpError(409, 'This match is already finished.');
    if (!m.p1 || !m.p2) throw new HttpError(409, 'Both players must be known before a walkover can be given.');
    const s1 = side === 1 ? m.race_to : 0;
    const s2 = side === 2 ? m.race_to : 0;
    run("UPDATE matches SET s1 = ?, s2 = ?, walkover = 1, status = 'live' WHERE id = ?", s1, s2, matchId);
    finishMatch(getMatch(matchId), s1, s2);
    return getMatch(matchId);
  });
}

module.exports = {
  db, get, all, run, tx, HttpError, getSetting, setSetting,
  hashPassword, checkPassword,
  MATCH_SQL, EVENT_SQL, getMatch, startEvent, startMatch, recordFrame, walkover,
  leagueStandings, STAGE, LB_BASE, GF_ROUND, THIRD_ROUND,
};
