/**
 * What the Rates screen can say after an action.
 *
 * Fixed codes in the query string, resolved to text here — the same rule as
 * every other admin screen. An action must never put its own wording into a
 * URL that is rendered back into the page, and an unknown code renders nothing.
 */
export const RATE_OK = {
  saved: 'Saved. Every quote from now on uses the new figure.',
  added: 'Added. It is live in the quote calculator straight away.',
  deactivated: 'Deactivated. It stops appearing in new quotes; nothing was deleted.',
  reactivated: 'Back in use. New quotes can reach it again.',
} as const;

export const RATE_ERR = {
  'no-database': 'The database is unavailable, so nothing was changed.',
  forbidden: 'Only the admin may change the price list.',
  'not-found': 'That row no longer exists.',
  'empty-label': 'A label is required.',
  'too-long': 'That is longer than the field allows.',
  'bad-key': 'A key may only contain lowercase letters, digits and hyphens — the quote calculator matches on it.',
  'key-taken': 'That key is already in use. Edit the existing row instead of adding a second one under the same key.',
  'bad-rate': 'An hourly rate must be a positive amount of dollars, at most two decimal places.',
  'bad-seats': 'Seats must be a whole number from 1 to 99.',
  'bad-hours': 'Monthly hours must be a whole number from 1 to 9999.',
  'not-confirmed': 'Nothing was changed — the confirmation box was not ticked.',
  'last-one': 'That is the last active row. The quote calculator needs at least one, so it was left alone.',
} as const;

export function rateMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in RATE_ERR) return { text: RATE_ERR[err as keyof typeof RATE_ERR], tone: 'err' };
  if (ok && ok in RATE_OK) return { text: RATE_OK[ok as keyof typeof RATE_OK], tone: 'ok' };
  return null;
}
