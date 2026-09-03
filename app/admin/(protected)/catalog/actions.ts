'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, count, eq, ne } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { agentTiers, coverageOptions, rateChanges } from '@/db/schema';
import { assertUser, type AdminUser } from '@/lib/auth/require';
import { canEditRates } from '@/lib/auth/roles';

/**
 * Editing the price list.
 *
 * Three rules run through every action here, and they are what makes this
 * screen safe enough to exist at all:
 *
 *  1. Admin only. A server action is a POST endpoint with a generated name
 *     that renders outside the layout tree, so the page's gate protects the
 *     page and nothing else — the same note already written into the leads,
 *     team and FAQ actions. canEditRates is re-checked on every one.
 *  2. Nothing is deleted. A rate that has been quoted is part of the record of
 *     what this business offered and for how much; a row is deactivated and
 *     kept. The last active row in either table cannot be deactivated, because
 *     a quote calculator with no tier to price against has no output.
 *  3. Every write lands in rate_changes with the editor's name and a whole-row
 *     before/after. The screen tells an editor their change is logged with
 *     their name; this is what makes that true rather than reassuring.
 */

const MAX_LABEL = 80;
const MAX_LONG_LABEL = 160;
const MAX_NOTE = 160;

/* The key is what the quote calculator matches on, so it reaches a switch and
   a URL, not just a table cell. */
const KEY = /^[a-z0-9][a-z0-9-]{0,31}$/;
/* Whole dollars today; two decimals so $8.50 needs no migration. */
const RATE = /^\d{1,4}(\.\d{1,2})?$/;

function back(param: 'ok' | 'error', code: string): never {
  redirect(`/admin/catalog?${param}=${code}`);
}

/** The editing gate, in one place so no action can forget half of it. */
async function assertRateEditor(): Promise<AdminUser> {
  const user = await assertUser();
  /* A refusal, not a redirect: a redirect out of a POST is not something the
     caller can act on. The page renders no editing controls for a manager, so
     reaching this is a stale tab or a hand-rolled request. */
  if (!canEditRates(user.role)) throw new Error('forbidden');
  return user;
}

type Entity = 'coverage_option' | 'agent_tier';
type ChangeAction = 'added' | 'updated' | 'deactivated' | 'reactivated';

/**
 * The audit row.
 *
 * actorName is written as a snapshot rather than left to a join, for the same
 * reason the quote on a quiz submission is: the record is of who changed the
 * price at the time, and a rename must not be able to rewrite it.
 */
async function log(
  user: AdminUser,
  entity: Entity,
  rowKey: string,
  action: ChangeAction,
  before: unknown,
  after: unknown,
) {
  await getDb().insert(rateChanges).values({
    actorId: user.id,
    actorName: user.name ?? user.email,
    entity,
    rowKey,
    action,
    before: before ?? null,
    after: after ?? null,
  });
}

/**
 * Only this screen is revalidated, deliberately.
 *
 * The public pages do not read these tables yet — lib/quiz/quiz.ts still
 * carries the figures inline, guarded by its 432-case parity test, and
 * MIGRATION-PLAN §6.3 is where the two are joined up. When the quiz is pointed
 * at these rows, /, /qualify and /pricing belong in this list; revalidating
 * them today would cost a rebuild to change nothing.
 */
function done() {
  revalidatePath('/admin/catalog');
}

/** Trimmed, or an empty string — the shape the validators below expect. */
function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/**
 * The "confirmed once" the caution banner promises.
 *
 * A required checkbox rather than a dialog: it is checked on the server, so it
 * holds for a hand-rolled POST as well as for the form, and it puts the
 * consequence in front of the editor at the moment they commit rather than in
 * a banner they last read a month ago.
 */
function assertConfirmed(formData: FormData) {
  if (field(formData, 'confirm') !== '1') back('error', 'not-confirmed');
}

/* ---------- coverage options ---------- */

/** Parses and range-checks the two numbers both coverage writes share. */
function coverageNumbers(formData: FormData) {
  const seats = Number(field(formData, 'seats'));
  const monthlyHours = Number(field(formData, 'monthlyHours'));
  if (!Number.isInteger(seats) || seats < 1 || seats > 99) back('error', 'bad-seats');
  if (!Number.isInteger(monthlyHours) || monthlyHours < 1 || monthlyHours > 9999) {
    back('error', 'bad-hours');
  }
  return { seats, monthlyHours };
}

export async function addCoverageOption(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const key = field(formData, 'key').toLowerCase();
  const label = field(formData, 'label');
  const longLabel = field(formData, 'longLabel');

  if (!KEY.test(key)) back('error', 'bad-key');
  if (!label) back('error', 'empty-label');
  if (label.length > MAX_LABEL || longLabel.length > MAX_LONG_LABEL) back('error', 'too-long');
  const { seats, monthlyHours } = coverageNumbers(formData);

  const db = getDb();
  /* Sorted last. Where a new option belongs among its siblings is a separate
     decision from adding one, and guessing it here would drop a new row into
     the middle of a list the editor is still reading. */
  const [{ value: existing }] = await db.select({ value: count() }).from(coverageOptions);

  const row = {
    key,
    label,
    longLabel: longLabel || label,
    seats,
    monthlyHours,
    sortOrder: existing + 1,
  };

  const [added] = await db
    .insert(coverageOptions)
    .values(row)
    .onConflictDoNothing({ target: coverageOptions.key })
    .returning({ key: coverageOptions.key });

  if (!added) back('error', 'key-taken');

  await log(user, 'coverage_option', key, 'added', null, row);
  done();
  back('ok', 'added');
}

export async function saveCoverageOption(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');
  assertConfirmed(formData);

  const key = field(formData, 'key');
  const label = field(formData, 'label');
  const longLabel = field(formData, 'longLabel');

  if (!label) back('error', 'empty-label');
  if (label.length > MAX_LABEL || longLabel.length > MAX_LONG_LABEL) back('error', 'too-long');
  const { seats, monthlyHours } = coverageNumbers(formData);

  const db = getDb();
  const [before] = await db.select().from(coverageOptions).where(eq(coverageOptions.key, key));
  if (!before) back('error', 'not-found');

  const [after] = await db
    .update(coverageOptions)
    .set({ label, longLabel: longLabel || label, seats, monthlyHours })
    .where(eq(coverageOptions.key, key))
    .returning();

  await log(user, 'coverage_option', key, 'updated', before, after);
  done();
  back('ok', 'saved');
}

export async function setCoverageActive(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const key = field(formData, 'key');
  const active = field(formData, 'active') === '1';

  const db = getDb();
  const [before] = await db.select().from(coverageOptions).where(eq(coverageOptions.key, key));
  if (!before) back('error', 'not-found');

  /* A calculator with nothing to size against has no output, so the last
     active row stays. Counted rather than assumed: "there are four of them"
     was true when this was written and is not a guarantee. */
  if (!active) {
    const [{ value: others }] = await db
      .select({ value: count() })
      .from(coverageOptions)
      .where(and(eq(coverageOptions.active, true), ne(coverageOptions.key, key)));
    if (others === 0) back('error', 'last-one');
  }

  const [after] = await db
    .update(coverageOptions)
    .set({ active })
    .where(eq(coverageOptions.key, key))
    .returning();

  await log(user, 'coverage_option', key, active ? 'reactivated' : 'deactivated', before, after);
  done();
  back('ok', active ? 'reactivated' : 'deactivated');
}

/* ---------- agent tiers ---------- */

export async function addAgentTier(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const key = field(formData, 'key').toLowerCase();
  const label = field(formData, 'label');
  const note = field(formData, 'note');
  const rate = field(formData, 'hourlyRateUsd');

  if (!KEY.test(key)) back('error', 'bad-key');
  if (!label) back('error', 'empty-label');
  if (label.length > MAX_LABEL || note.length > MAX_NOTE) back('error', 'too-long');
  if (!RATE.test(rate) || Number(rate) <= 0) back('error', 'bad-rate');

  const db = getDb();
  const [{ value: existing }] = await db.select({ value: count() }).from(agentTiers);

  const row = {
    key,
    label,
    /* Stored to two decimals whatever was typed, so a column of rates reads as
       a column of prices rather than a mix of 8 and 8.50. */
    hourlyRateUsd: Number(rate).toFixed(2),
    note: note || null,
    sortOrder: existing + 1,
  };

  const [added] = await db
    .insert(agentTiers)
    .values(row)
    .onConflictDoNothing({ target: agentTiers.key })
    .returning({ key: agentTiers.key });

  if (!added) back('error', 'key-taken');

  await log(user, 'agent_tier', key, 'added', null, row);
  done();
  back('ok', 'added');
}

export async function saveAgentTier(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');
  assertConfirmed(formData);

  const key = field(formData, 'key');
  const label = field(formData, 'label');
  const note = field(formData, 'note');
  const rate = field(formData, 'hourlyRateUsd');

  if (!label) back('error', 'empty-label');
  if (label.length > MAX_LABEL || note.length > MAX_NOTE) back('error', 'too-long');
  if (!RATE.test(rate) || Number(rate) <= 0) back('error', 'bad-rate');

  const db = getDb();
  const [before] = await db.select().from(agentTiers).where(eq(agentTiers.key, key));
  if (!before) back('error', 'not-found');

  const [after] = await db
    .update(agentTiers)
    .set({ label, hourlyRateUsd: Number(rate).toFixed(2), note: note || null })
    .where(eq(agentTiers.key, key))
    .returning();

  await log(user, 'agent_tier', key, 'updated', before, after);
  done();
  back('ok', 'saved');
}

export async function setTierActive(formData: FormData): Promise<void> {
  const user = await assertRateEditor();
  if (!isDatabaseConfigured()) back('error', 'no-database');

  const key = field(formData, 'key');
  const active = field(formData, 'active') === '1';

  const db = getDb();
  const [before] = await db.select().from(agentTiers).where(eq(agentTiers.key, key));
  if (!before) back('error', 'not-found');

  if (!active) {
    const [{ value: others }] = await db
      .select({ value: count() })
      .from(agentTiers)
      .where(and(eq(agentTiers.active, true), ne(agentTiers.key, key)));
    if (others === 0) back('error', 'last-one');
  }

  const [after] = await db
    .update(agentTiers)
    .set({ active })
    .where(eq(agentTiers.key, key))
    .returning();

  await log(user, 'agent_tier', key, active ? 'reactivated' : 'deactivated', before, after);
  done();
  back('ok', active ? 'reactivated' : 'deactivated');
}
