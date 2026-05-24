const db = require("../config/db");

const checkChannelMembership = async (channelId, userId) => {
  const [members] = await db.promise().query(
    `SELECT c.channel_id, c.workspace_id
     FROM channels c
     INNER JOIN workspace_members wm
       ON c.workspace_id = wm.workspace_id
     WHERE c.channel_id = ? AND wm.user_id = ?`,
    [channelId, userId]
  );

  return members[0];
};

const sendMessage = async (req, res) => {
  try {
    const { channel_id, message_text, reply_to, file_url, file_name } = req.body;
    const userId = req.user.user_id;

    if (!channel_id) {
      return res.status(400).json({
        success: false,
        message: "channel_id is required",
      });
    }

    if (!message_text && !file_url) {
      return res.status(400).json({
        success: false,
        message: "message_text or file is required",
      });
    }

    const channel = await checkChannelMembership(channel_id, userId);
    if (!channel) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to send messages in this channel",
      });
    }

    const [result] = await db
      .promise()
      .query(
        "INSERT INTO messages (channel_id, sender_id, message_text, reply_to, file_url, file_name) VALUES (?, ?, ?, ?, ?, ?)",
        [channel_id, userId, message_text || "", reply_to || null, file_url || null, file_name || null]
      );

    return res.status(201).json({
      success: true,
      message: "Message sent successfully",
      data: {
        message_id: result.insertId,
        channel_id,
        sender_id: userId,
        message_text,
        reply_to,
        file_url,
        file_name
      },
    });
  } catch (error) {
    console.error("Send message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while sending message",
    });
  }
};

const getChannelMessages = async (req, res) => {
  try {
    const channelId = req.params.channelId;
    const userId = req.user.user_id;

    if (!channelId) {
      return res.status(400).json({
        success: false,
        message: "Channel ID is required",
      });
    }

    const channel = await checkChannelMembership(channelId, userId);

    if (!channel) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to view messages in this channel",
      });
    }

    const [messages] = await db.promise().query(
      `SELECT m.*, u.name as sender_name 
       FROM messages m 
       JOIN users u ON m.sender_id = u.user_id 
       WHERE m.channel_id = ? 
       ORDER BY m.created_at ASC`,
      [channelId]
    );

    return res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching messages",
    });
  }
};

const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message_text } = req.body;
    const userId = req.user.user_id;

    if (!messageId || !message_text) {
      return res.status(400).json({
        success: false,
        message: "Message ID and message text are required",
      });
    }

    const [messages] = await db
      .promise()
      .query("SELECT * FROM messages WHERE message_id = ?", [messageId]);

    const message = messages[0];

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to edit this message",
      });
    }

    await db
      .promise()
      .query(
        "UPDATE messages SET message_text = ?, is_edited = TRUE WHERE message_id = ?",
        [message_text, messageId]
      );

    const [updatedRows] = await db
      .promise()
      .query(
        "SELECT message_id, channel_id, sender_id, message_text, is_edited, is_deleted FROM messages WHERE message_id = ?",
        [messageId]
      );

    return res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: updatedRows[0],
    });
  } catch (error) {
    console.error("Edit message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while editing message",
    });
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.user_id;

    if (!messageId) {
      return res.status(400).json({
        success: false,
        message: "Message ID is required",
      });
    }

    const [messages] = await db
      .promise()
      .query("SELECT * FROM messages WHERE message_id = ?", [messageId]);

    const message = messages[0];

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    if (message.sender_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "You are not allowed to delete this message",
      });
    }

    await db
      .promise()
      .query(
        "UPDATE messages SET is_deleted = TRUE, message_text = '[deleted]' WHERE message_id = ?",
        [messageId]
      );

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
      data: {
        message_id: message.message_id,
        channel_id: message.channel_id,
        is_deleted: true,
      },
    });
  } catch (error) {
    console.error("Delete message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while deleting message",
    });
  }
};

module.exports = {
  sendMessage,
  getChannelMessages,
  editMessage,
  deleteMessage,
};
