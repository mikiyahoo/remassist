#!/usr/bin/env bash
# Add the AUTH_* keys to an existing shared/.env.
#
#   scp deploy/ensure-auth-env.sh remvps:/tmp/ensure-auth-env.sh
#   ssh -t remvps sudo bash /tmp/ensure-auth-env.sh
#
# Why this exists rather than re-running provision.sh: that script writes the
# AUTH_* block only when it CREATES shared/.env, and skips the whole file if one
# is already there ("$SHARED/.env exists — not touching it"). Any box whose .env
# predates the admin-auth work therefore has no AUTH_SECRET line at all — not an
# empty one, an absent one. `sed -i s/^AUTH_SECRET=.*/.../` matches nothing and
# reports success, which is a very quiet way to stay broken.
#
# Idempotent: it adds a key only when missing, fills one that is present but
# empty, and never touches a key that already has a value. Re-running it changes
# nothing. It prints no secret values.
set -uo pipefail

F=/srv/remassist/shared/.env

if [ "$(id -u)" != 0 ]; then
  echo "must run as root: ssh -t remvps sudo bash /tmp/ensure-auth-env.sh" >&2
  exit 1
fi
if [ ! -f "$F" ]; then
  echo "$F does not exist — run deploy/provision.sh instead" >&2
  exit 1
fi

# Back up before editing an environment file, and keep the copy tighter than the
# original: it holds the same database password.
BAK="$F.bak-$(date -u +%Y%m%dT%H%M%SZ)"
cp -p "$F" "$BAK"
chmod 600 "$BAK"
echo "backup: $BAK"

# present  -> key exists with a non-empty value
# empty    -> key exists, value blank
# absent   -> no such key
state() {
  if grep -qE "^$1=.+" "$F"; then echo present
  elif grep -qE "^$1=" "$F"; then echo empty
  else echo absent
  fi
}

# Appends or fills. The value is passed as $2 and never echoed.
ensure() {
  local key="$1" val="$2" s
  s="$(state "$key")"
  case "$s" in
    present) printf '  %-18s already set, left alone\n' "$key" ;;
    empty)
      # A literal & or | in the replacement would be interpreted by sed, so the
      # substitution is avoided entirely: drop the blank line, append a good one.
      grep -vE "^$key=$" "$F" > "$F.tmp" && mv "$F.tmp" "$F"
      printf '%s=%s\n' "$key" "$val" >> "$F"
      printf '  %-18s was blank, filled\n' "$key"
      ;;
    absent)
      printf '%s=%s\n' "$key" "$val" >> "$F"
      printf '  %-18s was absent, added\n' "$key"
      ;;
  esac
}

echo "== Setting required keys =="

# 32 bytes of base64, the same shape provision.sh documents.
ensure AUTH_SECRET "$(openssl rand -base64 32)"

# Derived from the site URL already in the file rather than guessed. AUTH_URL is
# what every emailed link is built from: wrong here and invitation links point
# at a host we do not own, and lib/auth/origin.ts throws in production without
# it rather than trusting an attacker-controllable Host header.
SITE="$(sed -n 's|^NEXT_PUBLIC_SITE_URL=\(.*\)$|\1|p' "$F" | head -1)"
if [ -n "$SITE" ]; then
  ensure AUTH_URL "$SITE"
else
  echo "  AUTH_URL           SKIPPED — no NEXT_PUBLIC_SITE_URL to derive it from."
  echo "                     Add it by hand: AUTH_URL=https://your-domain"
fi

echo
echo "== Optional keys (left as they are) =="
for k in AUTH_RESEND_KEY AUTH_EMAIL_FROM; do
  printf '  %-18s %s\n' "$k" "$(state "$k")"
done
echo "  AUTH_RESEND_KEY absent or empty means no email: password sign-in only,"
echo "  and the code / invitation / verification flows report a mail error."

# provision.sh's ownership, restored in case the rewrite above changed it.
chown deploy:deploy "$F"
chmod 640 "$F"

echo
echo "== Result =="
for k in AUTH_SECRET AUTH_URL; do
  printf '  %-18s %s\n' "$k" "$(state "$k")"
done

echo
echo "Now restart so the app reads the new values:"
echo "  sudo systemctl restart remassist"
