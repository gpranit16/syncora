const db = require("../config/db");

/*
 * WhatsApp-style reactions for channel messages and direct messages. Any emoji
 * is accepted (not locked to a fixed allowlist), so users can send custom
 * reactions. QUICK_REACTIONS is exposed as the default quick-pick set for the UI.
 */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "🚀", "👀", "🎉"];
const MAX_EMOJI_LENGTH = 32;

// Accept any emoji: a non-empty emoji-ish string (must contain at least one
// non-ASCII code point) that is not overly long and contains no control chars.
const isValidEmoji = (emoji) => {
  if (typeof emoji !== "string") {
    return false;
  }

  const trimmed = emoji.trim();

  if (trimmed.length < 1 || trimmed.length > MAX_EMOJI_LENGTH) {
    return false;
  }

  const codePoints = [...trimmed];
  const hasNonAscii = codePoints.some((ch) => ch.codePointAt(0) > 0x7f);

  if (!hasNonAscii) {
    return false;
  }

  for (const ch of codePoints) {
    const code = ch.codePointAt(0);

    // Reject C0/C1 control characters (also keeps lone surrogates out).
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return false;
    }
  }

  return true;
};

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

const createReactionController = (config) => {
  const aggregateReactions = async (messageIds, ownUserId) => {
    const state = {};

    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return state;
    }

    const placeholders = messageIds.map(() => "?").join(", ");

    const [summaryRows] = await db.promise().query(
      `SELECT ${config.idColumn} AS message_id, emoji, COUNT(*) AS count
       FROM ${config.table}
       WHERE ${config.idColumn} IN (${placeholders})
       GROUP BY ${config.idColumn}, emoji
       ORDER BY MIN(created_at) ASC`,
      messageIds
    );

    const [ownRows] = await db.promise().query(
      `SELECT ${config.idColumn} AS message_id, emoji
       FROM ${config.table}
       WHERE ${config.idColumn} IN (${placeholders}) AND user_id = ?
       ORDER BY created_at ASC`,
      [...messageIds, ownUserId]
    );

    for (const row of summaryRows) {
      const id = row.message_id;
      if (!state[id]) {
        state[id] = { reactions: [], my_reactions: [] };
      }
      state[id].reactions.push({ emoji: row.emoji, count: row.count });
    }

    for (const row of ownRows) {
      const id = row.message_id;
      if (!state[id]) {
        state[id] = { reactions: [], my_reactions: [] };
      }
      state[id].my_reactions.push(row.emoji);
    }

    return state;
  };

  const buildMessageState = async (messageId, userId) => {
    const state = await aggregateReactions([messageId], userId);
    const messageState = state[Number(messageId)];

    return {
      reactions: messageState?.reactions ?? [],
      my_reactions: messageState?.my_reactions ?? [],
    };
  };

  const attachReactions = async (messages, userId) => {
    const ids = messages.map((message) => message[config.idColumn]);
    const state = await aggregateReactions(ids, userId);

    return messages.map((message) => {
      const messageState = state[message[config.idColumn]];

      return {
        ...message,
        reactions: messageState?.reactions ?? [],
        my_reactions: messageState?.my_reactions ?? [],
      };
    });
  };

  const loadMessageForReaction = async (messageId, userId) => {
    const message = await config.getMessage(messageId);

    if (!message) {
      return { error: { status: 404, message: "Message not found" } };
    }

    if (message.is_deleted) {
      return { error: { status: 400, message: "Cannot react to a deleted message" } };
    }

    const allowed = await config.canReact(message, userId);

    if (!allowed) {
      return { error: { status: 403, message: config.notAllowedMessage } };
    }

    return { message };
  };

  const buildResponseData = (messageId, emoji, added, state) => {
    const data = {
      message_id: Number(messageId),
      emoji,
      added,
      reactions: state.reactions,
      my_reactions: state.my_reactions,
    };

    if (config.idColumn !== "message_id") {
      data[config.idColumn] = Number(messageId);
    }

    return data;
  };

  const validateRequest = (req) => {
    const { messageId } = req.params;
    const { emoji } = req.body || {};

    if (!messageId) {
      return { status: 400, message: "Message ID is required" };
    }

    if (!isValidEmoji(emoji)) {
      return {
        status: 400,
        message: "Please send a valid emoji (any single emoji, up to 32 characters)",
      };
    }

    return { emoji };
  };

  const toggleReaction = async (req, res) => {
    try {
      const userId = req.user.user_id;
      const validated = validateRequest(req);

      if (validated.status) {
        return res.status(validated.status).json({
          success: false,
          message: validated.message,
        });
      }

      const { messageId } = req.params;
      const { emoji } = validated;

      const loaded = await loadMessageForReaction(messageId, userId);
      if (loaded.error) {
        return res.status(loaded.error.status).json({
          success: false,
          message: loaded.error.message,
        });
      }

      const [existing] = await db.promise().query(
        `SELECT reaction_id FROM ${config.table}
         WHERE ${config.idColumn} = ? AND user_id = ? AND emoji = ?`,
        [messageId, userId, emoji]
      );

      let added;
      if (existing[0]) {
        await db.promise().query(
          `DELETE FROM ${config.table} WHERE reaction_id = ?`,
          [existing[0].reaction_id]
        );
        added = false;
      } else {
        try {
          await db.promise().query(
            `INSERT INTO ${config.table} (${config.idColumn}, user_id, emoji) VALUES (?, ?, ?)`,
            [messageId, userId, emoji]
          );
          added = true;
        } catch (insertError) {
          if (insertError && insertError.code === "ER_DUP_ENTRY") {
            // Lost a race against a concurrent duplicate insert; the reaction
            // is already stored, so treat this request as successful.
            added = true;
          } else {
            throw insertError;
          }
        }
      }

      const state = await buildMessageState(messageId, userId);

      return res.status(200).json({
        success: true,
        message: added ? "Reaction added" : "Reaction removed",
        data: buildResponseData(messageId, emoji, added, state),
      });
    } catch (error) {
      console.error("Toggle reaction error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Server error while reacting to the message",
      });
    }
  };

  const removeReaction = async (req, res) => {
    try {
      const userId = req.user.user_id;
      const validated = validateRequest(req);

      if (validated.status) {
        return res.status(validated.status).json({
          success: false,
          message: validated.message,
        });
      }

      const { messageId } = req.params;
      const { emoji } = validated;

      const loaded = await loadMessageForReaction(messageId, userId);
      if (loaded.error) {
        return res.status(loaded.error.status).json({
          success: false,
          message: loaded.error.message,
        });
      }

      const [existing] = await db.promise().query(
        `SELECT reaction_id FROM ${config.table}
         WHERE ${config.idColumn} = ? AND user_id = ? AND emoji = ?`,
        [messageId, userId, emoji]
      );

      if (!existing[0]) {
        return res.status(404).json({
          success: false,
          message: "Reaction not found",
        });
      }

      await db.promise().query(
        `DELETE FROM ${config.table} WHERE reaction_id = ?`,
        [existing[0].reaction_id]
      );

      const state = await buildMessageState(messageId, userId);

      return res.status(200).json({
        success: true,
        message: "Reaction removed",
        data: buildResponseData(messageId, emoji, false, state),
      });
    } catch (error) {
      console.error("Remove reaction error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Server error while removing the reaction",
      });
    }
  };

  return { toggleReaction, removeReaction, attachReactions };
};

const channelReactions = createReactionController({
  table: "message_reactions",
  idColumn: "message_id",
  notAllowedMessage: "You are not allowed to react to this message",
  getMessage: async (messageId) => {
    const [rows] = await db.promise().query(
      "SELECT message_id, channel_id, sender_id, is_deleted FROM messages WHERE message_id = ?",
      [messageId]
    );

    return rows[0];
  },
  canReact: async (message, userId) => {
    const membership = await checkChannelMembership(message.channel_id, userId);

    return Boolean(membership);
  },
});

const dmReactions = createReactionController({
  table: "direct_message_reactions",
  idColumn: "direct_message_id",
  notAllowedMessage: "You are not allowed to react to this conversation",
  getMessage: async (messageId) => {
    const [rows] = await db.promise().query(
      "SELECT direct_message_id, sender_id, receiver_id, is_deleted FROM direct_messages WHERE direct_message_id = ?",
      [messageId]
    );

    return rows[0];
  },
  canReact: async (message, userId) =>
    Number(message.sender_id) === Number(userId) ||
    Number(message.receiver_id) === Number(userId),
});

module.exports = {
  QUICK_REACTIONS,
  channelReactions,
  dmReactions,
};
