const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const db = require("../config/db");

const run = async () => {
  console.log("Running Phase 2 Meetings database migrations on TiDB...");

  // 1. Create meetings table
  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS meetings (
      meeting_id INT AUTO_INCREMENT PRIMARY KEY,
      meeting_code VARCHAR(64) UNIQUE NOT NULL,
      workspace_id INT NOT NULL,
      channel_id INT NULL DEFAULT NULL,
      host_id INT NOT NULL,
      title VARCHAR(255) NOT NULL,
      mode ENUM('voice', 'video') NOT NULL DEFAULT 'video',
      status ENUM('active', 'ended') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ended_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_meetings_code (meeting_code),
      INDEX idx_meetings_workspace (workspace_id),
      INDEX idx_meetings_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("Checked/created 'meetings' table.");

  // 2. Create meeting_participants table
  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS meeting_participants (
      participant_id INT AUTO_INCREMENT PRIMARY KEY,
      meeting_id INT NOT NULL,
      user_id INT NOT NULL,
      role ENUM('host', 'participant') NOT NULL DEFAULT 'participant',
      status ENUM('connected', 'left', 'removed') NOT NULL DEFAULT 'connected',
      is_muted BOOLEAN NOT NULL DEFAULT FALSE,
      is_camera_off BOOLEAN NOT NULL DEFAULT FALSE,
      joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      left_at TIMESTAMP NULL DEFAULT NULL,
      INDEX idx_mp_meeting (meeting_id),
      INDEX idx_mp_user (user_id),
      INDEX idx_mp_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);
  console.log("Checked/created 'meeting_participants' table.");

  console.log("MEETINGS MIGRATION COMPLETED SUCCESSFULLY");
  await db.close().catch(() => {});
  process.exit(0);
};

run().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await db.close().catch(() => {});
  process.exit(1);
});
