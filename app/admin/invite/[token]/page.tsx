import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/auth';
import { getDb, isDatabaseConfigured } from '@/db';
import { invitations } from '@/db/schema/auth';
import { CODE_LENGTH } from '@/lib/auth/code';
import {
  hasLiveCode, hashInviteToken, inviteRefusal, isWellFormedInviteToken,
} from '@/lib/auth/invite';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import { acceptInvite, issueInviteCode } from './actions';
import { inviteMessage } from './messages';
import styles from '../../admin.module.css';

/**
 * Accept an invitation — MIGRATION-PLAN §10.
 *
 * Deliberately outside (protected): the person has no account yet, so the gate
 * one directory up would redirect them to a sign-in they cannot complete.
 *
 * Two factors, in two messages. The link proves control of the inbox at invite
 * time; opening it emails a short-lived code that proves it again now. A
 * corporate scanner that prefetches the link, or a message forwarded to the
 * wrong person, therefore is not an account.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Accept your invitation',
  robots: { index: false, follow: false },
};

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const message = inviteMessage(sp.ok, sp.error);

  if (!isWellFormedInviteToken(token)) notFound();

  if (!isDatabaseConfigured()) {
    return (
      <Card title="Not available">
        <p className={styles.signinLede}>
          There is no database configured in this environment, so invitations cannot be
          accepted here.
        </p>
      </Card>
    );
  }

  const db = getDb();
  const [row] = await db
    .select({
      email: invitations.email,
      expiresAt: invitations.expiresAt,
      acceptedAt: invitations.acceptedAt,
      codeHash: invitations.codeHash,
      codeExpiresAt: invitations.codeExpiresAt,
    })
    .from(invitations)
    .where(eq(invitations.tokenHash, hashInviteToken(token)))
    .limit(1);

  if (!row) notFound();

  const refusal = inviteRefusal(row);
  if (refusal === 'accepted') {
    return (
      <Card title="Already accepted">
        <p className={styles.signinLede}>
          This invitation has been used and the account already exists. Sign in with the
          password that was chosen at the time.
        </p>
        <p className={styles.signinFoot}><Link href="/admin/signin">Go to sign in</Link></p>
      </Card>
    );
  }
  if (refusal === 'expired') {
    return (
      <Card title="This invitation has expired">
        <p className={styles.signinLede}>
          Invitations are good for seven days. Ask whoever invited you to send a new one —
          the address is still fine, only the link has lapsed.
        </p>
      </Card>
    );
  }

  /**
   * Somebody already signed in cannot accept an invitation without ending up
   * with two accounts and a confusing session. Say so rather than letting the
   * form create the mess.
   */
  const session = await auth();
  if (session?.user?.email) {
    return (
      <Card title="You are already signed in">
        <p className={styles.signinLede}>
          This browser is signed in as <strong>{session.user.email}</strong>. Sign out first,
          then open this link again.
        </p>
        <p className={styles.signinFoot}><Link href="/admin/leads">Back to the admin</Link></p>
      </Card>
    );
  }

  const live = hasLiveCode(row);

  return (
    <Card title="Accept your invitation">
      <p className={styles.signinLede}>
        You have been invited to the Rem Assist admin as <strong>{row.email}</strong>.
      </p>

      {message && (
        <p
          className={`${styles.signinMsg} ${message.tone === 'ok' ? styles.msgOk : styles.msgErr}`}
          role="alert"
        >
          {message.text}
        </p>
      )}

      {!live ? (
        <>
          <p className={styles.signinLede}>
            To finish, we need to check this inbox is yours right now and not just at the
            moment the invitation was sent. Sending a {CODE_LENGTH}-digit code does that.
          </p>
          <form className={styles.signinForm} action={issueInviteCode}>
            <input type="hidden" name="token" value={token} />
            <button className={styles.signinBtn} type="submit">Email me a code</button>
          </form>
        </>
      ) : (
        <>
          <form className={styles.signinForm} action={acceptInvite}>
            <input type="hidden" name="token" value={token} />

            <div className={styles.signinField}>
              <label className={styles.signinLabel} htmlFor="invite-code">
                Code from your email
              </label>
              <input
                className={`${styles.signinInput} ${styles.codeInput}`}
                id="invite-code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern={`[0-9 ]{${CODE_LENGTH},}`}
                maxLength={CODE_LENGTH + 6}
                placeholder="000000"
                required
                autoFocus
              />
            </div>

            <div className={styles.signinField}>
              <label className={styles.signinLabel} htmlFor="invite-password">
                Choose a password
              </label>
              <input
                className={styles.signinInput}
                id="invite-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
                required
              />
            </div>

            <div className={styles.signinField}>
              <label className={styles.signinLabel} htmlFor="invite-confirm">
                Repeat the password
              </label>
              <input
                className={styles.signinInput}
                id="invite-confirm"
                name="confirm"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                required
              />
            </div>

            <button className={styles.signinBtn} type="submit">
              Create my account
            </button>
          </form>

          <form action={issueInviteCode}>
            <input type="hidden" name="token" value={token} />
            <button className={styles.signinAlt} type="submit">Send a new code</button>
          </form>
        </>
      )}
    </Card>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.signinWrap}>
      <div className={styles.signinCard}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.signinLogo} src="/images/rem-logo.svg" alt="Rem Assist" />
        <h1 className={styles.signinTitle}>{title}</h1>
        {children}
      </div>
    </div>
  );
}
