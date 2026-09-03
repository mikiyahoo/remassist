'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import { assertUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';

/**
 * FAQ editing.
 *
 * Every action starts with assertUser + canEditContent, and that is the
 * permission. A server action is a POST endpoint with a generated name that
 * renders outside the layout tree, so a page-level gate protects the page and
 * nothing else — the same reasoning already written into the leads and team
 * actions.
 *
 * Nothing here deletes a question. Unpublishing takes it off the site and keeps
 * what it said, which is the same rule accounts follow one level up: the record
 * of what the site once claimed is worth keeping the first time somebody asks
 * why an answer changed. See canUnpublishContent in lib/auth/roles.ts.
 *
 * Every write revalidates /faq. Without that the public page keeps serving the
 * previously rendered HTML and an editor's correction appears to have done
 * nothing — the most common way a CMS gets reported as broken when it is not.
 */

const MAX_QUESTION = 300;
const MAX_ANSWER = 4000;

function back(param: 'ok' | 'error', code: string): never {
  redirect(`/admin/content/faq?${param}=${code}`);
}

/**
 * Back to the edit page for one question rather than to the list.
 *
 * Used where staying put is the useful outcome: a validation failure has to
 * return to the form holding the text, and publishing or reordering from the
 * edit page should not eject you from it.
 */
function backToItem(id: string, param: 'ok' | 'error', code: string): never {
  redirect(`/admin/content/faq/${id}?${param}=${code}`);
}

/** The editing gate, in one place so no action can forget half of it. */
async function assertEditor() {
  const user = await assertUser();
  if (!canEditContent(user.role)) throw new Error('forbidden');
  return user;
}

/**
 * Revalidate the public page as well as this screen.
 *
 * /faq is prerendered, so this is what makes an edit visible. Called after the
 * write rather than before, because revalidating a path then failing to change
 * anything just costs a rebuild.
 */
function published() {
  revalidatePath('/faq');
  revalidatePath('/admin/content/faq');
}

export async function saveFaqItem(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();

  if (!question || !answer) backToItem(id, 'error', 'empty');
  if (question.length > MAX_QUESTION || answer.length > MAX_ANSWER) {
    backToItem(id, 'error', 'too-long');
  }

  const db = getDb();
  const [row] = await db
    .update(faqItems)
    .set({ question, answer })
    .where(eq(faqItems.id, id))
    .returning({ id: faqItems.id });

  if (!row) back('error', 'not-found');

  published();
  back('ok', 'saved');
}

export async function addFaqItem(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const groupId = String(formData.get('groupId') ?? '');
  const question = String(formData.get('question') ?? '').trim();
  const answer = String(formData.get('answer') ?? '').trim();

  if (!question || !answer) back('error', 'empty');
  if (question.length > MAX_QUESTION || answer.length > MAX_ANSWER) back('error', 'too-long');

  const db = getDb();
  const [group] = await db
    .select({ id: faqGroups.id })
    .from(faqGroups)
    .where(eq(faqGroups.id, groupId))
    .limit(1);
  if (!group) back('error', 'group-not-found');

  /* Appended to the end of its section rather than inserted at the top: the
     order on the page is editorial, and a new question arriving above a
     carefully placed one is a change nobody asked for. */
  const [{ n }] = await db
    .select({ n: count() })
    .from(faqItems)
    .where(eq(faqItems.groupId, groupId));

  await db.insert(faqItems).values({
    groupId,
    question,
    answer,
    sortOrder: Number(n),
    /* Unpublished by default. A half-written answer should not appear on the
       public page the instant it is saved. */
    published: false,
  });

  published();
  back('ok', 'added');
}

export async function setFaqItemPublished(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const next = formData.get('published') === '1';

  const db = getDb();
  const [row] = await db
    .update(faqItems)
    .set({ published: next })
    .where(eq(faqItems.id, id))
    .returning({ id: faqItems.id });

  if (!row) back('error', 'not-found');

  published();
  back('ok', next ? 'published' : 'unpublished');
}

/**
 * Move a question up or down within its section.
 *
 * Swaps sortOrder with its neighbour rather than renumbering the section, so
 * two editors reordering different pairs at the same time do not overwrite each
 * other's work. Both writes are one transaction: a half-applied swap leaves two
 * questions sharing a position, which reads as a random order.
 */
export async function moveFaqItem(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const direction = formData.get('direction') === 'up' ? 'up' : 'down';

  const db = getDb();
  const [item] = await db
    .select({ id: faqItems.id, groupId: faqItems.groupId, sortOrder: faqItems.sortOrder })
    .from(faqItems)
    .where(eq(faqItems.id, id))
    .limit(1);
  if (!item) back('error', 'not-found');

  const siblings = await db
    .select({ id: faqItems.id, sortOrder: faqItems.sortOrder })
    .from(faqItems)
    .where(eq(faqItems.groupId, item.groupId))
    .orderBy(asc(faqItems.sortOrder));

  const at = siblings.findIndex((s) => s.id === item.id);
  const swapWith = direction === 'up' ? siblings[at - 1] : siblings[at + 1];
  /* Already at the end it was asked to move towards. Not an error — the button
     is disabled there, so this is a double-submit or a stale page. */
  if (!swapWith) back('ok', 'moved');

  await db.transaction(async (tx) => {
    await tx.update(faqItems).set({ sortOrder: swapWith.sortOrder }).where(eq(faqItems.id, item.id));
    await tx.update(faqItems).set({ sortOrder: item.sortOrder }).where(eq(faqItems.id, swapWith.id));
  });

  published();
  back('ok', 'moved');
}

export async function saveFaqGroup(formData: FormData): Promise<void> {
  await assertEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const id = String(formData.get('id') ?? '');
  const title = String(formData.get('title') ?? '').trim();
  const slug = String(formData.get('slug') ?? '').trim().toLowerCase();

  if (!title || !slug) back('error', 'empty');
  /* The slug is the anchor the jump nav links to, so it is part of a URL. A
     space or a capital here produces a link that silently goes nowhere. */
  if (!/^[a-z][a-z-]*[a-z]$/.test(slug)) back('error', 'bad-slug');

  const db = getDb();
  const [clash] = await db
    .select({ id: faqGroups.id })
    .from(faqGroups)
    .where(and(eq(faqGroups.slug, slug), sql`${faqGroups.id} <> ${id}`))
    .limit(1);
  if (clash) back('error', 'slug-taken');

  const [row] = await db
    .update(faqGroups)
    .set({ title, slug })
    .where(eq(faqGroups.id, id))
    .returning({ id: faqGroups.id });
  if (!row) back('error', 'group-not-found');

  published();
  back('ok', 'group-saved');
}
