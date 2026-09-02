import Link from 'next/link';
import { count, desc, sql } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { leads, quizSubmissions } from '@/db/schema';
import { requireUser } from '@/lib/auth/require';
import { LEAD_STATUSES, SOURCE_LABELS, formatDate } from '@/lib/leads/display';
import styles from '../admin.module.css';

/**
 * The admin landing page.
 *
 * Replaces a redirect to /admin/leads. That redirect was honest when leads were
 * the only surface, but it meant the admin had no answer to "how are we doing"
 * short of reading a table row by row.
 *
 * Counts only, and every one of them is a link into the screen that can act on
 * the number. A dashboard that reports a figure you cannot then investigate is
 * a poster, not a tool.
 *
 * Lives inside (protected) so it inherits the gate. It is /admin because a
 * route group adds nothing to the URL.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Dashboard',
  robots: { index: false, follow: false },
};

const RECENT = 6;

export default async function DashboardPage() {
  await requireUser();

  if (!isDatabaseConfigured()) {
    return (
      <>
        <Topbar subtitle="Database not configured" />
        <div className={styles.view}>
          <div className={styles.notice}>
            <strong>No database configured</strong>
            There is no <code>DATABASE_URL</code> in this environment, so there is nothing to
            count. The public form degrades too — <code>/api/leads</code> answers 503 and
            visitors fall back to composing an email, so nothing is being lost.
          </div>
        </div>
      </>
    );
  }

  const db = getDb();

  const [byStatus, totals, quizTotals, recentLeads] = await Promise.all([
    db
      .select({ status: leads.status, n: count() })
      .from(leads)
      .groupBy(leads.status),
    db.select({ n: count() }).from(leads),
    db
      .select({
        n: count(),
        /* Submissions with no lead are the ones no other screen shows: the lead
           detail page only joins quizzes to the lead they belong to. */
        anonymous: sql<number>`count(*) filter (where ${quizSubmissions.leadId} is null)`,
        completed: sql<number>`count(*) filter (where ${quizSubmissions.completed})`,
      })
      .from(quizSubmissions),
    db
      .select({
        id: leads.id,
        createdAt: leads.createdAt,
        name: leads.name,
        email: leads.email,
        status: leads.status,
        source: leads.source,
      })
      .from(leads)
      .orderBy(desc(leads.createdAt))
      .limit(RECENT),
  ]);

  const statusCount = new Map(byStatus.map((r) => [r.status, Number(r.n)]));
  const leadTotal = Number(totals[0]?.n ?? 0);
  const quizzes = Number(quizTotals[0]?.n ?? 0);
  const anonymous = Number(quizTotals[0]?.anonymous ?? 0);
  const completed = Number(quizTotals[0]?.completed ?? 0);
  const untouched = statusCount.get('new') ?? 0;

  return (
    <>
      <Topbar subtitle="Everything the system has captured" />

      <div className={styles.view}>
        <div className={styles.statRow}>
          <Stat href="/admin/leads" value={leadTotal} label="Leads captured" />
          <Stat
            href="/admin/leads?status=new"
            value={untouched}
            label="Awaiting a first response"
            tone={untouched > 0 ? 'warn' : undefined}
          />
          <Stat href="/admin/quizzes" value={quizzes} label="Fit finder submissions" />
          <Stat
            href="/admin/quizzes?only=anonymous"
            value={anonymous}
            label="Quizzes with no contact details"
            note={anonymous > 0 ? 'Interest with nobody to reply to' : undefined}
          />
        </div>

        <section className={`${styles.panel} ${styles.section}`}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Pipeline</h2>
            <span className={styles.panelNote}>
              {completed} of {quizzes} quizzes were completed
            </span>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr><th>Status</th><th>Leads</th><th aria-label="Share" /></tr>
              </thead>
              <tbody>
                {LEAD_STATUSES.map((s) => {
                  const n = statusCount.get(s) ?? 0;
                  const pct = leadTotal > 0 ? Math.round((n / leadTotal) * 100) : 0;
                  return (
                    <tr key={s}>
                      <td>
                        <Link className={styles.rowLink} href={`/admin/leads?status=${s}`}>
                          <span className={`${styles.pill} ${styles[`s_${s}`]}`}>{s}</span>
                        </Link>
                      </td>
                      <td className={styles.mono}>{n}</td>
                      <td>
                        {/* A bar rather than only a number: the shape of the
                            pipeline is the point, and 3 vs 30 does not read as
                            a difference in a column of digits. */}
                        <span className={styles.bar} aria-hidden="true">
                          <span className={styles.barFill} style={{ width: `${pct}%` }} />
                        </span>
                        <span className={styles.barPct}>{pct}%</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <h2 className={styles.panelTitle}>Latest arrivals</h2>
            <Link className={`${styles.btn} ${styles.btnGhost}`} href="/admin/leads">
              All leads
            </Link>
          </div>
          {recentLeads.length === 0 ? (
            <p className={styles.empty}>
              <strong>Nothing captured yet</strong>
              Leads from the contact form, the fit finder and the pricing CTA all land here.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr><th>Received</th><th>Name</th><th>Email</th><th>Source</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {recentLeads.map((l) => (
                    <tr key={l.id}>
                      <td className={`${styles.mono} ${styles.nowrap}`}>{formatDate(l.createdAt)}</td>
                      <td>
                        <Link className={styles.rowLink} href={`/admin/leads/${l.id}`}>
                          {l.name ?? <span className={styles.none}>No name</span>}
                        </Link>
                      </td>
                      <td className={styles.mono}>{l.email}</td>
                      <td className={styles.nowrap}>{SOURCE_LABELS[l.source] ?? l.source}</td>
                      <td>
                        <span className={`${styles.pill} ${styles[`s_${l.status}`]}`}>{l.status}</span>
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

function Stat({ href, value, label, note, tone }: {
  href: string;
  value: number;
  label: string;
  note?: string;
  tone?: 'warn';
}) {
  return (
    <Link className={`${styles.stat} ${tone === 'warn' ? styles.statWarn : ''}`} href={href}>
      <span className={styles.statNum}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
      {note && <span className={styles.statNote}>{note}</span>}
    </Link>
  );
}

function Topbar({ subtitle }: { subtitle: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.tbInner}>
        <div>
          <h1 className={styles.tbTitle}>Dashboard</h1>
          <p className={styles.tbSub}>{subtitle}</p>
        </div>
      </div>
    </header>
  );
}
