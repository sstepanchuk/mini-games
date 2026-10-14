// A question at the command line (cli.js, migrate.js). The answer is taken exactly as typed (no trimming: the
// browser takes passwords that way too); hidden: a password, not echoed at a terminal. Input that is not a terminal
// (a pipe) gives its lines in turn, one per question.
import readline from 'node:readline';

let piped = null;                                      // the lines of input that is not a terminal

// → the answer, or null when the input has ended (nothing more to read)
export async function ask(question, hidden = false) {
  if (!process.stdin.isTTY) {
    if (hidden) console.error('(input is not a terminal: the password will be visible; prefer VAULT_PASSWORD)');
    process.stdout.write(question);
    piped ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const { value, done } = await piped.next();
    return done ? null : value.replace(/\r$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(question); };
  return new Promise(resolve => {
    let answer = null;
    rl.on('close', () => {                               // answered, or the input ended (Ctrl-D) first
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
    rl.question(question, a => { answer = a; rl.close(); });
  });
}
