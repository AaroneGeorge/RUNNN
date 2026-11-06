import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseVestQr } from '@kalikkam/shared';

// Printed vest QRs are "KLK1:<vest>:<sig>", sig = HMAC(secret, vest). The secret lives next to the DB
// and is created on first run. Losing it means reprinting vests, so it's never rotated automatically.
const KEY_PATH = process.env.VEST_KEY_PATH ?? resolve(fileURLToPath(new URL('.', import.meta.url)), '../data/vest.key');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let secret: Buffer | null = null;
function key(): Buffer {
  if (secret) return secret;
  if (existsSync(KEY_PATH)) secret = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
  else {
    secret = randomBytes(32);
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    writeFileSync(KEY_PATH, secret.toString('hex'), { mode: 0o600 });
  }
  return secret;
}

export function vestSig(vest: string): string {
  const mac = createHmac('sha256', key()).update(`vest:${vest}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

export const vestQr = (vest: string) => `KLK1:${vest}:${vestSig(vest)}`;

/** The vest number a scanned QR belongs to, or null if it's not a genuine Zombie Run vest. */
export function verifyVestQr(text: string): string | null {
  const q = parseVestQr(text);
  return q && q.sig === vestSig(q.vest) ? q.vest : null;
}
