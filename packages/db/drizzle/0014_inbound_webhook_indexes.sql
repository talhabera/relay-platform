-- Route a WhatsApp delivery to its channel. The webhook matches
-- value.metadata.phone_number_id, not the WABA id in entry.id.
CREATE INDEX IF NOT EXISTS channels_whatsapp_phone_number_id_idx
  ON channels ((config->>'phoneNumberId')) WHERE type = 'whatsapp';
--> statement-breakpoint
-- Route an Instagram delivery to its channel. Both the comment branch and the
-- direct-message branch of the shared route resolve by config->>'accountId'.
CREATE INDEX IF NOT EXISTS channels_instagram_account_id_idx
  ON channels ((config->>'accountId')) WHERE type = 'instagram';
--> statement-breakpoint
-- Find the conversation for one sender on one channel. UNIQUE because two
-- deliveries a second apart can land on two web instances at once: without a
-- constraint both check-then-insert paths miss, both insert, and the
-- conversation splits permanently. Partial on archived_at IS NULL so
-- archiving a chat still lets the same sender start a fresh one.
--
-- The channel_type qualification is load-bearing, not decoration. On the two
-- inbound channels visitor_id identifies one person, so it is a real key. On
-- 'widget' it is the client IP -- literally 'unknown' when there is no
-- x-forwarded-for header -- so every widget visitor behind one IP would
-- collide. Unqualified, this index aborts on any database already holding two
-- non-archived widget chats from one IP, and drizzle wraps the file in one
-- transaction, so the whole migration rolls back and the deploy is blocked.
-- At runtime createChatSession has no onConflictDoNothing, so a second widget
-- conversation from that IP would 500. Operator, master and web chats are only
-- safe because their visitor_id is NULL and NULLs are distinct here.
CREATE UNIQUE INDEX IF NOT EXISTS chats_agent_channel_visitor_idx
  ON chats (agent_id, channel_type, visitor_id)
  WHERE archived_at IS NULL AND channel_type IN ('whatsapp', 'instagram');
--> statement-breakpoint
-- Meta redelivers. This index is what makes a redelivery a no-op instead of
-- a second stored message and a second reply.
CREATE UNIQUE INDEX IF NOT EXISTS messages_platform_message_id_idx
  ON messages ((metadata->>'platformMessageId'))
  WHERE metadata ? 'platformMessageId';
