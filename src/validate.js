'use strict';
// Input guards. Everything that arrives from a browser lands here first.
const { HttpError } = require('../db');

const must = (cond, msg, status = 400) => { if (!cond) throw new HttpError(status, msg); };

const text = (v, min, max, label) => {
  const s = String(v ?? '').trim();
  must(s.length >= min && s.length <= max, `${label} must be ${min}-${max} characters.`);
  return s;
};

const optText = (v, max) => {
  const s = String(v ?? '').trim();
  must(s.length <= max, `Text is too long (max ${max} characters).`);
  return s || null;
};

const int = (v, min, max, label, fallback) => {
  if (v === undefined || v === null || v === '') {
    must(fallback !== undefined, `${label} is required.`);
    return fallback;
  }
  const n = Number(v);
  must(Number.isInteger(n) && n >= min && n <= max, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
};

function cleanUrl(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let u;
  try { u = new URL(s); } catch { throw new HttpError(400, 'Enter a full link starting with https://'); }
  must(u.protocol === 'https:' || u.protocol === 'http:', 'Enter a full link starting with https://');
  return u.toString();
}

function cleanDate(v) {
  const d = new Date(v);
  must(!Number.isNaN(d.getTime()), 'Enter a valid start date and time.');
  return d.toISOString();
}

function cleanEmail(v) {
  const email = String(v ?? '').trim().toLowerCase();
  must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'Enter a valid email address.');
  return email;
}

// Avatars arrive as a small inline image (the browser shrinks them first), so
// there is no upload endpoint and no files to clean up.
const AVATAR_MAX = 90 * 1024;
function cleanAvatar(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  must(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s), 'Pick an image file (PNG, JPEG, WebP or GIF).');
  must(s.length <= AVATAR_MAX, 'That image is too large — try a smaller one.');
  return s;
}

module.exports = { must, text, optText, int, cleanUrl, cleanDate, cleanEmail, cleanAvatar };
