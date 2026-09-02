'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthError } from 'next-auth';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { signIn } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/db';
import { invitations, users } from '@/db/schema/auth';
import { isAllowedEmail } from '@/lib/auth/allowlist';
import { clearFailures, isLockedOut, recordFailure } from '@/lib/auth/attempts';
import { generateSigninCode, normaliseCode } from '@/lib/auth/code';
import { renderInviteCodeEmail } from '@/lib/auth/email';
import {
  hasLiveCode, hashInviteToken, inviteCodeExpiry, inviteRefusal, invitePath,
  isWellFormedInviteToken,
} from '@/lib/auth/invite';
import { sendAuthEmail } from '@/lib/auth/mailer';
import { hashPassword, passwordProblem, verifyPassword } from '@/lib/auth/password';
import { REMEMBER_COOKIE, rememberCookieOptions } from '@/lib/auth/remember';

/**
 * Accepting an invitation — MIGRATION-PLAN §10.
 *
 * These are the only actions in the application reachable by somebody with no
 * session, so everything is re-derived from the token on every call. The page
 * having already validated it means nothing: a server action is a POST endpoint
 * with a generated name, and nothing stops it being called directly with a
 * different token, a different password, or after the invitation was revoked.
 */

function back(token: string, param: 'ok' | 'error', code: string): never {
  redirect(`${invitePath(token)}?${param}=${code}`);
}

/**
 * The invitation row, or a redirect explaining why not.
 *
 * `notFound` for a token that does not resolve, rather than a message: there is
 * nothing useful to say to somebody holding a string that was never a token,
 * and the 404 is the same answer a mistyped URL gets anywhere else.
 */
async function loadInvitation(token: string) {
  if (!isWellFormedInviteToken(token)) redirect('/admin/signin');
  const db = getDb();
  const [row] = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      invitedBy: invitations.invitedBy,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      codeHash: invitations.codeHash,
      codeExpiresAt: invitations.codeExpiresAt,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, hashInviteToken(token)))
    .limit(1);

  /* An unusable invitation sends them to the page, which renders the reason.
     Redirecting here rather than returning null keeps every caller from having
     to remember the null case. */
  if (!row || inviteRefusal(row)) redirect(invitePath(token));
  return row;
}

/** Email the second factor. Also used to resend when the first one expires. */
export async function issueInviteCode(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isWellFormedInviteToken(token)) redirect('/admin/signin');
  if (!isDatabaseConfigured()) back(token, 'error', 'no-database');

  const row = await loadInvitation(token);
  const resend = Boolean(row.codeHash);

  /* Guard the resend button as well as the code itself. Without this, anyone
     holding the link could make us send unlimited mail to that address. */
  if (await isLockedOut(row.email)) back(token, 'error', 'code-wrong');

  const code = generateSigninCode();
  const db = getDb();

  /* Written before the send. If the write succeeded and the send did not, the
     person can ask for another; if the send succeeded and the write had not,
     they would be typing a code nothing could verify. */
  await db
    .update(invitations)
    .set({ codeHash: await hashPassword(code), codeExpiresAt: inviteCodeExpiry() })
    .where(eq(invitations.id, row.id));

  const { subject, html, text } = renderInviteCodeEmail({ code });
  let sent = true;
  try {
    await sendAuthEmail({
      to: row.email,
      subject,
      html,
      text,
      localPreview: [
        '',
        '  ┌─ Registration code (local only — no email was sent)',
        `  │  ${row.email}`,
        `  └─ code: ${code}`,
        '',
      ].join('\n'),
    });
  } catch {
    sent = false;
  }

  if (!sent) {
    /* Clear the code we just wrote. Leaving it would mean the form asks for a
       code that was never delivered. */
    await db
      .update(invitations)
      .set({ codeHash: null, codeExpiresAt: null })
      .where(eq(invitations.id, row.id));
    back(token, 'error', 'send-failed');
  }

  back(token, 'ok', resend ? 'code-resent' : 'code-sent');
}

/**
 * Redeem the code, create the account, and sign them in.
 *
 * The password is validated first, before the code is even looked at. Getting
 * the password wrong is the ordinary mistake here, and checking the code first
 * would spend one of five lockout attempts on it — five typos in a password
 * field would lock somebody out of their own registration.
 */
export async function acceptInvite(formData: FormData): Promise<void> {
  const token = String(formData.get('token') ?? '');
  if (!isWellFormedInviteToken(token)) redirect('/admin/signin');
  if (!isDatabaseConfigured()) back(token, 'error', 'no-database');

  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');
  const code = normaliseCode(String(formData.get('code') ?? ''));

  if (password !== confirm) back(token, 'error', 'password-mismatch');
  if (passwordProblem(password)) back(token, 'error', 'password-weak');

  const row = await loadInvitation(token);
  const db = getDb();

  if (await isLockedOut(row.email)) back(token, 'error', 'code-wrong');

  if (!hasLiveCode(row) || !(await verifyPassword(code, row.codeHash!))) {
    await recordFailure(row.email);
    back(token, 'error', 'code-wrong');
  }
  await clearFailures(row.email);

  /* The domain gate again, at the last moment before an account exists. The
     address was checked when the invitation was created, but the allowlist can
     change between then and a week later, and this is the point of no return. */
  if (!isAllowedEmail(row.email)) back(token, 'error', 'taken');

  /* Hashed before the transaction opens, not inside it. scrypt is deliberately
     ~100ms of CPU, and doing it between BEGIN and COMMIT holds a connection and
     the row locks for that whole time to no purpose. */
  const passwordHash = await hashPassword(password);

  let created = true;
  try {
    await db.transaction(async (tx) => {
      /**
       * Both writes or neither. A user created without the invitation being
       * marked accepted leaves a live token that would fail on the unique
       * index and look, to the person holding it, like a broken link.
       */
      await tx.insert(users).values({
        email: row.email,
        role: row.role,
        passwordHash,
        /* Verified by construction: they just proved control of this inbox by
           typing a code we emailed to it. */
        emailVerified: new Date(),
        invitedBy: row.invitedBy,
      });

      const marked = await tx
        .update(invitations)
        .set({ acceptedAt: new Date(), codeHash: null, codeExpiresAt: null })
        .where(and(eq(invitations.id, row.id), isNull(invitations.acceptedAt)))
        .returning({ id: invitations.id });

      /* Lost the race against another submission of the same form. Rolling
         back is right: the other one already created the account. */
      if (marked.length === 0) throw new Error('invitation already accepted');
    });
  } catch {
    created = false;
  }

  if (!created) {
    /* Either the unique index on lower(email) refused a duplicate, or another
       submission got there first. Both mean the account exists and they should
       sign in — which is also true if they simply double-clicked. */
    const [exists] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${row.email.toLowerCase()}`)
      .limit(1);
    if (exists) back(token, 'error', 'taken');
    back(token, 'error', 'no-database');
  }

  /* Sized before signIn, because auth.ts reads this cookie during the request
     that creates the session row. Short by default — nobody ticked anything. */
  const jar = await cookies();
  jar.set(REMEMBER_COOKIE, '0', rememberCookieOptions(false, process.env.NODE_ENV === 'production'));

  try {
    /* The ordinary password provider, so registration ends on exactly the path
       every later sign-in takes rather than a second, less-tested one. */
    await signIn('password', { email: row.email, password, redirectTo: '/admin/leads' });
  } catch (err) {
    /* signIn signals success by throwing a redirect, so only an AuthError is a
       real failure. The account exists either way, so send them to sign in. */
    if (err instanceof AuthError) redirect('/admin/signin');
    throw err;
  }
}
