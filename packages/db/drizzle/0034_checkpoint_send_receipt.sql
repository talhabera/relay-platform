-- W3GAP: at-most-once lead delivery. The worker claims `send_receipt` as
-- `sending` before it sends a lead_delivery card and settles it as `sent`
-- with the send's result, so a stuck-approved Retry, or a Retry of a failed
-- markLeadDelivered after a good send, returns the earlier result instead of
-- sending the lead to the client twice.
ALTER TABLE "checkpoints" ADD COLUMN IF NOT EXISTS "send_receipt" jsonb;
