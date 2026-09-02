import type { DefaultSession } from 'next-auth';
import type { Role } from '@/lib/auth/roles';

/**
 * Session shape — MIGRATION-PLAN §10.
 *
 * `id` was already being assigned in auth.ts's session callback without a
 * declaration; `role` is added here so every gate can read it off the session
 * without casting. Both come from the adapter's user row under the database
 * session strategy.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
    } & DefaultSession['user'];
  }
}

export {};
