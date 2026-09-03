import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { faqGroups, faqItems } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { canEditContent } from '@/lib/auth/roles';
import ModalDialog from '../../ModalDialog';
import CategoryFilter from './CategoryFilter';
import { addFaqItem, saveFaqGroup, setFaqItemPublished } from './actions';
import { faqMessage } from './messages';
import styles from '../../../admin.module.css';

/**
 * The FAQ list — the Test Admin prototype's shape.
 *
 * One flat, scannable line per question: grip, question, status pill, icon
 * actions, under a heading per section. Above it a filter bar — status tabs
 * with counts, a category dropdown, and a Sections toggle — and that filter
 * bar is what replaced the previous panel per section. Six panels meant
 * the answer to "which questions are still drafts" was to scroll all six and
 * read every pill; now it is one tab.
 *
 * The section headings are why there is no category tag on a row any more. A
 * tag under a heading of the same name repeats that word once per row, and the
 * row already has three things competing for the right-hand side. Filter to one
 * category and both disappear: every row is that section, so naming it on each
 * one says nothing.
 *
 * Two deliberate departures from the mockup, both because a working page cannot
 * promise what it does not do:
 *
 *  - The grip does not drag. This admin ships no client-side drag, so the grip
 *    is decorative and hidden from screen readers; reordering is Move up /
 *    Move down on the edit page, where the item's position in its section is
 *    also shown. The mockup's footer said "drag the grip to reorder", which
 *    would be a lie a static artboard can afford.
 *  - The second row action publishes and unpublishes rather than deleting.
 *    Content here is taken off the page, never destroyed — see
 *    canUnpublishContent in lib/auth/roles.ts. A trash icon over an action
 *    that unpublishes would be worse than either choice made honestly.
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

/**
 * Questions, or the section editor.
 *
 * Section titles and anchors used to be a details element at the foot of the
 * page, which put six collapsed forms below however many questions you were
 * reading. As a view it is one click from the filter bar and it gets the whole
 * panel. One pill rather than a Questions/Sections pair, because All,
 * Published and Draft already are the questions view.
 */
const VIEWS = ['questions', 'sections'] as const;
type View = (typeof VIEWS)[number];

function asStatus(v: string | undefined): Status {
  return STATUSES.includes(v as Status) ? (v as Status) : 'all';
}

function asView(v: string | undefined): View {
  return VIEWS.includes(v as View) ? (v as View) : 'questions';
}

export default async function FaqListPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string; error?: string; status?: string; cat?: string; add?: string; view?: string;
  }>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const message = faqMessage(sp.ok, sp.error);
  const mayEdit = canEditContent(user.role);
  const status = asStatus(sp.status);
  /* Only an editor has a sections view to switch to, so a manager arriving on
     ?view=sections gets the questions rather than a panel of controls every
     action behind would refuse. */
  const view = mayEdit ? asView(sp.view) : 'questions';

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
     page renders in, which is the whole point of showing it as one list, and it
     is what makes a heading per section correct rather than decorative: the
     rows under one heading really are contiguous. */
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

  /* Headings only when nothing is already narrowing the list to one section. */
  const grouped = cat === 'all';
  const shownPerGroup = new Map<string, number>();
  for (const r of rows) shownPerGroup.set(r.groupId, (shownPerGroup.get(r.groupId) ?? 0) + 1);

  const adding = mayEdit && sp.add === '1' && view === 'questions';

  /* Every link keeps the other filters. Losing the category you had selected
     because you clicked Draft is the sort of thing that makes a filter bar feel
     broken when each control works perfectly on its own. Params equal to their
     default are omitted, so the canonical URL of the default view is bare. */
  const href = (next: { status?: Status; cat?: string; view?: View; add?: '1' }) => {
    const s = next.status ?? status;
    const c = next.cat ?? cat;
    const v = next.view ?? view;
    const params = new URLSearchParams();
    if (s !== 'all') params.set('status', s);
    if (c !== 'all') params.set('cat', c);
    if (v !== 'questions') params.set('view', v);
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
          {/* The status tabs stay put in the sections view with none of them
              lit, and clicking any of them is the way back. That beats hiding
              them — the bar keeps its shape — and it beats leaving one lit,
              which would claim two things are selected at once. */}
          <div className={styles.filterPills} role="group" aria-label="Filter FAQ by status">
            <Tab
              href={href({ status: 'all', view: 'questions' })}
              on={view === 'questions' && status === 'all'}
              label="All"
              count={total}
            />
            <Tab
              href={href({ status: 'published', view: 'questions' })}
              on={view === 'questions' && status === 'published'}
              label="Published"
              count={publishedCount}
            />
            <Tab
              href={href({ status: 'draft', view: 'questions' })}
              on={view === 'questions' && status === 'draft'}
              label="Draft"
              count={draftCount}
            />
          </div>

          {/* Selecting a category navigates without a view param, so it lands
              on the questions too. */}
          <CategoryFilter
            groups={groups.map((g) => ({ id: g.id, title: g.title }))}
            value={cat}
            status={status}
          />

          {mayEdit && (
            <div className={styles.filterPills} role="group" aria-label="Edit the sections">
              {/* One pill, not a Questions/Sections pair: All, Published and
                  Draft already are the questions view, so a Questions tab
                  would be a fourth control saying the same thing. It toggles,
                  so it is also the way out of the view it opens. */}
              <Tab
                href={href({ view: view === 'sections' ? 'questions' : 'sections' })}
                on={view === 'sections'}
                label="Sections"
              />
            </div>
          )}

          {mayEdit && (
            <Link
              className={`${styles.btn} ${styles.btnGhost} ${styles.filterEnd}`}
              /* Forced to the questions view: the modal renders there, so
                 adding from the sections view has to leave it. */
              href={href({ add: '1', view: 'questions' })}
            >
              + Add question
            </Link>
          )}
        </div>

        {view === 'sections' ? (
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <div>
                <h2 className={styles.panelTitle}>Section titles and anchors</h2>
                <p className={styles.panelSub}>
                  {groups.length} sections, in the order the public page renders them. An anchor
                  is part of a URL — changing one breaks any link pointing at it.
                </p>
              </div>
            </div>
            {/* The form IS the grid cell — two sections abreast rather than six
                full-width rows of two short fields each. */}
            <div className={styles.sectionGrid}>
              {groups.map((g) => (
                <form className={styles.sectionCell} action={saveFaqGroup} key={g.id}>
                  <input type="hidden" name="id" value={g.id} />
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor={`t-${g.id}`}>Title</label>
                    <input
                      className={styles.control}
                      id={`t-${g.id}`}
                      name="title"
                      defaultValue={g.title}
                      required
                    />
                  </div>
                  <div className={styles.sectionRow}>
                    <div className={`${styles.field} ${styles.grow}`}>
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
                    {/* Named for a screen reader: six buttons all reading
                        "Save" is six identical announcements. */}
                    <button
                      className={`${styles.btn} ${styles.btnGhost}`}
                      type="submit"
                      aria-label={`Save section: ${g.title}`}
                    >
                      Save
                    </button>
                  </div>
                </form>
              ))}
            </div>
            <div className={styles.panelFoot}>
              <span>A section holding no live questions renders nothing on the public page.</span>
              <Link className={styles.rowLink} href={href({ view: 'questions' })}>
                Back to the questions
              </Link>
            </div>
          </div>
        ) : (
          <div className={styles.panel}>
            {rows.length === 0 ? (
              <p className={styles.empty}>
                <strong>
                  {total === 0 ? 'No questions yet' : 'Nothing matches those filters'}
                </strong>
                {total === 0
                  ? 'Use “Add question” above to write the first one.'
                  : `There are ${total} questions in total — clear the filters to see them.`}
              </p>
            ) : (
              rows.map((it, n) => {
                const group = groupById.get(it.groupId);
                /* A heading before the first row of each run. The rows are
                   sorted by section, so "the previous row was a different
                   section" is the whole test. */
                const opensGroup = grouped && rows[n - 1]?.groupId !== it.groupId;

                return (
                  <div key={it.id}>
                    {opensGroup && (
                      <div className={styles.faqGroupRow}>
                        <span>{group?.title ?? 'No section'}</span>
                        <span className={styles.faqGroupCount}>
                          {shownPerGroup.get(it.groupId)}
                          {status === 'all' ? '' : ' shown'}
                        </span>
                      </div>
                    )}

                    <div className={styles.faqRow}>
                      {/* Decorative: this admin has no client-side drag, and
                          reordering is Move up / Move down on the edit page. */}
                      <span className={styles.grip} aria-hidden="true" />

                      <Link className={styles.faqQ} href={`/admin/content/faq/${it.id}`}>
                        {it.question}
                      </Link>

                      {/* No category tag under a heading of the same name, and
                          none when a category is selected either — every row
                          would carry the word you just filtered on. */}
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
                            <input
                              type="hidden"
                              name="published"
                              value={it.published ? '0' : '1'}
                            />
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
        )}

        {adding && (
          <ModalDialog title="Add a question" cancelHref={href({})}>
            <form className={styles.modalBody} action={addFaqItem}>
              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="ng">Section</label>
                  <select
                    className={styles.control}
                    id="ng"
                    name="groupId"
                    /* The section you are filtered to is the one you are
                       looking at, so it is the one you are most likely adding
                       to. Undefined falls back to the first option. */
                    defaultValue={cat !== 'all' ? cat : undefined}
                    required
                  >
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
                  rows={5}
                  maxLength={4000}
                  required
                />
              </div>
              <div className={styles.modalFoot}>
                <span className={styles.panelNote}>
                  Added as a draft, so you can check it before it goes live
                </span>
                <Link className={`${styles.btn} ${styles.btnGhost}`} href={href({})}>
                  Cancel
                </Link>
                <button className={`${styles.btn} ${styles.btnPrimary}`} type="submit">
                  Add question
                </button>
              </div>
            </form>
          </ModalDialog>
        )}
      </div>
    </>
  );
}

/**
 * One tab. A link, not a button: the filter belongs in the URL.
 *
 * `count` is optional because the Questions/Sections pair has nothing to count
 * — a number there would have to be invented.
 */
function Tab({ href, on, label, count }: {
  href: string;
  on: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      className={`${styles.fbtn} ${on ? styles.fbtnOn : ''}`}
      href={href}
      aria-current={on ? 'true' : undefined}
    >
      {label}
      {count !== undefined && <span className={styles.fbtnCount}>{count}</span>}
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
