CREATE DATABASE IF NOT EXISTS smart_team_collab;

USE smart_team_collab;

DROP TABLE IF EXISTS activity_logs;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS direct_messages;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS channels;
DROP TABLE IF EXISTS workspace_members;
DROP TABLE IF EXISTS workspaces;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE workspaces (
  workspace_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  owner_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_workspaces_owner
    FOREIGN KEY (owner_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE workspace_members (
  member_id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id INT NOT NULL,
  role ENUM('owner', 'admin', 'member') DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_workspace_user UNIQUE (workspace_id, user_id),

  CONSTRAINT fk_workspace_members_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_workspace_members_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE channels (
  channel_id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_workspace_channel UNIQUE (workspace_id, name),

  CONSTRAINT fk_channels_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE
);

CREATE TABLE messages (
  message_id INT AUTO_INCREMENT PRIMARY KEY,
  channel_id INT NOT NULL,
  sender_id INT NOT NULL,
  message_text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_messages_channel
    FOREIGN KEY (channel_id)
    REFERENCES channels(channel_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_messages_sender
    FOREIGN KEY (sender_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE direct_messages (
  direct_message_id INT AUTO_INCREMENT PRIMARY KEY,
  sender_id INT NOT NULL,
  receiver_id INT NOT NULL,
  message_text TEXT NOT NULL,
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_direct_messages_sender
    FOREIGN KEY (sender_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_direct_messages_receiver
    FOREIGN KEY (receiver_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE tasks (
  task_id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  assigned_to INT,
  created_by INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT,
  status ENUM('pending', 'in_progress', 'completed') DEFAULT 'pending',
  priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
  due_date DATE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_tasks_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_tasks_assigned_to
    FOREIGN KEY (assigned_to)
    REFERENCES users(user_id)
    ON DELETE SET NULL,

  CONSTRAINT fk_tasks_created_by
    FOREIGN KEY (created_by)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE notifications (
  notification_id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message VARCHAR(255) NOT NULL,
  type ENUM('message', 'task', 'workspace') DEFAULT 'message',
  is_read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_notifications_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);

CREATE TABLE activity_logs (
  log_id INT AUTO_INCREMENT PRIMARY KEY,
  workspace_id INT NOT NULL,
  user_id INT NOT NULL,
  action VARCHAR(150) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_activity_logs_workspace
    FOREIGN KEY (workspace_id)
    REFERENCES workspaces(workspace_id)
    ON DELETE CASCADE,

  CONSTRAINT fk_activity_logs_user
    FOREIGN KEY (user_id)
    REFERENCES users(user_id)
    ON DELETE CASCADE
);
