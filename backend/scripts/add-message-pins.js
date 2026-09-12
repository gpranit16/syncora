// Adds pin columns to the live TiDB if missing. Idempotent: checks
// INFORMATION_SCHEMA.COLUMNS first so it is safe to re-run.
const db = require("../config/db");

const tableHasColumn = async (table, column) => {
  const [rows] = await db.promise().query(
    "SELECT COUNT(*) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    [table, column]
  );
  return Number(rows[0].c) > 0;
};

const run = async () => {
  for (const table of ["messages", "direct_messages"]) {
    const hasPinned = await tableHasColumn(table, "is_pinned");
    const hasPinnedAt = await tableHasColumn(table, "pinned_at");
    console.log(`${table}: is_pinned=${hasPinned} pinned_at=${hasPinnedAt}`);

    if (!hasPinned) {
      await db.promise().query(
        `ALTER TABLE ${table} ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT FALSE`
      );
      console.log(`${table}: added is_pinned`);
    }
    if (!hasPinnedAt) {
      await db.promise().query(
        `ALTER TABLE ${table} ADD COLUMN pinned_at TIMESTAMP NULL DEFAULT NULL`
      );
      console.log(`${table}: added pinned_at`);
    }
  }

  await db.close();
  console.log("PIN COLUMNS OK");
  process.exit(0);
};

run().catch(async (err) => {
  console.error("FAILED:", err.message, err.code || "");
  await db.close().catch(() => {});
  process.exit(1);
});