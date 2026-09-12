const db = require('../config/db');

async function initMeetingAITables() {
  try {
    console.log('Ensuring meeting_transcripts table...');
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS meeting_transcripts (
        transcript_id INT AUTO_INCREMENT PRIMARY KEY,
        meeting_id INT NOT NULL,
        meeting_code VARCHAR(50) NOT NULL,
        workspace_id INT NOT NULL,
        channel_id INT NULL,
        transcript_text LONGTEXT NOT NULL,
        segments LONGTEXT NULL,
        language VARCHAR(20) DEFAULT 'en',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_meeting_code_trans (meeting_code),
        INDEX idx_meeting_id (meeting_id),
        INDEX idx_workspace_id (workspace_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('meeting_transcripts table ensured.');

    console.log('Ensuring meeting_summaries table...');
    await db.promise().query(`
      CREATE TABLE IF NOT EXISTS meeting_summaries (
        summary_id INT AUTO_INCREMENT PRIMARY KEY,
        meeting_id INT NOT NULL,
        meeting_code VARCHAR(50) NOT NULL,
        workspace_id INT NOT NULL,
        channel_id INT NULL,
        language VARCHAR(20) DEFAULT 'en',
        summary_text LONGTEXT NOT NULL,
        decisions LONGTEXT NULL,
        action_items LONGTEXT NULL,
        blockers LONGTEXT NULL,
        deadlines LONGTEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_meeting_code_lang (meeting_code, language),
        INDEX idx_meeting_id (meeting_id),
        INDEX idx_workspace_id (workspace_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('meeting_summaries table ensured.');

    try {
      const [taskCols] = await db.promise().query("SHOW COLUMNS FROM tasks LIKE 'source_meeting_id'");
      if (taskCols.length === 0) {
        await db.promise().query("ALTER TABLE tasks ADD COLUMN source_meeting_id INT NULL");
        console.log('Added source_meeting_id to tasks table.');
      } else {
        console.log('source_meeting_id column already exists in tasks table.');
      }
    } catch (taskColErr) {
      console.warn('tasks table column check notice:', taskColErr.message);
    }

    console.log('Meeting AI DB tables migration completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('Error in initMeetingAITables:', err);
    process.exit(1);
  }
}

initMeetingAITables();
