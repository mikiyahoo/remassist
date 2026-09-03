import { sendVerificationEmail } from './settings/actions';
import type { AdminUser } from '@/lib/auth/require';
import styles from '../admin.module.css';

/**
 * "Your email is not verified yet" — MIGRATION-PLAN §10, phase 5.
 *
 * Warn-only, and that is a decision rather than an omission. Verification
 * depends on email delivery, which is the very thing that was broken when this
 * work started — a hard block would brick the only admin account with no
 * recovery short of direct SQL. Making it a block later is one guard in
 * requireUser(), and it should only go in after a real sign-in email has been
 * seen to arrive in production.
 *
 * It does grow more insistent after a week, so it cannot be ignored forever
 * without anyone noticing.
 */

/**
 * A week's grace before the banner turns insistent.
 *
 * It was a day, which was the wrong number for the situation it actually
 * describes: verification needs working email, and email is the thing that has
 * not worked in this deployment yet. A red banner on day two blames the person
 * for something they cannot fix, and a warning that appears when nothing can be
 * done about it is a warning people learn to scroll past — which then costs
 * nothing when it fires for a real reason.
 *
 * It still never blocks. Only the tone changes.
 */
const LOUD_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export default function VerifyBanner({ user }: { user: AdminUser }) {
  if (user.emailVerified) return null;

  const loud = Date.now() - user.createdAt.getTime() > LOUD_AFTER_MS;

  return (
    <div
      className={`${styles.verifyBanner} ${loud ? styles.verifyLoud : ''}`}
      role={loud ? 'alert' : 'status'}
    >
      <div>
        <strong>
          {loud ? 'Your email address is still unverified' : 'Verify your email address'}
        </strong>
        <span>
          {loud
            ? `This account has been unverified for more than a week. Nothing is blocked, but
               an unverified address cannot receive a sign-in code — which is the only way
               back in if the password is ever lost.`
            : `We will email you a code. Entering it confirms the address can actually
               receive mail, which is what makes password recovery possible.`}
        </span>
      </div>
      <form action={sendVerificationEmail}>
        <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
          Send verification email
        </button>
      </form>
    </div>
  );
}
