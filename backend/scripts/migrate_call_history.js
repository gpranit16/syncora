const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const db = require("../config/db");

const tableHasColumn = async (table, column) => {
  const [rows] = await db.promise().query(
    "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return Number(rows[0].c) > 0;
};

const run = async () => {
  console.log("Checking direct_messages table for call history columns...");

  const columnsToAdd = [
    {
      name: "message_type",
      sql: "ALTER TABLE direct_messages ADD COLUMN message_type VARCHAR(32) NOT NULL DEFAULT 'text'",
    },
    {
      name: "call_id",
      sql: "ALTER TABLE direct_messages ADD COLUMN call_id VARCHAR(128) NULL DEFAULT NULL",
    },
    {
      name: "call_type",
      sql: "ALTER TABLE direct_messages ADD COLUMN call_type VARCHAR(16) NULL DEFAULT NULL",
    },
    {
      name: "call_status",
      sql: "ALTER TABLE direct_messages ADD COLUMN call_status VARCHAR(32) NULL DEFAULT NULL",
    },
    {
      name: "call_duration",
      sql: "ALTER TABLE direct_messages ADD COLUMN call_duration INT NULL DEFAULT 0",
    },
  ];

  for (const col of columnsToAdd) {
    const exists = await tableHasColumn("direct_messages", col.name);
    console.log(`direct_messages: ${col.name} exists = ${exists}`);
    if (!exists) {
      try {
        await db.promise().query(col.sql);
        console.log(`direct_messages: added ${col.name}`);
      } catch (err) {
        if (err.code === "ER_DUP_FIELDNAME" || (err.message && err.message.includes("Duplicate column"))) {
          console.log(`direct_messages: ${col.name} already exists, skipping.`);
        } else {
          throw err;
        }
      }
    }
  }

  // Also check if index on call_id exists
  try {
    const [indexRows] = await db.promise().query(
      "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'direct_messages' AND INDEX_NAME = 'idx_dm_call_id'"
    );
    if (Number(indexRows[0].c) === 0) {
      await db.promise().query("CREATE INDEX idx_dm_call_id ON direct_messages (call_id)");
      console.log("direct_messages: created index idx_dm_call_id");
    }
  } catch (err) {
    console.warn("Index creation note:", err.message);
  }

  console.log("CALL HISTORY MIGRATION COMPLETED SUCCESSFULLY");
  await db.close().catch(() => {});
  process.exit(0);
};

run().catch(async (err) => {
  console.error("Migration failed:", err.message);
  await db.close().catch(() => {});
  process.exit(1);
});
