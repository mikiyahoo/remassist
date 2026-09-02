import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import { MAX_ATTEMPTS } from '@/lib/auth/attempts';

/**
 * What the invitation screen can say — MIGRATION-PLAN §10.
 *
 * Fixed codes in the query string, resolved to text here, for the same reason
 * as the two settings screens: an action must never put its own wording into a
 * URL that is rendered back into the page. Unknown codes render nothing.
 */
export const INVITE_OK = {
  'code-sent': 'We emailed you a code. Enter it below along with the password you want.',
  'code-resent': 'A new code is on its way. The previous one no longer works.',
} as const;

export const INVITE_ERR = {
  /* One message for a wrong code, an expired code and a lockout alike.
     Distinguishing them tells somebody guessing which guesses were close and
     when to back off. */
  'code-wrong': `That code did not work. It may have expired — request a new one. After ${MAX_ATTEMPTS} wrong codes the address is locked for fifteen minutes.`,
  'password-weak': `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase is fine, and easier to remember than a mangled word.`,
  'password-mismatch': 'The two passwords did not match.',
  'send-failed': 'The code could not be emailed. Ask whoever invited you to check the mail configuration.',
  'no-database': 'The database is unavailable, so nothing was changed.',
  taken: 'An account with that address already exists. Sign in instead.',
} as const;

export function inviteMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in INVITE_ERR) {
    return { text: INVITE_ERR[err as keyof typeof INVITE_ERR], tone: 'err' };
  }
  if (ok && ok in INVITE_OK) {
    return { text: INVITE_OK[ok as keyof typeof INVITE_OK], tone: 'ok' };
  }
  return null;
}
