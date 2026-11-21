-- Reverses 0034_checkpoint_send_receipt.sql. Not run by the migrator (drizzle
-- has no down step); apply by hand, then delete the 0034 row from
-- drizzle.__drizzle_migrations.
ALTER TABLE "checkpoints" DROP COLUMN IF EXISTS "send_receipt";
