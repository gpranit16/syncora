const db = require("../config/db");

const sendDirectMessage = async (req, res) => {
  try {
    const { receiver_id, message_text, reply_to = null, file_url = null, file_name = null } = req.body;
    const senderId = req.user.user_id;

    if (!receiver_id) {
      return res.status(400).json({
        success: false,
        message: "Receiver ID is required",
      });
    }

    if (!message_text && !file_url) {
      return res.status(400).json({
        success: false,
        message: "Message text or file is required",
      });
    }

    if (Number(receiver_id) === Number(senderId)) {
      return res.status(400).json({
        success: false,
        message: "You cannot send a direct message to yourself",
      });
    }

    const [receivers] = await db
      .promise()
      .query("SELECT user_id, name, email FROM users WHERE user_id = ?", [
        receiver_id,
      ]);

    if (receivers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
      });
    }

    const [result] = await db.promise().query(
      "INSERT INTO direct_messages (sender_id, receiver_id, message_text, reply_to, file_url, file_name) VALUES (?, ?, ?, ?, ?, ?)",
      [senderId, receiver_id, message_text || "", reply_to, file_url, file_name]
    );

    return res.status(201).json({
      success: true,
      message: "Direct message sent successfully",
      data: {
        direct_message_id: result.insertId,
        sender_id: senderId,
        receiver_id,
        message_text,
        reply_to,
        file_url,
        file_name,
        is_read: false,
      },
    });
  } catch (error) {
    console.error("Send direct message error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while sending direct message",
    });
  }
};

const getDirectMessages = async (req, res) => {
  try {
    const { receiverId } = req.params;
    const userId = req.user.user_id;

    if (!receiverId) {
      return res.status(400).json({
        success: false,
        message: "Receiver ID is required",
      });
    }

    const [receivers] = await db
      .promise()
      .query("SELECT user_id FROM users WHERE user_id = ?", [receiverId]);

    if (receivers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Receiver not found",
      });
    }

    await db.promise().query(
      `UPDATE direct_messages
       SET is_read = TRUE
       WHERE sender_id = ? AND receiver_id = ?`,
      [receiverId, userId]
    );

    const [messages] = await db.promise().query(
      `SELECT
        dm.direct_message_id,
        dm.sender_id,
        sender.name AS sender_name,
        sender.email AS sender_email,
        dm.receiver_id,
        receiver.name AS receiver_name,
        receiver.email AS receiver_email,
        dm.message_text,
        dm.reply_to,
        dm.file_url,
        dm.file_name,
        dm.is_edited,
        dm.is_deleted,
        dm.is_read,
        dm.created_at
      FROM direct_messages dm
      INNER JOIN users sender
        ON dm.sender_id = sender.user_id
      INNER JOIN users receiver
        ON dm.receiver_id = receiver.user_id
      WHERE
        (dm.sender_id = ? AND dm.receiver_id = ?)
        OR
        (dm.sender_id = ? AND dm.receiver_id = ?)
      ORDER BY dm.created_at ASC`,
      [userId, receiverId, receiverId, userId]
    );

    return res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error("Get direct messages error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Server error while fetching direct messages",
    });
  }
};
const getRecentDmUsers = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const [users] = await db.promise().query(
      `SELECT DISTINCT u.user_id, u.name, u.email, u.is_online, u.last_seen
       FROM users u
       JOIN direct_messages dm ON u.user_id = dm.sender_id OR u.user_id = dm.receiver_id
       WHERE (dm.sender_id = ? OR dm.receiver_id = ?) AND u.user_id != ?`,
      [userId, userId, userId]
    );
    return res.status(200).json({ success: true, users });
  } catch (error) {
    console.error("Get recent DM users error:", error.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const editDirectMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { message_text } = req.body;
    const userId = req.user.user_id;

    if (!message_text) {
      return res.status(400).json({ success: false, message: "Message text required" });
    }

    const [message] = await db.promise().query("SELECT sender_id FROM direct_messages WHERE direct_message_id = ?", [messageId]);
    
    if (message.length === 0 || message[0].sender_id !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to edit this message" });
    }

    await db.promise().query("UPDATE direct_messages SET message_text = ?, is_edited = TRUE WHERE direct_message_id = ?", [message_text, messageId]);
    return res.status(200).json({ success: true, message: "Direct message edited successfully" });
  } catch (error) {
    console.error("Edit DM error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteDirectMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.user.user_id;

    const [message] = await db.promise().query("SELECT sender_id FROM direct_messages WHERE direct_message_id = ?", [messageId]);
    
    if (message.length === 0 || message[0].sender_id !== userId) {
      return res.status(403).json({ success: false, message: "Not authorized to delete this message" });
    }

    await db.promise().query("UPDATE direct_messages SET message_text = 'This message was deleted.', is_deleted = TRUE WHERE direct_message_id = ?", [messageId]);
    return res.status(200).json({ success: true, message: "Direct message deleted successfully" });
  } catch (error) {
    console.error("Delete DM error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  sendDirectMessage,
  getDirectMessages,
  getRecentDmUsers,
  editDirectMessage,
  deleteDirectMessage,
};
