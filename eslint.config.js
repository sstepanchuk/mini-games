// `npm run lint`: library/ runs in the browser (sw.js in a service worker), tools/ and tests/ in Node;
// games/ (plaintext, local only) is checked too when it is there, except the copies remove-game keeps aside
// (games/.removed: old code, not on the shelf).
import globals from 'globals';

const rules = { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-undef': 'error', 'prefer-const': 'error', eqeqeq: ['error', 'smart'] };
export default [
  { ignores: ['site/**', 'node_modules/**', 'games/.removed/**'] },
  { files: ['library/**/*.js', 'games/**/*.js'], languageOptions: { globals: globals.browser }, rules },
  { files: ['library/app/sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['library/game-api.js'], languageOptions: { sourceType: 'script' } },
  { files: ['tools/**/*.js', 'tests/**/*.js', 'eslint.config.js'], languageOptions: { globals: globals.node }, rules },
  // browser scenarios (the library's, and a game's own sealed in games/<id>/test): CommonJS in Node, with functions
  // that run in the page (page.evaluate, init scripts)
  { files: ['tests/e2e/**/*.cjs', 'games/*/test/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } }, rules }
];
