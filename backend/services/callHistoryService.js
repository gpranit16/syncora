const db = require("../config/db");

const getDmRoomName = (firstId, secondId) => {
  const firstUserId = Math.min(Number(firstId), Number(secondId));
  const secondUserId = Math.max(Number(firstId), Number(secondId));
  return `dm_${firstUserId}_${secondUserId}`;
};

const formatCallMessageText = (callType, callStatus, durationSeconds) => {
  const isVideo = callType === "video";
  const typeLabel = isVideo ? "Video call" : "Voice call";

  switch (callStatus) {
    case "completed": {
      const dur = durationSeconds || 0;
      const mins = Math.floor(dur / 60);
      const secs = dur % 60;
      let durLabel = "";
      if (mins > 0) {
        durLabel = `${mins} min ${secs} sec`;
      } else {
        durLabel = `${secs} sec`;
      }
      return `${typeLabel} (${durLabel})`;
    }
    case "missed":
      return `Missed ${isVideo ? "video" : "voice"} call`;
    case "rejected":
      return `${typeLabel} declined`;
    case "cancelled":
      return `Cancelled ${isVideo ? "video" : "voice"} call`;
    case "failed":
      return `${typeLabel} failed`;
    default:
      return `${typeLabel}`;
  }
};

/**
 * Persists a call-history event idempotently into direct_messages table
 * and broadcasts the message via Socket.io so both participants see it in real-time.
 */
const recordCallHistory = async ({
  callId,
  callerId,
  receiverId,
  callType = "voice",
  callStatus = "completed",
  duration = 0,
  io = null,
}) => {
  if (!callId || !callerId || !receiverId) {
    console.warn("[CallHistory] Missing required parameters to record call event");
    return null;
  }

  const normalizedCallerId = Number(callerId);
  const normalizedReceiverId = Number(receiverId);
  const normalizedDuration = Math.max(0, Math.floor(duration || 0));

  try {
    // 1. Idempotency Check: if this callId is already recorded in direct_messages, skip
    const [existing] = await db.promise().query(
      "SELECT direct_message_id FROM direct_messages WHERE call_id = ? LIMIT 1",
      [callId]
    );

    if (existing && existing.length > 0) {
      console.log(`[CallHistory] Call ${callId} already recorded (id: ${existing[0].direct_message_id}), skipping.`);
      return null;
    }

    // 2. Fetch participant user details
    const [users] = await db.promise().query(
      "SELECT user_id, name, email FROM users WHERE user_id IN (?, ?)",
      [normalizedCallerId, normalizedReceiverId]
    );

    const callerUser = users.find((u) => u.user_id === normalizedCallerId);
    const receiverUser = users.find((u) => u.user_id === normalizedReceiverId);

    const messageText = formatCallMessageText(callType, callStatus, normalizedDuration);

    // 3. Insert record into direct_messages
    const [insertResult] = await db.promise().query(
      `INSERT INTO direct_messages (
        sender_id,
        receiver_id,
        message_text,
        message_type,
        call_id,
        call_type,
        call_status,
        call_duration,
        is_read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedCallerId,
        normalizedReceiverId,
        messageText,
        "call",
        callId,
        callType,
        callStatus,
        normalizedDuration,
        callStatus === "missed" ? false : true,
      ]
    );

    const insertedId = insertResult.insertId;

    const dmPayload = {
      direct_message_id: insertedId,
      sender_id: normalizedCallerId,
      sender_name: callerUser ? callerUser.name : "Caller",
      sender_email: callerUser ? callerUser.email : "",
      receiver_id: normalizedReceiverId,
      receiver_name: receiverUser ? receiverUser.name : "Receiver",
      receiver_email: receiverUser ? receiverUser.email : "",
      message_text: messageText,
      message_type: "call",
      call_id: callId,
      call_type: callType,
      call_status: callStatus,
      call_duration: normalizedDuration,
      reply_to: null,
      file_url: null,
      file_name: null,
      is_edited: false,
      is_deleted: false,
      is_read: callStatus === "missed" ? false : true,
      is_pinned: false,
      pinned_at: null,
      reactions: [],
      my_reactions: [],
      created_at: new Date().toISOString(),
    };

    // 4. Realtime broadcast via Socket.io
    if (io) {
      const dmRoom = getDmRoomName(normalizedCallerId, normalizedReceiverId);
      io.to(dmRoom).emit("receive_dm", dmPayload);
      io.to(`user_${normalizedCallerId}`).emit("receive_dm", dmPayload);
      io.to(`user_${normalizedReceiverId}`).emit("receive_dm", dmPayload);
      console.log(`[CallHistory] Realtime call event broadcast to ${dmRoom} and user rooms [Call: ${callId}, Status: ${callStatus}]`);
    }

    return dmPayload;
  } catch (err) {
    console.error(`[CallHistory] Error recording call history for ${callId}:`, err.message);
    return null;
  }
};

module.exports = {
  recordCallHistory,
  formatCallMessageText,
};
