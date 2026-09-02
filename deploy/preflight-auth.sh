#!/usr/bin/env bash
# Pre-flight for the admin-accounts migrations (0003-0005).
#
# Copy it over and run it with sudo. Two commands, no quotes anywhere:
#
#   scp deploy/preflight-auth.sh remvps:/tmp/preflight-auth.sh
#   ssh -t remvps sudo bash /tmp/preflight-auth.sh
#
# Not `ssh host '<sql>'`, and not `ssh host bash -s < file`, because neither
# survives a Windows shell. PowerShell strips embedded double quotes before ssh
# sees them, so inline SQL arrives as bare words and bash dies on the first
# `(`; and PowerShell rejects `<` outright ("reserved for future use"). Passing
# the command as bare tokens has no quoting to get wrong on any platform.
#
# sudo is required: provision.sh writes shared/.env as deploy:deploy 0640, so an
# admin login cannot read it. DATABASE_URL is TCP with a password, so psql works
# fine as root.
#
# Read-only. It writes nothing, changes nothing, and prints no secret values.
set -uo pipefail

ENV_FILE=/srv/remassist/shared/.env
if [ ! -r "$ENV_FILE" ]; then
  # provision.sh writes this file chown deploy:deploy, chmod 640, so an admin
  # login cannot read it. Run the script under sudo:
  #     ssh -t remvps sudo bash /tmp/preflight-auth.sh
  echo "cannot read $ENV_FILE — run this with sudo" >&2
  echo "  ssh -t remvps sudo bash /tmp/preflight-auth.sh" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

missing=0

echo "== Environment =="
for var in DATABASE_URL AUTH_SECRET AUTH_URL; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    # Length only, never the value. AUTH_SECRET signs every session cookie and
    # DATABASE_URL carries the database password; neither belongs in a terminal
    # scrollback or a pasted screenshot.
    printf '  %-18s set (%d chars)\n' "$var" "${#val}"
  else
    printf '  %-18s MISSING  <-- required\n' "$var"
    missing=1
  fi
done

for var in AUTH_RESEND_KEY AUTH_EMAIL_FROM; do
  val="${!var:-}"
  if [ -n "$val" ]; then
    printf '  %-18s set\n' "$var"
  else
    printf '  %-18s unset (no email; password sign-in only)\n' "$var"
  fi
done

if [ -z "${DATABASE_URL:-}" ]; then
  echo
  echo "No DATABASE_URL, so there is nothing further to check."
  exit 1
fi

echo
echo "== Schema state =="
psql "$DATABASE_URL" -q -t -A <<'SQL'
select '  migrations applied : ' || coalesce((
         select count(*)::text from drizzle.__drizzle_migrations
       ), 'no drizzle bookkeeping table');
select '  users table       : ' || case when exists (
         select 1 from information_schema.tables
          where table_schema = 'public' and table_name = 'users'
       ) then 'present' else 'ABSENT - 0002 has not run, tables arrive empty' end;
select '  role column       : ' || case when exists (
         select 1 from information_schema.columns
          where table_name = 'users' and column_name = 'role'
       ) then 'present - 0004 already applied' else 'absent - 0004 will add it' end;
SQL

echo
echo "== Existing accounts =="
echo "   (every one of these becomes role='manager' when 0004 runs)"
psql "$DATABASE_URL" -q <<'SQL'
select count(*)              as users,
       count(password_hash)  as with_password,
       count(email_verified) as verified
  from users;
SQL

echo "== Lead data (must survive migration 0001) =="
psql "$DATABASE_URL" -q <<'SQL'
select count(*) as leads,
       count(first_name)       as have_first_name,
       count(service_interest) as have_service_interest,
       count(raw_fields)       as have_raw_fields
  from leads;
SQL
echo "   0001 adds those three columns as nullable, so rows captured before it"
echo "   ran read NULL. A total that matches what you had is the thing to check."
echo

echo "== BLOCKER CHECK: case-duplicate addresses =="
echo "   Any row below means 0004 cannot create users_email_lower_idx, so the"
echo "   deploy aborts at the migrate step. That happens BEFORE the symlink"
echo "   swap, so the live site stays on the previous release."
psql "$DATABASE_URL" -q <<'SQL'
select lower(email) as duplicate_address, count(*)
  from users
 group by 1
having count(*) > 1;
SQL

echo
if [ "$missing" != 0 ]; then
  echo "RESULT: a required variable is missing. Fix it before deploying."
  exit 1
fi
echo "RESULT: environment complete. Read the two tables above before deploying."
