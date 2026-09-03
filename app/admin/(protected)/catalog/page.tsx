import Link from 'next/link';
import { asc, desc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { agentTiers, coverageOptions, rateChanges, serviceCategories } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditRates } from '@/lib/auth/roles';
import { formatDate } from '@/lib/leads/display';
import {
  addAgentTier, addCoverageOption, saveAgentTier, saveCoverageOption,
  setCoverageActive, setTierActive,
} from './actions';
import { rateMessage } from './messages';
import styles from '../../admin.module.css';

/**
 * Rates — the Test Admin prototype's shape, MIGRATION-PLAN §6.3.
 *
 * These tables decide what the fit finder quotes: a coverage option's seats and
 * monthly hours, and an hourly rate by tier. Change a number here and every
 * estimate the site produces changes with it — which is exactly why nobody
 * could previously see them from the admin. An estimate you cannot trace back
 * to the figure that produced it is not auditable.
 *
 * Editing is admin-only, and the reasoning is in canEditRates: canEditContent
 * is deliberately generous because a wrong word is visible and reversible, and
 * a wrong price is neither. A manager sees this screen with no controls on it,
 * which is the useful half — knowing what a row currently says.
 *
 * Nothing is deleted. The trash icon deactivates, keeping the figure and taking
 * it out of new quotes, because a rate that has been quoted is part of the
 * record of what this business charged. Every write is logged to rate_changes
 * with the editor's name, and the last panel on this page shows that log — a
 * promise of an audit trail that cannot be read is not one.
 *
 * The forms live in the row's own place in the table rather than on a page of
 * their own. Four coverage options and three tiers is not a list worth losing
 * your place in, and the fields are few enough to fit the row's width.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Rates',
  robots: { index: false, follow: false },
};

/** How many audit rows the log panel shows before it stops being scannable. */
const LOG_ROWS = 12;

/** Fallback for the "monthly · full-time" column when there is no ft row. */
const FULL_TIME_HOURS = 160;

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

type Search = {
  ok?: string;
  error?: string;
  /** `coverage:<key>` or `tier:<key>` — the row whose edit form is open. */
  edit?: string;
  /** `coverage:<key>` or `tier:<key>` — the row asking to be deactivated. */
  off?: string;
  /** `coverage` or `tier` — which add form is open. */
  add?: string;
};

/**
 * Splits `coverage:pt` into a table and a key.
 *
 * One parameter rather than four, so opening any form closes every other one:
 * two edit forms open at once in a price list is an invitation to save the
 * wrong row.
 */
function target(value: string | undefined, table: 'coverage' | 'tier'): string | null {
  if (!value) return null;
  const [t, ...rest] = value.split(':');
  const key = rest.join(':');
  return t === table && key ? key : null;
}

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = rateMessage(sp.ok, sp.error);
  const mayEdit = canEditRates(user.role);

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so the price list
            cannot be read.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const [coverage, tiers, categories, changes] = await Promise.all([
    db.select().from(coverageOptions).orderBy(asc(coverageOptions.sortOrder)),
    db.select().from(agentTiers).orderBy(asc(agentTiers.sortOrder)),
    db.select().from(serviceCategories).orderBy(asc(serviceCategories.sortOrder)),
    db.select().from(rateChanges).orderBy(desc(rateChanges.changedAt)).limit(LOG_ROWS),
  ]);

  /* A form only opens for somebody who may submit it — otherwise the query
     string alone would render a manager a set of controls that every action
     behind them refuses. */
  const editCoverage = mayEdit ? target(sp.edit, 'coverage') : null;
  const editTier = mayEdit ? target(sp.edit, 'tier') : null;
  const offCoverage = mayEdit ? target(sp.off, 'coverage') : null;
  const offTier = mayEdit ? target(sp.off, 'tier') : null;
  const adding = mayEdit && (sp.add === 'coverage' || sp.add === 'tier') ? sp.add : null;

  /* The divisor behind the monthly column, read from the price list rather
     than hardcoded beside it: if somebody changes what a full-time month is,
     the arithmetic and the sentence explaining it both follow. */
  const fullTimeHours =
    coverage.find((c) => c.key === 'ft')?.monthlyHours ?? FULL_TIME_HOURS;

  const empty = coverage.length === 0 && tiers.length === 0;

  return (
    <>
      <Topbar />

      <div className={styles.view}>
        <div className={styles.caution}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 2 21h20z" />
            <path d="M12 10v5" />
            <path d="M12 18h.01" />
          </svg>
          <p>
            <span className={styles.cautionLead}>Rates are the price list.</span>
            {mayEdit ? (
              <>
                Editing coverage options or agent tiers changes what the site quotes. Every
                change here is confirmed once and logged with your name.
              </>
            ) : (
              <>
                Editing coverage options or agent tiers changes what the site quotes, so only
                the admin may change them. Everything below is what the quote calculator is
                working from right now.
              </>
            )}
          </p>
        </div>

        {message && (
          <p
            className={`${styles.signinMsg} ${message.tone === 'ok' ? styles.msgOk : styles.msgErr}`}
            role="status"
          >
            {message.text}
          </p>
        )}

        {empty && (
          <div className={`${styles.notice} ${styles.section}`}>
            <strong>The price list is empty</strong>
            Both rate tables have no rows, so the quiz is working from the figures that live
            inline in <code>lib/quiz/quiz.ts</code> rather than reading these. Run{' '}
            <code>npm run db:seed</code> to populate them.
          </div>
        )}

        {/* ---------- coverage options ---------- */}
        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Coverage options</h2>
              <p className={styles.panelSub}>
                How a subscription can be shaped — seats × monthly hours
              </p>
            </div>
            {mayEdit && (
              <Link
                className={`${styles.btn} ${styles.btnGhost}`}
                href={adding === 'coverage' ? '/admin/catalog' : '/admin/catalog?add=coverage'}
              >
                {adding === 'coverage' ? 'Cancel' : '+ Add option'}
              </Link>
            )}
          </div>

          {coverage.length === 0 && adding !== 'coverage' ? (
            <p className={styles.empty}>
              <strong>No coverage options</strong>
              Nothing to size a quote against.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Long label</th>
                    <th>Seats</th>
                    <th>Monthly hours</th>
                    {mayEdit && <th className={styles.thActions}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {coverage.map((c) => {
                    if (editCoverage === c.key) {
                      return (
                        <tr key={c.key}>
                          <td className={styles.editCell} colSpan={5}>
                            <form className={styles.editForm} action={saveCoverageOption}>
                              <input type="hidden" name="key" value={c.key} />
                              <Field label="Label" name="label" formId={`c-${c.key}`} defaultValue={c.label} autoFocus />
                              <Field
                                formId={`c-${c.key}`}
                                label="Long label"
                                name="longLabel"
                                defaultValue={c.longLabel}
                                className={styles.editWide}
                                hint="How this reads inside a quote sentence"
                              />
                              <Field
                                formId={`c-${c.key}`}
                                label="Seats"
                                name="seats"
                                defaultValue={String(c.seats)}
                                type="number"
                                min={1}
                                max={99}
                                className={styles.editNarrow}
                              />
                              <Field
                                formId={`c-${c.key}`}
                                label="Monthly hours"
                                name="monthlyHours"
                                defaultValue={String(c.monthlyHours)}
                                type="number"
                                min={1}
                                max={9999}
                                className={styles.editNarrow}
                              />
                              <Confirm id={`c-${c.key}`} />
                              <div className={styles.rowActions} style={{ padding: 0 }}>
                                <button
                                  className={`${styles.btn} ${styles.btnPrimary}`}
                                  type="submit"
                                >
                                  Save option
                                </button>
                                <Link className={styles.rowLink} href="/admin/catalog">
                                  Cancel
                                </Link>
                              </div>
                            </form>
                          </td>
                        </tr>
                      );
                    }

                    if (offCoverage === c.key) {
                      return (
                        <ConfirmOff
                          key={c.key}
                          action={setCoverageActive}
                          rowKey={c.key}
                          columns={5}
                          what={`Stop quoting “${c.label}”?`}
                          detail="It stays on record with its figures; new quotes will not offer it."
                          verb="Deactivate option"
                        />
                      );
                    }

                    return (
                      <tr className={c.active ? undefined : styles.rowOff} key={c.key}>
                        <td>
                          <span className={styles.cellPrimary}>{c.label}</span>
                          {!c.active && <span className={styles.tag}>Off</span>}
                          <span className={`${styles.cellSecondary} ${styles.mono}`}>{c.key}</span>
                        </td>
                        <td className={`${styles.cellSecondary} ${styles.cellSentence}`}>
                          {c.longLabel}
                        </td>
                        <td>{c.seats}</td>
                        <td>{c.monthlyHours}</td>
                        {mayEdit && (
                          <td>
                            <RowActions
                              action={setCoverageActive}
                              rowKey={c.key}
                              active={c.active}
                              editHref={`/admin/catalog?edit=coverage:${c.key}`}
                              offHref={`/admin/catalog?off=coverage:${c.key}`}
                              noun="option"
                              label={c.label}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {adding === 'coverage' && (
                    <tr>
                      <td className={styles.editCell} colSpan={5}>
                        <form className={styles.editForm} action={addCoverageOption}>
                          <Field
                            formId="new-coverage"
                            label="Key"
                            name="key"
                            className={styles.editNarrow}
                            pattern="[a-z0-9][a-z0-9\-]*"
                            title="Lowercase letters, digits and hyphens — the quote calculator matches on it"
                            hint="Permanent"
                            autoFocus
                            required
                          />
                          <Field label="Label" name="label" formId="new-coverage" required />
                          <Field
                            formId="new-coverage"
                            label="Long label"
                            name="longLabel"
                            className={styles.editWide}
                            hint="How this reads inside a quote sentence"
                          />
                          <Field
                            formId="new-coverage"
                            label="Seats"
                            name="seats"
                            type="number"
                            min={1}
                            max={99}
                            defaultValue="1"
                            className={styles.editNarrow}
                            required
                          />
                          <Field
                            formId="new-coverage"
                            label="Monthly hours"
                            name="monthlyHours"
                            type="number"
                            min={1}
                            max={9999}
                            className={styles.editNarrow}
                            required
                          />
                          <div className={styles.rowActions} style={{ padding: 0 }}>
                            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                              Add option
                            </button>
                            <Link className={styles.rowLink} href="/admin/catalog">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------- agent tiers ---------- */}
        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Agent tiers</h2>
              <p className={styles.panelSub}>
                Hourly rates feed the quote a prospect sees — this is commercial
              </p>
            </div>
            {mayEdit && (
              <Link
                className={`${styles.btn} ${styles.btnGhost}`}
                href={adding === 'tier' ? '/admin/catalog' : '/admin/catalog?add=tier'}
              >
                {adding === 'tier' ? 'Cancel' : '+ Add tier'}
              </Link>
            )}
          </div>

          {tiers.length === 0 && adding !== 'tier' ? (
            <p className={styles.empty}>
              <strong>No tiers</strong>
              Nothing to price a quote against.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Tier</th>
                    <th>Hourly rate (USD)</th>
                    <th>Monthly · full-time</th>
                    <th>Note</th>
                    {mayEdit && <th className={styles.thActions}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((t) => {
                    if (editTier === t.key) {
                      return (
                        <tr key={t.key}>
                          <td className={styles.editCell} colSpan={5}>
                            <form className={styles.editForm} action={saveAgentTier}>
                              <input type="hidden" name="key" value={t.key} />
                              <Field
                                formId={`t-${t.key}`}
                                label="Tier"
                                name="label"
                                defaultValue={t.label}
                                className={styles.editWide}
                                autoFocus
                              />
                              <Field
                                formId={`t-${t.key}`}
                                label="Hourly rate (USD)"
                                name="hourlyRateUsd"
                                defaultValue={Number(t.hourlyRateUsd).toFixed(2)}
                                type="number"
                                min={0.01}
                                max={9999}
                                step={0.01}
                                className={styles.editNarrow}
                              />
                              <Field
                                formId={`t-${t.key}`}
                                label="Note"
                                name="note"
                                defaultValue={t.note ?? ''}
                                className={styles.editWide}
                                hint="What this tier buys, in a salesperson's words"
                              />
                              <Confirm id={`t-${t.key}`} />
                              <div className={styles.rowActions} style={{ padding: 0 }}>
                                <button
                                  className={`${styles.btn} ${styles.btnPrimary}`}
                                  type="submit"
                                >
                                  Save tier
                                </button>
                                <Link className={styles.rowLink} href="/admin/catalog">
                                  Cancel
                                </Link>
                              </div>
                            </form>
                          </td>
                        </tr>
                      );
                    }

                    if (offTier === t.key) {
                      return (
                        <ConfirmOff
                          key={t.key}
                          action={setTierActive}
                          rowKey={t.key}
                          columns={5}
                          what={`Stop quoting the “${t.label}” tier?`}
                          detail="Its rate stays on record; no new quote will be priced at it."
                          verb="Deactivate tier"
                        />
                      );
                    }

                    return (
                      <tr className={t.active ? undefined : styles.rowOff} key={t.key}>
                        <td>
                          <span className={styles.cellPrimary}>{t.label}</span>
                          {!t.active && <span className={styles.tag}>Off</span>}
                          <span className={`${styles.cellSecondary} ${styles.mono}`}>{t.key}</span>
                        </td>
                        <td>
                          <b>${Number(t.hourlyRateUsd).toFixed(2)}</b>
                        </td>
                        {/* Derived, never stored: one figure that can disagree
                            with the rate beside it is one too many. */}
                        <td className={styles.cellSecondary}>
                          {money.format(Number(t.hourlyRateUsd) * fullTimeHours)}
                        </td>
                        <td className={styles.cellSecondary}>
                          {t.note ?? <span className={styles.none}>—</span>}
                        </td>
                        {mayEdit && (
                          <td>
                            <RowActions
                              action={setTierActive}
                              rowKey={t.key}
                              active={t.active}
                              editHref={`/admin/catalog?edit=tier:${t.key}`}
                              offHref={`/admin/catalog?off=tier:${t.key}`}
                              noun="tier"
                              label={t.label}
                            />
                          </td>
                        )}
                      </tr>
                    );
                  })}

                  {adding === 'tier' && (
                    <tr>
                      <td className={styles.editCell} colSpan={5}>
                        <form className={styles.editForm} action={addAgentTier}>
                          <Field
                            formId="new-tier"
                            label="Key"
                            name="key"
                            className={styles.editNarrow}
                            pattern="[a-z0-9][a-z0-9\-]*"
                            title="Lowercase letters, digits and hyphens — the quote calculator matches on it"
                            hint="Permanent"
                            autoFocus
                            required
                          />
                          <Field label="Tier" name="label" formId="new-tier" className={styles.editWide} required />
                          <Field
                            formId="new-tier"
                            label="Hourly rate (USD)"
                            name="hourlyRateUsd"
                            type="number"
                            min={0.01}
                            max={9999}
                            step={0.01}
                            className={styles.editNarrow}
                            required
                          />
                          <Field
                            formId="new-tier"
                            label="Note"
                            name="note"
                            className={styles.editWide}
                            hint="What this tier buys, in a salesperson's words"
                          />
                          <div className={styles.rowActions} style={{ padding: 0 }}>
                            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                              Add tier
                            </button>
                            <Link className={styles.rowLink} href="/admin/catalog">
                              Cancel
                            </Link>
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className={styles.panelFoot}>
            Monthly figures assume one full-time seat at {fullTimeHours} hrs/mo. Deactivating a
            tier stops it appearing in future quotes; nothing here is ever deleted.
          </div>
        </section>

        {/* ---------- the log ---------- */}
        {/* The other half of "logged with your name". A change log nobody can
            read is a claim, not a record. */}
        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Recent rate changes</h2>
              <p className={styles.panelSub}>
                {changes.length === 0
                  ? 'Nothing has been changed since the log was added'
                  : `The last ${changes.length} edits to the price list, newest first`}
              </p>
            </div>
          </div>
          {changes.length === 0 ? (
            <p className={styles.empty}>
              <strong>No changes logged</strong>
              Every edit made from this screen is recorded here with the name of whoever made
              it.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((ch) => (
                    <tr key={ch.id}>
                      <td className={styles.mono}>{formatDate(ch.changedAt)}</td>
                      <td>
                        <span className={styles.cellPrimary}>{ch.actorName}</span>
                      </td>
                      <td>
                        {ch.entity === 'agent_tier' ? 'Agent tier' : 'Coverage option'}
                        <span className={`${styles.cellSecondary} ${styles.mono}`}>
                          {ch.rowKey}
                        </span>
                      </td>
                      <td className={styles.cellSecondary}>{describe(ch.action, ch.before, ch.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ---------- service categories ---------- */}
        {/* Not part of the price list and not editable here: these route a lead
            to a service page, they do not price one. Kept on this screen
            because it is the only place the three catalog tables can be read
            together, which is what makes a quote traceable. */}
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>Service categories</h2>
              <p className={styles.panelSub}>
                {categories.length} rows — what a lead is routed into. Read-only; these carry no
                price.
              </p>
            </div>
          </div>
          {categories.length === 0 ? (
            <p className={styles.empty}>
              <strong>No categories</strong>
              Nothing to route a lead into.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Slug</th>
                    <th>Nav blurb</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.key}>
                      <td>
                        <span className={styles.cellPrimary}>{c.name}</span>
                        <span className={`${styles.cellSecondary} ${styles.mono}`}>{c.key}</span>
                      </td>
                      <td className={styles.mono}>/{c.slug}</td>
                      <td className={styles.cellSecondary}>
                        {c.navBlurb ?? <span className={styles.none}>—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

/**
 * One line of the change log.
 *
 * Reads the two snapshots rather than a stored sentence: the wording of a log
 * entry should be able to improve without rewriting history, and a stored
 * sentence is the version that cannot.
 */
function describe(action: string, before: unknown, after: unknown): string {
  const b = before as Record<string, unknown> | null;
  const a = after as Record<string, unknown> | null;

  if (action === 'added') return `Added at ${rateOf(a) ?? 'no rate'}`;
  if (action === 'deactivated') return 'Deactivated — out of new quotes';
  if (action === 'reactivated') return 'Back in use';

  const from = rateOf(b);
  const to = rateOf(a);
  if (from && to && from !== to) return `Rate ${from} → ${to}`;

  const hoursFrom = hoursOf(b);
  const hoursTo = hoursOf(a);
  if (hoursFrom && hoursTo && hoursFrom !== hoursTo) return `Hours ${hoursFrom} → ${hoursTo}`;

  /* Everything else is a label or a note: worth logging, not worth a bespoke
     sentence each. The whole-row snapshots are in the table for anyone who
     needs the detail. */
  return 'Wording updated';
}

function rateOf(row: Record<string, unknown> | null): string | null {
  const v = row?.hourlyRateUsd;
  return typeof v === 'string' || typeof v === 'number'
    ? `$${Number(v).toFixed(2)}`
    : null;
}

function hoursOf(row: Record<string, unknown> | null): string | null {
  const v = row?.monthlyHours;
  return typeof v === 'number' ? `${v}` : null;
}

/** A labelled control, with the hint the field needs and nothing more. */
function Field({
  label,
  name,
  formId,
  defaultValue,
  className = '',
  hint,
  ...rest
}: {
  label: string;
  name: string;
  /** Which form this field belongs to — only ever one row's, and it makes the
      id unique without putting a value's own text into an attribute that may
      not contain spaces. Not the HTML `form` attribute, which associates a
      control with a form elsewhere in the document. */
  formId: string;
  defaultValue?: string;
  className?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `f-${formId}-${name}`;
  return (
    <div className={`${styles.field} ${className}`}>
      <label className={styles.fieldLabel} htmlFor={id}>{label}</label>
      <input
        className={styles.control}
        id={id}
        name={name}
        defaultValue={defaultValue}
        {...rest}
      />
      {hint && <span className={styles.panelNote}>{hint}</span>}
    </div>
  );
}

/**
 * The confirmation the caution banner promises.
 *
 * `required` in the browser and re-checked in the action, because a required
 * attribute is a courtesy and not a control.
 */
function Confirm({ id }: { id: string }) {
  return (
    <label className={styles.confirmCheck} htmlFor={`ok-${id}`}>
      <input type="checkbox" id={`ok-${id}`} name="confirm" value="1" required />
      <span>
        I know this changes what the site quotes from now on, and that this edit is logged
        with my name.
      </span>
    </label>
  );
}

/**
 * Deactivation asks first, in the row's own place.
 *
 * A server-rendered confirm step rather than a browser dialog: this admin ships
 * no client-side JS for its tables, and an unconfirmed price change is the one
 * thing on this screen that should not be one click away.
 */
function ConfirmOff({
  action,
  rowKey,
  columns,
  what,
  detail,
  verb,
}: {
  action: (formData: FormData) => Promise<void>;
  rowKey: string;
  columns: number;
  what: string;
  detail: string;
  verb: string;
}) {
  return (
    <tr>
      <td className={styles.editCell} colSpan={columns}>
        <form className={styles.editForm} action={action}>
          <input type="hidden" name="key" value={rowKey} />
          <input type="hidden" name="active" value="0" />
          <p style={{ margin: 0, flex: '1 1 20rem' }}>
            <strong>{what}</strong>
            <span className={styles.cellSecondary}>{detail}</span>
          </p>
          <div className={styles.rowActions} style={{ padding: 0 }}>
            <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit" autoFocus>
              {verb}
            </button>
            <Link className={styles.rowLink} href="/admin/catalog">
              Keep it
            </Link>
          </div>
        </form>
      </td>
    </tr>
  );
}

/** Edit, and deactivate or bring back — the prototype's icon pair. */
function RowActions({
  action,
  rowKey,
  active,
  editHref,
  offHref,
  noun,
  label,
}: {
  action: (formData: FormData) => Promise<void>;
  rowKey: string;
  active: boolean;
  editHref: string;
  offHref: string;
  noun: string;
  label: string;
}) {
  return (
    <div className={styles.actions}>
      <Link className={styles.iconBtn} href={editHref} aria-label={`Edit ${noun}: ${label}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
      </Link>

      {active ? (
        /* A link, not a submit: the click opens the confirm step above rather
           than making the change. */
        <Link
          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
          href={offHref}
          aria-label={`Deactivate ${noun}: ${label}`}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </Link>
      ) : (
        /* Bringing one back needs no confirmation: it is additive, and one
           click undoes it again. */
        <form action={action}>
          <input type="hidden" name="key" value={rowKey} />
          <input type="hidden" name="active" value="1" />
          <button
            className={styles.iconBtn}
            type="submit"
            aria-label={`Put ${noun} back in use: ${label}`}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M20 11a8 8 0 1 0-1.5 5.2" />
              <path d="M20 4v7h-7" />
            </svg>
          </button>
        </form>
      )}
    </div>
  );
}

function Topbar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Rates</h1>
          <p className={styles.tbSub}>Coverage options and agent tiers — the price list</p>
        </div>
      </div>
    </header>
  );
}
