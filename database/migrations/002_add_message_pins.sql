-- Migration 002: Message pinning (channels + DMs)
-- Run once against an EXISTING database (e.g. your live TiDB instance).
-- Fresh setups do not need this file; database/schema.sql already includes the columns.

USE smart_team_collab;

-- Add pinned state to channel messages.
ALTER TABLE messages
  ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN pinned_at TIMESTAMP NULL DEFAULT NULL;

-- Add pinned state to direct messages.
ALTER TABLE direct_messages
  ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN pinned_at TIMESTAMP NULL DEFAULT NULL;