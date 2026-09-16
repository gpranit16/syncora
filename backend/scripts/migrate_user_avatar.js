const db = require('../config/db');

async function migrateUserAvatar() {
  console.log('Starting users avatar_url migration...');
  try {
    // Check if column already exists
    const [columns] = await db.promise().query("SHOW COLUMNS FROM users LIKE 'avatar_url'");
    if (columns.length === 0) {
      await db.promise().query("ALTER TABLE users ADD COLUMN avatar_url TEXT DEFAULT NULL");
      console.log("Successfully added avatar_url column to users table.");
    } else {
      console.log("avatar_url column already exists in users table.");
    }
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    process.exit(0);
  }
}

migrateUserAvatar();
