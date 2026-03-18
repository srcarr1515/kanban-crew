-- Add per-crew-member AI provider and model overrides.
-- NULL means "use the global default".
ALTER TABLE crew_members ADD COLUMN ai_provider TEXT DEFAULT NULL;
ALTER TABLE crew_members ADD COLUMN ai_model TEXT DEFAULT NULL;
