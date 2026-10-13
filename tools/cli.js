#!/usr/bin/env node
// Library tooling: `node tools/cli.js help`. The password comes from VAULT_PASSWORD or a prompt.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import * as vault from '../library/crypto.js';
import * as repo from './repo.js';
import { readManifest, bundleGame, buildSite, checkVault, testGame } from './build.js';
import { serve } from './dev.js';

const { P, rel, exists, problem } = repo;

// Passwords are taken exactly as typed (no trimming), the same way the browser takes them.
let piped = null;                                      // input that is not a terminal: its lines, read in turn
async function ask(question, hidden) {
  if (!process.stdin.isTTY) {
    if (hidden) console.error('(input is not a terminal: the password will be visible; prefer VAULT_PASSWORD)');
    process.stdout.write(question);
    piped ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const { value, done } = await piped.next();
    if (done) problem('No input for: ' + question.trim());
    return value.replace(/\r$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(question); };
  return new Promise(resolve => rl.question(question, answer => {
    rl.close();
    if (hidden) process.stdout.write('\n');
    resolve(answer);
  }));
}
const password = (q = 'Password: ') => process.env.VAULT_PASSWORD ?? ask(q, true);
const signIn = async () => repo.open(await password());


const HELP = `Library commands

  npm run unlock [-- --force]    decrypt game sources into games/ (--force: overwrite local changes)
  npm run dev [-- site] [port]   the library with your games/ (or the built site/), on this computer only
                                 (--lan: also to your network; with games/ that serves plaintext games)
  npm run build [-- --no-tests]  run each game's own tests (games/<id>/test/*.test.js), then bundle and encrypt
                                 the games into vault/ and assemble site/ (--no-tests: build without running them)
  npm run site                   assemble site/ from library/ and vault/ (no password; CI does this)
  npm run check                  validate vault/ (no password needed)

  npm run user -- list           who has access
  npm run user -- add <name>     add a person (a password is generated and shown once)
  npm run user -- remove <name>  remove a person (rotates the library key, re-encrypts everything)
  npm run user -- passwd         change your password (new keys; rotates the library key)

  node tools/cli.js init <name> …        create a new library (once)
  node tools/cli.js remove-game <id>     take a game off the shelf and delete its files

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

  async unlock(...flags) {
    const lib = await signIn(), force = flags.includes('--force');
    for (const id of repo.vaultIds()) {
      const dir = path.join(P.games, id);
      const files = repo.unpackSource(await repo.readSealed(repo.vaultPath(id, 'source.bin'), vault.label.source(id), lib));
      // names come from the archive: none may point outside the game's folder
      for (const f of Object.keys(files)) if (!path.resolve(dir, f).startsWith(path.resolve(dir) + path.sep)) problem(id + ': unsafe path in the archive: ' + f);
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

  async build(...flags) {
    const bad = flags.filter(f => f !== '--no-tests');
    if (bad.length) problem('Unknown option: ' + bad.join(' ') + '. See: node tools/cli.js help');
    const ids = repo.gameIds(), missing = repo.vaultIds().filter(id => !ids.includes(id));
    if (missing.length) problem('games/' + missing.join(', games/') + ' missing. Run npm run unlock, or remove the game: node tools/cli.js remove-game ' + missing[0]);
    if (!ids.length) problem('No games in games/.');
    const games = ids.map(id => [id, readManifest(id)]);                 // validate everything before asking for the password
    // a game whose own tests fail is not sealed (CI cannot see sealed games: this is their only gate)
    if (flags.includes('--no-tests')) console.log('! games\' own tests skipped (--no-tests)');
    else for (const [id] of games) { const n = testGame(id); if (n) console.log('✓ ' + id + ': its tests pass (' + n + ' file' + (n > 1 ? 's' : '') + ')'); }
    const lib = await signIn();
    for (const [id, g] of games) {
      const html = await bundleGame(id, g);
      const changed = [
        await repo.writeGame(id, html, lib),
        await repo.writeSource(id, lib),
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

  async 'remove-game'(id) {
    if (!id || !repo.vaultIds().includes(id)) problem('No such game in vault/: ' + id);
    for (const p of [repo.vaultPath(id), path.join(P.games, id)]) fs.rmSync(p, { recursive: true, force: true });
    console.log('✓ ' + id + ' removed. Commit vault/.');
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

  dev: (...args) => serve(args.includes('site') ? 'site' : 'games', args.find(a => /^\d+$/.test(a)) || '8000', args.includes('--lan') ? '0.0.0.0' : '127.0.0.1')
};

const [cmd = 'help', ...rest] = process.argv.slice(2);
const done = e => { console.error('✗ ' + (e instanceof repo.Problem ? e.message : e.stack || e)); process.exit(1); };
if (!Object.hasOwn(commands, cmd)) done(new repo.Problem('Unknown command: ' + cmd + '. See: node tools/cli.js help'));
else Promise.resolve().then(() => commands[cmd](...rest)).catch(done);
