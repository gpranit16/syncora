-- Migration to create workspace_banned_users table
CREATE TABLE IF NOT EXISTS workspace_banned_users (
  ban_id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id INT NOT NULL,
  banned_by INT NOT NULL,
  reason VARCHAR(255) DEFAULT 'Banned by admin/owner',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_ws_banned_user UNIQUE (workspace_id, user_id),

  CONSTRAINT fk_ws_banned_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_ws_banned_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_ws_banned_by
    FOREIGN KEY (banned_by)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);
