import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import CategoryFilter from './CategoryFilter';
import { addFaqItem, saveFaqGroup, setFaqItemPublished } from './actions';
import { faqMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The FAQ list — the Test Admin prototype's shape.
 *
 * One flat, scannable line per question: grip, question, category tag, status
 * pill, icon actions. Above it a filter bar — status tabs with counts, and a
 * category dropdown — and that filter bar is what replaced the previous panel
 * per section. Six panels meant the answer to "which questions are still
 * drafts" was to scroll all six and read every pill; now it is one tab.
 *
 * The category tag and the dropdown are the same thing as the old section
 * panels: an item's group. Nothing about the data changed, only whether you
 * have to navigate the grouping to see across it.
 *
 * Two deliberate departures from the mockup, both because a working page
 * cannot promise what it does not do:
 *
 *  - The grip does not drag. This admin ships no client-side drag, so the grip
 *    is decorative and says so to a screen reader; reordering is Move up /
 *    Move down on the edit page, where the item's position in its section is
 *    also shown. The mockup's footer said "drag the grip to reorder", which
 *    would be a lie the mockup could afford.
 *  - The second row action publishes and unpublishes rather than deleting.
 *    Content on this site is taken off the page, never destroyed — see
 *    canUnpublishContent in lib/auth/roles.ts. A trash icon over an action
 *    that unpublishes would be worse than either.
 *
 * Both roles may edit content; the gate is re-checked inside every action,
 * because a server action renders outside this page.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'FAQ',
  robots: { index: false, follow: false },
};

const STATUSES = ['all', 'published', 'draft'] as const;
type Status = (typeof STATUSES)[number];

function asStatus(v: string | undefined): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : 'all';
}

export default async function FaqListPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; status?: string; cat?: string; add?: string }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = faqMessage(sp.ok, sp.error);
  const mayEdit = canEditContent(user.role);
  const status = asStatus(sp.status);

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there is nothing to
            edit.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const [groups, items] = await Promise.all([
    db.select().from(faqGroups).orderBy(asc(faqGroups.sortOrder)),
    db.select().from(faqItems).orderBy(asc(faqItems.sortOrder)),
  ]);

  const groupById = new Map(groups.map((g) => [g.id, g]));
  const groupRank = new Map(groups.map((g, i) => [g.id, i]));

  /* sortOrder is per section — the index is (group_id, sort_order) and
     moveFaqItem only ever swaps siblings — so a flat list has to sort by the
     section first or the six sections interleave. This is the order the public
     page renders in, which is the whole point of showing it as one list. */
  const ordered = [...items].sort((a, b) => {
    const byGroup = (groupRank.get(a.groupId) ?? 0) - (groupRank.get(b.groupId) ?? 0);
    return byGroup !== 0 ? byGroup : a.sortOrder - b.sortOrder;
  });

  /* Counted before filtering: a tab whose count changes when you select it
     tells you nothing about what is on the other tabs. */
  const total = ordered.length;
  const publishedCount = ordered.filter((i) => i.published).length;
  const draftCount = total - publishedCount;

  /* A category from the query string is only honoured if it names a group that
     exists, so a hand-typed ?cat= falls back to showing everything rather than
     to an empty list that looks like lost content. */
  const cat = sp.cat && groupById.has(sp.cat) ? sp.cat : 'all';

  const rows = ordered.filter((i) => {
    if (status === 'published' && !i.published) return false;
    if (status === 'draft' && i.published) return false;
    if (cat !== 'all' && i.groupId !== cat) return false;
    return true;
  });

  const adding = mayEdit && sp.add === '1';

  /* Every filter link keeps the other filter. Losing the category you had
     selected because you clicked Draft is the sort of thing that makes a
     filter bar feel broken when each control works perfectly on its own. */
  const href = (next: { status?: Status; cat?: string; add?: '1' }) => {
    const s = next.status ?? status;
    const c = next.cat ?? cat;
    const params = new URLSearchParams();
    if (s !== 'all') params.set('status', s);
    if (c !== 'all') params.set('cat', c);
    if (next.add) params.set('add', next.add);
    const qs = params.toString();
    return `/admin/content/faq${qs ? `?${qs}` : ''}`;
  };

  return (
    <>
      <Topbar />

      <div className={styles.view}>
        {message && (
          <p
            className={`${styles.signinMsg} ${message.tone === 'ok' ? styles.msgOk : styles.msgErr}`}
            role="status"
          >
            {message.text}
          </p>
        )}

        <div className={styles.filterbar}>
          <div className={styles.filterPills} role="group" aria-label="Filter FAQ by status">
            <Tab href={href({ status: 'all' })} on={status === 'all'} label="All" count={total} />
            <Tab
              href={href({ status: 'published' })}
              on={status === 'published'}
              label="Published"
              count={publishedCount}
            />
            <Tab
              href={href({ status: 'draft' })}
              on={status === 'draft'}
              label="Draft"
              count={draftCount}
            />
          </div>

          <CategoryFilter
            groups={groups.map((g) => ({ id: g.id, title: g.title }))}
            value={cat}
            status={status}
          />

          {mayEdit && (
            <Link
              className={`${styles.btn} ${styles.btnGhost} ${styles.filterEnd}`}
              href={adding ? href({}) : href({ add: '1' })}
            >
              {adding ? 'Cancel' : '+ Add question'}
            </Link>
          )}
        </div>

        <div className={styles.panel}>
          {/* Revealed by the filter bar's own button rather than always
              present: six permanent add-forms is what made the old page
              long, and one is enough because the section is now a field. */}
          {adding && (
            <form className={styles.stackWide} action={addFaqItem}>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ng">Section</label>
                  <select className={styles.control} id="ng" name="groupId" required>
                    {groups.map((g) => (
                      <option key={g.id} value={g.id}>{g.title}</option>
                    ))}
                  </select>
                </div>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label className={styles.fieldLabel} htmlFor="nq">Question</label>
                  <input
                    className={styles.control}
                    id="nq"
                    name="question"
                    placeholder="What do people actually ask?"
                    maxLength={300}
                    required
                    autoFocus
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="na">Answer</label>
                <textarea
                  className={styles.textarea}
                  id="na"
                  name="answer"
                  rows={4}
                  maxLength={4000}
                  required
                />
              </div>
              <div className={styles.rowActions} style={{ padding: 0 }}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Add question
                </button>
                <span className={styles.panelNote}>
                  Added as a draft, so you can check it before it goes live
                </span>
              </div>
            </form>
          )}

          {rows.length === 0 ? (
            <p className={styles.empty}>
              <strong>
                {total === 0
                  ? 'No questions yet'
                  : 'Nothing matches those filters'}
              </strong>
              {total === 0
                ? 'Use “Add question” above to write the first one.'
                : `There are ${total} questions in total — clear the filters to see them.`}
            </p>
          ) : (
            rows.map((it) => {
              const group = groupById.get(it.groupId);
              return (
                <div className={styles.faqRow} key={it.id}>
                  {/* Decorative: this admin has no client-side drag, and
                      reordering is Move up / Move down on the edit page. */}
                  <span className={styles.grip} aria-hidden="true" />

                  <Link className={styles.faqQ} href={`/admin/content/faq/${it.id}`}>
                    {it.question}
                  </Link>

                  <span className={styles.faqCat}>{group?.title ?? 'No section'}</span>

                  <span
                    className={`${styles.pill} ${it.published ? styles.pillLow : styles.pillMed}`}
                  >
                    {it.published ? 'Published' : 'Draft'}
                  </span>

                  {mayEdit && (
                    <div className={styles.actions}>
                      <Link
                        className={styles.iconBtn}
                        href={`/admin/content/faq/${it.id}`}
                        aria-label={`Edit: ${it.question}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
                        </svg>
                      </Link>

                      <form action={setFaqItemPublished}>
                        <input type="hidden" name="id" value={it.id} />
                        <input type="hidden" name="published" value={it.published ? '0' : '1'} />
                        <button
                          className={styles.iconBtn}
                          type="submit"
                          aria-label={
                            it.published
                              ? `Take off the FAQ page: ${it.question}`
                              : `Put live on the FAQ page: ${it.question}`
                          }
                        >
                          {it.published ? (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M3 3l18 18" />
                              <path d="M10.6 5.1A9.9 9.9 0 0 1 12 5c5 0 9 4.5 9 7 0 .8-.5 1.9-1.4 3" />
                              <path d="M6.3 6.9C3.9 8.4 3 10.4 3 12c0 2.5 4 7 9 7 1.6 0 3-.4 4.2-1" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" aria-hidden="true">
                              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                          )}
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              );
            })
          )}

          <div className={styles.panelFoot}>
            <span>
              Reorder from a question&rsquo;s edit page &mdash; the public FAQ follows
              immediately after save.
            </span>
            <Link className={styles.rowLink} href="/faq">View the public page</Link>
          </div>
        </div>

        {/* One block for all six sections rather than a details element per
            panel, which is where this used to live. Touched roughly never —
            changing an anchor breaks an inbound link — so it sits closed at
            the bottom rather than above the questions. */}
        {mayEdit && groups.length > 0 && (
          <details className={`${styles.panel} ${styles.section} ${styles.groupSettings}`}>
            <summary>Section titles and anchors</summary>
            {groups.map((g) => (
              <form className={styles.inviteRow} action={saveFaqGroup} key={g.id}>
                <input type="hidden" name="id" value={g.id} />
                <div className={`${styles.field} ${styles.grow}`}>
                  <label className={styles.fieldLabel} htmlFor={`t-${g.id}`}>Title</label>
                  <input
                    className={styles.control}
                    id={`t-${g.id}`}
                    name="title"
                    defaultValue={g.title}
                    required
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor={`s-${g.id}`}>Anchor</label>
                  <input
                    className={styles.control}
                    id={`s-${g.id}`}
                    name="slug"
                    defaultValue={g.slug}
                    pattern="[a-z][a-z\-]*[a-z]"
                    title="Lowercase letters and hyphens only — it is part of a URL"
                    required
                  />
                </div>
                <button className={`${styles.btn} ${styles.btnGhost}`} type="submit">
                  Save section
                </button>
              </form>
            ))}
          </details>
        )}
      </div>
    </>
  );
}

/** One status tab. A link, not a button: the filter belongs in the URL. */
function Tab({ href, on, label, count }: {
  href: string;
  on: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      className={`${styles.fbtn} ${on ? styles.fbtnOn : ''}`}
      href={href}
      aria-current={on ? 'true' : undefined}
    >
      {label}
      <span className={styles.fbtnCount}>{count}</span>
    </Link>
  );
}

function Topbar() {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>FAQ</h1>
          <p className={styles.tbSub}>The questions that sell the process</p>
        </div>
      </div>
    </header>
  );
}
