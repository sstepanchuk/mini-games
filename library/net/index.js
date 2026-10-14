// Rooms for up to 8 players. No server of our own: players meet through public MQTT brokers
// (internet rooms: what goes there is sealed with a key from the room's code, seal.js) or by showing each other a
// code (nearby rooms, no internet), and play over a direct
// WebRTC link whenever one works. Both kinds of room have the same API (room.js, newRoom: the room object); what
// games see of it is the library's (app/together.js), see README.md ("Game API").
import { loadTransport } from './brokers.js';

export { hasInternet } from './brokers.js';
export { joinRoom } from './internet.js';
export { joinNearby } from './nearby.js';
// TIMING: how long the room waits, ms (SCALE: what scales it, window.__timeScale in tests; 1 on a page); PROTO: our wire
// version; secure(): whether this page can have internet rooms; CODE_LENGTH: of a new room's code (newRoomCode;
// validRoomCode takes the older, shorter ones too)
export { CODE_LENGTH, newRoomCode, PROTO, SCALE, secure, TIMING, validRoomCode } from './config.js';
export { HOLD, MAX_PLAYERS, NAME } from './room.js';
// start loading the internet transport early (e.g. while the player is still on the shelf); never throws
export const preload = () => { loadTransport().catch(() => {}); };
