'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { getDb, isDatabaseConfigured } from '@/db';
import { leads } from '@/db/schema';
import { assertUser } from '@/lib/auth/require';
import { canEditLeads } from '@/lib/auth/roles';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/leads/display';

/**
 * Set a lead's status.
 *
 * A server action is a POST endpoint with a generated name — it is NOT covered
 * by the (protected) layout's gate, which only runs when rendering a page. So
 * it re-checks the session itself. Trusting the layout here would leave an
 * unauthenticated write against the leads table.
 */
export async function setLeadStatus(id: string, status: string) {
  const user = await assertUser();
  if (!canEditLeads(user.role)) throw new Error('forbidden');

  if (!isDatabaseConfigured()) throw new Error('database unavailable');
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('bad id');
  if (!(LEAD_STATUSES as readonly string[]).includes(status)) throw new Error('bad status');

  const db = getDb();
  await db
    .update(leads)
    .set({ status: status as LeadStatus })
    .where(eq(leads.id, id));

  revalidatePath(`/admin/leads/${id}`);
  revalidatePath('/admin/leads');
}
