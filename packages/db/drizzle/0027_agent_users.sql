-- S99: agent users + approve rights (spec 2026-10-02-approve-rights).
-- operator_agent_editors becomes the agent user table: independent can_edit /
-- can_approve flags per (agent, user).
ALTER TABLE "operator_agent_editors" ADD COLUMN IF NOT EXISTS "can_edit" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
-- Backfill 1: existing editor grants get approve too (added with DEFAULT true,
-- then the default flips to false for new rows). Re-running is a no-op.
ALTER TABLE "operator_agent_editors" ADD COLUMN IF NOT EXISTS "can_approve" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "operator_agent_editors" ALTER COLUMN "can_approve" SET DEFAULT false;
--> statement-breakpoint
-- Backfill 2: a member (role = member, not the owner or the agent creator) who
-- started an operator session on an agent and has no row gets approve only.
INSERT INTO "operator_agent_editors" ("agent_id", "user_id", "can_edit", "can_approve")
SELECT DISTINCT c."agent_id", c."user_id", false, true
FROM "chats" c
JOIN "agents" a ON a."id" = c."agent_id"
JOIN "companies" co ON co."id" = a."company_id"
JOIN "company_members" m
  ON m."company_id" = a."company_id"
 AND m."user_id" = c."user_id"
 AND m."role" = 'member'
WHERE c."channel_type" = 'operator'
  AND a."kind" = 'operator'
  AND c."agent_id" IS NOT NULL
  AND c."user_id" IS NOT NULL
  AND c."user_id" <> co."owner_id"
  AND (a."created_by_user_id" IS NULL OR c."user_id" <> a."created_by_user_id")
ON CONFLICT ("agent_id", "user_id") DO NOTHING;
