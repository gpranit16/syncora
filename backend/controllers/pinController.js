const db = require("../config/db");

/*
 * Message pinning for channel messages and direct messages. A small engine
 * driven by per-type config (table + id column + permission check), so pinning
 * works identically for both. Pinned state lives as boolean columns on the
 * existing message tables (is_pinned / pinned_at).
 */
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

const createPinController = (config) => {
  const togglePin = async (req, res) => {
    try {
      const { messageId } = req.params;
      const userId = req.user.user_id;

      if (!messageId) {
        return res.status(400).json({
          success: false,
          message: "Message ID is required",
        });
      }

      const message = await config.getMessage(messageId);

      if (!message) {
        return res.status(404).json({
          success: false,
          message: "Message not found",
        });
      }

      if (message.is_deleted) {
        return res.status(400).json({
          success: false,
          message: "Cannot pin a deleted message",
        });
      }

      const allowed = await config.canPin(message, userId);
      if (!allowed) {
        return res.status(403).json({
          success: false,
          message: config.notAllowedMessage,
        });
      }

      const pinned = message.is_pinned ? false : true;
      const pinnedAt = pinned ? new Date() : null;

      await db.promise().query(
        `UPDATE ${config.table} SET is_pinned = ?, pinned_at = ? WHERE ${config.idColumn} = ?`,
        [pinned, pinnedAt, message[config.idColumn]]
      );

      const data = {
        message_id: Number(message[config.idColumn]),
        is_pinned: pinned,
        pinned_at: pinnedAt,
      };

      if (config.idColumn !== "message_id") {
        data[config.idColumn] = Number(message[config.idColumn]);
      }

      return res.status(200).json({
        success: true,
        message: pinned ? "Message pinned" : "Message unpinned",
        data,
      });
    } catch (error) {
      console.error("Toggle pin error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Server error while updating pin",
      });
    }
  };

  return { togglePin };
};

const channelPins = createPinController({
  table: "messages",
  idColumn: "message_id",
  notAllowedMessage: "You are not allowed to pin messages in this channel",
  getMessage: async (messageId) => {
    const [rows] = await db.promise().query(
      "SELECT message_id, channel_id, sender_id, is_deleted, is_pinned, pinned_at FROM messages WHERE message_id = ?",
      [messageId]
    );

    return rows[0];
  },
  canPin: async (message, userId) => {
    const membership = await checkChannelMembership(message.channel_id, userId);

    return Boolean(membership);
  },
});

const dmPins = createPinController({
  table: "direct_messages",
  idColumn: "direct_message_id",
  notAllowedMessage: "You are not allowed to pin messages in this conversation",
  getMessage: async (messageId) => {
    const [rows] = await db.promise().query(
      "SELECT direct_message_id, sender_id, receiver_id, is_deleted, is_pinned, pinned_at FROM direct_messages WHERE direct_message_id = ?",
      [messageId]
    );

    return rows[0];
  },
  canPin: async (message, userId) =>
    Number(message.sender_id) === Number(userId) ||
    Number(message.receiver_id) === Number(userId),
});

module.exports = {
  channelPins,
  dmPins,
};