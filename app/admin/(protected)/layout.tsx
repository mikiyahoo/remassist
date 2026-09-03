import Link from 'next/link';
import { cookies } from 'next/headers';
import { signOut } from '@/auth';
import { requireUser } from '@/lib/auth/require';
import { canManageUsers } from '@/lib/auth/roles';
import { REMEMBER_COOKIE } from '@/lib/auth/remember';
import AdminNav from './AdminNav';
import VerifyBanner from './VerifyBanner';
import styles from '../admin.module.css';

/** First-name initials for the footer avatar: "Jane Doe" -> JD. Falls back to
    the email prefix when no name is set, so an account that never filled its
    name still gets a mark of its own rather than a blank circle. */
function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || 'A').trim();
  const parts = src.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/**
 * The admin gate and chrome — MIGRATION-PLAN §10.
 *
 * A server-component check rather than middleware, per the plan.
 *
 * Note what this does NOT cover: route handlers render outside the layout tree,
 * so every handler under /admin re-checks the session itself. See
 * leads/export/route.ts — a CSV of every lead is exactly the thing that must
 * not be reachable because someone assumed a parent layout was protecting it.
 *
 * Sidebar and topbar follow the "Test Admin" prototype. Leads, Settings and
 * Team are built; the remaining sections in that prototype are later phases and
 * are deliberately absent rather than present-and-dead.
 */

/* Session-dependent: prerendering would bake one person's view into HTML. */
export const dynamic = 'force-dynamic';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  /* Loads the user row, so a disabled account loses access on its next
     request rather than at its next sign-in. */
  const user = await requireUser();

  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/rem-logo.svg" alt="Rem Assist" />
          <span className={styles.brandLabel}>Admin</span>
        </div>

        <AdminNav showTeam={canManageUsers(user.role)} />

        <div className={styles.sidebarFoot}>
          {/* Identity block, drawn exactly as the prototype drew it: initials
              avatar, then name and "role · email" on the line under it. */}
          <div className={styles.adminCard}>
            <span className={styles.avatar} aria-hidden="true">
              {initials(user.name, user.email)}
            </span>
            <div>
              <div className={styles.adminName}>{user.name ?? 'Admin user'}</div>
              <div className={styles.adminRole}>{user.role} · {user.email}</div>
            </div>
          </div>

          <div className={styles.sidebarLinks}>
            {/* The way back to the site the admin edits. New tab so the admin
                is not thrown out of where they were working. */}
            <Link href="/" target="_blank" rel="noopener">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14 4h6v6" />
                <path d="M20 4 10 14" />
                <path d="M20 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h6" />
              </svg>
              <span>View site</span>
            </Link>

            <form
              action={async () => {
                'use server';
                /* Clear the remember flag too. Left behind, it would silently
                   give the next person to sign in on this browser a 30-day
                   session they never asked for. */
                (await cookies()).delete(REMEMBER_COOKIE);
                await signOut({ redirectTo: '/admin/signin' });
              }}
            >
              <button className={styles.signoutLink} type="submit">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <path d="m16 17 5-5-5-5M21 12H9" />
                </svg>
                <span>Sign out</span>
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        {/* Above the page's own sticky topbar, so it scrolls away rather than
            permanently eating a strip of a screen it never blocks. */}
        <VerifyBanner user={user} />
        {children}
      </div>
    </>
  );
}
