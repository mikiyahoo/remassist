import { headers } from 'next/headers';

/**
 * The origin to build an emailed link from — MIGRATION-PLAN §10.
 *
 * AUTH_URL wins, and it is what production sets. The request headers are only a
 * fallback for local development, where nobody has bothered to set it.
 *
 * That order matters more than it looks. The Host header is attacker-controlled
 * — anything can send `Host: evil.test` — so a link built from it can be
 * pointed anywhere. For a *sign-in* link Auth.js's own host checking covers
 * that, but an invitation link is ours, and it carries a token that creates an
 * account. Deriving it from a request is a way to email somebody a credential
 * addressed to a host we do not own. So the configured origin leads, and the
 * header path exists only where NODE_ENV is not production.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* A malformed AUTH_URL falls through rather than throwing here — the
         caller gets a usable local origin instead of a 500 nobody can read. */
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_URL must be set in production to build invitation links');
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}
