'use strict';
// Share links. Crawlers do not run JavaScript and never see the hash router, so
// /e/12, /p/4 and /m/9 answer with a tiny page that carries Open Graph tags and
// then bounces real visitors into the app.
const { get, EVENT_SQL, MATCH_SQL } = require('../db');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Short readable date for the preview text; the exact wording is not important.
const dateLabel = (iso) => new Date(iso).toLocaleString('en-KE', {
  weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Nairobi',
});

// A themed hero image keeps every shared link looking like a real listing.
function ogImage(kind, seed) {
  const prompts = {
    event: 'dramatic dark billiards hall, overhead view of a pool table with green felt, glowing cue balls, moody sports photography',
    player: 'pool player chalking a cue in a dark billiards hall, dramatic rim lighting, sports portrait',
    match: 'close up of a pool table rack with two balls, dramatic side lighting, dark background, sports photography',
    organizer: 'busy billiards club interior with rows of pool tables under warm spotlights, wide shot',
  };
  const prompt = encodeURIComponent(prompts[kind] || prompts.event);
  return `https://coresg-normal.trae.ai/api/ide/v1/text_to_image?prompt=${prompt}&image_size=landscape_4_3&seed=${seed}`;
}

function page({ title, description, image, target }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · PoolHub</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="PoolHub">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<link rel="canonical" href="${esc(target)}">
<meta http-equiv="refresh" content="0;url=${esc(target)}">
<style>
body{margin:0;background:#070b14;color:#e8eefc;font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh}
main{max-width:34rem;padding:2rem;text-align:center}
h1{font-size:1.5rem;margin:0 0 .5rem}p{color:#93a1bd}
a{display:inline-block;margin-top:1rem;padding:.7rem 1.2rem;border-radius:999px;background:#00e5c0;color:#04241a;font-weight:700;text-decoration:none}
img{width:100%;border-radius:1rem;margin-bottom:1.25rem}
</style>
</head>
<body>
<main>
<img src="${esc(image)}" alt="">
<h1>${esc(title)}</h1>
<p>${esc(description)}</p>
<a href="${esc(target)}">Open in PoolHub</a>
</main>
<script>location.replace(${JSON.stringify(target)});</script>
</body>
</html>`;
}

// Returns true when the path was a share link and a page has been written.
function handle(req, res, pathname, origin) {
  const shape = [
    [/^\/e\/(\d+)\/?$/, 'event'],
    [/^\/p\/(\d+)\/?$/, 'player'],
    [/^\/m\/(\d+)\/?$/, 'match'],
    [/^\/o\/(\d+)\/?$/, 'organizer'],
  ];
  for (const [re, kind] of shape) {
    const m = re.exec(pathname);
    if (!m) continue;
    const info = describe(kind, Number(m[1]), origin);
    if (!info) return false;
    const body = page({ ...info, image: ogImage(kind, m[1]) });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
    return true;
  }
  return false;
}

function describe(kind, id, origin) {
  if (kind === 'event') {
    const ev = get(EVENT_SQL + ' WHERE e.id = ?', id);
    if (!ev) return null;
    const when = dateLabel(ev.starts_at);
    return {
      title: `${ev.name} — ${ev.game_type} at ${ev.venue}`,
      description: `${when}. ${ev.registered}/${ev.max_players} registered · ${ev.status === 'finished' ? 'finished' : ev.status === 'live' ? 'live now' : 'open for entries'}${ev.entry_fee > 0 ? ` · entry KES ${ev.entry_fee}` : ' · free entry'}.`,
      target: `${origin}/#/event/${ev.id}`,
    };
  }
  if (kind === 'player') {
    const p = get('SELECT * FROM players WHERE id = ?', id);
    if (!p) return null;
    return {
      title: `${p.name} — rating ${p.rating}`,
      description: `${[p.club, p.location].filter(Boolean).join(', ') || 'Pool player'} · ${p.wins}W ${p.losses}L · ${p.titles} titles.`,
      target: `${origin}/#/player/${p.id}`,
    };
  }
  if (kind === 'match') {
    const mt = get(MATCH_SQL + ' WHERE m.id = ?', id);
    if (!mt) return null;
    return {
      title: `${mt.p1_name || 'TBD'} vs ${mt.p2_name || 'TBD'} — ${mt.event_name}`,
      description: `${mt.status === 'live' ? `Live ${mt.s1}-${mt.s2}` : mt.status === 'finished' ? `Finished ${mt.s1}-${mt.s2}` : 'Upcoming'} · race to ${mt.race_to}.`,
      target: `${origin}/#/match/${mt.id}`,
    };
  }
  const u = get("SELECT id, name, verified FROM users WHERE id = ? AND role = 'organizer'", id);
  if (!u) return null;
  const events = get("SELECT COUNT(*) AS n FROM events WHERE organizer_id = ? AND status != 'finished'", u.id).n;
  return {
    title: `${u.name} on PoolHub`,
    description: `Verified tournament organiser${events ? ` with ${events} event${events === 1 ? '' : 's'} running` : ''}.`,
    target: `${origin}/#/organizer/${u.id}`,
  };
}

module.exports = { handle, ogImage };
