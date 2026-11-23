'use strict';
// The live score strip that sits under the header on every page.
import { api } from './api.js';
import { esc } from './ui.js';

const box = document.getElementById('ticker');
const track = document.getElementById('ticker-track');

export async function refreshTicker() {
  let d;
  try { d = await api('/live'); } catch { return; }
  if (!d.live.length) {
    box.hidden = true;
    track.innerHTML = '';
    return;
  }
  const items = d.live.map((m) => `<a class="ticker-item" href="#/match/${m.id}">
    <span>${esc(m.p1_name || 'TBD')}</span><b>${m.s1}</b>
    <span class="sep">–</span><b>${m.s2}</b><span>${esc(m.p2_name || 'TBD')}</span>
    <span class="sep">·</span><span>${esc(m.event_name)}</span>
  </a>`).join('');
  // Printed twice so the marquee can loop without jumping back.
  track.innerHTML = items + items;
  box.hidden = false;
}
