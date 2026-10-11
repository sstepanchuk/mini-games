#!/usr/bin/env node
// Library tooling: `node tools/cli.js help`. The password comes from VAULT_PASSWORD or a prompt.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as vault from '../library/crypto.js';
import * as repo from './repo.js';
import { readManifest, bundleGame, gamePage, checkSite, siteFiles, serviceWorker } from './build.js';
import { serve } from './dev.js';

const { P, rel, exists, problem } = repo;

// Passwords are taken exactly as typed (no trimming), the same way the browser takes them.
function ask(question, hidden) {
  const tty = !!process.stdin.isTTY;
  if (hidden && !tty) console.error('(input is not a terminal: the password will be visible; prefer VAULT_PASSWORD)');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: tty });
  if (hidden && tty) rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(question); };
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    if (hidden && tty) process.stdout.write('\n');
    resolve(answer.replace(/\r$/, ''));
  }));
}
const password = (q = 'Password: ') => process.env.VAULT_PASSWORD ?? ask(q, true);
const signIn = async () => repo.open(await password());

// the list of games on the shelf (public: titles and covers are on the game pages anyway)
const shelfFile = () => repo.sitePath('library.json');
const writeShelf = games => writeIfChanged(shelfFile(), JSON.stringify(games.map(([id, g]) => ({ id, title: g.title, tagline: g.tagline, image: g.image, emoji: g.emoji })), null, 2) + '\n');

const HELP = `Library commands

  npm run unlock [-- --force]    decrypt game sources into games/ (--force: overwrite local changes)
  npm run dev [-- docs] [port]   local server for games/ (or the built site in docs/), on this computer only
  npm run build                  bundle and encrypt the games, update docs/ and vault/
  npm run check                  validate docs/ before publishing (no password needed)

  npm run user -- list           who has access
  npm run user -- add <name>     add a person (a password is generated and shown once)
  npm run user -- remove <name>  remove a person (rotates the library key, re-encrypts everything)
  npm run user -- passwd         change your password (also gives you new keys)

  node tools/cli.js init <name> …        create a new library (once)
  node tools/cli.js remove-game <id>     take a game off the shelf and delete its files

Set VAULT_PASSWORD to skip the password prompt.`;

const commands = {
  help: () => console.log(HELP),

  async init(...names) {
    if (exists(P.keyring)) problem('A library already exists: ' + rel(P.keyring));
    if (!names.length) problem('Give at least one name: node tools/cli.js init <name> …');
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

  async unlock(...flags) {
    const lib = await signIn(), force = flags.includes('--force');
    for (const id of repo.sourceIds()) {
      const dir = path.join(P.games, id);
      const files = repo.unpackSource(await repo.readSealed(repo.sourcePath(id), vault.label.source(id), lib));
      const local = exists(dir) ? repo.walk(dir) : [];
      const changed = local.filter(f => !(f in files) || !repo.same(fs.readFileSync(path.join(dir, f)), Buffer.from(files[f], 'base64')));
      if (changed.length && !force) {
        console.log('! ' + id + ': local changes in ' + changed.join(', ') + ' — skipped. Overwrite them: npm run unlock -- --force');
        continue;
      }
      for (const f of local) if (!(f in files)) fs.rmSync(path.join(dir, f));       // --force: the folder ends up exactly like the archive
      for (const [f, b64] of Object.entries(files)) repo.writeAtomic(path.join(dir, f), Buffer.from(b64, 'base64'));
      console.log('✓ ' + rel(dir));
    }
  },

  async build() {
    const ids = repo.gameIds(), missing = repo.sourceIds().filter(id => !ids.includes(id));
    if (missing.length) problem('games/' + missing.join(', games/') + ' missing. Run npm run unlock, or remove the game: node tools/cli.js remove-game ' + missing[0]);
    if (!ids.length) problem('No games in games/.');
    const games = ids.map(id => [id, readManifest(id)]);                 // validate everything before asking for the password
    const lib = await signIn();
    for (const [f, data] of Object.entries(await siteFiles())) writeIfChanged(repo.sitePath(f), data);
    for (const [id, g] of games) {
      const html = await bundleGame(id, g);
      const changed = [
        await repo.writeSealed(repo.sitePath(id, 'game.bin'), Buffer.from(html), vault.label.game(id), lib),
        await repo.writeSource(id, lib)
      ].some(Boolean);
      for (const f of fs.readdirSync(repo.sitePath(id))) if (f.endsWith('.png') && f !== g.image) fs.rmSync(repo.sitePath(id, f));   // an old cover
      fs.copyFileSync(path.join(P.games, id, g.image), repo.sitePath(id, g.image));
      repo.writeAtomic(repo.sitePath(id, 'index.html'), gamePage(id, g));
      console.log('✓ ' + id + ': ' + (html.length / 1024).toFixed(0) + ' KB' + (changed ? '' : ' (unchanged)'));
    }
    writeShelf(games);
  },

  async 'remove-game'(id) {
    if (!id || !repo.siteGames().includes(id)) problem('No such game in docs/: ' + id);
    writeShelf(JSON.parse(fs.readFileSync(shelfFile(), 'utf8')).filter(g => g.id !== id).map(g => [g.id, g]));
    for (const p of [repo.sitePath(id), repo.sourcePath(id), path.join(P.games, id)]) fs.rmSync(p, { recursive: true, force: true });
    console.log('✓ ' + id + ' removed. Commit docs/ and vault/.');
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
    } else if (sub === 'remove') {
      repo.requireClean(P.site, P.vault);
      const lib = await signIn(), { kr, me } = lib;
      const gone = kr.people.filter(p => p.name === name);
      if (!gone.length) problem('No such name. See: npm run user -- list');
      if (gone.includes(me)) problem('You cannot remove yourself: sign in with someone else’s password.');
      // the removed person may have kept the library key, so it is replaced and everything re-encrypted
      kr.people = kr.people.filter(p => !gone.includes(p));
      await repo.rotate(kr, lib);
      console.log('✓ ' + name + ' no longer has access. Library key rotated, files re-encrypted — commit docs/ and vault/.');
    } else if (sub === 'passwd') {
      const { kr, me, raw } = await repo.open(await password('Current password: '));
      let pw = await ask('New password (empty to generate): ', true);
      if (!pw) console.log('New password: ' + (pw = repo.makePassword()));
      else {
        repo.checkNewPassword(pw);
        if (await ask('Repeat: ', true) !== pw) problem('Passwords do not match.');
      }
      const owner = await vault.signIn(kr, pw);
      if (owner && owner.person !== me) problem('Choose another password.');   // it already opens someone else's keys
      await vault.replaceKeys(kr, me, pw, raw);
      repo.writeKeyring(kr);
      console.log('✓ Password changed and your keys replaced. Commit docs/keyring.json.');
    } else problem('npm run user -- list | add <name> | remove <name> | passwd');
  },

  async check() {
    const { problems, games, people } = await checkSite();
    if (problems.length) { problems.forEach(p => console.error('✗ ' + p)); process.exit(1); }
    console.log('✓ docs/ is valid: ' + games + ' game(s), ' + people + ' people');
  },

  dev: (...args) => serve(args.includes('docs') ? 'docs' : 'games', args.find(a => /^\d+$/.test(a)) || '8000', args.includes('--lan') ? '0.0.0.0' : '127.0.0.1')
};

// every command that changes docs/ also refreshes the offline copy's file list (sw.js)
const WRITES = new Set(['init', 'build', 'remove-game', 'user']);
const writeIfChanged = (file, data) => { if (!exists(file) || !fs.readFileSync(file).equals(Buffer.from(data))) repo.writeAtomic(file, data); };

const [cmd = 'help', ...rest] = process.argv.slice(2);
const done = e => { console.error('✗ ' + (e instanceof repo.Problem ? e.message : e.stack || e)); process.exit(1); };
if (!Object.hasOwn(commands, cmd)) done(new repo.Problem('Unknown command: ' + cmd + '. See: node tools/cli.js help'));
else Promise.resolve().then(() => commands[cmd](...rest))
  .then(() => { if (WRITES.has(cmd) && exists(repo.sitePath('index.html'))) writeIfChanged(repo.sitePath('sw.js'), serviceWorker()); })
  .catch(done);
