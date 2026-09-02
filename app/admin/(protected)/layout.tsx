import { cookies } from 'next/headers';
import { signOut } from '@/auth';
import { requireUser } from '@/lib/auth/require';
import { canManageUsers } from '@/lib/auth/roles';
import { REMEMBER_COOKIE } from '@/lib/auth/remember';
import AdminNav from './AdminNav';
import VerifyBanner from './VerifyBanner';
import styles from '../admin.module.css';

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
  const email = user.email;

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
          <span className={styles.who}>{email}</span>
          <span className={styles.whoRole}>{user.role}</span>
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
            <button className={styles.signout} type="submit">Sign out</button>
          </form>
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
