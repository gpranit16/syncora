require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const db = require('../config/db');

const migrations = [
  `ALTER TABLE tasks 
    ADD COLUMN source_message_id INT DEFAULT NULL,
    ADD COLUMN source_message_type ENUM('channel','dm') DEFAULT NULL,
    ADD COLUMN source_channel_id INT DEFAULT NULL,
    ADD COLUMN source_dm_user_id INT DEFAULT NULL`,
];

(async () => {
  for (const sql of migrations) {
    try {
      await db.promise().query(sql);
      console.log('Migration applied:', sql.substring(0, 60));
    } catch (err) {
      if (err.code === 'ER_DUP_FIELDNAME' || (err.message && err.message.includes('Duplicate column'))) {
        console.log('Already exists, skipping:', sql.substring(0, 60));
      } else {
        console.error('Migration error:', err.message);
        process.exit(1);
      }
    }
  }
  console.log('All migrations done.');
  await db.close().catch(() => {});
  process.exit(0);
})();
