const db = require("../config/db");

const onlineUsers = new Map();

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

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

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
      console.log(`Direct message sent to ${roomName}`);

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

    socket.on("disconnect", async () => {
      const userId = onlineUsers.get(socket.id);

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
