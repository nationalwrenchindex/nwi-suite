-- Multi-service detailer booking support
-- Adds a services JSONB array to jobs so detailer bookings can carry more than one
-- service per visit. service_type is kept as-is for backwards compatibility
-- (mechanics still send a single string; detailers populate services[] AND set
-- service_type = services[0] for any code that reads the old column).

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS services jsonb NOT NULL DEFAULT '[]'::jsonb;
