import { describe, expect, it } from 'vitest';
import { MIN_PASSWORD_LENGTH, hashPassword, passwordProblem, verifyPassword } from './password';

const GOOD = 'correct horse battery staple';

describe('hashPassword / verifyPassword', () => {
  it('round-trips a password', async () => {
    const hash = await hashPassword(GOOD);
    await expect(verifyPassword(GOOD, hash)).resolves.toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword(GOOD);
    await expect(verifyPassword('correct horse battery stapl', hash)).resolves.toBe(false);
    await expect(verifyPassword('', hash)).resolves.toBe(false);
    await expect(verifyPassword(GOOD.toUpperCase(), hash)).resolves.toBe(false);
  });

  it('salts, so the same password hashes differently every time', async () => {
    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toBe(b);
    // …and both still verify.
    await expect(verifyPassword(GOOD, a)).resolves.toBe(true);
    await expect(verifyPassword(GOOD, b)).resolves.toBe(true);
  });

  it('never stores the password in the hash', async () => {
    const hash = await hashPassword(GOOD);
    expect(hash).not.toContain(GOOD);
    expect(hash).not.toContain('correct');
  });

  it('records its cost parameters, so they can be raised later', async () => {
    const hash = await hashPassword(GOOD);
    expect(hash.split('$')[0]).toBe('scrypt');
    expect(hash.split('$')).toHaveLength(6);
  });

  it('handles unicode and whitespace-bearing passphrases', async () => {
    for (const p of ['Ådam på Ölandsbron 2026', '🔐 a long enough passphrase', 'trailing space   ']) {
      const hash = await hashPassword(p);
      await expect(verifyPassword(p, hash)).resolves.toBe(true);
      await expect(verifyPassword(p.trim() + 'x', hash)).resolves.toBe(false);
    }
  });
});

describe('verifyPassword on a damaged stored value', () => {
  // A corrupted row should fail one sign-in, not throw a 500 that tells an
  // attacker they have found something worth poking at.
  it('returns false instead of throwing', async () => {
    for (const bad of [
      '',
      'not-a-hash',
      'scrypt$16384$8$1$onlyfiveparts',
      'scrypt$16384$8$1$$',
      'bcrypt$16384$8$1$c2FsdA==$aGFzaA==',
      'scrypt$notanumber$8$1$c2FsdA==$aGFzaA==',
      '$$$$$',
    ]) {
      await expect(verifyPassword(GOOD, bad)).resolves.toBe(false);
    }
  });

  it('refuses absurd cost parameters rather than hanging on them', async () => {
    // These come from the database. A tampered row asking for an enormous N
    // would otherwise pin a CPU for minutes on a single sign-in attempt.
    const started = Date.now();
    await expect(
      verifyPassword(GOOD, 'scrypt$999999999$8$1$c2FsdA==$aGFzaA=='),
    ).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('passwordProblem', () => {
  it('accepts a long passphrase', () => {
    expect(passwordProblem(GOOD)).toBeNull();
  });

  it('enforces the length floor at the boundary', () => {
    expect(passwordProblem('x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(passwordProblem('x'.repeat(MIN_PASSWORD_LENGTH - 1))).not.toBeNull();
  });

  it('rejects whitespace-only input that passes the length check', () => {
    expect(passwordProblem(' '.repeat(20))).not.toBeNull();
  });

  it('caps the length, since hashing megabytes is a free denial of service', () => {
    expect(passwordProblem('x'.repeat(200))).toBeNull();
    expect(passwordProblem('x'.repeat(201))).not.toBeNull();
  });

  it('imposes no composition rules', () => {
    // Deliberate: requiring a symbol and a digit pushes people towards
    // "Password1!", which is shorter and more guessable than a passphrase.
    expect(passwordProblem('all lowercase letters here')).toBeNull();
  });

  it('never echoes the password back in the message', () => {
    const secret = 'hunter2';
    expect(passwordProblem(secret)).not.toContain(secret);
  });
});
