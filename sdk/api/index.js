/* @ihroteka/api — the library, as every game sees it: `window.ihroteka`.
   Not imported: the build (and `npm run dev`) inlines this script at the top of the game's <head>,
   before any game code runs, with { id, title } from game.json in place of GAME. The library page runs the
   game in a frame and hands it the API (see @ihroteka/shelf, shell.js); a game page opened on its own,
   outside the library, gets no API: `window.ihroteka` is undefined there, so games treat it as optional.

   Contract (version 2):
     ihroteka.version     2
     ihroteka.game        { id, title }
     ihroteka.libraryUrl  absolute URL of the library
     ihroteka.home()      back to the shelf
     ihroteka.room        the room with the other player, shared by the whole library (see README "Multiplayer")
     ihroteka.invite()    open the library's "play together" dialog */
(function (game) {
  if (!game) return;
  var library = null;
  try { library = window.parent !== window && window.parent.__ihroteka; } catch (e) {}   // another site around us
  window.ihroteka = library ? library.attach(window, game) : undefined;
})(/* GAME */ null);
