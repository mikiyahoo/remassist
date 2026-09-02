import {
  pgTable, pgEnum, text, integer, boolean, timestamp, uuid, index,
} from 'drizzle-orm/pg-core';

/**
 * Editable site content — the CMS tables.
 *
 * Everything here is currently hardcoded in app/: blog metadata in
 * lib/blog/posts.ts, the one article body in app/blog/[slug]/ArticleBody.tsx,
 * reviews in app/reviews/page.tsx, and 29 FAQ entries as raw <details> markup
 * in app/faq/page.tsx. These tables are the destination; the public pages are
 * cut over in a later step, after a seed has proven the same content survives
 * the round trip.
 *
 * What is deliberately NOT modelled: a source's logo and its tone colour. Those
 * are design, not content — there are exactly two of them, they change roughly
 * never, and an editor wants to add a review or correct a footnote rather than
 * swap Trustpilot's wordmark. Storing JSX in a column to avoid a decision is
 * how a CMS turns into a worse version of the code it replaced.
 */

/* ── Blog ──────────────────────────────────────────────────────────────── */

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The URL segment. Unique because it is the route. */
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  excerpt: text('excerpt').notNull(),
  /**
   * The article itself, HTML.
   *
   * Nullable, and that is not laziness: today four posts have metadata and
   * exactly one has a body (ArticleBody.tsx). A null body is the honest
   * representation of "listed but not written yet", which is also why three of
   * the four are published: false.
   */
  body: text('body'),
  /**
   * Kept as text in YYYY-MM-DD, matching lib/blog/posts.ts. A date column would
   * be tidier, but this value is displayed rather than compared, and changing
   * its type at the same time as changing where it is stored would make a
   * failed cutover harder to read.
   */
  date: text('date').notNull(),
  readTime: text('read_time').notNull(),
  category: text('category').notNull(),
  image: text('image').notNull(),
  authorName: text('author_name').notNull(),
  authorAvatar: text('author_avatar').notNull(),
  /** Unpublished posts are listed nowhere public; publishedPosts() filters on it. */
  published: boolean('published').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('posts_published_date_idx').on(t.published, t.date),
]);

/* ── Reviews ───────────────────────────────────────────────────────────── */

export const reviewSource = pgEnum('review_source', ['trustpilot', 'google']);

/**
 * Per-source figures and wording. One row per source, keyed by the source
 * itself — there is no second Trustpilot.
 */
export const reviewSources = pgTable('review_sources', {
  source: reviewSource('source').primaryKey(),
  url: text('url').notNull(),
  /** The star row. The score the source publishes, never one computed here. */
  stars: integer('stars').notNull(),
  /**
   * What the source prints beside the score: Trustpilot says "Excellent",
   * Google says "5.0". Stored as the label rather than derived, because each
   * source words it its own way and inventing a shared rule would misquote one
   * of them.
   */
  ratingLabel: text('rating_label').notNull(),
  /**
   * Anything the reader needs in order to read the cards correctly — that one
   * Trustpilot review was removed by its author, or that Google publishes
   * relative dates. Load-bearing for honesty, so it is content, not a comment.
   */
  footnote: text('footnote'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: reviewSource('source').notNull(),
  author: text('author').notNull(),
  /** Whatever the source prints under the name: country, review count. */
  meta: text('meta').notNull(),
  /**
   * Verbatim as the source states it, including "7 months ago" — Google
   * publishes relative dates and rewriting one into an absolute date would be
   * us asserting something the source did not.
   */
  dateText: text('date_text').notNull(),
  /** Trustpilot reviews carry their own headline. Google reviews do not. */
  headline: text('headline'),
  body: text('body').notNull(),
  rating: integer('rating').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  published: boolean('published').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('reviews_source_order_idx').on(t.source, t.sortOrder),
]);

/* ── FAQ ───────────────────────────────────────────────────────────────── */

export const faqGroups = pgTable('faq_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** The anchor the jump nav links to, so these must keep their current values. */
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  /** The line under the heading. Every group has one. */
  blurb: text('blurb'),
  /**
   * The "Pricing page →" link beside each heading. Two columns rather than one
   * stored anchor: the label is content an editor may reword, the href is a
   * route that has to stay valid, and conflating them means validating markup.
   */
  linkHref: text('link_href'),
  linkLabel: text('link_label'),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const faqItems = pgTable('faq_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  /**
   * No cascade. Deleting a group that still holds questions should fail loudly
   * rather than quietly taking 29 answers with it — the same instinct as
   * disabling a user instead of deleting them.
   */
  groupId: uuid('group_id').notNull().references(() => faqGroups.id),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  published: boolean('published').notNull().default(true),
}, (t) => [
  index('faq_items_group_order_idx').on(t.groupId, t.sortOrder),
]);
