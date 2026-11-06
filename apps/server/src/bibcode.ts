import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIB_RE, parseBibQr } from '@runnn/shared';

const here = dirname(fileURLToPath(import.meta.url));
/** Empty string = keep the key in memory only (tests). */
const KEY_PATH = process.env.BIB_KEY_PATH ?? resolve(here, '../data/bib.key');
/** No O/0/I/1: these get read aloud. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let secret: Buffer | null = null;

/** Created on first run with mode 0600. Losing it invalidates every printed bib. */
function key(): Buffer {
  if (secret) return secret;
  if (!KEY_PATH) {
    secret = randomBytes(32);
  } else if (existsSync(KEY_PATH)) {
    secret = Buffer.from(readFileSync(KEY_PATH, 'utf8').trim(), 'hex');
  } else {
    secret = randomBytes(32);
    mkdirSync(dirname(KEY_PATH), { recursive: true });
    writeFileSync(KEY_PATH, secret.toString('hex'), { mode: 0o600 });
  }
  return secret;
}

/** For tests. */
export function setBibKey(hex: string) {
  secret = Buffer.from(hex, 'hex');
}

/** 8 characters ≈ 40 bits. */
export function bibSig(bib: string): string {
  const mac = createHmac('sha256', key()).update(`bib:${bib}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[mac[i] % ALPHABET.length];
  return out;
}

export const bibQr = (bib: string) => `RN1:${bib}:${bibSig(bib)}`;

/** Returns the bib number when the signature checks out, otherwise null. */
export function verifyBibQr(text: string): string | null {
  const q = parseBibQr(text);
  if (!q || !BIB_RE.test(q.bib)) return null;
  const want = Buffer.from(bibSig(q.bib));
  const got = Buffer.from(q.sig);
  return want.length === got.length && timingSafeEqual(want, got) ? q.bib : null;
}

export function bibRange(from: number, count: number): { bib: string; qr: string }[] {
  const out: { bib: string; qr: string }[] = [];
  for (let n = from; n < from + count && n <= 999; n++) {
    const bib = String(n).padStart(3, '0');
    out.push({ bib, qr: bibQr(bib) });
  }
  return out;
}
