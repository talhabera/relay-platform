-- W2FIX: database guards for the checkpoint and client-membership races.
--
-- 1. One open card per company record: a second proposeAction for a record
--    that already has a pending card hits this index (insert ... on conflict
--    do nothing) instead of opening a duplicate.
-- 2. One membership per client user (spec 2026-10-02-client-role-and-portal):
--    assertMembershipInviteAllowed checks in app code; this closes the race
--    between two concurrent client invites.
-- 3. checkpoints.refresh_requested_at makes Refresh idempotent: the first
--    request stamps it, a repeat while the agent has not answered is a no-op.
--
-- Pre-existing duplicate pending cards for one record are closed first (the
-- newest stays pending, older ones are discarded and point at it) so the
-- index can build. Duplicate client memberships are not repaired here: if any
-- exist the index build fails and they must be resolved by hand.
ALTER TABLE "checkpoints" ADD COLUMN IF NOT EXISTS "refresh_requested_at" timestamp;
--> statement-breakpoint
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "record_id" ORDER BY "created_at" DESC, "id" DESC
    ) AS "keep_id",
    row_number() OVER (
      PARTITION BY "record_id" ORDER BY "created_at" DESC, "id" DESC
    ) AS "rn"
  FROM "checkpoints"
  WHERE "status" = 'pending' AND "record_id" IS NOT NULL
)
UPDATE "checkpoints" c
SET
  "status" = 'discarded',
  "superseded_by" = ranked."keep_id",
  "execute_result" = '{"status":"discarded","reason":"duplicate pending card"}'::jsonb,
  "resolved_at" = now()
FROM ranked
WHERE c."id" = ranked."id" AND ranked."rn" > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "checkpoints_record_pending_uidx"
  ON "checkpoints" ("record_id")
  WHERE "status" = 'pending' AND "record_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "company_members_client_user_uidx"
  ON "company_members" ("user_id")
  WHERE "role" = 'client';
