'use strict';
// The games PoolHub understands. Shared by the API and the forms that post to it.
const GAME_TYPES = ['8-ball', '9-ball', '10-ball', 'snooker', 'straight pool'];

// The usual house rules every event plays by. A superadmin can edit this once;
// it shows on the home page. Organizers can still add their own per-event rules.
const HOUSE_RULES = `The rules we play by.

8-BALL
Rack your own. Break from behind the head string; if no ball reaches a cushion and none is potted, re-rack.
The table stays open until a group is legally potted — that group becomes yours.
Call your pocket on the 8. Potting it early, or in the wrong pocket, loses the frame.
Clear your group first, then pot the 8 to win the frame.

9-BALL
Always strike the lowest ball on the table first; any ball potted on a legal hit counts.
One push-out is allowed straight after the break, then play is normal.
Pot the 9 legally to win the frame — direct, combo or carom.

FOULS
Potting the cue ball, hitting the wrong ball first, no ball reaching a cushion after contact, hitting nothing at all, or touching a ball with your hand or cue.
A foul gives the opponent ball in hand — place the cue ball anywhere on the table.

THE MATCH
Matches are a race to the event's target; the first to reach it wins.
Lag or toss for the first break, then the winner breaks each frame.
League nights: three points for a win, one for a draw or a walkover.

ETIQUETTE
Rack your own, and stay still and quiet while your opponent is down on the shot.
Respect the table, the venue and your opponent.`;

module.exports = { GAME_TYPES, HOUSE_RULES };
