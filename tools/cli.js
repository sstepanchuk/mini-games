#!/usr/bin/env node
// Library tooling: `node tools/cli.js help`. The password comes from VAULT_PASSWORD or a prompt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as vault from '../library/crypto.js';
import * as repo from './repo.js';
import * as prompt from './prompt.js';
import { readManifest, bundleGame, buildSite, checkVault, testGame, coverWarnings, playersOf, apiVersion, validId } from './build.js';
import { serve } from './dev.js';
import { cover } from './png.js';

const { P, rel, exists, problem } = repo;

// a question, answered as typed (prompt.js); no answer (the input ended) is a mistake
const ask = async (question, hidden) => (await prompt.ask(question, hidden)) ?? problem('No input for: ' + question.trim());
const password = (q = 'Password: ') => process.env.VAULT_PASSWORD ?? ask(q, true);
const signIn = async () => repo.open(await password());

// --flag value pairs (named in `valued`) and bare --flags (named in `bare`) → { '--flag': value | true }; anything else
// is a mistake
function options(args, valued, bare = []) {
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (valued.includes(a) && i + 1 < args.length) out[a] = args[++i];
    else if (bare.includes(a)) out[a] = true;
    else problem('Unknown option: ' + a + (valued.includes(a) ? ' (it needs a value)' : '') + '. See: node tools/cli.js help');
  }
  return out;
}
const TEMPLATE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template');


const HELP = `Library commands

  npm run unlock [-- --force]    decrypt game sources into games/, or bring them up to date with vault/ (local
                                 changes are kept and named; --force: overwrite them)
  npm run dev [-- site] [port]   the library with your games/ (or the built site/), on this computer only
                                 (--lan: also to your network; with games/ that serves plaintext games;
                                 --devnet: a fake network, so tabs play together without internet, as ?devnet does;
                                 --probe: also the browser scenarios' open game, tests/e2e/fixtures/probe)
  npm run build [-- --no-tests] [--force]
                                 run each game's own tests (games/<id>/test/*.test.js), then bundle and encrypt
                                 the games into vault/ and assemble site/ (--no-tests: build without running them;
                                 --force: seal games/ even over a vault/ that changed since your last unlock or build)
  npm run site                   assemble site/ from library/ and vault/ (no password; CI does this)
  npm run check                  validate vault/ (no password needed)

  npm run user -- list           who has access
  npm run user -- add <name>     add a person (a password is generated and shown once)
  npm run user -- remove <name>  remove a person (rotates the library key, re-encrypts everything)
  npm run user -- passwd         change your password (new keys; rotates the library key)

  node tools/cli.js new <id> [--players 2-4] [--title …]   a new game in games/<id>, from tools/template
  node tools/cli.js remove-game <id> --yes   take a game off the shelf: vault/<id> deleted, games/<id> moved to
                                         games/.removed/<id>-<date> (plaintext, local: the only copy of unbuilt edits)
  node tools/cli.js init <name> …        create a new library (once)

Set VAULT_PASSWORD to skip the password prompt.`;

const commands = {
  help: () => console.log(HELP),

  async init(...names) {
    if (exists(P.keyring)) problem('A library already exists: ' + rel(P.keyring));
    if (!names.length) problem('Give at least one name: node tools/cli.js init <name> …');
    if (new Set(names).size !== names.length) problem('Every name must be different.');
    const kr = vault.newKeyring(), raw = vault.newLibraryKey();
    kr.kid = await vault.keyId(raw);
    console.log('New library. Passwords are shown only once, save them:\n');
    for (const name of names) {
      const pw = repo.makePassword();
      await repo.addPerson(kr, raw, name, pw);
      console.log('  ' + name.padEnd(12) + pw);
    }
    repo.writeKeyring(kr);
    console.log('\nNext: npm run build');
  },

  // vault/<id> into games/<id>: a folder only behind it is brought up to date; one with changes of its own is left as
  // it is (--force: overwritten)
  async unlock(...flags) {
    const lib = await signIn(), force = flags.includes('--force');
    for (const id of repo.vaultIds()) {
      const dir = path.join(P.games, id);
      // the sources with the cover beside them, against this folder and the version it last came from (repo.js)
      const { sealed: files, local, ours, theirs } = await repo.compareSource(id, lib, { strict: true });
      // names come from the archive: none may point outside the game's folder
      for (const f of Object.keys(files)) if (!path.resolve(dir, f).startsWith(path.resolve(dir) + path.sep)) problem(id + ': unsafe path in the archive: ' + f);
      // this copy's own changes (with no record of the version it came from: every file unlike the vault's); one the
      // vault has made too (the same edit on both sides, an unlock cut short before its base) is no conflict
      const differs = f => local?.[f] !== files[f];
      const edits = (ours ?? Object.keys(local ?? {})).filter(differs), updated = theirs?.filter(differs);
      if (edits.length && !force) {
        const mine = '! ' + id + ': local changes in ' + edits.join(', ');
        const which = 'Take the vault\'s: npm run unlock -- --force; seal yours over it: npm run build -- --force';
        if (theirs?.length) console.log(mine + ', and vault/' + id + ' changed too (' + theirs.join(', ') + ') — skipped. ' + which);
        else if (theirs) console.log(mine + ' — skipped. Overwrite them: npm run unlock -- --force');
        else console.log(mine + ' — skipped (nothing here records which version they were unlocked from). ' + which);
        continue;
      }
      for (const f of Object.keys(local ?? {})) if (!(f in files)) fs.rmSync(path.join(dir, f));   // the folder ends up exactly like the archive
      for (const [f, b64] of Object.entries(files)) repo.writeAtomic(path.join(dir, f), Buffer.from(b64, 'base64'));
      repo.writeBase(id, files);
      console.log('✓ ' + rel(dir) + (updated?.length ? ' (updated: ' + updated.join(', ') + ')' : ''));
    }
  },

  async build(...flags) {
    const bad = flags.filter(f => f !== '--no-tests' && f !== '--force');
    if (bad.length) problem('Unknown option: ' + bad.join(' ') + '. See: node tools/cli.js help');
    const ids = repo.gameIds(), missing = repo.vaultIds().filter(id => !ids.includes(id));
    if (missing.length) problem('games/' + missing.join(', games/') + ' missing. Run npm run unlock, or remove the game: node tools/cli.js remove-game ' + missing[0]);
    if (!ids.length) problem('No games in games/.');
    const games = ids.map(id => [id, readManifest(id)]);                 // validate everything before asking for the password
    // a game whose own tests fail is not sealed (CI cannot see sealed games: this is their only gate); a cover the
    // shelf and link previews will not show well is named next to them
    const tests = !flags.includes('--no-tests');
    if (!tests) console.log('! games\' own tests skipped (--no-tests)');
    for (const [id, g] of games) {
      const n = tests ? testGame(id) : 0;
      if (n) console.log('✓ ' + id + ': its tests pass (' + n + ' file' + (n > 1 ? 's' : '') + ')');
      for (const w of coverWarnings(id, g)) console.log('! ' + w);
    }
    const lib = await signIn();
    // A games/<id> behind vault/<id> (someone else built since, and this checkout pulled it) is not sealed over it
    // unless asked: every game is checked before anything is written.
    const behind = [];
    for (const [id] of games) {
      const { sealed, local, same, ours, theirs } = await repo.compareSource(id, lib);
      if (!sealed || same || theirs?.length === 0) continue;
      const mine = (ours ?? []).filter(f => local?.[f] !== sealed[f]);   // (an edit the vault has too is no one's own)
      behind.push(theirs ? 'vault/' + id + ' changed since your last npm run unlock or build (' + theirs.join(', ') + ')' + (mine.length ? '; yours: ' + mine.join(', ') : '')
        : 'games/' + id + ' differs from vault/' + id + ', and nothing here records which version it was unlocked from');
    }
    if (behind.length && !flags.includes('--force')) {
      problem(behind.join('\n  ') + '\n  Take the vault\'s: npm run unlock (it keeps your edits and says which); seal yours over it: npm run build -- --force');
    }
    for (const [id, g] of games) {
      const html = await bundleGame(id, g, { warn: m => console.log('! ' + m) });
      const changed = [
        await repo.writeGame(id, html, lib),
        await repo.writeSource(id, g, lib),
        repo.writeIfChanged(repo.vaultPath(id, 'game.json'), JSON.stringify(g, null, 2) + '\n'),
        repo.writeIfChanged(repo.vaultPath(id, g.image), fs.readFileSync(path.join(P.games, id, g.image)))
      ].some(Boolean);
      for (const f of fs.readdirSync(repo.vaultPath(id))) if (f.endsWith('.png') && f !== g.image) fs.rmSync(repo.vaultPath(id, f));   // an old cover
      console.log('✓ ' + id + ': ' + (html.length / 1024).toFixed(0) + ' KB' + (changed ? '' : ' (unchanged)'));
    }
    await commands.site();
  },

  async site() {
    const n = await buildSite();
    console.log('✓ site/ assembled: ' + n + ' game(s)');
  },

  // A new game from tools/template (a small turn-based game on ihroteka.round: rules with tests, a page, a placeholder
  // cover), ready to play in the dev server, alone or together.
  async new(id, ...flags) {
    const opt = options(flags, ['--players', '--title']);
    if (!id || id.startsWith('-')) problem('node tools/cli.js new <id> [--players 2-4] [--title …]');
    if (!validId(id)) problem('"' + id + '": the id becomes the URL, so use lowercase letters, digits and dashes (and not lib)');
    const dir = path.join(P.games, id);
    if (exists(dir) || repo.vaultIds().includes(id)) problem('games/' + id + ' or vault/' + id + ' already exists: choose another id');
    const players = opt['--players'] ?? '2';
    if (!playersOf(players) || playersOf(players).min > playersOf(players).max) problem('--players: "2", or a range such as "2-4" (1 to 8)');
    const g = JSON.parse(fs.readFileSync(path.join(TEMPLATE, 'game.json'), 'utf8'));
    Object.assign(g, { title: opt['--title'] || id, players, api: apiVersion() });
    const files = repo.walk(TEMPLATE).filter(f => f !== 'game.json');
    try {
      for (const f of files) {
        let data = fs.readFileSync(path.join(TEMPLATE, f));
        if (f === 'index.html') data = data.toString('utf8').replace(/\{\{title\}\}/g, () => repo.esc(g.title));
        repo.writeAtomic(path.join(dir, f), data);
      }
      repo.writeAtomic(path.join(dir, 'game.json'), JSON.stringify(g, null, 2) + '\n');
      repo.writeAtomic(path.join(dir, g.image), cover(g.theme));
      readManifest(id);                                  // (an id the build would refuse: nothing left behind)
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
    console.log('✓ games/' + id + ': ' + g.title + ' (' + players + ' players), from tools/template\n' +
      '  npm run dev, then http://localhost:8000/' + id + '/\n' +
      '  two players without internet: npm run dev -- --devnet, and the same address in two tabs ("Грати разом" in one)\n' +
      '  its tests: npm run test:games; on the shelf: replace preview.png (1200×630), then npm run build');
  },

  // Off the shelf: vault/<id> goes (commit that), and the plaintext games/<id> is kept aside, not deleted.
  async 'remove-game'(id, ...flags) {
    const opt = options(flags, [], ['--yes']), dir = path.join(P.games, String(id));
    if (!validId(id) || (!repo.vaultIds().includes(id) && !exists(dir))) problem('No such game: ' + id + ' (neither vault/' + id + ' nor games/' + id + ')');
    const backup = path.join(P.games, '.removed', id + '-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-'));
    const what = [repo.vaultIds().includes(id) && 'deletes vault/' + id, exists(dir) && 'moves games/' + id + ' to ' + rel(backup)].filter(Boolean);
    if (!opt['--yes']) problem('This ' + what.join(' and ') + '. To do it: node tools/cli.js remove-game ' + id + ' --yes');
    if (exists(dir)) { fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.renameSync(dir, backup); }
    fs.rmSync(repo.vaultPath(id), { recursive: true, force: true });
    console.log('✓ ' + id + ' is off the shelf' + (exists(backup) ? '; its sources are in ' + rel(backup) : '') + '. Commit vault/, then npm run site.');
  },

  async user(sub, ...args) {
    const name = args.join(' ').trim();
    if (sub === 'list') {
      for (const p of repo.readKeyring().people) console.log('  ' + p.name);
    } else if (sub === 'add') {
      if (!name) problem('npm run user -- add <name>');
      const { kr, raw } = await signIn();
      if (kr.people.some(p => p.name === name)) problem('That name is already taken.');
      const pw = repo.makePassword();
      await repo.addPerson(kr, raw, name, pw);
      repo.writeKeyring(kr);
      console.log('✓ ' + name + ' has access. Password (shown once): ' + pw);
      // the site's keyring too (after the password, which nothing may hide: with no game yet there is no site)
      if (repo.vaultIds().length) await commands.site();
      console.log('Commit vault/.');
    } else if (sub === 'remove') {
      repo.requireClean(P.vault);
      const lib = await signIn(), { kr, me } = lib;
      const gone = kr.people.filter(p => p.name === name);
      if (!gone.length) problem('No such name. See: npm run user -- list');
      if (gone.includes(me)) problem('You cannot remove yourself: sign in with someone else’s password.');
      // the removed person may have kept the library key, so it is replaced and everything re-encrypted
      kr.people = kr.people.filter(p => !gone.includes(p));
      await repo.rotate(kr, lib);
      await commands.site();
      console.log('✓ ' + name + ' no longer has access. Library key rotated, games re-encrypted — commit vault/.');
    } else if (sub === 'passwd') {
      repo.requireClean(P.vault);
      const lib = await repo.open(await password('Current password: ')), { kr, me, raw } = lib;
      let pw = await ask('New password (empty to generate): ', true);
      if (!pw) console.log('New password: ' + (pw = repo.makePassword()));
      else {
        repo.checkNewPassword(pw);
        if (await ask('Repeat: ', true) !== pw) problem('Passwords do not match.');
      }
      const owner = await vault.signIn(kr, pw);
      if (owner && owner.person !== me) problem('Choose another password.');   // it already opens someone else's keys
      // new keys, and a new library key: the old password still opens the old keyring in git history
      await vault.replaceKeys(kr, me, pw, raw);
      await repo.rotate(kr, lib);
      await commands.site();
      console.log('✓ Password changed, your keys replaced, library key rotated. Commit vault/.');
    } else problem('npm run user -- list | add <name> | remove <name> | passwd');
  },

  check() {
    const problems = checkVault();
    if (problems.length) { problems.forEach(p => console.error('✗ ' + p)); process.exit(1); }
    console.log('✓ vault/ is valid: ' + repo.vaultIds().length + ' game(s), ' + repo.readKeyring().people.length + ' people');
  },

  dev(...args) {
    const bad = args.filter(a => !['site', '--lan', '--devnet', '--probe'].includes(a) && !/^\d+$/.test(a));
    if (bad.length) problem('Unknown option: ' + bad.join(' ') + '. See: node tools/cli.js help');
    serve(args.includes('site') ? 'site' : 'games', args.find(a => /^\d+$/.test(a)), args.includes('--lan') ? '0.0.0.0' : '127.0.0.1',
      { devnet: args.includes('--devnet'), probe: args.includes('--probe') });
  }
};

const [cmd = 'help', ...rest] = process.argv.slice(2);
const done = e => { console.error('✗ ' + (e instanceof repo.Problem ? e.message : e.stack || e)); process.exit(1); };
if (!Object.hasOwn(commands, cmd)) done(new repo.Problem('Unknown command: ' + cmd + '. See: node tools/cli.js help'));
else Promise.resolve().then(() => commands[cmd](...rest)).catch(done);
