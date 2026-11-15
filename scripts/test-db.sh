#!/usr/bin/env bash
# Database tests: starts an empty local Supabase database (Docker), runs
# every migration in supabase/migrations on it and then the pgTAP tests in
# tests/db. Nothing touches a real project.
#
#   npm run test:db            needs Docker and the Supabase CLI
#   KEEP_DB=1 npm run test:db  leaves the database running afterwards
#
# The Supabase project files are set up in a temporary folder, so the
# repository needs no supabase/config.toml (the deployment works without
# one and should stay that way).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="${TEST_DB_DIR:-$(mktemp -d)}"
mkdir -p "$work"
cd "$work"
if [ ! -f supabase/config.toml ]; then
  supabase init --force >/dev/null
  # Own name and ports, so it doesn't clash with a local Supabase.
  sed -i 's/^project_id = .*/project_id = "bautagebuch-test"/' supabase/config.toml
fi
rm -rf supabase/migrations supabase/tests
cp -r "$root/supabase/migrations" supabase/migrations
mkdir -p supabase/tests
cp "$root"/tests/db/*.test.sql supabase/tests/

stop() {
  if [ -z "${KEEP_DB:-}" ]; then supabase stop --no-backup >/dev/null 2>&1 || true; fi
}
trap stop EXIT

# Applies every migration to a fresh database: a migration that fails
# here would also fail on the real ones.
if supabase status >/dev/null 2>&1; then
  supabase db reset --local
else
  supabase db start
fi

db_url="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
psql "$db_url" -v ON_ERROR_STOP=1 -q -f "$root/tests/db/00_helpers.sql"
supabase test db
