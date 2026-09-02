import { randomInt } from 'node:crypto';

/**
 * The sign-in code — MIGRATION-PLAN §10.
 *
 * One token backs both the emailed link and the typed code: Auth.js puts
 * whatever this returns into the callback URL, so the same six digits work
 * either way. That keeps the flow single-use whichever route the person takes,
 * with no second token to expire or invalidate.
 */

export const CODE_LENGTH = 6;

/** Token lifetime in seconds, for both the link and the code. */
export const CODE_TTL_SEC = 15 * 60;

/**
 * A cryptographically random 6-digit code.
 *
 * `randomInt`, never `Math.random`: the entire scheme rests on this value being
 * unguessable, and Math.random is a predictable PRNG.
 *
 * Zero-padded, which is not cosmetic. Without it the ~10% of values below
 * 100000 render as a short string, and somebody typing the leading zero they
 * were shown would be told their correct code is wrong.
 */
export function generateSigninCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
}

/**
 * Normalise what somebody typed into what we can compare.
 *
 * People paste codes with spaces in them, and phone keyboards like to add a
 * trailing one. Non-digits are stripped rather than rejected so a paste of
 * "483 920" works instead of failing for a reason nobody can see.
 */
export function normaliseCode(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH);
}

/** Whether a typed code is the right shape to be worth sending to the server. */
export function isWellFormedCode(input: string): boolean {
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(input);
}
