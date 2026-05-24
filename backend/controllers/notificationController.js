const db = require("../config/db");

const allowedTypes = ["message", "task", "workspace"];

const createNotification = async (req, res) => {
  try {
    const { user_id, message, type } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({
        success: false,
        message: "User ID and notification message are required",
      });
    }

    const notificationType = type || "message";

    if (!allowedTypes.includes(notificationType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid notification type",
      });
    }

    const [users] = await db
      .promise()
      .query("SELECT user_id FROM users WHERE user_id = ?", [user_id]);

    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const [result] = await db.promise().query(
      "INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)",
      [user_id, message, notificationType]
    );

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      notification: {
        notification_id: result.insertId,
        user_id,
        message,
        type: notificationType,
        is_read: false,
      },
    });
  } catch (error) {
    console.error("Create notification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while creating notification",
    });
  }
};

const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user.user_id;

    const [notifications] = await db.promise().query(
      `SELECT notification_id, user_id, message, type, is_read, created_at
       FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    return res.status(200).json({
      success: true,
      notifications,
    });
  } catch (error) {
    console.error("Get notifications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching notifications",
    });
  }
};

const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user.user_id;

    if (!notificationId) {
      return res.status(400).json({
        success: false,
        message: "Notification ID is required",
      });
    }

    const [notifications] = await db.promise().query(
      "SELECT notification_id FROM notifications WHERE notification_id = ? AND user_id = ?",
      [notificationId, userId]
    );

    if (notifications.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    await db.promise().query(
      "UPDATE notifications SET is_read = TRUE WHERE notification_id = ? AND user_id = ?",
      [notificationId, userId]
    );

    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      notification: {
        notification_id: Number(notificationId),
        is_read: true,
      },
    });
  } catch (error) {
    console.error("Mark notification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while updating notification",
    });
  }
};

module.exports = {
  createNotification,
  getUserNotifications,
  markNotificationAsRead,
};
