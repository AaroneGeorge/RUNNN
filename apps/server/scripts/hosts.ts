// Manage host accounts (the only people who can create games and events).
//   pnpm --filter @kalikkam/server hosts add <username>      asks for the password twice (or reads HOST_PASSWORD)
//   pnpm --filter @kalikkam/server hosts remove <username>
//   pnpm --filter @kalikkam/server hosts list
// Uses the same database as the server (DB_PATH, or apps/server/data/kalikkam.db). Safe to run while it's up.
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AuthError, Store } from '../src/store.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const store = new Store(process.env.DB_PATH ?? resolve(here, '../data/kalikkam.db'));

/** Ask a question; `hidden` doesn't echo what's typed. */
function ask(question: string, hidden = false): Promise<string> {
  return new Promise((done) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    if (hidden) (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s) => s.includes(question) && process.stdout.write(s);
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      done(answer);
    });
  });
}

const [cmd, username] = process.argv.slice(2);
try {
  if (cmd === 'add' && username) {
    let password = process.env.HOST_PASSWORD ?? '';
    if (!password) {
      password = await ask(`Password for ${username}: `, true);
      if ((await ask('Same password again: ', true)) !== password) throw new AuthError("The passwords don't match.");
    }
    const existed = store.hostNames().includes(username.trim().toLowerCase());
    store.setHostPassword(username, password);
    const name = username.trim().toLowerCase();
    console.log(existed ? `Changed the password for ${name} (and signed them out everywhere).` : `Host ${name} can sign in now.`);
  } else if (cmd === 'remove' && username) {
    console.log(store.removeHost(username) ? `Removed host ${username}.` : `No host called ${username}.`);
  } else if (cmd === 'list') {
    const names = store.hostNames();
    console.log(names.length ? names.join('\n') : 'No hosts yet. Add one: hosts add <username>');
  } else {
    console.log('Usage: hosts add <username> | hosts remove <username> | hosts list');
    process.exitCode = 1;
  }
} catch (e) {
  console.error(e instanceof AuthError ? e.message : e);
  process.exitCode = 1;
}
