import { asc, eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import seed from '@/db/content-seed.json';

/**
 * The FAQ, read from the database.
 *
 * With a fallback to db/content-seed.json — the same file the import was made
 * from — and the condition on that fallback is the whole design:
 *
 *   DATABASE_URL absent  -> use the seed
 *   DATABASE_URL present -> query, and let any error propagate
 *
 * The first case is CI. .github/workflows runs `npm run build` with no
 * database, and /faq is prerendered, so without a fallback either the build
 * fails or the page ships empty. The second case is production, where the
 * deploy sources shared/.env before building: a query that throws there must
 * fail the build loudly rather than quietly shipping the seed, because the seed
 * is a snapshot of what the content was on the day it was imported and serving
 * it after somebody has edited the FAQ would silently undo their work.
 *
 * That asymmetry is deliberate. A fallback that triggers on *any* problem is
 * how stale content gets served for months without anyone noticing.
 */

export interface FaqEntry {
  question: string;
  answer: string;
}

export interface FaqGroup {
  slug: string;
  title: string;
  blurb: string | null;
  linkHref: string | null;
  linkLabel: string | null;
  items: FaqEntry[];
}

function fromSeed(): FaqGroup[] {
  return seed.faqGroups
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({
      slug: g.slug,
      title: g.title,
      blurb: g.blurb,
      linkHref: g.linkHref,
      linkLabel: g.linkLabel,
      items: seed.faqItems
        .filter((i) => i.groupSlug === g.slug && i.published)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({ question: i.question, answer: i.answer })),
    }));
}

export async function getFaq(): Promise<FaqGroup[]> {
  if (!isDatabaseConfigured()) return fromSeed();

  const db = getDb();
  const [groups, items] = await Promise.all([
    db.select().from(faqGroups).orderBy(asc(faqGroups.sortOrder)),
    db
      .select()
      .from(faqItems)
      /* Unpublished questions exist so an editor can draft one without it
         appearing here. Filtered in the query rather than after, so a draft
         never reaches the page even in a serialised payload. */
      .where(eq(faqItems.published, true))
      .orderBy(asc(faqItems.sortOrder)),
  ]);

  return groups.map((g) => ({
    slug: g.slug,
    title: g.title,
    blurb: g.blurb,
    linkHref: g.linkHref,
    linkLabel: g.linkLabel,
    items: items
      .filter((i) => i.groupId === g.id)
      .map((i) => ({ question: i.question, answer: i.answer })),
  }));
}
