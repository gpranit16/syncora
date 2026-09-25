const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const defaultDb = require("../config/db");

const migrateCalendarTables = async (db = defaultDb) => {
  console.log("Checking Google Calendar integration database tables...");

  // 1. Create user_calendar_integrations table
  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS user_calendar_integrations (
      integration_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      google_email VARCHAR(255) NULL,
      access_token TEXT NULL,
      refresh_token TEXT NULL,
      token_expiry BIGINT NULL,
      sync_tasks BOOLEAN NOT NULL DEFAULT TRUE,
      sync_meetings BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_user_calendar (user_id),
      INDEX idx_user_cal_user (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 2. Create calendar_sync_events table
  await db.promise().query(`
    CREATE TABLE IF NOT EXISTS calendar_sync_events (
      sync_id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      event_type ENUM('task', 'meeting') NOT NULL,
      source_id INT NOT NULL,
      google_event_id VARCHAR(255) NOT NULL,
      calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_cse_user (user_id),
      INDEX idx_cse_lookup (user_id, event_type, source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // 3. Add scheduled columns to meetings table if they don't exist
  try {
    const [columns] = await db.promise().query(`
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'meetings' 
        AND COLUMN_NAME = 'scheduled_start_time'
    `);
    if (columns.length === 0) {
      await db.promise().query(`
        ALTER TABLE meetings 
        ADD COLUMN scheduled_start_time TIMESTAMP NULL DEFAULT NULL,
        ADD COLUMN scheduled_end_time TIMESTAMP NULL DEFAULT NULL
      `);
      console.log("Added scheduled columns to 'meetings' table.");
    }
  } catch (err) {
    console.warn("Notice checking meetings columns:", err.message);
  }

  console.log("Google Calendar database tables verified successfully.");
};

if (require.main === module) {
  migrateCalendarTables()
    .then(async () => {
      await defaultDb.close().catch(() => {});
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("Migration failed:", err.message);
      await defaultDb.close().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateCalendarTables };
