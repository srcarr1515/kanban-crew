-- Add per-crew-member skill configuration.
-- NULL means "all default skills enabled".
-- '[]' means "no skills".
-- '["brainstorming","planning"]' means "only those skills".
ALTER TABLE crew_members ADD COLUMN skills TEXT DEFAULT NULL;
