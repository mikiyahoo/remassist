#!/usr/bin/env node
/**
 * Import db/rates-seed.json into the three catalog tables.
 *
 *   npm run db:seed
 *
 * These are the figures behind every estimate the site quotes: coverage
 * options, agent tiers and the service categories a lead is routed into.
 * MIGRATION-PLAN §6.3 is where they replace the arrays in lib/quiz/quiz.ts;
 * until then this is what the Rates screen reads and what makes a stored quote
 * traceable to the numbers that produced it.
 *
 * Plain .mjs importing only node: builtins and pg, so it runs on the VPS's
 * Node 20 as well as locally — the same reason db/seed-content.mjs and
 * deploy/set-admin-password.mjs are .mjs. It replaced a db/seed.ts that could
 * not run under either: its relative imports carried no file extensions, which
 * Next resolves and node's ESM loader does not.
 *
 * INSERT-ONLY, never UPDATE, and that is the important property. Rates are
 * editable in the admin now, so a second run must not quietly restore $8.00
 * over a deliberate price change — which also makes it safe to call on every
 * deploy. Rows are matched on their key and skipped if present. The trade is
 * that it cannot be used to push a new price from the JSON; that is correct,
 * because the database is the source of truth and this file is the record of
 * what was first imported.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ['.env.local', '.env']) {
    try {
      const m = /^DATABASE_URL=(.*)$/m.exec(readFileSync(f, 'utf8'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* try the next one */ }
  }
  return null;
}

const url = connectionString();
if (!url) {
  console.error('\n  No DATABASE_URL, and no .env.local or .env to read one from.\n');
  process.exit(1);
}

const seed = JSON.parse(readFileSync(new URL('./rates-seed.json', import.meta.url), 'utf8'));
const pool = new pg.Pool({ connectionString: url });
const c = await pool.connect();

const added = {};
const skipped = {};
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };

try {
  await c.query('BEGIN');

  for (const o of seed.coverageOptions) {
    const { rowCount } = await c.query(
      `insert into coverage_options
         (key, label, long_label, seats, monthly_hours, sort_order)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (key) do nothing`,
      [o.key, o.label, o.longLabel, o.seats, o.monthlyHours, o.sortOrder],
    );
    bump(rowCount ? added : skipped, 'coverage_options');
  }

  for (const t of seed.agentTiers) {
    const { rowCount } = await c.query(
      `insert into agent_tiers (key, label, hourly_rate_usd, note, sort_order)
       values ($1,$2,$3,$4,$5)
       on conflict (key) do nothing`,
      [t.key, t.label, t.hourlyRateUsd, t.note ?? null, t.sortOrder],
    );
    bump(rowCount ? added : skipped, 'agent_tiers');
  }

  for (const s of seed.serviceCategories) {
    const { rowCount } = await c.query(
      `insert into service_categories (key, name, slug, nav_blurb, sort_order)
       values ($1,$2,$3,$4,$5)
       on conflict (key) do nothing`,
      [s.key, s.name, s.slug, s.navBlurb ?? null, s.sortOrder],
    );
    bump(rowCount ? added : skipped, 'service_categories');
  }

  await c.query('COMMIT');
} catch (err) {
  await c.query('ROLLBACK');
  console.error('\n  Rate seed failed, nothing was written:\n');
  console.error(err);
  process.exitCode = 1;
} finally {
  c.release();
  await pool.end();
}

if (process.exitCode !== 1) {
  const line = (o) => Object.entries(o).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
  console.log(`  added:   ${line(added)}`);
  console.log(`  skipped: ${line(skipped)} (already present)`);
}
