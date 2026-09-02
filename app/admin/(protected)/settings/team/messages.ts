import { ALLOWED_DOMAINS } from '@/lib/auth/allowlist';

/**
 * What the team screen can say after an action — MIGRATION-PLAN §10.
 *
 * Fixed codes in the query string, resolved to text here, for the same reason
 * as the settings screen: an action must never put its own wording into a URL
 * that gets rendered back into the page. Unknown codes render nothing.
 */
export const TEAM_OK = {
  invited: 'Invitation sent.',
  reinvited: 'A new invitation was sent, and the earlier link stopped working.',
  disabled: 'That account is disabled. They lose access on their next request.',
  enabled: 'That account can sign in again.',
} as const;

export const TEAM_ERR = {
  'bad-domain': `Invitations can only be sent to a company address (${ALLOWED_DOMAINS.join(', ')}).`,
  'already-a-user': 'Somebody with that address already has an account.',
  'send-failed': 'The invitation could not be emailed, so it was cancelled. Check the mail configuration and try again.',
  'no-database': 'The database is unavailable, so nothing was changed.',
  'not-found': 'That account no longer exists.',
  'refuse-self': 'You cannot disable your own account. There is no second administrator to undo it.',
  'refuse-admin': 'The administrator account cannot be disabled.',
} as const;

export function teamMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in TEAM_ERR) return { text: TEAM_ERR[err as keyof typeof TEAM_ERR], tone: 'err' };
  if (ok && ok in TEAM_OK) return { text: TEAM_OK[ok as keyof typeof TEAM_OK], tone: 'ok' };
  return null;
}
