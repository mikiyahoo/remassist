import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

/**
 * Password hashing — MIGRATION-PLAN §10.
 *
 * scrypt from node:crypto rather than bcrypt or argon2. It is memory-hard, it
 * is in the standard library, and it adds no dependency to a project that has
 * kept its dependency list to nine packages.
 *
 * Nothing in this module logs a password, puts one in an error message, or
 * returns one. The plaintext exists only as an argument.
 */

/* promisify loses the options overload, so it is restated here rather than
   dropping to `any`. */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Cost parameters, stored inside each hash rather than assumed at verify time.
 * That is what makes them raisable later: an old hash keeps verifying with the
 * parameters it was written with, and gets rewritten on next sign-in if wanted.
 *
 * N=16384,r=8 needs 128*N*r = 16MB. maxmem is set explicitly because the
 * default is close enough to that ceiling to be worth not relying on.
 */
const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/** Deliberately a length floor and nothing else — see passwordProblem. */
export const MIN_PASSWORD_LENGTH = 12;

/**
 * Reject a password before it is ever hashed, or null when it is acceptable.
 *
 * Length only, no composition rules. Requiring a symbol and a digit pushes
 * people towards `Password1!` and its cousins, which are shorter and more
 * guessable than a long passphrase; NIST dropped the composition advice for
 * exactly that reason. The upper bound exists because scrypt happily accepts
 * megabytes and hashing them is a free denial of service.
 */
export function passwordProblem(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase is fine, and easier to remember than a mangled word.`;
  }
  if (plain.length > 200) return 'That is longer than 200 characters.';
  if (plain.trim().length === 0) return 'That is only whitespace.';
  return null;
}

/** `scrypt$N$r$p$salt$hash`, both halves base64. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scryptAsync(plain, salt, KEYLEN, {
    N, r: R, p: P, maxmem: MAXMEM,
  }));
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed or truncated stored value.
 * A corrupted row should fail one sign-in, not surface a 500 that tells an
 * attacker they found something interesting.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    /* Guard the cost parameters: they come from the database, and a tampered
       row asking for an enormous N would hang the process rather than fail. */
    if (n < 1024 || n > 1_048_576 || r < 1 || r > 32 || p < 1 || p > 16) return false;

    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = (await scryptAsync(plain, salt, expected.length, {
      N: n, r, p, maxmem: MAXMEM,
    }));

    /* Constant time. A plain === leaks how many leading bytes matched, which
       over enough attempts recovers the hash a byte at a time. */
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
