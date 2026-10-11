// Two-player rooms. No server of our own: players meet through public MQTT brokers
// (internet rooms) or by showing each other a code (nearby rooms, no internet), and play over a direct
// WebRTC link whenever one works. Both kinds of room have the same API; see README.md ("Multiplayer").
import { loadTransport } from './brokers.js';

export { joinRoom } from './internet.js';
export { joinNearby } from './nearby.js';
export { newRoomCode, validRoomCode } from './config.js';
// start loading the internet transport early (e.g. while the player is still on the shelf); never throws
export const preload = () => { loadTransport().catch(() => {}); };
