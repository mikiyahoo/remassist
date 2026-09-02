'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { posts } from '@/db/schema';
import { assertUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import { isPublishable } from '@/lib/blog/legacy-bodies';

/**
 * Blog post editing.
 *
 * Same gate as the other content actions, checked here rather than only on the
 * page, because a server action is separately reachable.
 *
 * Bodies are stored as PLAIN TEXT, not HTML, and that is a security decision
 * rather than a simplification. Staff-authored HTML rendered raw on a public
 * page is stored XSS the moment one editor account is phished, and the usual
 * answer — sanitise it — means either a new dependency in a project that has
 * kept to nine, or a hand-rolled sanitiser, which is a well-known way to be
 * confidently wrong. Plain text with blank lines for paragraphs and a leading
 * "## " for a heading has no parsing surface at all. Richer formatting is worth
 * doing later, with a real Markdown library, as its own deliberate step.
 */

const MAX_TITLE = 300;
const MAX_EXCERPT = 600;
const MAX_BODY = 120_000;

function back(param: 'ok' | 'error', code: string): never {
  redirect(`/admin/content/posts?${param}=${code}`);
}

async function assertEditor() {
  const user = await assertUser();
  if (!canEditContent(user.role)) throw new Error('forbidden');
  return user;
}

/**
 * The blog index and the article are both prerendered, so both need clearing.
 * Revalidating only the index is the subtle version of this bug: the list shows
 * a new title that links to a stale page.
 */
function publishedPaths(slug?: string) {
  revalidatePath('/blog');
  if (slug) revalidatePath(`/blog/${slug}`);
  revalidatePath('/admin/content/posts');
}

/** Lowercase letters, numbers and hyphens: this value is the URL. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function savePost(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
  const excerpt = String(formData.get('excerpt') ?? '').trim();
  const body = String(formData.get('body') ?? '');
  const date = String(formData.get('date') ?? '').trim();
  const readTime = String(formData.get('readTime') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  const image = String(formData.get('image') ?? '').trim();
  const authorName = String(formData.get('authorName') ?? '').trim();
  const authorAvatar = String(formData.get('authorAvatar') ?? '').trim();

  if (!title || !slug || !excerpt) back('error', 'empty');
  if (title.length > MAX_TITLE || excerpt.length > MAX_EXCERPT) back('error', 'too-long');
  if (body.length > MAX_BODY) back('error', 'too-long');
  if (!SLUG_RE.test(slug)) back('error', 'bad-slug');
  if (!DATE_RE.test(date)) back('error', 'bad-date');

  const db = getDb();

  const [clash] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(and(eq(posts.slug, slug), sql`${posts.id} <> ${id}`))
    .limit(1);
  if (clash) back('error', 'slug-taken');

  const [existing] = await db
    .select({ slug: posts.slug, published: posts.published })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!existing) back('error', 'not-found');

  /* A published post that would be left with nothing to read is refused rather
     than silently unpublished — quietly taking a live article off the blog
     because somebody cleared a textarea is worse than saying no. */
  if (existing.published && !isPublishable(slug, body || null)) back('error', 'no-body');

  await db
    .update(posts)
    .set({
      title,
      slug,
      excerpt,
      body: body.trim() ? body : null,
      date,
      readTime,
      category,
      image,
      authorName,
      authorAvatar,
      updatedAt: new Date(),
    })
    .where(eq(posts.id, id));

  /* Both the old and new slug: renaming a post leaves the previous URL cached
     until something clears it. */
  publishedPaths(slug);
  if (existing.slug !== slug) revalidatePath(`/blog/${existing.slug}`);
  back('ok', 'saved');
}

export async function addPost(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const title = String(formData.get('title') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase();
  const excerpt = String(formData.get('excerpt') ?? '').trim();

  if (!title || !slug || !excerpt) back('error', 'empty');
  if (!SLUG_RE.test(slug)) back('error', 'bad-slug');

  const db = getDb();
  const [clash] = await db
    .select({ id: posts.id })
    .from(posts)
    .where(eq(posts.slug, slug))
    .limit(1);
  if (clash) back('error', 'slug-taken');

  await db.insert(posts).values({
    title,
    slug,
    excerpt,
    body: null,
    /* Today, in UTC. The column is display text in YYYY-MM-DD, matching what
       lib/blog/posts.ts already held. */
    date: new Date().toISOString().slice(0, 10),
    readTime: '5 min read',
    category: 'Uncategorised',
    image: '/images/blog/placeholder.jpg',
    authorName: '',
    authorAvatar: '',
    /* A draft. Nothing reaches the blog without somebody choosing to publish. */
    published: false,
  });

  publishedPaths();
  back('ok', 'added');
}

export async function setPostPublished(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const next = formData.get('published') === '1';

  const db = getDb();
  const [row] = await db
    .select({ slug: posts.slug, body: posts.body })
    .from(posts)
    .where(eq(posts.id, id))
    .limit(1);
  if (!row) back('error', 'not-found');

  /* An empty post on the blog is a link to a blank page. The check allows the
     one article whose body still lives in a component — see
     lib/blog/legacy-bodies.ts. */
  if (next && !isPublishable(row.slug, row.body)) back('error', 'no-body');

  await db.update(posts).set({ published: next, updatedAt: new Date() }).where(eq(posts.id, id));

  publishedPaths(row.slug);
  back('ok', next ? 'published' : 'unpublished');
}
