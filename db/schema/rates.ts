import {
  pgTable, text, integer, numeric, boolean, timestamp, jsonb, index,
} from 'drizzle-orm/pg-core';
import { users } from './auth';

/**
 * Rate tables — MIGRATION-PLAN §6.3, the fix for §1.3.
 *
 * These are the single source of truth for the home hero, the Qualify page and
 * the pricing page. A rate change becomes one UPDATE instead of an edit in two
 * hand-synced JS arrays that can silently drift apart.
 *
 * NOTE: nothing reads these yet. lib/quiz/quiz.ts still carries the rates
 * inline, and its 432-case parity test is what guarantees the arithmetic. Point
 * the quiz at these tables only with that test green on both sides.
 */

/**
 * `active` rather than a delete, on both rate tables.
 *
 * The same rule accounts and content already follow, for the same reason one
 * level further in: a rate that has been quoted is part of the record of what
 * this business offered and for how much. Dropping the row destroys that, and
 * it is the first thing anyone asks for when a prospect quotes an old price
 * back at them. Deactivating keeps the figure and stops it reaching a new
 * quote — see canEditRates in lib/auth/roles.ts.
 */
export const coverageOptions = pgTable('coverage_options', {
  key: text('key').primaryKey(),                     // pt | ft | shift | always
  label: text('label').notNull(),
  longLabel: text('long_label').notNull(),
  seats: integer('seats').notNull(),                 // 1 | 1 | 2 | 4
  monthlyHours: integer('monthly_hours').notNull(),  // 80 | 160 | 320 | 640
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const agentTiers = pgTable('agent_tiers', {
  key: text('key').primaryKey(),                     // pro | mid | expert
  label: text('label').notNull(),
  /* numeric, not integer: today's rates are whole dollars, but a schema that
     cannot express $8.50 needs a migration the first time pricing gets
     nuanced. */
  hourlyRateUsd: numeric('hourly_rate_usd', { precision: 6, scale: 2 }).notNull(),
  /* What this tier buys, in the words a salesperson would use. Shown beside the
     rate in the admin so a number nobody remembers the reason for is not the
     only thing on the row. */
  note: text('note'),
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const serviceCategories = pgTable('service_categories', {
  key: text('key').primaryKey(),                     // back | gtm | sdr | mixed
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  navBlurb: text('nav_blurb'),
  sortOrder: integer('sort_order').notNull(),
});

/**
 * Every edit to the price list, with the name of whoever made it.
 *
 * The Rates screen tells an editor their change is logged with their name, and
 * this is the table that makes that true rather than reassuring. It exists
 * because a rate is the one figure in this system that a prospect is told out
 * loud: "why is the quote different from last month" has to be answerable, and
 * the row itself only ever holds the current number.
 *
 * `actorName` is a snapshot, not a join. The same reasoning as the quote stored
 * on quiz_submissions: the record is of who changed the price *at the time*,
 * and a rename or a removed account must not be able to rewrite that. actorId
 * is kept alongside it for the cases where the account is still there.
 */
export const rateChanges = pgTable('rate_changes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actorName: text('actor_name').notNull(),
  entity: text('entity').notNull(),      // coverage_option | agent_tier
  rowKey: text('row_key').notNull(),
  action: text('action').notNull(),      // added | updated | deactivated | reactivated
  /* Null on an add: there was nothing there before. Both are whole-row
     snapshots rather than a changed-field diff, so a reader is never left
     guessing what the rest of the row said at the time. */
  before: jsonb('before'),
  after: jsonb('after'),
}, (t) => [
  index('rate_changes_at_idx').on(t.changedAt.desc()),
]);
