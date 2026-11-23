'use strict';
// File exports: CSV tables and an .ics calendar entry. Kept apart from the routes
// so the same escaping is used by rankings, results and the bracket.

const BOM = '\ufeff';

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

// rows: array of objects. columns: [{ key, label }] so the header is human readable.
function toCsv(rows, columns) {
  const head = columns.map((c) => cell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(',')).join('\r\n');
  return BOM + head + '\r\n' + body + '\r\n';
}

// Escapes the characters iCalendar treats as structure.
const icsText = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const icsStamp = (v) => {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

// Folds long lines at 75 octets, as the spec requires.
function fold(line) {
  let out = '';
  let rest = line;
  while (rest.length > 73) {
    out += rest.slice(0, 73) + '\r\n ';
    rest = rest.slice(73);
  }
  return out + rest;
}

// One all-day-ish calendar entry for an event, defaulting to a four hour session.
function eventIcs(ev, baseUrl) {
  const start = icsStamp(ev.starts_at);
  if (!start) return null;
  const end = icsStamp(new Date(new Date(ev.starts_at).getTime() + 4 * 3600 * 1000));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PoolHub//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:poolhub-event-${ev.id}@poolhub`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsText(ev.name)}`,
    `LOCATION:${icsText([ev.venue, ev.location].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText([
      ev.game_type,
      ev.race_to ? `Race to ${ev.race_to}` : '',
      ev.entry_fee > 0 ? `Entry KES ${ev.entry_fee}` : 'Free entry',
      ev.prize > 0 ? `Prize KES ${ev.prize}` : '',
      ev.description || '',
    ].filter(Boolean).join(' · '))}`,
    `URL:${baseUrl}/e/${ev.id}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { toCsv, eventIcs, icsStamp };
