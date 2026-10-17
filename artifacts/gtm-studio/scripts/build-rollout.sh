#!/usr/bin/env bash
# Rebuilds supabase/rollout/2-apply-all.sql (the one-paste file) from the migrations. Run after
# adding or changing a 2026101700NN migration.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- STEP 2 of 4. Run AFTER step 1. Creates client spaces, roles, Trash, bulk actions, reviews,"
  echo "-- activity log and notifications. It is the migration files in order, in one paste."
  echo "-- Safe to run again if it stops part-way: every step checks before it changes anything."
  echo
  for f in supabase/migrations/20261017*.sql; do
    echo "-- ===== $(basename "$f") ====="
    cat "$f"
    echo
  done
} > supabase/rollout/2-apply-all.sql
