'use strict';
// Server-Sent Events fan-out. Every screen that is open gets pushed frame changes.

const clients = new Set();

function broadcast(message) {
  const data = `data: ${JSON.stringify(message)}\n\n`;
  for (const c of clients) c.write(data);
}

// Keeps the response open and registers it until the browser goes away.
function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// Comment frames keep proxies from closing an idle stream.
function heartbeat(ms = 25000) {
  return setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, ms).unref();
}

module.exports = { broadcast, subscribe, heartbeat, clients };
