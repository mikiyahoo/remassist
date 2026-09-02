import { and, count, eq, gte, lt } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { signinAttempts } from '@/db/schema/auth';

/**
 * Brute-force lockout for sign-in token redemption.
 *
 * Auth.js ships no throttling on redemption whatsoever, which is defensible for
 * a 32-byte token and indefensible for the 6-digit code we now issue. Without
 * this module the code is a million guesses against an endpoint with no
 * counter, no delay and no lockout.
 *
 * Keyed on the email, not the IP, and deliberately: the attack is guessing one
 * known administrator's code, and an attacker rotating IPs would walk straight
 * through IP keying while email keying still stops them. The cost is that
 * somebody could lock a colleague out for the window — acceptable for nine
 * internal users, and the rows say plainly when it happened.
 */

/** Failures tolerated inside the window before the identifier is locked out. */
export const MAX_ATTEMPTS = 5;

/** How far back failures count, and therefore how long a lockout lasts. */
export const WINDOW_SEC = 15 * 60;

function windowStart(now: Date): Date {
  return new Date(now.getTime() - WINDOW_SEC * 1000);
}

/**
 * True when this identifier has burned through its attempts.
 *
 * Fails OPEN when there is no database — the alternative is locking every
 * administrator out of the admin permanently on a misconfigured box, and the
 * redemption itself cannot succeed without a database anyway.
 */
export async function isLockedOut(identifier: string, now = new Date()): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(signinAttempts)
    .where(and(
      eq(signinAttempts.identifier, identifier),
      gte(signinAttempts.failedAt, windowStart(now)),
    ));
  return (row?.n ?? 0) >= MAX_ATTEMPTS;
}

/**
 * Record one failed redemption, and prune anything older than the window on the
 * way through so the table stays bounded without a scheduled job.
 */
export async function recordFailure(identifier: string, now = new Date()): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  await db.insert(signinAttempts).values({ identifier, failedAt: now });
  await db.delete(signinAttempts).where(lt(signinAttempts.failedAt, windowStart(now)));
}

/** Drop this identifier's failures after a successful sign-in. */
export async function clearFailures(identifier: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const db = getDb();
  await db.delete(signinAttempts).where(eq(signinAttempts.identifier, identifier));
}
