// `npm run lint`: library/ runs in the browser (sw.js in a service worker), and so does a game's page (games/, and the
// template that `cli new` copies, tools/template); tools/ and tests/ run in Node, and so do a game's own tests
// (games/*/test, tools/template/test: Node, with the browser's names too, as a test may shim a document). games/
// (plaintext, local only) is checked too when it is there, except the copies remove-game keeps aside (games/.removed:
// old code, not on the shelf). library/ keeps to what Safari 15.0–15.3 (older iPhones) has: no .at(), structuredClone,
// Object.hasOwn, nor (Safari before 16.4) DecompressionStream and CompressionStream but where a feature test guards them.
import globals from 'globals';

const rules = { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }], 'no-undef': 'error', 'prefer-const': 'error', eqeqeq: ['error', 'smart'] };
export default [
  { ignores: ['site/**', 'node_modules/**', 'games/.removed/**'] },
  { files: ['library/**/*.js', 'games/**/*.js'], languageOptions: { globals: globals.browser }, rules },
  { files: ['library/app/sw.js'], languageOptions: { globals: globals.serviceworker } },
  { files: ['library/game-api.js'], languageOptions: { sourceType: 'script' } },
  // (no-restricted-properties would flag a plain property named so: last.at = at)
  { files: ['library/**/*.js'], rules: {
    'no-restricted-syntax': ['error',
      { selector: 'CallExpression[callee.property.name=/^(at|findLast|findLastIndex)$/]', message: 'Safari 15.0–15.3 (older iPhones) has none: x[x.length - 1]' },
      { selector: "MemberExpression[object.name='Object'][property.name='hasOwn']", message: 'Safari 15.0–15.3: Object.prototype.hasOwnProperty.call' }],
    'no-restricted-globals': ['error', { name: 'structuredClone', message: 'Safari 15.0–15.3 has no structuredClone' },
      { name: 'DecompressionStream', message: 'Safari before 16.4 (iOS 15–16.3) has none: crypto.js gameText takes the gunzip of lib/inflate.js' },
      { name: 'CompressionStream', message: 'Safari before 16.4 (iOS 15–16.3) has none: crypto.js gameText takes the gunzip of lib/inflate.js' }]
  } },
  { files: ['tools/**/*.js', 'tests/**/*.js', 'eslint.config.js'], ignores: ['tools/template/**', '!tools/template/test/**'], languageOptions: { globals: globals.node }, rules },
  { files: ['tools/template/**/*.js'], ignores: ['tools/template/test/**'], languageOptions: { globals: globals.browser }, rules },
  { files: ['games/*/test/**/*.js', 'tools/template/test/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules },
  // browser scenarios (the library's, and a game's own sealed in games/<id>/test): CommonJS in Node, with functions
  // that run in the page (page.evaluate, init scripts)
  { files: ['tests/e2e/**/*.cjs', 'games/*/test/**/*.cjs'], languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } }, rules }
];
