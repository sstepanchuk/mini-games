// Rooms for up to 8 players. No server of our own: players meet through public MQTT brokers
// (internet rooms) or by showing each other a code (nearby rooms, no internet), and play over a direct
// WebRTC link whenever one works. Both kinds of room have the same API (room.js, newRoom: the room object); what
// games see of it is the library's (app/together.js), see README.md ("Game API").
import { loadTransport } from './brokers.js';

export { hasInternet } from './brokers.js';
export { joinRoom } from './internet.js';
export { joinNearby } from './nearby.js';
export { newRoomCode, PROTO, TIMING, validRoomCode } from './config.js';   // TIMING: how long the room waits, ms; PROTO: our wire version
export { HOLD, MAX_PLAYERS, NAME } from './room.js';
// start loading the internet transport early (e.g. while the player is still on the shelf); never throws
export const preload = () => { loadTransport().catch(() => {}); };
