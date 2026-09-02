'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '../admin.module.css';

/**
 * The sidebar links — MIGRATION-PLAN §10.
 *
 * A client component for one reason: which link is current. A server layout has
 * no access to the pathname, and the alternative — hardcoding `active` on Leads
 * — was already wrong the moment Settings existed, telling anyone on the
 * settings screen that they were looking at leads.
 *
 * It ships `usePathname` and nothing else. No data, no session, no fetching:
 * `canManageUsers` is resolved on the server and arrives as a boolean, so the
 * role never reaches the browser bundle, and hiding the Team link is cosmetic
 * anyway — the route and every action behind it re-check the role themselves.
 */
export default function AdminNav({ showTeam }: { showTeam: boolean }) {
  const pathname = usePathname() ?? '';

  /**
   * Prefix matching, so /admin/leads/<id> keeps Leads lit. Settings is matched
   * exactly, otherwise it would also light up on its own /team child.
   *
   * Returns aria-current alongside the class because the active state is
   * carried visually by a colour and a left border, and neither reaches a
   * screen reader. Spread onto the Link so the two can never drift apart.
   */
  const link = (href: string, exact = false) => {
    const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return {
      className: `${styles.navLink} ${active ? styles.active : ''}`,
      'aria-current': active ? ('page' as const) : undefined,
    };
  };

  return (
    <nav className={styles.navScroll} aria-label="Admin sections">
      <div className={styles.navGroup}>
        <div className={styles.navGroupTitle}>Pipeline</div>
        <Link {...link('/admin/leads')} href="/admin/leads">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 12h5l2 3h4l2-3h5" />
            <path d="M4 5h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
          </svg>
          <span>Leads</span>
        </Link>
      </div>

      <div className={styles.navGroup}>
        <div className={styles.navGroupTitle}>Account</div>
        <Link {...link('/admin/settings', true)} href="/admin/settings">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          <span>Settings</span>
        </Link>

        {showTeam && (
          <Link {...link('/admin/settings/team')} href="/admin/settings/team">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="8" r="3.4" />
              <path d="M3 20v-1.4A4.6 4.6 0 0 1 7.6 14h2.8a4.6 4.6 0 0 1 4.6 4.6V20" />
              <path d="M16.5 4.6a3.4 3.4 0 0 1 0 6.6M21 20v-1.4a4.6 4.6 0 0 0-3.2-4.4" />
            </svg>
            <span>Team</span>
          </Link>
        )}
      </div>
    </nav>
  );
}
