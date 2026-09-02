/**
 * What the posts editor can say after an action.
 *
 * Fixed codes in the query string, resolved to text here. Unknown codes render
 * nothing.
 */
export const POST_OK = {
  saved: 'Saved.',
  added: 'Draft created. It is not on the blog until you publish it.',
  published: 'That post is live on the blog.',
  unpublished: 'That post is off the blog. Nothing was deleted — the draft is kept.',
} as const;

export const POST_ERR = {
  'no-database': 'The database is unavailable, so nothing was changed.',
  'not-found': 'That post no longer exists.',
  empty: 'A title, a slug and an excerpt are all required.',
  'too-long': 'That is longer than the field allows.',
  'bad-slug': 'A slug may only contain lowercase letters, numbers and hyphens — it is the URL.',
  'slug-taken': 'Another post already uses that slug.',
  'no-body': 'This post has no article body, so it cannot be published. Write one first.',
  'bad-date': 'Use a date in YYYY-MM-DD form.',
} as const;

export function postMessage(
  ok: string | undefined,
  err: string | undefined,
): { text: string; tone: 'ok' | 'err' } | null {
  if (err && err in POST_ERR) return { text: POST_ERR[err as keyof typeof POST_ERR], tone: 'err' };
  if (ok && ok in POST_OK) return { text: POST_OK[ok as keyof typeof POST_OK], tone: 'ok' };
  return null;
}
