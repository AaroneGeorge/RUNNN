import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.ts';

describe('organiser accounts', () => {
  it('logs in, keeps a session and logs out', () => {
    const s = new Store();
    s.addOrganiser('Alice', 'correct horse');
    const r = s.login('alice', 'correct horse')!;
    expect(r).not.toBeNull();
    expect(s.organiser(r.token)!.username).toBe('alice');
    expect(s.profileIdByToken(r.profileToken)).toBe(r.profileId);
    s.logout(r.token);
    expect(s.organiser(r.token)).toBeNull();
  });

  it('rejects wrong passwords and unknown users', () => {
    const s = new Store();
    s.addOrganiser('alice', 'correct horse');
    expect(s.login('alice', 'wrong horse')).toBeNull();
    expect(s.login('bob', 'correct horse')).toBeNull();
  });

  it('takes about as long for an unknown user as for a wrong password', () => {
    const s = new Store();
    s.addOrganiser('alice', 'correct horse');
    const time = (fn: () => void) => {
      const t = performance.now();
      for (let i = 0; i < 5; i++) fn();
      return performance.now() - t;
    };
    const wrongPw = time(() => s.login('alice', 'nope nope'));
    const noUser = time(() => s.login('nobody', 'nope nope'));
    expect(noUser).toBeGreaterThan(wrongPw * 0.4);
  });

  it('expires sessions after 30 days', () => {
    const s = new Store();
    s.addOrganiser('alice', 'correct horse');
    const r = s.login('alice', 'correct horse', undefined, 0)!;
    expect(s.organiser(r.token, 29 * 86400_000)).not.toBeNull();
    expect(s.organiser(r.token, 31 * 86400_000)).toBeNull();
  });

  it('links a guest profile on first login and signs out old sessions on password change', () => {
    const s = new Store();
    const guest = s.createProfile('Ali');
    s.addOrganiser('alice', 'correct horse');
    const r = s.login('alice', 'correct horse', guest.token)!;
    expect(r.profileId).toBe(guest.profile.id);
    s.addOrganiser('alice', 'new password!');
    expect(s.organiser(r.token)).toBeNull();
  });

  it('validates usernames and passwords', () => {
    const s = new Store();
    expect(() => s.addOrganiser('a', 'longenough')).toThrow();
    expect(() => s.addOrganiser('alice', 'short')).toThrow();
    expect(s.removeOrganiser('ghost')).toBe(false);
    s.addOrganiser('alice', 'longenough');
    expect(s.listOrganisers().map((o) => o.username)).toEqual(['alice']);
    expect(s.removeOrganiser('alice')).toBe(true);
  });
});
