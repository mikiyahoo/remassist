/**
 * What the reviews editor can say after an action.
 *
 * Fixed codes in the query string, resolved to text here — an action never puts
 * its own wording into a URL that gets rendered back into the page. Unknown
 * codes render nothing.
 */
export const REVIEW_OK = {
  saved: 'Saved.',
  added: 'Review added, and left off the page until you publish it.',
  published: 'That review is on the reviews page.',
  unpublished: 'That review is off the page. Nothing was deleted — the wording is kept.',
  moved: 'Order updated.',
  'source-saved': 'Source details saved.',
} as const;

export const REVIEW_ERR = {
  'no-database': 'The database is unavailable, so nothing was changed.',
  'not-found': 'That review no longer exists.',
  'source-not-found': 'That source no longer exists.',
  empty: 'An author, a date, and the review text are all required.',
  'too-long': 'That is longer than the field allows.',
  'bad-rating': 'A rating has to be a whole number from 1 to 5.',
  'bad-url': 'The source link must be an http or https URL — it is what lets a reader check the review.',
} as const;

export function reviewMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in REVIEW_ERR) {
    return { text: REVIEW_ERR[err as keyof typeof REVIEW_ERR], tone: 'err' };
  }
  if (ok && ok in REVIEW_OK) {
    return { text: REVIEW_OK[ok as keyof typeof REVIEW_OK], tone: 'ok' };
  }
  return null;
}
