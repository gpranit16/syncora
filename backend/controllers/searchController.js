const db = require("../config/db");

const globalSearch = async (req, res) => {
  try {
    const searchText = req.query.q;

    if (!searchText || !searchText.trim()) {
      return res.status(400).json({
        success: false,
        message: "Search keyword is required",
      });
    }

    const keyword = `%${searchText.trim()}%`;
    const connection = db.promise();

    const [users] = await connection.query(
      `SELECT user_id, name, email, is_online, last_seen
       FROM users
       WHERE name LIKE ? OR email LIKE ?`,
      [keyword, keyword]
    );

    const [messages] = await connection.query(
      `SELECT message_id, channel_id, sender_id, message_text, created_at
       FROM messages
       WHERE message_text LIKE ?`,
      [keyword]
    );

    const [tasks] = await connection.query(
      `SELECT task_id, workspace_id, assigned_to, created_by, title, description, status, priority, due_date, created_at
       FROM tasks
       WHERE title LIKE ? OR description LIKE ?`,
      [keyword, keyword]
    );

    const [channels] = await connection.query(
      `SELECT channel_id, workspace_id, name, description, created_at
       FROM channels
       WHERE name LIKE ?`,
      [keyword]
    );

    return res.status(200).json({
      users,
      messages,
      tasks,
      channels,
    });
  } catch (error) {
    console.error("Search error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while searching",
    });
  }
};

module.exports = {
  globalSearch,
};
