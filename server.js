'use strict';
// PoolHub: the HTTP server. Routes live in src/routes/*, data access in db.js.
// Uses only Node built-ins (Node 22.5+), so there is nothing to install.
const http = require('http');
const path = require('path');
const { get, HttpError } = require('./db');
const { createRouter, sendJson, readBody, serveStatic } = require('./src/http');
const { readToken, pruneLoginFailures, WINDOW } = require('./src/auth');
const share = require('./src/share');
const live = require('./src/live');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const { route, resolve } = createRouter();

for (const name of ['auth', 'home', 'events', 'matches', 'players', 'follows', 'admin', 'superadmin']) {
  require('./src/routes/' + name).register(route);
}

live.heartbeat(25000);
setInterval(pruneLoginFailures, WINDOW).unref();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  try {
    if (pathname === '/api/stream' && req.method === 'GET') return live.subscribe(req, res);
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      const origin = 'http://' + (req.headers.host || 'localhost:' + PORT);
      if (share.handle(req, res, pathname, origin)) return;
      return serveStatic(req, res, pathname, PUBLIC_DIR);
    }

    const found = resolve(req.method, pathname);
    if (!found.r) {
      return sendJson(res, found.pathMatched ? 405 : 404, { error: found.pathMatched ? 'Method not allowed.' : 'Not found.' });
    }

    const ctx = {
      req, res,
      ip: req.socket.remoteAddress || 'unknown',
      params: Object.fromEntries(found.r.keys.map((k, i) => [k, decodeURIComponent(found.m[i + 1])])),
      query: Object.fromEntries(url.searchParams),
      body: ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {},
      user: null,
    };
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) {
      const p = readToken(header.slice(7));
      if (p) ctx.user = get('SELECT id, name, email, phone, role, verified, banned, avatar FROM users WHERE id = ?', p.uid) || null;
    }

    let result;
    for (const h of found.r.handlers) {
      const out = h(ctx);
      if (out !== undefined) result = out;
    }
    // Downloads (CSV, ICS) replace the JSON envelope with the file itself.
    if (ctx.raw) {
      res.writeHead(200, { 'Content-Type': ctx.raw.type, 'Cache-Control': 'no-store', ...ctx.raw.headers });
      return res.end(ctx.raw.body);
    }
    sendJson(res, 200, result === undefined ? { ok: true } : result);
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
    console.error(err);
    sendJson(res, 500, { error: 'Something went wrong on our side. Try again.' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`PoolHub running at http://localhost:${PORT}`));
}
module.exports = { server };
