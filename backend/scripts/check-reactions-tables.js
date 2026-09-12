// Widens the emoji column to 64 chars so arbitrary custom emoji (including
// long ZWJ sequences / skin-tone variants) fit safely. Idempotent.
const db = require("../config/db");

const run = async () => {
  const [cols] = await db
    .promise()
    .query("SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'message_reactions' AND COLUMN_NAME = 'emoji'");

  const maxLen = cols[0] ? Number(cols[0].CHARACTER_MAXIMUM_LENGTH) : 0;
  console.log("current emoji column length:", maxLen);

  if (maxLen < 64) {
    await db.promise().query("ALTER TABLE message_reactions MODIFY emoji VARCHAR(64) NOT NULL");
    await db.promise().query("ALTER TABLE direct_message_reactions MODIFY emoji VARCHAR(64) NOT NULL");
    console.log("ALTERED to VARCHAR(64)");
  } else {
    console.log("already wide enough, nothing to do");
  }

  await db.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error("FAILED:", err.message, err.code || "");
  await db.close().catch(() => {});
  process.exit(1);
});
