'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { invitations, sessions, users } from '@/db/schema/auth';
import { isAllowedEmail } from '@/lib/auth/allowlist';
import { assertRole } from '@/lib/auth/require';
import { sendAuthEmail } from '@/lib/auth/mailer';
import { renderInviteEmail } from '@/lib/auth/email';
import { siteOrigin } from '@/lib/auth/origin';
import { generateInviteToken, hashInviteToken, inviteExpiry, invitePath } from '@/lib/auth/invite';

/**
 * Team administration — MIGRATION-PLAN §10.
 *
 * Every action starts with assertRole('admin'), and that is the actual
 * permission. A server action is a POST endpoint with a generated name that
 * renders outside the layout tree, so hiding the Team link from a manager
 * hides a link and nothing more — the manager can still call this.
 *
 * assertRole throws rather than redirecting, deliberately: a manager reaching
 * these is either a bug or an attack, and neither deserves a tidy error page.
 */

function back(param: 'ok' | 'error', code: string): never {
  redirect(`/admin/settings/team?${param}=${code}`);
}

export async function inviteManager(formData: FormData): Promise<void> {
  const admin = await assertRole('admin');
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  if (!isAllowedEmail(email)) back('error', 'bad-domain');

  const db = getDb();
  const now = new Date();

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);
  if (existing) back('error', 'already-a-user');

  /**
   * Expire any invitation already outstanding for this address rather than
   * leaving two live tokens, and expire rather than delete so the record of who
   * invited whom survives — the same rule as disabling a user instead of
   * removing them.
   */
  const [superseded] = await db
    .update(invitations)
    .set({ expiresAt: now })
    .where(and(
      eq(invitations.email, email),
      isNull(invitations.acceptedAt),
      gt(invitations.expiresAt, now),
    ))
    .returning({ id: invitations.id });

  const token = generateInviteToken();
  const [created] = await db
    .insert(invitations)
    .values({
      email,
      tokenHash: hashInviteToken(token),
      role: 'manager',
      invitedBy: admin.id,
      expiresAt: inviteExpiry(now),
    })
    .returning({ id: invitations.id });

  const url = `${await siteOrigin()}${invitePath(token)}`;
  const { subject, html, text } = renderInviteEmail({ url, invitedByEmail: admin.email });

  let sent = true;
  try {
    await sendAuthEmail({
      to: email,
      subject,
      html,
      text,
      localPreview: [
        '',
        '  ┌─ Manager invitation (local only — no email was sent)',
        `  │  ${email}`,
        `  └─ ${url}`,
        '',
      ].join('\n'),
    });
  } catch {
    sent = false;
  }

  if (!sent) {
    /* Expire the row we just wrote. A pending invitation on the team screen
       that nobody ever received is worse than none: somebody waits for it,
       then asks, then it is quietly resent anyway. */
    await db.update(invitations).set({ expiresAt: now }).where(eq(invitations.id, created.id));
    revalidatePath('/admin/settings/team');
    back('error', 'send-failed');
  }

  revalidatePath('/admin/settings/team');
  back('ok', superseded ? 'reinvited' : 'invited');
}

export async function setUserDisabled(formData: FormData): Promise<void> {
  const admin = await assertRole('admin');
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const userId = String(formData.get('userId') ?? '');
  const disable = formData.get('disable') === '1';

  /* Checked before the row is loaded, so the message is right even in the
     impossible case where the admin's own row has gone missing. */
  if (userId === admin.id) back('error', 'refuse-self');

  const db = getDb();
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) back('error', 'not-found');
  /* There is exactly one admin and it is not the caller, so this is a row that
     should not exist — refuse rather than act on it. */
  if (target.role === 'admin') back('error', 'refuse-admin');

  await db
    .update(users)
    .set({ disabledAt: disable ? new Date() : null })
    .where(eq(users.id, userId));

  if (disable) {
    /**
     * Drop their sessions too.
     *
     * requireUser already loads the row on every request, so this is not what
     * makes the revocation immediate — it is what makes it *true*: a session
     * row left behind is a live credential sitting in the database, and the
     * only reason it stops working is a check somebody could later refactor.
     *
     * Deleting a session is not the delete that canDelete forbids. That rule
     * protects the record of who invited whom; a session row is a credential,
     * and revoking a credential is the whole point of this action.
     */
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  revalidatePath('/admin/settings/team');
  back('ok', disable ? 'disabled' : 'enabled');
}
