-- Make the redelivery guard usable by the query that reads it.
--
-- 0014 created this index with `WHERE metadata ? 'platformMessageId'`, but the
-- delivery-status lookup asks `metadata->>'platformMessageId' = $1`. Postgres'
-- predicate-implication prover can derive `expr IS NOT NULL` from a strict
-- operator on `expr`, but it cannot derive the `?` operator from `->>`: they
-- are different expressions. So the index served the insert's uniqueness check
-- and was skipped for the SELECT, which seq-scanned `messages` — roughly three
-- times per outbound message, since WhatsApp reports sent, delivered and read.
--
-- `IS NOT NULL` keeps exactly the same uniqueness semantics and is provably
-- implied by the equality. It also stops indexing a row whose
-- `platformMessageId` is JSON null, which the `?` form included.
DROP INDEX IF EXISTS messages_platform_message_id_idx;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_message_id_idx
  ON messages ((metadata->>'platformMessageId'))
  WHERE (metadata->>'platformMessageId') IS NOT NULL;
