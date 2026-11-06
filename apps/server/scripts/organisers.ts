/**
 * Manage organiser accounts.
 *
 *   pnpm --filter @runnn/server organisers add <username>     (prompts for a password)
 *   pnpm --filter @runnn/server organisers list
 *   pnpm --filter @runnn/server organisers remove <username>
 */
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const store = new Store(process.env.DB_PATH ?? resolve(here, '../data/runnn.db'));
const [cmd, user] = process.argv.slice(2);

function ask(q: string, hidden: boolean): Promise<string> {
  if (process.env.ORGANISER_PASSWORD) return Promise.resolve(process.env.ORGANISER_PASSWORD);
  return new Promise((ok) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void };
      out._writeToOutput = (s: string) => {
        if (s.startsWith(q)) process.stdout.write(q);
      };
    }
    rl.question(q, (a) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      ok(a);
    });
  });
}

async function main() {
  switch (cmd) {
    case 'add': {
      if (!user) throw new Error('usage: organisers add <username>');
      const pw = await ask('Password (8+ characters): ', true);
      const again = process.env.ORGANISER_PASSWORD ? pw : await ask('Again: ', true);
      if (pw !== again) throw new Error('Passwords do not match.');
      const name = store.addOrganiser(user, pw);
      console.log(`Organiser ${name} saved. Existing sessions for them were signed out.`);
      break;
    }
    case 'list': {
      const all = store.listOrganisers();
      if (!all.length) console.log('No organisers yet. Add one with: organisers add <username>');
      for (const o of all) console.log(`${o.username}\t${new Date(o.createdAt).toISOString().slice(0, 10)}`);
      break;
    }
    case 'remove': {
      if (!user) throw new Error('usage: organisers remove <username>');
      console.log(store.removeOrganiser(user) ? `Removed ${user}.` : `No organiser called ${user}.`);
      break;
    }
    default:
      console.log('usage: organisers <add|list|remove> [username]');
      process.exitCode = 1;
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => store.close());
