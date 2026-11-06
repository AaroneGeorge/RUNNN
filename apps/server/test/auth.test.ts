import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';

describe('guest profiles', () => {
  it('creates and renames', () => {
    const s = new Store();
    const { profile, token } = s.createProfile('  Sam  ');
    expect(profile.name).toBe('Sam');
    expect(s.profileIdByToken(token)).toBe(profile.id);
    expect(s.rename(profile.id, 'Samira').name).toBe('Samira');
    expect(() => s.createProfile('   ')).toThrow();
  });
});

describe('email sign-in', () => {
  it('stores only a hash and verifies the code', () => {
    const s = new Store();
    const { code } = s.startEmail('Me@Example.com');
    const row = s.db.prepare('SELECT * FROM email_codes').get() as Record<string, unknown>;
    expect(JSON.stringify(row)).not.toContain(code);
    const r = s.verifyEmail('me@example.com', code);
    expect(r.profile.name).toBe('me');
    expect(s.me(r.profile.id)!.email).toBe('me@example.com');
  });

  it('enforces the resend gap and the hourly cap', () => {
    const s = new Store();
    let t = 1_000_000;
    s.startEmail('a@b.co', t);
    expect(() => s.startEmail('a@b.co', t + 5000)).toThrow(/30 seconds/);
    for (let i = 0; i < 4; i++) s.startEmail('a@b.co', (t += 31_000));
    expect(() => s.startEmail('a@b.co', (t += 31_000))).toThrow(/Too many/);
  });

  it('allows five wrong tries then locks the code', () => {
    const s = new Store();
    const { code } = s.startEmail('a@b.co');
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect(() => s.verifyEmail('a@b.co', wrong)).toThrow(/Wrong code/);
    expect(() => s.verifyEmail('a@b.co', code)).toThrow(/Too many/);
  });

  it('expires codes after ten minutes', () => {
    const s = new Store();
    const { code } = s.startEmail('a@b.co', 0);
    expect(() => s.verifyEmail('a@b.co', code, undefined, 11 * 60_000)).toThrow(/expired/);
  });

  it('attaches the email to a signed-in guest so their XP survives', () => {
    const s = new Store();
    const guest = s.createProfile('Guest');
    s.db.prepare('UPDATE profiles SET xp = 250 WHERE id = ?').run(guest.profile.id);
    const { code } = s.startEmail('g@x.io');
    const r = s.verifyEmail('g@x.io', code, guest.token);
    expect(r.linked).toBe(true);
    expect(r.profile.id).toBe(guest.profile.id);
    expect(r.profile.xp).toBe(250);

    // Next phone: same address returns the same profile.
    const again = s.startEmail('g@x.io', Date.now() + 60_000);
    const r2 = s.verifyEmail('g@x.io', again.code, undefined, Date.now() + 61_000);
    expect(r2.profile.id).toBe(guest.profile.id);
    expect(r2.token).toBe(guest.token);
  });

  it('rejects junk addresses', () => {
    const s = new Store();
    expect(() => s.startEmail('not-an-email')).toThrow();
  });
});
