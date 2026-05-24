const db = require("../config/db");

const getUnreadCounts = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [channelUnreadResult] = await db.promise().query(
      "SELECT COUNT(*) AS total FROM messages WHERE is_read = FALSE AND sender_id != ?",
      [userId]
    );

    const [dmUnreadResult] = await db.promise().query(
      "SELECT COUNT(*) AS total FROM direct_messages WHERE is_read = FALSE AND receiver_id = ?",
      [userId]
    );

    const [notificationUnreadResult] = await db.promise().query(
      "SELECT COUNT(*) AS total FROM notifications WHERE is_read = FALSE AND user_id = ?",
      [userId]
    );

    const [perChannelUnreadRows] = await db
      .promise()
      .query(
        "SELECT channel_id, COUNT(*) AS total FROM messages WHERE is_read = FALSE AND sender_id != ? GROUP BY channel_id",
        [userId]
      );

    const channelUnread = channelUnreadResult[0].total;
    const dmUnread = dmUnreadResult[0].total;
    const notificationsUnread = notificationUnreadResult[0].total;
    const perChannelUnread = perChannelUnreadRows.reduce((acc, row) => {
      acc[row.channel_id] = row.total;
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      channel_unread: channelUnread,
      dm_unread: dmUnread,
      notifications: notificationsUnread,
      per_channel_unread: perChannelUnread,
      total_unread: channelUnread + dmUnread + notificationsUnread,
    });
  } catch (error) {
    console.error("Unread counts error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching unread counts",
    });
  }
};

module.exports = {
  getUnreadCounts,
};
