import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/db';
import { users } from '@/db/schema/auth';
import { authorise, type AdminUser } from '@/lib/auth/session';
import { type Role } from '@/lib/auth/roles';

/**
 * The one place authorisation is decided — MIGRATION-PLAN §10.
 *
 * Before this existed the same rule was copied into the layout, two route
 * handlers and a server action. Adding a second rule to each of those is how
 * authorisation bugs get written, so every gate calls in here rather than
 * reimplementing.
 *
 * This module is the plumbing: read the session, read the row, hand both to
 * authorise(). The rules themselves live in session.ts, which imports no
 * next-auth and is therefore testable — see the note at the top of that file.
 *
 * The user row is loaded on every call rather than trusted from the session.
 * That is what makes disabling someone take effect on their next request
 * instead of at their next sign-in.
 */

export type { AdminUser } from '@/lib/auth/session';

/** The signed-in user, or null. */
export async function currentUser(): Promise<AdminUser | null> {
  /* No database means no row to read, and authorise() denies without one. The
     early return is only about not calling getDb(); the decision is identical,
     which is why the fail-closed rule is not restated here. */
  if (!isDatabaseConfigured()) return authorise(null, undefined);

  const session = await auth();
  const email = session?.user?.email;
  if (!email) return authorise(null, undefined);

  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
      disabledAt: users.disabledAt,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1);

  return authorise(email, row);
}

/** For pages and layouts: the user, or a redirect to sign-in. */
export async function requireUser(): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) redirect('/admin/signin');
  return user;
}

/** For pages: the user if they hold the role, or a redirect. */
export async function requireRole(role: Role): Promise<AdminUser> {
  const user = await requireUser();
  if (user.role !== role) redirect('/admin/leads');
  return user;
}

/**
 * For server actions and route handlers, which render outside the layout tree
 * and are therefore not covered by its gate. Throws rather than redirects — a
 * redirect from a POST action is not a refusal the caller can act on.
 */
export async function assertRole(role: Role): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) throw new Error('unauthorised');
  if (user.role !== role) throw new Error('forbidden');
  return user;
}

/** For actions any signed-in user may perform. */
export async function assertUser(): Promise<AdminUser> {
  const user = await currentUser();
  if (!user) throw new Error('unauthorised');
  return user;
}
