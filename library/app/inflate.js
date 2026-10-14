// Gunzip for browsers without DecompressionStream (Safari before 16.4: iOS 15–16.3), where a sealed game (gzipped:
// tools/repo.js writeGame) cannot be opened otherwise. Built into lib/inflate.js (tools/build.js; tools/dev.js serves
// it too) and loaded only there, by lock.js openSealed, so the library page stays small. fflate © Arjun Barrett, MIT.
export { gunzipSync as gunzip } from 'fflate';
