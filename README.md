# PoolHub (Phase 1)

Events, brackets, live scores, player profiles, rankings, organizer tools and
promoted events for pool. The website works on phone and desktop.

## Run it
Needs Node.js 22.5 or newer (https://nodejs.org). Nothing else to install.

    node seed.js      # optional: fills in demo players, events and a live match
    node server.js    # then open http://localhost:3000

Demo logins (password `poolhub123`):
- admin@poolhub.test: admin (verify organizers, approve promotions)
- league@poolhub.test: verified organizer (can score matches, charge fees)
- mombasa@poolhub.test: organizer not yet verified (free events only)
- player1@poolhub.test: player
- fan@poolhub.test: fan

Reset demo data: `node seed.js --reset`. Run the automated checks: `node test.js`.

## What is in it
- Home: live matches, featured events, upcoming events, top players, results
- Events: search and filter, event page, registration, bracket, stream embed
- Live scoring: the organizer taps +1 frame and every open screen updates
- Players: profile, rating (Elo-style), win rate, frames, head-to-head
- Organizers: post and edit events, draw the bracket (byes for odd numbers), request promotion
- Admin: verify organizers, approve or deny promotion requests

## Files
- server.js: API and web server
- db.js: database (SQLite), bracket, scoring and rating logic
- public/: the website (index.html, style.css, app.js)
- seed.js, test.js: demo data and automated checks

## Before real use
- Set a SECRET environment variable and run behind HTTPS (for example Caddy or nginx)
- Entry fees and promotion are recorded, not charged. Add M-Pesa (Daraja)
  STK push on registration and on ad purchase as the next step
- Streaming is link-based: YouTube links embed, other links open in a new tab
- Back up poolhub.db regularly
- This is the web app. A mobile app can reuse the same API (Flutter or
  React Native), or you can wrap the site as an installable app first
