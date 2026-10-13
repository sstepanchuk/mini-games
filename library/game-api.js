/* The library, as every game sees it: `window.ihroteka`.
   Not imported: the build (and `npm run dev`) inlines this script at the top of the game's <head>,
   before any game code runs, with { id, title, players, wire } from game.json in place of GAME. The library page
   runs the game in a frame and hands it the API (see app/shell.js); a game page opened on its own,
   outside the library, gets no API: `window.ihroteka` is undefined there, so games treat it as optional.

   Contract (version 4: players are names, a round can move to another player's copy):
     ihroteka.version     4
     ihroteka.game        { id, title, players: { min, max }, wire }   (wire: game.json "wire", 1 when not given)
     ihroteka.libraryUrl  absolute URL of the library
     ihroteka.home()      back to the shelf
     ihroteka.room        the other players, through the room the whole library shares (app/together.js: channel)
     ihroteka.round       the game's rounds: one shared record, who runs a round, its snapshots (app/round.js; phase 4)
     ihroteka.invite()    open the library's "play together" dialog
     <ihroteka-wait>      the library's waiting screens, where the game puts them (app/screens.js; defined below)
   app/shell.js (api) builds it. tests/api-surface.json pins these names, the version (here, in shell.js and in
   README), and the members and events of ihroteka.room and ihroteka.round; tests/api-surface.json "screens" pins the
   element, its attribute and event, its kinds and the markup's hooks; README "Game API" documents every one of them.
   The build drops this comment. */
(function (game) {
  if (!game) return;
  var library = null;
  try { library = window.parent !== window && window.parent.__ihroteka; } catch (e) {}   // another site around us
  window.ihroteka = library ? library.attach(window, game) : undefined;
  // <ihroteka-wait>: where the game puts the library's waiting screens (app/screens.js). Defined here, in the game's
  // own window, before its page is parsed; it only tells the library where they are, so it never needs to change.
  if (library && library.waitScreen && window.ihroteka && window.customElements && !window.customElements.get('ihroteka-wait')) {
    window.customElements.define('ihroteka-wait', class extends HTMLElement {
      connectedCallback() { library.waitScreen(this, true); }
      disconnectedCallback() { library.waitScreen(this, false); }
    });
  }
})(/* GAME */ null);
