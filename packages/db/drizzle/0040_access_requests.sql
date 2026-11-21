-- S85: closed-beta access requests from the marketing site
-- (pricing-and-access-requests spec, decisions 5-11). One row per lowercased
-- email; a repeat request updates the details and keeps status.
-- Reverse: down/0040_access_requests.sql.
CREATE TABLE IF NOT EXISTS "access_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "email" text NOT NULL,
  "name" text NOT NULL,
  "agency_name" text NOT NULL,
  "client_count" text NOT NULL,
  "plan" text DEFAULT 'none' NOT NULL,
  "message" text,
  "status" text DEFAULT 'new' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "access_requests_email_unique" UNIQUE ("email"),
  CONSTRAINT "access_requests_email_lower_chk" CHECK (email = lower(email)),
  CONSTRAINT "access_requests_client_count_chk" CHECK (client_count IN ('1', '2-5', '6-20', '20+')),
  CONSTRAINT "access_requests_plan_chk" CHECK (plan IN ('free', 'pro', 'enterprise', 'none')),
  CONSTRAINT "access_requests_status_chk" CHECK (status IN ('new', 'invited', 'declined'))
);
