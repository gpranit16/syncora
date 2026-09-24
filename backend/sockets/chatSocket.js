const db = require("../config/db");
const { recordCallHistory } = require("../services/callHistoryService");
const { meetingSocket, handleMeetingDisconnect } = require("./meetingSocket");
const { stopDeepgramSession } = require("../services/deepgramService");

const onlineUsers = new Map();
const activeCalls = new Map();

const getDmRoomName = (firstId, secondId) => {
  const firstUserId = Math.min(Number(firstId), Number(secondId));
  const secondUserId = Math.max(Number(firstId), Number(secondId));

  return `dm_${firstUserId}_${secondUserId}`;
};

const getUnreadCountsForUser = async (userId) => {
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

  return {
    success: true,
    channel_unread: channelUnread,
    dm_unread: dmUnread,
    notifications: notificationsUnread,
    per_channel_unread: perChannelUnread,
    total_unread: channelUnread + dmUnread + notificationsUnread,
  };
};

const chatSocket = (io) => {
  const emitUnreadUpdateForUser = async (userId) => {
    if (!userId) {
      return;
    }

    try {
      const counts = await getUnreadCountsForUser(userId);
      io.to(`user_${userId}`).emit("unread_update", counts);
    } catch (error) {
      console.error("Unread update emit error:", error.message);
    }
  };

  const emitUnreadUpdatesForChannelRoom = async (roomName, senderId) => {
    try {
      const socketIds = await io.in(roomName).allSockets();

      for (const socketId of socketIds) {
        const userId = onlineUsers.get(socketId);

        if (userId && userId !== senderId) {
          await emitUnreadUpdateForUser(userId);
        }
      }
    } catch (error) {
      console.error("Unread channel update error:", error.message);
    }
  };

  // Broadcast WhatsApp-style reaction events to the right room
  // (channel room for channel messages, DM room for direct messages).
  const broadcastReaction = (event, data) => {
    if (!data || typeof data !== "object") {
      return;
    }

    if (data.channel_id) {
      io.to(`channel_${data.channel_id}`).emit(event, data);
      console.log(`${event} broadcast in channel_${data.channel_id}`);
      return;
    }

    if (data.sender_id && data.receiver_id) {
      const roomName = getDmRoomName(data.sender_id, data.receiver_id);
      io.to(roomName).emit(event, data);
      console.log(`${event} broadcast in ${roomName}`);
    }
  };

  // Pin/unpin events use the same room routing as reactions.
  const broadcastPin = (event, data) => {
    broadcastReaction(event, data);
  };

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    // Register meeting socket handlers
    meetingSocket(io, socket, onlineUsers);

    // Online users
    socket.on("user_online", async (userId) => {
      onlineUsers.set(socket.id, userId);

      await db.promise().query("UPDATE users SET is_online = TRUE WHERE user_id = ?", [userId]);

      io.emit("online_users", Array.from(onlineUsers.values()));
      console.log(`User ${userId} is online`);
    });

    socket.on("join_user_room", (userId) => {
      const roomName = `user_${userId}`;

      socket.join(roomName);
      console.log(`Socket ${socket.id} joined ${roomName}`);
    });

    socket.on("unread_update", async (userId) => {
      await emitUnreadUpdateForUser(userId);
    });

    // Channel chat
    socket.on("join_channel", (channelId) => {
      const roomName = `channel_${channelId}`;

      socket.join(roomName);
      console.log(`Socket ${socket.id} joined ${roomName}`);
    });

    socket.on("send_message", async (messageData) => {
      const roomName = `channel_${messageData.channel_id}`;

      io.to(roomName).emit("receive_message", messageData);
      console.log(`Message sent to ${roomName}`);

      if (messageData.reply_to) {
        io.to(roomName).emit("message_reply", {
          message_id: messageData.message_id,
          reply_to: messageData.reply_to,
          message_text: messageData.message_text,
          sender_id: messageData.sender_id,
          channel_id: messageData.channel_id,
        });
      }

      if (messageData.sender_id) {
        await emitUnreadUpdatesForChannelRoom(roomName, messageData.sender_id);
      }
    });

    socket.on("message_edited", (messageData) => {
      const roomName = `channel_${messageData.channel_id}`;

      io.to(roomName).emit("message_edited", messageData);
      console.log(`Message edited in ${roomName}`);
    });

    socket.on("message_deleted", (messageData) => {
      const roomName = `channel_${messageData.channel_id}`;

      io.to(roomName).emit("message_deleted", messageData);
      console.log(`Message deleted in ${roomName}`);
    });

    // Message reactions (realtime, no page refresh needed)
    socket.on("reaction_added", (data) => {
      broadcastReaction("reaction_added", data);
    });

    socket.on("reaction_removed", (data) => {
      broadcastReaction("reaction_removed", data);
    });

    // Message pinning (realtime, no page refresh needed)
    socket.on("message_pinned", (data) => {
      broadcastPin("message_pinned", data);
    });

    socket.on("message_unpinned", (data) => {
      broadcastPin("message_unpinned", data);
    });

    // Direct message chat
    socket.on("join_dm", ({ senderId, receiverId }) => {
      const roomName = getDmRoomName(senderId, receiverId);

      socket.join(roomName);
      console.log(`Socket ${socket.id} joined ${roomName}`);
    });

    socket.on("send_dm", async (messageData) => {
      const roomName = getDmRoomName(
        messageData.sender_id,
        messageData.receiver_id
      );

      io.to(roomName).emit("receive_dm", messageData);
      if (messageData.receiver_id) {
        io.to(`user_${messageData.receiver_id}`).emit("receive_dm", messageData);
      }
      console.log(`Direct message sent to ${roomName} and user_${messageData.receiver_id}`);

      if (messageData.receiver_id) {
        await emitUnreadUpdateForUser(messageData.receiver_id);
      }
    });

    socket.on("dm_edited", (messageData) => {
      const roomName = getDmRoomName(messageData.sender_id, messageData.receiver_id);
      io.to(roomName).emit("dm_edited", messageData);
    });

    socket.on("dm_deleted", (messageData) => {
      const roomName = getDmRoomName(messageData.sender_id, messageData.receiver_id);
      io.to(roomName).emit("dm_deleted", messageData);
    });

    socket.on("conversation_deleted", (data) => {
      if (data && data.sender_id && data.receiver_id) {
        const roomName = getDmRoomName(data.sender_id, data.receiver_id);
        io.to(roomName).emit("conversation_deleted", data);
        io.to(`user_${data.sender_id}`).emit("conversation_deleted", data);
        io.to(`user_${data.receiver_id}`).emit("conversation_deleted", data);
      }
    });

    // Realtime notifications
    socket.on("join_notifications", (userId) => {
      const roomName = `notification_${userId}`;

      socket.join(roomName);
      console.log(`Socket ${socket.id} joined ${roomName}`);
    });

    socket.on("send_notification", (notificationData) => {
      const roomName = `notification_${notificationData.user_id}`;

      io.to(roomName).emit("receive_notification", notificationData);
      console.log(`Notification sent to ${roomName}`);
    });

    socket.on("mark_channel_read", async ({ channel_id, user_id }) => {
      if (!channel_id || !user_id) {
        return;
      }

      try {
        await db
          .promise()
          .query(
            "UPDATE messages SET is_read = TRUE WHERE channel_id = ? AND sender_id != ?",
            [channel_id, user_id]
          );

        await emitUnreadUpdateForUser(user_id);
      } catch (error) {
        console.error("Mark channel read error:", error.message);
      }
    });

    socket.on("task_assigned", (data) => {
      const roomName = `user_${data.assigned_to}`;
      io.to(roomName).emit("task_assigned", data);
      console.log(`Task assigned notification sent to ${roomName}`);
    });

    socket.on("mark_dm_read", async ({ sender_id, receiver_id }) => {
      if (!receiver_id) {
        return;
      }

      try {
        await db
          .promise()
          .query("UPDATE direct_messages SET is_read = TRUE WHERE receiver_id = ?", [
            receiver_id,
          ]);

        await emitUnreadUpdateForUser(receiver_id);
      } catch (error) {
        console.error("Mark DM read error:", error.message);
      }
    });

    // Typing indicators for channels and direct messages
    socket.on("typing", (typingData) => {
      if (typingData.channel_id) {
        const roomName = `channel_${typingData.channel_id}`;

        io.to(roomName).emit("user_typing", typingData);
        return;
      }

      if (typingData.sender_id && typingData.receiver_id) {
        const roomName = getDmRoomName(
          typingData.sender_id,
          typingData.receiver_id
        );

        io.to(roomName).emit("user_typing", typingData);
      }
    });

    socket.on("stop_typing", (typingData) => {
      if (typingData.channel_id) {
        const roomName = `channel_${typingData.channel_id}`;

        io.to(roomName).emit("user_stop_typing", typingData);
        return;
      }

      if (typingData.sender_id && typingData.receiver_id) {
        const roomName = getDmRoomName(
          typingData.sender_id,
          typingData.receiver_id
        );

        io.to(roomName).emit("user_stop_typing", typingData);
      }
    });

    // ── 1-to-1 Voice & Video Call Signaling ──────────────────────────────────
    socket.on("call_user", async ({ receiver_id, call_type, offer }) => {
      const callerId = onlineUsers.get(socket.id);
      if (!callerId) {
        socket.emit("call_error", { message: "Unauthorized: Caller is not authenticated" });
        return;
      }

      if (!receiver_id || Number(receiver_id) === Number(callerId)) {
        socket.emit("call_error", { message: "Invalid call recipient" });
        return;
      }

      const normalizedReceiverId = Number(receiver_id);

      try {
        const queryRes = await db.promise().query(
          "SELECT user_id, name, email FROM users WHERE user_id IN (?, ?)",
          [callerId, normalizedReceiverId]
        );
        const users = (queryRes && Array.isArray(queryRes[0])) ? queryRes[0] : (Array.isArray(queryRes) ? queryRes : []);

        const callerUser = users.find(u => u.user_id === Number(callerId));
        const receiverUser = users.find(u => u.user_id === normalizedReceiverId);

        if (!callerUser || !receiverUser) {
          socket.emit("call_error", { message: "Recipient user not found" });
          return;
        }

        // Check if receiver is already busy on another call
        for (const [existingCallId, call] of activeCalls.entries()) {
          if (
            (call.callerId === normalizedReceiverId || call.receiverId === normalizedReceiverId) &&
            call.status !== "ended"
          ) {
            socket.emit("call_rejected", {
              call_id: existingCallId,
              reason: "busy",
              message: `${receiverUser.name} is currently on another call.`
            });
            return;
          }
        }

        const callId = `call_${callerId}_${normalizedReceiverId}_${Date.now()}`;
        activeCalls.set(callId, {
          callId,
          callerId: Number(callerId),
          receiverId: normalizedReceiverId,
          callType: call_type || "voice",
          status: "ringing",
          callerSocketId: socket.id,
          createdAt: Date.now()
        });

        // Join caller to call room
        socket.join(`call_${callId}`);

        // Notify receiver room
        io.to(`user_${normalizedReceiverId}`).emit("incoming_call", {
          call_id: callId,
          caller: {
            user_id: callerUser.user_id,
            name: callerUser.name,
            avatar: callerUser.avatar || null
          },
          call_type: call_type || "voice",
          offer: offer || null
        });

        // Notify caller that recipient's phone is ringing
        socket.emit("call_ringing", {
          call_id: callId,
          receiver: {
            user_id: receiverUser.user_id,
            name: receiverUser.name,
            avatar: receiverUser.avatar || null
          },
          call_type: call_type || "voice"
        });

        console.log(`Call initiated [${callId}]: ${callerUser.name} -> ${receiverUser.name} (${call_type || "voice"})`);
      } catch (err) {
        console.error("Error initiating call:", err.message);
        socket.emit("call_error", { message: "Failed to initiate call" });
      }
    });

    socket.on("call_accept", ({ call_id, answer }) => {
      const receiverId = onlineUsers.get(socket.id);
      const call = activeCalls.get(call_id);

      if (!call || call.status === "ended") {
        socket.emit("call_error", { message: "Call has expired or ended" });
        return;
      }

      if (call.receiverId !== Number(receiverId)) {
        socket.emit("call_error", { message: "Unauthorized to accept this call" });
        return;
      }

      call.status = "connected";
      call.receiverSocketId = socket.id;
      call.startedAt = Date.now();

      // Ensure both receiver and caller sockets join the call room for transcription & in-call events
      socket.join(`call_${call_id}`);
      if (call.callerSocketId) {
        const callerSocket = io.sockets.sockets.get(call.callerSocketId);
        if (callerSocket) callerSocket.join(`call_${call_id}`);
      }

      io.to(`user_${call.callerId}`).emit("call_accepted", {
        call_id,
        receiver_id: Number(receiverId),
        answer: answer || null
      });

      console.log(`Call accepted [${call_id}] by user ${receiverId}`);
    });

    socket.on("call_reject", async ({ call_id, reason }) => {
      const userId = onlineUsers.get(socket.id);
      const call = activeCalls.get(call_id);

      // Clean up any transcription sessions
      stopDeepgramSession(socket.id).catch(() => {});
      if (call) {
        if (call.callerSocketId) stopDeepgramSession(call.callerSocketId).catch(() => {});
        activeCalls.delete(call_id);
        const targetId = call.callerId === Number(userId) ? call.receiverId : call.callerId;
        io.to(`user_${targetId}`).emit("call_rejected", {
          call_id,
          reason: reason || "declined"
        });
        console.log(`Call rejected [${call_id}]: User ${userId} rejected call (${reason || "declined"})`);

        await recordCallHistory({
          callId: call.callId,
          callerId: call.callerId,
          receiverId: call.receiverId,
          callType: call.callType,
          callStatus: reason === "busy" ? "missed" : "rejected",
          duration: 0,
          io
        });
      }
    });

    socket.on("webrtc_signal", ({ call_id, target_user_id, signal }) => {
      const senderId = onlineUsers.get(socket.id);
      if (!senderId || !target_user_id || !signal) return;

      io.to(`user_${target_user_id}`).emit("webrtc_signal", {
        call_id,
        from_user_id: Number(senderId),
        signal
      });
    });

    socket.on("call_end", async ({ call_id, target_user_id, reason }) => {
      const senderId = onlineUsers.get(socket.id);

      // Stop Deepgram transcription for the user ending the call
      stopDeepgramSession(socket.id).catch(() => {});

      let call = null;
      if (call_id) {
        call = activeCalls.get(call_id);
        activeCalls.delete(call_id);
      } else {
        for (const [cId, c] of activeCalls.entries()) {
          if (c.callerId === Number(senderId) || c.receiverId === Number(senderId)) {
            call = c;
            activeCalls.delete(cId);
            break;
          }
        }
      }

      // Stop Deepgram transcription for the peer as well
      if (call) {
        if (call.callerSocketId) stopDeepgramSession(call.callerSocketId).catch(() => {});
        if (call.receiverSocketId) stopDeepgramSession(call.receiverSocketId).catch(() => {});
      }

      const activeCallId = call ? call.callId : call_id;

      if (target_user_id) {
        io.to(`user_${target_user_id}`).emit("call_ended", {
          call_id: activeCallId,
          reason: reason || "hung_up"
        });
      }

      socket.emit("call_ended", { call_id: activeCallId, reason: "hung_up" });
      console.log(`Call ended [${activeCallId || "active"}] by user ${senderId}`);

      if (call) {
        let status = "completed";
        let duration = 0;

        if (call.status === "connected" && call.startedAt) {
          duration = Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
          status = "completed";
        } else if (call.status === "ringing") {
          status = Number(senderId) === Number(call.callerId) ? "cancelled" : "missed";
        } else {
          status = "cancelled";
        }

        await recordCallHistory({
          callId: call.callId,
          callerId: call.callerId,
          receiverId: call.receiverId,
          callType: call.callType,
          callStatus: status,
          duration,
          io
        });
      }
    });

    socket.on("disconnect", async () => {
      handleMeetingDisconnect(io, socket);
      stopDeepgramSession(socket.id).catch(() => {});

      const userId = onlineUsers.get(socket.id);

      // Clean up any ongoing or ringing calls for this user
      if (userId) {
        for (const [callId, call] of activeCalls.entries()) {
          if (call.callerId === Number(userId) || call.receiverId === Number(userId)) {
            const otherId = call.callerId === Number(userId) ? call.receiverId : call.callerId;
            io.to(`user_${otherId}`).emit("call_ended", {
              call_id: callId,
              reason: "disconnected"
            });
            activeCalls.delete(callId);
            console.log(`Call ended due to disconnect [${callId}]: user ${userId}`);

            let status = "completed";
            let duration = 0;

            if (call.status === "connected" && call.startedAt) {
              duration = Math.max(0, Math.floor((Date.now() - call.startedAt) / 1000));
              status = "completed";
            } else {
              status = "failed";
            }

            await recordCallHistory({
              callId: call.callId,
              callerId: call.callerId,
              receiverId: call.receiverId,
              callType: call.callType,
              callStatus: status,
              duration,
              io
            });
          }
        }
      }

      onlineUsers.delete(socket.id);
      io.emit("online_users", Array.from(onlineUsers.values()));

      if (userId) {
        await db.promise().query("UPDATE users SET is_online = FALSE, last_seen = NOW() WHERE user_id = ?", [userId]);
        console.log(`User ${userId} went offline`);
      }

      console.log("User disconnected:", socket.id);
    });
  });
};

module.exports = chatSocket;
