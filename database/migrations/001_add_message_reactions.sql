-- Migration 001: WhatsApp-style emoji reactions (channel messages + direct messages)
-- Run this once against an EXISTING database (e.g. your live TiDB instance).
-- Fresh setups do not need this file; database/schema.sql already includes these tables.

USE smart_team_collab;

CREATE TABLE IF NOT EXISTS message_reactions (
  reaction_id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_message_reaction UNIQUE (message_id, user_id, emoji),

  CONSTRAINT fk_message_reactions_message
    FOREIGN KEY (message_id)
    REFERENCES messages(message_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_message_reactions_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS direct_message_reactions (
  reaction_id INT AUTO_INCREMENT PRIMARY KEY,
  direct_message_id INT NOT NULL,
  user_id INT NOT NULL,
  emoji VARCHAR(64) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_dm_message_reaction UNIQUE (direct_message_id, user_id, emoji),

  CONSTRAINT fk_dm_reactions_message
    FOREIGN KEY (direct_message_id)
    REFERENCES direct_messages(direct_message_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_dm_reactions_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
) DEFAULT CHARSET=utf8mb4;
