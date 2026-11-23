'use strict';
// Signed-in sessions: signed tokens, roles, and failed-login throttling.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HttpError } = require('../db');

// The signing key lives in .secret so logins survive a restart.
function loadSecret() {
  if (process.env.SECRET) return process.env.SECRET;
  const file = path.join(__dirname, '..', '.secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(file, s, { mode: 0o600 });
    return s;
  }
}
const SECRET = loadSecret();
const TOKEN_DAYS = 30;

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readToken(token) {
  const [body, sig] = String(token).split('.');
  if (!body || !sig) return null;
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

const newToken = (uid) => signToken({ uid, exp: Date.now() + TOKEN_DAYS * 864e5 });
const publicUser = (u) => ({
  id: u.id, name: u.name, email: u.email, phone: u.phone || null,
  role: u.role, verified: !!u.verified, banned: !!u.banned, avatar: u.avatar || null,
});
const canManage = (user, ownerId) => user && (user.role === 'admin' || user.role === 'superadmin' || user.id === ownerId);
// True for the platform staff tiers, so route checks stay in one place.
const isAdmin = (user) => !!user && (user.role === 'admin' || user.role === 'superadmin');

const needLogin = (ctx) => {
  if (!ctx.user) throw new HttpError(401, 'Log in to continue.');
  if (ctx.user.banned) throw new HttpError(403, 'This account has been suspended. Contact an administrator.');
};
const needRole = (...roles) => (ctx) => {
  needLogin(ctx);
  // A superadmin clears every admin gate.
  if (roles.includes(ctx.user.role)) return;
  if (roles.includes('admin') && ctx.user.role === 'superadmin') return;
  throw new HttpError(403, 'You do not have access to this.');
};

// Only failed logins count, per account + address, so a shared Wi-Fi does not lock everyone out.
const failedLogins = new Map();
const WINDOW = 15 * 60 * 1000;

function recentFails(key) {
  const now = Date.now();
  const list = (failedLogins.get(key) || []).filter((t) => now - t < WINDOW);
  failedLogins.set(key, list);
  return list;
}
function checkLoginAllowed(key) {
  if (recentFails(key).length >= 8) throw new HttpError(429, 'Too many failed attempts. Try again in 15 minutes.');
}
function noteLoginFailure(key) { recentFails(key).push(Date.now()); }
function clearLoginFailures(key) { failedLogins.delete(key); }
function pruneLoginFailures() {
  for (const k of [...failedLogins.keys()]) if (!recentFails(k).length) failedLogins.delete(k);
}

module.exports = {
  signToken, readToken, newToken, publicUser, canManage, isAdmin,
  needLogin, needRole,
  checkLoginAllowed, noteLoginFailure, clearLoginFailures, pruneLoginFailures,
  WINDOW,
};
