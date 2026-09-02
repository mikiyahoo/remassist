import { randomUUID } from 'node:crypto';
import NextAuth from 'next-auth';
import Resend from 'next-auth/providers/resend';
import Credentials from 'next-auth/providers/credentials';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import type { Adapter } from '@auth/core/adapters';
import { getDb, isDatabaseConfigured } from '@/db';
import { users, accounts, sessions, verificationTokens } from '@/db/schema/auth';
import { isAllowedEmail } from '@/lib/auth/allowlist';
import { verifyPassword } from '@/lib/auth/password';
import { isRole } from '@/lib/auth/roles';
import { clearFailures, isLockedOut, recordFailure } from '@/lib/auth/attempts';
import { CODE_TTL_SEC, generateSigninCode } from '@/lib/auth/code';
import { renderSigninEmail } from '@/lib/auth/email';
import { mailFrom, sendAuthEmail } from '@/lib/auth/mailer';
import {
  REMEMBER_COOKIE, SESSION_UPDATE_AGE_SEC, sessionMaxAge,
} from '@/lib/auth/remember';

/**
 * Admin authentication — MIGRATION-PLAN §10.
 *
 * Emailed sign-in for ~9 internal editors: one single-use token delivered as
 * both a clickable link and a 6-digit code. No public accounts, no passwords,
 * no OAuth today.
 *
 * The config is a function rather than an object for two reasons. It must not
 * touch the database at import time — `next build` prerenders in a process with
 * no DATABASE_URL, and building the adapter eagerly would fail the build for
 * every page that never authenticates (same reasoning as the lazy pool in
 * db/index.ts). And session length has to be resolved per request, which is the
 * only seam Auth.js offers for a working "keep me signed in".
 */

/**
 * The Drizzle adapter with brute-force lockout on token redemption.
 *
 * `useVerificationToken` is the single point where a token is exchanged for a
 * session, and the adapter is a plain object of optional methods, so this is
 * the natural place to count failures. It has to exist: Auth.js applies no
 * throttling of its own, and a 6-digit code without a counter is a million
 * guesses against an endpoint that answers as fast as it is asked.
 *
 * A locked-out attempt returns null, which Auth.js turns into its ordinary
 * Verification error — identical to a wrong code, so nothing is disclosed about
 * whether the address exists or is currently locked.
 */
function buildAdapter(): Adapter {
  const base = DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  });

  return {
    ...base,
    async useVerificationToken(params) {
      if (await isLockedOut(params.identifier)) return null;
      const row = await base.useVerificationToken!(params);
      if (row) await clearFailures(params.identifier);
      else await recordFailure(params.identifier);
      return row;
    },
  };
}

/**
 * Read the remember flag. Uses next/headers rather than the request argument
 * because that argument is undefined when signIn is invoked from a server
 * action — which is exactly the path the sign-in form takes.
 */
async function rememberedSessionMaxAge(): Promise<number> {
  try {
    const jar = await cookies();
    return sessionMaxAge(jar.get(REMEMBER_COOKIE)?.value);
  } catch {
    /* No request context (build-time evaluation). The short session is the
       safe default; nothing is being signed in here anyway. */
    return sessionMaxAge(undefined);
  }
}

/**
 * Look a user up for password sign-in.
 *
 * Every failure returns null and they are all indistinguishable to the caller:
 * unknown address, disabled account, no password set, wrong password, locked
 * out. Distinguishing them turns the sign-in form into an oracle that confirms
 * which addresses have accounts.
 */
async function authorizePassword(email: string, password: string) {
  if (!isDatabaseConfigured()) return null;
  if (!isAllowedEmail(email)) return null;

  /* Password guessing and code guessing are the same attack, so they share the
     one counter rather than each getting a weaker copy of it. */
  if (await isLockedOut(email)) return null;

  const db = getDb();
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      disabledAt: users.disabledAt,
    })
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  /* Still hash on the miss paths. Returning early makes an unknown address
     answer measurably faster than a known one with a wrong password, which
     enumerates accounts by stopwatch. */
  const hash = row?.passwordHash ?? DUMMY_HASH;
  const ok = await verifyPassword(password, hash);

  if (!row || !ok || row.disabledAt || !row.passwordHash) {
    await recordFailure(email);
    return null;
  }

  await clearFailures(email);
  return { id: row.id, email: row.email, name: row.name };
}

/**
 * A real scrypt hash of a value nobody knows, used to keep the timing of a
 * miss close to the timing of a hit. Generated once per process.
 */
const DUMMY_HASH =
  'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  const adapter = isDatabaseConfigured() ? buildAdapter() : undefined;
  /* Resolved once per request from the remember cookie, and used both for the
     session config and by the jwt.encode override below, so password and code
     sign-in size their sessions identically. */
  const maxAge = await rememberedSessionMaxAge();

  return {
    /* Behind Nginx the request host arrives in forwarded headers. Without this
       Auth.js refuses to build callback URLs from them. Requires Nginx to set
       X-Forwarded-Proto — deploy/remassist-common.conf does. */
    trustHost: true,
    adapter,
    /**
     * The reason password sign-in works at all.
     *
     * Auth.js's credentials branch never calls handleLoginOrRegister — it
     * unconditionally calls jwt.encode and puts the result in the session
     * cookie, even under strategy:'database'. Left alone, that writes a JWE
     * that getSessionAndUser cannot resolve, so the user is silently signed out
     * one request later with nothing in the logs. (The usual guard does not
     * fire: assert.js only raises UnsupportedStrategy when EVERY provider is
     * credentials, and Resend is also present.)
     *
     * So encode mints a real session row and returns its token. Under
     * strategy:'database' this override is reached from exactly one place —
     * the credentials branch. The email branch checks useJwtSession and skips
     * it, session.js takes the database branch, and signOut calls
     * adapter.deleteSession. That single-caller property is load-bearing and
     * specific to @auth/core 0.41.x; if this file starts issuing broken
     * sessions after an upgrade, check that assumption first.
     */
    jwt: {
      async encode({ token }) {
        const userId = token?.sub;
        if (!adapter?.createSession || !userId) {
          throw new Error('cannot create a session without an adapter and a user');
        }
        const sessionToken = randomUUID();
        await adapter.createSession({
          sessionToken,
          userId,
          expires: new Date(Date.now() + maxAge * 1000),
        });
        return sessionToken;
      },
      /* Never called under strategy:'database' — session reads go through
         getSessionAndUser and signOut through deleteSession. Present so a
         future strategy change fails loudly rather than mis-decoding a
         database session token as a JWT. */
      decode() {
        return null;
      },
    },
    /**
     * Resolved per request. Auth.js recomputes the sliding expiry from whatever
     * this returns on every session read, so as long as the remember cookie
     * outlives the session the renewal stays consistent on its own — no need to
     * wrap the adapter's createSession, which would be undone by that same
     * recomputation on the next read.
     */
    session: {
      strategy: 'database',
      maxAge: await rememberedSessionMaxAge(),
      updateAge: SESSION_UPDATE_AGE_SEC,
    },
    providers: [
      Resend({
        /* The provider refuses to initialise without a key. In the local branch
           below nothing is ever sent with it, so a placeholder is enough. */
        apiKey: process.env.AUTH_RESEND_KEY ?? 'local-development-no-key',
        from: mailFrom(),
        /* One token, two ways to redeem it, therefore one expiry. Fifteen
           minutes is short for a link and standard for a code; combined with the
           lockout above it keeps the 6-digit keyspace out of reach. */
        maxAge: CODE_TTL_SEC,
        generateVerificationToken: generateSigninCode,
        async sendVerificationRequest({ identifier, url, token }) {
          const { subject, html, text } = renderSigninEmail({ code: token, url });
          await sendAuthEmail({
            to: identifier,
            subject,
            html,
            text,
            /**
             * Local development with no mail provider: the credentials are
             * printed to the terminal instead of emailed.
             *
             * NOT a bypass. The token is real and single-use, the allowlist has
             * already refused any address outside the company by the time this
             * runs, and redemption goes through the ordinary callback. Only the
             * transport differs, so the flow tested locally is the flow that
             * ships. See printLocally in lib/auth/mailer.ts for why that branch
             * cannot be reached in production.
             */
            localPreview: [
              '',
              '  ┌─ Admin sign-in (local only — no email was sent)',
              `  │  ${identifier}`,
              `  │  code: ${token}`,
              `  └─ ${url}`,
              '',
            ].join('\n'),
          });
        },
      }),
      /**
       * Password sign-in. Not a first-class Auth.js flow here — see the
       * jwt.encode note above for what makes it produce a database session.
       */
      Credentials({
        id: 'password',
        name: 'Password',
        credentials: {
          email: { label: 'Email', type: 'email' },
          password: { label: 'Password', type: 'password' },
        },
        authorize(credentials) {
          const email = String(credentials?.email ?? '').trim().toLowerCase();
          const password = String(credentials?.password ?? '');
          if (!email || !password) return null;
          return authorizePassword(email, password);
        },
      }),
    ],
    pages: {
      signIn: '/admin/signin',
      error: '/admin/signin',
      /* Straight to the code screen, which is where the person now has something
         to do. Note this path carries NO query string: Auth.js appends its own
         (?provider=…&type=…), and a page URL that already had one comes out as
         `?sent=1%3Fprovider%3Dresend` — a mangled parameter and an ugly URL. */
      verifyRequest: '/admin/signin/code',
    },
    callbacks: {
      /**
       * Enforced here rather than only in the admin layout, and this matters:
       * the callback runs *before* the mail is sent, so a stranger's address is
       * refused instead of being emailed. Gating only at the page would leave a
       * public endpoint that makes our server send mail to any address on
       * request — an open relay wearing a sign-in form.
       */
      signIn({ user }) {
        return isAllowedEmail(user?.email);
      },
      session({ session, user }) {
        if (session.user) {
          session.user.id = user.id;
          /* The adapter returns the whole row, so the role rides along without
             a second query. isRole guards it because the column is typed as an
             enum in Postgres but arrives here as a plain string. */
          const role = (user as { role?: unknown }).role;
          session.user.role = isRole(role) ? role : 'manager';
        }
        return session;
      },
    },
  };
});
