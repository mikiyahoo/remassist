'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { asc, count, eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { reviewSources, reviews } from '@/db/schema';
import { assertUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';

/**
 * Review editing.
 *
 * Same gate as every other action: assertUser plus canEditContent, checked here
 * and not merely on the page, because a server action is a POST endpoint that
 * renders outside the layout tree.
 *
 * A note on what these rows ARE, because it changes what the screen should
 * allow. Each one is a quote from a named person on Trustpilot or Google. The
 * fields exist so a transcription error can be corrected, not so the wording
 * can be improved — a tool that freely rewrites testimonial text is a tool for
 * fabricating testimonials. Two things follow, and both are enforced rather
 * than merely suggested: a source must keep a working link, so a reader can
 * check the original; and nothing here deletes, so a review that is taken down
 * still has its wording on record.
 */

const MAX_SHORT = 200;
const MAX_BODY = 4000;

function back(param: 'ok' | 'error', code: string): never {
  redirect(`/admin/content/reviews?${param}=${code}`);
}

async function assertEditor() {
  const user = await assertUser();
  if (!canEditContent(user.role)) throw new Error('forbidden');
  return user;
}

/** /reviews is prerendered, so this is what makes an edit visible. */
function published() {
  revalidatePath('/reviews');
  revalidatePath('/admin/content/reviews');
}

function ratingOf(v: FormDataEntryValue | null): number | null {
  const n = Number(String(v ?? ''));
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

export async function saveReview(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const author = String(formData.get('author') ?? '').trim();
  const meta = String(formData.get('meta') ?? '').trim();
  const dateText = String(formData.get('dateText') ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const rating = ratingOf(formData.get('rating'));

  if (!author || !dateText || !body) back('error', 'empty');
  if (author.length > MAX_SHORT || meta.length > MAX_SHORT
    || dateText.length > MAX_SHORT || headline.length > MAX_SHORT) back('error', 'too-long');
  if (body.length > MAX_BODY) back('error', 'too-long');
  if (rating === null) back('error', 'bad-rating');

  const db = getDb();
  const [row] = await db
    .update(reviews)
    /* headline is nullable and only Trustpilot uses it, so an empty box stores
       null rather than '' — otherwise the public page renders an empty heading
       above every Google review. */
    .set({ author, meta, dateText, headline: headline || null, body, rating })
    .where(eq(reviews.id, id))
    .returning({ id: reviews.id });

  if (!row) back('error', 'not-found');

  published();
  back('ok', 'saved');
}

export async function addReview(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const source = String(formData.get('source') ?? '');
  const author = String(formData.get('author') ?? '').trim();
  const meta = String(formData.get('meta') ?? '').trim();
  const dateText = String(formData.get('dateText') ?? '').trim();
  const headline = String(formData.get('headline') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const rating = ratingOf(formData.get('rating'));

  if (!author || !dateText || !body) back('error', 'empty');
  if (rating === null) back('error', 'bad-rating');

  const db = getDb();
  const [known] = await db
    .select({ source: reviewSources.source })
    .from(reviewSources)
    .where(eq(reviewSources.source, source as 'trustpilot' | 'google'))
    .limit(1);
  if (!known) back('error', 'source-not-found');

  const [{ n }] = await db
    .select({ n: count() })
    .from(reviews)
    .where(eq(reviews.source, known.source));

  await db.insert(reviews).values({
    source: known.source,
    author,
    meta,
    dateText,
    headline: headline || null,
    body,
    rating,
    sortOrder: Number(n),
    /* Off the page until somebody has checked it against the original. These
       are other people's words; publishing one the instant it is typed is how
       a transcription error becomes a public misquote. */
    published: false,
  });

  published();
  back('ok', 'added');
}

export async function setReviewPublished(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const next = formData.get('published') === '1';

  const db = getDb();
  const [row] = await db
    .update(reviews)
    .set({ published: next })
    .where(eq(reviews.id, id))
    .returning({ id: reviews.id });

  if (!row) back('error', 'not-found');

  published();
  back('ok', next ? 'published' : 'unpublished');
}

/** Swap with a neighbour inside the source, in one transaction. See moveFaqItem. */
export async function moveReview(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';

  const db = getDb();
  const [item] = await db
    .select({ id: reviews.id, source: reviews.source, sortOrder: reviews.sortOrder })
    .from(reviews)
    .where(eq(reviews.id, id))
    .limit(1);
  if (!item) back('error', 'not-found');

  const siblings = await db
    .select({ id: reviews.id, sortOrder: reviews.sortOrder })
    .from(reviews)
    .where(eq(reviews.source, item.source))
    .orderBy(asc(reviews.sortOrder));

  const at = siblings.findIndex((s) => s.id === item.id);
  const swapWith = direction === 'up' ? siblings[at - 1] : siblings[at + 1];
  if (!swapWith) back('ok', 'moved');

  await db.transaction(async (tx) => {
    await tx.update(reviews).set({ sortOrder: swapWith.sortOrder }).where(eq(reviews.id, item.id));
    await tx.update(reviews).set({ sortOrder: item.sortOrder }).where(eq(reviews.id, swapWith.id));
  });

  published();
  back('ok', 'moved');
}

export async function saveReviewSource(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const source = String(formData.get('source') ?? '');
  const url = String(formData.get('url') ?? '').trim();
  const ratingLabel = String(formData.get('ratingLabel') ?? '').trim();
  const footnote = String(formData.get('footnote') ?? '').trim();
  const stars = ratingOf(formData.get('stars'));

  if (!url || !ratingLabel) back('error', 'empty');
  if (stars === null) back('error', 'bad-rating');

  /**
   * The link is what lets a reader go and check the review for themselves, so
   * it is required to be a real one. A testimonial section that cites a source
   * nobody can follow is just a claim.
   */
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    back('error', 'bad-url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') back('error', 'bad-url');

  const db = getDb();
  const [row] = await db
    .update(reviewSources)
    .set({ url, ratingLabel, stars, footnote: footnote || null })
    .where(eq(reviewSources.source, source as 'trustpilot' | 'google'))
    .returning({ source: reviewSources.source });

  if (!row) back('error', 'source-not-found');

  published();
  back('ok', 'source-saved');
}
