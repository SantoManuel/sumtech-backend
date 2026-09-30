CREATE TABLE IF NOT EXISTS "sec"."operational_health_pings" (
  "id" SERIAL PRIMARY KEY,
  "pinged_at" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
