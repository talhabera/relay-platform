ALTER TABLE "agents" ADD COLUMN "model" text DEFAULT 'haiku' NOT NULL;
ALTER TABLE "agent_versions" ADD COLUMN "model" text DEFAULT 'haiku' NOT NULL;
ALTER TABLE "agent_versions" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;
ALTER TABLE "chats" ADD COLUMN "model" text;

UPDATE "agent_versions" AS v
SET "status" = 'live'
FROM (
  SELECT DISTINCT ON ("agent_id") "id"
  FROM "agent_versions"
  ORDER BY "agent_id", "created_at" DESC
) AS latest
WHERE v."id" = latest."id";

CREATE UNIQUE INDEX "agent_versions_one_live_idx"
  ON "agent_versions" ("agent_id")
  WHERE "status" = 'live';
