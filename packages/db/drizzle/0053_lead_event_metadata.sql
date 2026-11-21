-- Lead event metadata (RELAY-158): one nullable jsonb column on lead_events so
-- a same-status event can say what it did. A payment add or remove on a won
-- lead writes a won -> won event with { op, paymentId, kind }, so an add and a
-- remove differ in the log and a removed payment stays traceable. Null for a
-- plain status move. Additive, no default, no backfill.
-- Reverse: down/0053_lead_event_metadata.sql.
ALTER TABLE "lead_events" ADD COLUMN IF NOT EXISTS "metadata" jsonb;
