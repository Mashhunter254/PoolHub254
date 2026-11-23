'use strict';
// The very small HTTP toolkit: a pattern router, JSON replies, body reading and static files.
const fs = require('fs');
const path = require('path');
const { HttpError } = require('../db');

// Routes are registered as '/api/events/:id' and matched against the request pathname.
function createRouter() {
  const routes = [];

  function route(method, pattern, ...handlers) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, regex, keys, handlers });
  }

  // Tells the caller whether the path exists at all, so it can answer 405 instead of 404.
  function resolve(method, pathname) {
    let pathMatched = false;
    for (const r of routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      return { r, m, pathMatched: true };
    }
    return { r: null, m: null, pathMatched };
  }

  return { route, resolve };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.ics': 'text/calendar; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

// Handlers that return a file (CSV, ICS) park the payload on the context and the
// server writes it instead of the usual JSON envelope.
function sendRaw(ctx, type, body, filename) {
  if (filename) ctx.raw = { type, body, headers: { 'Content-Disposition': `attachment; filename="${filename}"` } };
  else ctx.raw = { type, body, headers: {} };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const MAX_BODY = 100 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Request is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { reject(new HttpError(400, 'Request body must be valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname, publicDir) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(publicDir, rel));
  if (!file.startsWith(publicDir + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

module.exports = { createRouter, sendJson, sendRaw, readBody, serveStatic, MIME, MAX_BODY };
