-- One inbound routing key, one channel.
--
-- The Meta webhook routes resolve a delivery to a channel with findFirst on
-- config->>'phoneNumberId' (WhatsApp) or config->>'accountId' (Instagram).
-- Those values are typed by an operator and an Instagram Business account id
-- is public, so without a constraint a second company can claim a routing key
-- that already belongs to someone else: findFirst then returns one of the two
-- rows arbitrarily, and the first company's conversations start landing under
-- the other company's agent. The webhook signature does not close this — it
-- authenticates Meta, not the tenant.
--
-- Unique across every status, not just active ones: scoping to active would
-- let a duplicate sit dormant and then fail at the moment someone activates
-- it, which is the worst time to find out.
--
-- These supersede the non-unique lookup indexes on the same expressions, so
-- those are dropped rather than left as a second plan for the same query.
--
-- If this migration fails with a uniqueness violation, the database already
-- holds two channels claiming one number or account. That is the bug this
-- prevents; resolve the duplicate before deploying.
DROP INDEX IF EXISTS channels_whatsapp_phone_number_id_idx;--> statement-breakpoint
DROP INDEX IF EXISTS channels_instagram_account_id_idx;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS channels_whatsapp_phone_number_uidx
  ON channels ((config->>'phoneNumberId'))
  WHERE type = 'whatsapp' AND (config->>'phoneNumberId') IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS channels_instagram_account_uidx
  ON channels ((config->>'accountId'))
  WHERE type = 'instagram' AND (config->>'accountId') IS NOT NULL;
