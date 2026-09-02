import { isAllowedEmail } from './allowlist';
import { isRole, type Role } from './roles';

/**
 * The authorisation decision itself — MIGRATION-PLAN §10.
 *
 * Split out of require.ts so it can be tested. Not an abstraction for its own
 * sake: require.ts imports `@/auth`, and anything importing that pulls in the
 * whole next-auth module graph, which cannot be loaded in a plain node test
 * without reshaping the shared vitest config. The rules below are the part
 * worth testing and none of them need a session, a request or a database.
 *
 * Pure and free of next-auth, next/headers and database imports, matching the
 * convention of allowlist.ts, roles.ts and invite.ts.
 */

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  emailVerified: Date | null;
  createdAt: Date;
  /**
   * Whether a password has been set, NOT the hash. The settings screen needs
   * to know which of "change" and "set" it is offering, and a hash that never
   * leaves the auth module cannot be logged, serialised into a server
   * component payload, or compared with === by accident.
   */
  hasPassword: boolean;
}

/** The columns the gate reads. Shaped by the select in require.ts. */
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: Date | null;
  createdAt: Date;
  disabledAt: Date | null;
  passwordHash: string | null;
}

/**
 * Who this request is allowed to be, or null.
 *
 * Every refusal returns null rather than throwing or reporting a reason. The
 * callers turn that into a redirect or a 404; none of them wants to know which
 * rule refused, and a reason that reaches a response is a reason an attacker
 * can read.
 *
 * `row` being undefined covers two cases that are the same answer: the query
 * found nothing, and there was no database to ask. That is what makes failing
 * CLOSED structural here rather than a branch somebody has to remember — the
 * opposite of lib/auth/attempts.ts, deliberately. There, failing open means
 * "do not throttle", which beats locking every administrator out of a
 * misconfigured box forever. Here, failing open would mean "everyone is an
 * admin", so no database must deny.
 */
export function authorise(
  email: string | null | undefined,
  row: UserRow | undefined,
): AdminUser | null {
  if (!email) return null;

  /* A cheap outer fence, kept even though the row is authoritative. An address
     off a company domain has no business being resolved to an account. */
  if (!isAllowedEmail(email)) return null;

  if (!row) return null;

  /* Access is revoked by setting this, never by deleting the row. Checked on
     every request rather than at sign-in, which is what makes disabling
     somebody take effect immediately — a revocation that waits for the person
     to cooperate is not a revocation. */
  if (row.disabledAt) return null;

  /* Postgres types this as an enum; it arrives here as a plain string. An
     unrecognised value denies rather than defaulting to 'manager', because a
     role nobody wrote on purpose is a row nobody should be trusting. */
  if (!isRole(row.role)) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    emailVerified: row.emailVerified,
    createdAt: row.createdAt,
    hasPassword: row.passwordHash !== null,
  };
}
