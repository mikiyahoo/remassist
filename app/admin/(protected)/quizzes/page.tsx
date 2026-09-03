import { Fragment } from 'react';
import Link from 'next/link';
import { desc, eq, isNull } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { leads, quizSubmissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { answerFor, formatDate, orderedAnswers, questionFor } from '@/lib/leads/display';
import styles from '../../admin.module.css';

/**
 * Fit finder submissions.
 *
 * The reason this screen exists: a submission whose lead_id is null appears
 * nowhere else. The lead detail page renders quiz answers, but only the ones
 * joined to that lead — so somebody who worked through the quiz and then chose
 * not to leave their details produced a record no human could read. That is
 * demand the business has already paid to generate and then cannot see.
 *
 * Read-only, and both roles may see it: it is the same lead data by another
 * route, and canViewLeads is true for a manager.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Fit finder',
  robots: { index: false, follow: false },
};

const PAGE_SIZE = 50;

export default async function QuizzesPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string }>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const anonymousOnly = sp.only === 'anonymous';

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar total={null} anonymousOnly={anonymousOnly} />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there are no
            submissions to show.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();
  const rows = await db
    .select({
      id: quizSubmissions.id,
      createdAt: quizSubmissions.createdAt,
      answers: quizSubmissions.answers,
      result: quizSubmissions.result,
      completed: quizSubmissions.completed,
      leadId: quizSubmissions.leadId,
      leadEmail: leads.email,
      leadName: leads.name,
    })
    .from(quizSubmissions)
    .leftJoin(leads, eq(quizSubmissions.leadId, leads.id))
    .where(anonymousOnly ? isNull(quizSubmissions.leadId) : undefined)
    .orderBy(desc(quizSubmissions.createdAt))
    .limit(PAGE_SIZE);

  return (
    <>
      <Topbar total={rows.length} anonymousOnly={anonymousOnly} />

      <div className={styles.view}>
        <div className={styles.filters}>
          <Link
            className={`${styles.pagerLink} ${!anonymousOnly ? styles.pagerLinkOn : ''}`}
            href="/admin/quizzes"
          >
            All submissions
          </Link>
          <Link
            className={`${styles.pagerLink} ${anonymousOnly ? styles.pagerLinkOn : ''}`}
            href="/admin/quizzes?only=anonymous"
          >
            No contact details
          </Link>
        </div>

        {rows.length === 0 ? (
          <div className={styles.panel}>
            <p className={styles.empty}>
              <strong>{anonymousOnly ? 'Nobody abandoned the quiz' : 'No submissions yet'}</strong>
              {anonymousOnly
                ? 'Every submission so far came with contact details, which is the outcome you want.'
                : 'The fit finder on the home page and /qualify both write here.'}
            </p>
          </div>
        ) : (
          rows.map((q) => (
            <section className={`${styles.panel} ${styles.section}`} key={q.id}>
              <div className={styles.panelHead}>
                <h2 className={styles.panelTitle}>
                  {q.leadId
                    ? (q.leadName ?? q.leadEmail ?? 'Linked lead')
                    : 'Anonymous — no contact details'}
                </h2>
                <span className={styles.panelNote}>
                  <span className={styles.mono}>{formatDate(q.createdAt)}</span>
                  {!q.completed && <span className={styles.tag}>Partial</span>}
                </span>
              </div>

              {q.leadId ? (
                <p className={styles.panelIntro}>
                  <Link className={styles.rowLink} href={`/admin/leads/${q.leadId}`}>
                    Open the lead
                  </Link>
                  {q.leadEmail && <span className={styles.mono}> · {q.leadEmail}</span>}
                </p>
              ) : (
                <p className={styles.panelIntro}>
                  {/* Said plainly, because the instinct on seeing an interesting
                      answer set is to look for the person attached to it. */}
                  This person did not leave an address, so there is nobody to reply to. The
                  answers are still worth reading as demand.
                </p>
              )}

              <dl className={styles.qa}>
                {orderedAnswers(q.answers).map(([key, value]) => {
                  const a = answerFor(key, value);
                  return (
                    <Fragment key={key}>
                      <dt>{questionFor(key) ?? key}</dt>
                      <dd>
                        {a.label}
                        {a.note && <span className={styles.answerNote}> — {a.note}</span>}
                      </dd>
                    </Fragment>
                  );
                })}
              </dl>

              {q.result && (
                <div className={`${styles.quote} ${styles.quoteDivided}`}>
                  <Quote label="Service" value={q.result.service} />
                  <Quote label="Tier" value={q.result.tier} />
                  <Quote label="Seats" value={q.result.seats} />
                  <Quote label="Hours" value={q.result.hours} />
                  <Quote label="Rate" value={q.result.rate ? `$${q.result.rate}/hr` : undefined} />
                  <Quote label="Estimate" value={q.result.cost} />
                </div>
              )}
            </section>
          ))
        )}

        {rows.length === PAGE_SIZE && (
          <p className={styles.panelNote}>
            Showing the {PAGE_SIZE} most recent. Older submissions are not paged yet.
          </p>
        )}
      </div>
    </>
  );
}

function Quote({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className={styles.quoteItem}>
      <span className={styles.quoteLabel}>{label}</span>
      <span className={styles.quoteValue}>
        {value ?? <span className={styles.none}>—</span>}
      </span>
    </div>
  );
}

function Topbar({ total, anonymousOnly }: { total: number | null; anonymousOnly: boolean }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Fit finder</h1>
          <p className={styles.tbSub}>
            {total === null
              ? 'Database not configured'
              : anonymousOnly
                ? `${total} with no contact details`
                : `${total} submissions`}
          </p>
        </div>
      </div>
    </header>
  );
}
