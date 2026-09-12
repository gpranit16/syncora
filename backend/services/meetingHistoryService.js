const db = require("../config/db");

const formatMeetingDuration = (durationSeconds) => {
  const dur = Math.max(0, Math.floor(durationSeconds || 0));
  const mins = Math.floor(dur / 60);
  const secs = dur % 60;
  if (mins > 0) {
    return `${mins} min ${secs} sec`;
  }
  return `${secs} sec`;
};

/**
 * Persists a meeting-end history event idempotently into the messages table
 * and broadcasts the message via Socket.io so all channel members see it in real-time.
 */
const recordMeetingEndHistory = async ({
  meetingId,
  meetingCode,
  channelId,
  hostId,
  title,
  mode = "video",
  duration = 0,
  io = null,
}) => {
  if (!channelId || (!meetingId && !meetingCode)) {
    return null;
  }

  const normalizedChannelId = Number(channelId);
  const normalizedHostId = Number(hostId || 0);
  const normalizedDuration = Math.max(0, Math.floor(duration || 0));
  const isVideo = mode === "video";
  const typeLabel = isVideo ? "Video Meeting" : "Voice Meeting";
  const displayTitle = title || typeLabel;
  const durLabel = formatMeetingDuration(normalizedDuration);
  const messageText = `${displayTitle} ended • ${durLabel}`;

  try {
    // 1. Idempotency Check: if this meeting is already recorded in messages, skip
    const [existing] = await db.promise().query(
      "SELECT message_id FROM messages WHERE channel_id = ? AND (meeting_id = ? OR meeting_code = ?) LIMIT 1",
      [normalizedChannelId, meetingId || null, meetingCode || null]
    );

    if (existing && existing.length > 0) {
      return null;
    }

    // 2. Fetch host info
    let hostName = "Host";
    if (normalizedHostId > 0) {
      const [users] = await db.promise().query(
        "SELECT user_id, name FROM users WHERE user_id = ? LIMIT 1",
        [normalizedHostId]
      );
      if (users && users.length > 0) {
        hostName = users[0].name;
      }
    }

    const now = new Date();

    // 3. Insert record into messages
    const [insertResult] = await db.promise().query(
      `INSERT INTO messages (
        channel_id,
        sender_id,
        message_text,
        message_type,
        meeting_id,
        meeting_code,
        meeting_type,
        meeting_duration,
        created_at
      ) VALUES (?, ?, ?, 'meeting', ?, ?, ?, ?, ?)`,
      [
        normalizedChannelId,
        normalizedHostId || 1,
        messageText,
        meetingId || null,
        meetingCode || null,
        mode,
        normalizedDuration,
        now,
      ]
    );

    const insertedId = insertResult.insertId;

    const messagePayload = {
      message_id: insertedId,
      channel_id: normalizedChannelId,
      sender_id: normalizedHostId || 1,
      sender_name: hostName,
      message_text: messageText,
      message_type: "meeting",
      meeting_id: meetingId,
      meeting_code: meetingCode,
      meeting_type: mode,
      meeting_title: displayTitle,
      meeting_duration: normalizedDuration,
      reply_to: null,
      file_url: null,
      file_name: null,
      is_edited: false,
      is_deleted: false,
      is_pinned: false,
      pinned_at: null,
      reactions: [],
      my_reactions: [],
      created_at: now.toISOString(),
    };

    // 4. Realtime broadcast via Socket.io
    if (io) {
      const channelRoom = `channel_${normalizedChannelId}`;
      io.to(channelRoom).emit("receive_message", messagePayload);
      console.log(`[MeetingHistory] Realtime meeting event broadcast to ${channelRoom} [Meeting: ${meetingCode}]`);
    }

    return messagePayload;
  } catch (err) {
    console.error(`[MeetingHistory] Error recording meeting history for ${meetingCode}:`, err.message);
    return null;
  }
};

module.exports = {
  recordMeetingEndHistory,
  formatMeetingDuration,
};
