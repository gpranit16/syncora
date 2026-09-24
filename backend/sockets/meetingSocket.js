const db = require("../config/db");
const { recordMeetingEndHistory } = require("../services/meetingHistoryService");
const {
  startDeepgramSession,
  sendAudioToDeepgram,
  stopDeepgramSession,
} = require("../services/deepgramService");

// Map<meetingCode, { meetingId, title, hostUserId, participants: Map<socketId, ParticipantObject> }>
const activeMeetingRooms = new Map();

/**
 * Persist a Deepgram final transcript segment to the meeting_transcripts table.
 * Called directly via the onFinalSegment callback — NOT via socket round-trip.
 */
async function persistDeepgramSegment(payload, rooms, dbConn) {
  const { meetingCode, speakerId, speakerName, text, timestamp, language } = payload || {};
  if (!meetingCode || !text || !text.trim()) return;

  let room = rooms.get(meetingCode);
  if (!room) {
    const [meetings] = await dbConn.promise().query(
      "SELECT * FROM meetings WHERE meeting_code = ?",
      [meetingCode]
    );
    if (meetings.length === 0) {
      console.warn(`[Deepgram] persistDeepgramSegment: meeting ${meetingCode} not found in DB`);
      return;
    }
    const m = meetings[0];
    room = {
      meetingId: m.meeting_id,
      title: m.title,
      hostUserId: Number(m.host_id || m.host_user_id),
      meetingType: m.mode || "voice",
      channelId: m.channel_id,
      workspaceId: m.workspace_id,
      createdAt: m.created_at || new Date(),
      participants: new Map(),
      transcriptSegments: [],
    };
    rooms.set(meetingCode, room);
  }

  if (!room.transcriptSegments) room.transcriptSegments = [];

  const cleanText = text.trim();
  const currentTimestamp = timestamp || new Date().toISOString();
  const currentTsMillis = new Date(currentTimestamp).getTime();

  // Deduplication: same speaker, same text, within 2s
  const isDuplicate = room.transcriptSegments.some(
    (s) =>
      s.speaker_id === speakerId &&
      s.text.toLowerCase() === cleanText.toLowerCase() &&
      Math.abs(new Date(s.timestamp).getTime() - currentTsMillis) < 2000
  );

  if (isDuplicate) return;

  room.transcriptSegments.push({
    speaker_id: speakerId,
    speaker_name: speakerName || "Speaker",
    text: cleanText,
    timestamp: currentTimestamp,
    language: language || "multi",
  });

  const fullText = room.transcriptSegments
    .map((s) => `${s.speaker_name || "Speaker"}: ${s.text}`)
    .join("\n");
  const segmentsJson = JSON.stringify(room.transcriptSegments);

  await dbConn.promise().query(
    `INSERT INTO meeting_transcripts (
      meeting_id, meeting_code, workspace_id, channel_id, transcript_text, segments, language
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      transcript_text = VALUES(transcript_text),
      segments = VALUES(segments),
      language = VALUES(language),
      updated_at = CURRENT_TIMESTAMP`,
    [
      room.meetingId,
      meetingCode,
      room.workspaceId || 0,
      room.channelId || null,
      fullText,
      segmentsJson,
      language || "multi",
    ]
  );

  console.log(`[Deepgram] Persisted segment for "${speakerName}" in meeting=${meetingCode}`);
}

const meetingSocket = (io, socket, onlineUsers) => {
  // Join a meeting room
  socket.on("meeting_join", async (data) => {
    try {
      const {
        meeting_code,
        user_id,
        user_name,
        user_avatar,
        user_email,
        is_muted = false,
        is_camera_off = false,
      } = data || {};

      if (!meeting_code || !user_id) {
        socket.emit("meeting_error", { message: "Meeting code and user ID required" });
        return;
      }

      // Check meeting in DB
      const [meetings] = await db.promise().query(
        "SELECT * FROM meetings WHERE meeting_code = ?",
        [meeting_code]
      );

      if (meetings.length === 0) {
        socket.emit("meeting_error", { message: "Meeting not found" });
        return;
      }

      const meeting = meetings[0];
      if (meeting.status === "ended") {
        socket.emit("meeting_error", { message: "This meeting has ended" });
        return;
      }

      const hostId = meeting.host_id !== undefined ? meeting.host_id : meeting.host_user_id;
      const isHost = Number(hostId) === Number(user_id);
      const role = isHost ? "host" : "participant";

      // DB participant record
      try {
        const [existing] = await db.promise().query(
          "SELECT * FROM meeting_participants WHERE meeting_id = ? AND user_id = ?",
          [meeting.meeting_id, user_id]
        );

        if (existing.length > 0) {
          await db.promise().query(
            "UPDATE meeting_participants SET status = 'connected', left_at = NULL, is_muted = ?, is_camera_off = ? WHERE participant_id = ?",
            [is_muted ? 1 : 0, is_camera_off ? 1 : 0, existing[0].participant_id]
          );
        } else {
          await db.promise().query(
            `INSERT INTO meeting_participants 
             (meeting_id, user_id, role, status, is_muted, is_camera_off, joined_at)
             VALUES (?, ?, ?, 'connected', ?, ?, NOW())`,
            [meeting.meeting_id, user_id, role, is_muted ? 1 : 0, is_camera_off ? 1 : 0]
          );
        }
      } catch (dbErr) {
        console.error("Meeting participant DB update error:", dbErr.message);
      }

      const roomName = `meeting_${meeting_code}`;
      socket.join(roomName);

      // In-memory management
      if (!activeMeetingRooms.has(meeting_code)) {
        activeMeetingRooms.set(meeting_code, {
          meetingId: meeting.meeting_id,
          title: meeting.title,
          hostUserId: Number(hostId),
          meetingType: meeting.mode || meeting.meeting_type || "video",
          channelId: meeting.channel_id,
          workspaceId: meeting.workspace_id,
          createdAt: meeting.created_at || new Date(),
          participants: new Map(),
          screenPresenter: null,
          screenShareLocked: false,
          messages: [],
        });
      }

      const room = activeMeetingRooms.get(meeting_code);
      const participantInfo = {
        socketId: socket.id,
        userId: Number(user_id),
        userName: user_name || "User",
        userAvatar: user_avatar || null,
        userEmail: user_email || null,
        role,
        isMuted: !!is_muted,
        isCameraOff: !!is_camera_off,
        joinedAt: new Date().toISOString(),
      };

      // Collect existing participants to send back to the newly joined peer
      const existingParticipants = [];
      for (const [sId, p] of room.participants.entries()) {
        if (sId !== socket.id) {
          existingParticipants.push({
            socket_id: p.socketId,
            user_id: p.userId,
            user_name: p.userName,
            user_avatar: p.userAvatar,
            user_email: p.userEmail,
            role: p.role,
            is_muted: p.isMuted,
            is_camera_off: p.isCameraOff,
            joined_at: p.joinedAt,
          });
        }
      }

      room.participants.set(socket.id, participantInfo);

      // Send confirmation & existing peers to joining user
      socket.emit("meeting_joined_success", {
        meeting: {
          meeting_id: meeting.meeting_id,
          meeting_code: meeting.meeting_code,
          title: meeting.title,
          meeting_type: meeting.meeting_type,
          host_user_id: meeting.host_user_id,
          channel_id: meeting.channel_id,
          workspace_id: meeting.workspace_id,
          role,
        },
        my_socket_id: socket.id,
        existing_participants: existingParticipants,
        screen_presenter: room.screenPresenter || null,
        screen_share_locked: !!room.screenShareLocked,
        chat_history: room.messages || [],
      });

      // Broadcast new participant to everyone else in the meeting room
      socket.to(roomName).emit("meeting_user_joined", {
        socket_id: socket.id,
        user_id: Number(user_id),
        user_name: participantInfo.userName,
        user_avatar: participantInfo.userAvatar,
        user_email: participantInfo.userEmail,
        role,
        is_muted: participantInfo.isMuted,
        is_camera_off: participantInfo.isCameraOff,
        joined_at: participantInfo.joinedAt,
      });

      if (meeting.channel_id) {
        io.to(`channel_${meeting.channel_id}`).emit("meeting_channel_started", {
          channel_id: Number(meeting.channel_id),
          meeting_id: meeting.meeting_id,
          meetingId: meeting.meeting_id,
          meeting_code: meeting.meeting_code,
          meetingCode: meeting.meeting_code,
          title: meeting.title,
          mode: meeting.mode || meeting.meeting_type || "video",
          meeting_type: meeting.mode || meeting.meeting_type || "video",
          host_id: Number(hostId),
          hostId: Number(hostId),
          host_name: participantInfo.userName,
          status: "active",
          created_at: meeting.created_at,
        });
      }

      console.log(`User ${user_id} (${user_name}) joined meeting ${meeting_code} with socket ${socket.id}`);
    } catch (error) {
      console.error("meeting_join error:", error);
      socket.emit("meeting_error", { message: "Internal server error joining meeting" });
    }
  });

  // Relay WebRTC mesh signaling (Offer / Answer / ICE Candidate)
  socket.on("meeting_signal", (data) => {
    const { meeting_code, target_socket_id, signal } = data || {};
    if (!target_socket_id || !signal) {
      return;
    }

    const userId = onlineUsers.get(socket.id);
    io.to(target_socket_id).emit("meeting_signal", {
      sender_socket_id: socket.id,
      sender_user_id: userId ? Number(userId) : null,
      signal,
    });
  });

  // Toggle mic/camera status
  socket.on("meeting_toggle_media", async (data) => {
    const { meeting_code, is_muted, is_camera_off } = data || {};
    if (!meeting_code) return;

    const room = activeMeetingRooms.get(meeting_code);
    if (room && room.participants.has(socket.id)) {
      const p = room.participants.get(socket.id);
      if (typeof is_muted === "boolean") p.isMuted = is_muted;
      if (typeof is_camera_off === "boolean") p.isCameraOff = is_camera_off;

      const roomName = `meeting_${meeting_code}`;
      io.to(roomName).emit("meeting_user_updated", {
        socket_id: socket.id,
        user_id: p.userId,
        is_muted: p.isMuted,
        is_camera_off: p.isCameraOff,
      });

      // Update DB asynchronously
      db.promise().query(
        "UPDATE meeting_participants SET is_muted = ?, is_camera_off = ? WHERE meeting_id = ? AND user_id = ?",
        [p.isMuted ? 1 : 0, p.isCameraOff ? 1 : 0, room.meetingId, p.userId]
      ).catch(err => console.error("meeting_toggle_media DB err:", err.message));
    }
  });

  // Host: Mute a specific participant
  socket.on("meeting_mute_participant", async (data) => {
    const { meeting_code, target_socket_id } = data || {};
    if (!meeting_code || !target_socket_id) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can mute participants" });
      return;
    }

    const target = room.participants.get(target_socket_id);
    if (target) {
      target.isMuted = true;
      io.to(target_socket_id).emit("meeting_forced_mute", {
        by_user_id: userId,
      });

      const roomName = `meeting_${meeting_code}`;
      io.to(roomName).emit("meeting_user_updated", {
        socket_id: target_socket_id,
        user_id: target.userId,
        is_muted: true,
        is_camera_off: target.isCameraOff,
      });

      db.promise().query(
        "UPDATE meeting_participants SET is_muted = 1 WHERE meeting_id = ? AND user_id = ?",
        [room.meetingId, target.userId]
      ).catch(err => console.error("meeting_mute_participant DB err:", err.message));
    }
  });

  // Host: Unmute a specific participant
  socket.on("meeting_unmute_participant", async (data) => {
    const { meeting_code, target_socket_id } = data || {};
    if (!meeting_code || !target_socket_id) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can unmute participants" });
      return;
    }

    const target = room.participants.get(target_socket_id);
    if (target) {
      target.isMuted = false;
      io.to(target_socket_id).emit("meeting_forced_unmute", {
        by_user_id: userId,
      });

      const roomName = `meeting_${meeting_code}`;
      io.to(roomName).emit("meeting_user_updated", {
        socket_id: target_socket_id,
        user_id: target.userId,
        is_muted: false,
        is_camera_off: target.isCameraOff,
      });

      db.promise().query(
        "UPDATE meeting_participants SET is_muted = 0 WHERE meeting_id = ? AND user_id = ?",
        [room.meetingId, target.userId]
      ).catch(err => console.error("meeting_unmute_participant DB err:", err.message));
    }
  });

  // Host: Remove a participant
  socket.on("meeting_remove_participant", async (data) => {
    const { meeting_code, target_socket_id } = data || {};
    if (!meeting_code || !target_socket_id) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can remove participants" });
      return;
    }

    const target = room.participants.get(target_socket_id);
    if (target) {
      if (room.screenPresenter && room.screenPresenter.socketId === target_socket_id) {
        room.screenPresenter = null;
        io.to(`meeting_${meeting_code}`).emit("meeting_screen_share_status", {
          socket_id: target_socket_id,
          is_sharing: false,
        });
      }

      io.to(target_socket_id).emit("meeting_removed", {
        reason: "You were removed from the meeting by the host",
      });

      room.participants.delete(target_socket_id);
      const roomName = `meeting_${meeting_code}`;
      io.to(roomName).emit("meeting_user_left", {
        socket_id: target_socket_id,
        user_id: target.userId,
        reason: "removed",
      });

      db.promise().query(
        "UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = ? AND user_id = ?",
        [room.meetingId, target.userId]
      ).catch(err => console.error("meeting_remove_participant DB err:", err.message));
    }
  });

  // Screen Share status broadcast (Google Meet style)
  socket.on("meeting_screen_share_status", (data) => {
    const { meeting_code, is_sharing } = data || {};
    if (!meeting_code) return;

    const room = activeMeetingRooms.get(meeting_code);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    const userId = participant?.userId || Number(onlineUsers.get(socket.id));
    const userName = participant?.userName || "User";

    // Permission check: If host disabled screen sharing, block non-host from sharing
    if (is_sharing && room.screenShareLocked && userId !== room.hostUserId) {
      socket.emit("meeting_error", { message: "Screen sharing is disabled by the meeting host" });
      return;
    }

    if (is_sharing) {
      room.screenPresenter = {
        socketId: socket.id,
        userId: userId,
        userName: userName,
      };
    } else {
      if (room.screenPresenter && room.screenPresenter.socketId === socket.id) {
        room.screenPresenter = null;
      }
    }

    const roomName = `meeting_${meeting_code}`;
    io.to(roomName).emit("meeting_screen_share_status", {
      socket_id: socket.id,
      user_id: userId,
      user_name: userName,
      is_sharing: !!is_sharing,
    });
  });

  // Host: Toggle/Lock screen sharing permissions for the whole meeting
  socket.on("meeting_toggle_screen_share_lock", (data) => {
    const { meeting_code, is_locked } = data || {};
    if (!meeting_code) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can toggle screen share permissions" });
      return;
    }

    room.screenShareLocked = !!is_locked;

    // If locked and non-host member is currently sharing, force stop their share
    if (room.screenShareLocked && room.screenPresenter) {
      const presenterSocketId = room.screenPresenter.socketId;
      const presenterUserId = room.screenPresenter.userId;
      if (presenterUserId !== room.hostUserId) {
        room.screenPresenter = null;
        io.to(presenterSocketId).emit("meeting_force_stop_screen_share", {
          by_user_id: userId,
          reason: "Screen sharing was disabled by the host",
        });
        io.to(`meeting_${meeting_code}`).emit("meeting_screen_share_status", {
          socket_id: presenterSocketId,
          is_sharing: false,
        });
      }
    }

    const roomName = `meeting_${meeting_code}`;
    io.to(roomName).emit("meeting_screen_share_lock_updated", {
      is_locked: room.screenShareLocked,
      by_user_id: userId,
    });
  });

  // Host: Stop someone else's screen share
  socket.on("meeting_stop_screen_share", (data) => {
    const { meeting_code, target_socket_id } = data || {};
    if (!meeting_code || !target_socket_id) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can stop screen sharing" });
      return;
    }

    if (room.screenPresenter && room.screenPresenter.socketId === target_socket_id) {
      room.screenPresenter = null;
    }

    // Force stop event directly to target presenter
    io.to(target_socket_id).emit("meeting_force_stop_screen_share", {
      by_user_id: userId,
    });

    // Broadcast room status that screen share ended
    const roomName = `meeting_${meeting_code}`;
    io.to(roomName).emit("meeting_screen_share_status", {
      socket_id: target_socket_id,
      is_sharing: false,
    });
  });

  // In-Meeting Chat: Send and broadcast messages to the meeting room
  socket.on("meeting_send_message", (data) => {
    const { meeting_code, message } = data || {};
    if (!meeting_code || !message || !message.trim()) return;

    const room = activeMeetingRooms.get(meeting_code);
    if (!room) return;

    const participant = room.participants.get(socket.id);
    const userId = participant?.userId || Number(onlineUsers.get(socket.id));
    const userName = participant?.userName || "User";
    const userAvatar = participant?.userAvatar || null;
    const isHost = room.hostUserId === userId;

    if (!room.messages) room.messages = [];

    const msgObj = {
      message_id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      meeting_code,
      sender_socket_id: socket.id,
      sender_id: userId,
      sender_name: userName,
      sender_avatar: userAvatar,
      is_host: isHost,
      text: message.trim(),
      created_at: new Date().toISOString(),
    };

    // Keep up to 200 in-memory messages per meeting
    room.messages.push(msgObj);
    if (room.messages.length > 200) {
      room.messages.shift();
    }

    const roomName = `meeting_${meeting_code}`;
    io.to(roomName).emit("meeting_new_message", msgObj);
  });

  // ── Deepgram Live Transcription ─────────────────────────────────────────────

  // Client requests to start a Deepgram session (for Meeting or 1-on-1 Call)
  socket.on("deepgram_start", async (data) => {
    try {
      const { meeting_code, call_id, user_id, user_name } = data || {};
      if (!meeting_code && !call_id) return;

      if (meeting_code) {
        socket.join(`meeting_${meeting_code}`);

        const room = activeMeetingRooms.get(meeting_code);
        const participant = room?.participants?.get(socket.id);
        const resolvedUserId = participant?.userId || Number(user_id) || null;
        const resolvedUserName = participant?.userName || user_name || "Speaker";

        console.log(`[Deepgram] Starting session for socket=${socket.id} user="${resolvedUserName}" meeting=${meeting_code}`);

        // Pass onFinalSegment callback — runs directly in-process, no socket round-trip
        await startDeepgramSession(io, socket, {
          meetingCode: meeting_code,
          userId: resolvedUserId,
          userName: resolvedUserName,
          onFinalSegment: async (payload) => {
            await persistDeepgramSegment(payload, activeMeetingRooms, db);
          },
        });
      } else if (call_id) {
        socket.join(`call_${call_id}`);

        const resolvedUserId = Number(user_id) || onlineUsers.get(socket.id) || null;
        const resolvedUserName = user_name || "Speaker";

        console.log(`[Deepgram] Starting session for socket=${socket.id} user="${resolvedUserName}" call=${call_id}`);

        await startDeepgramSession(io, socket, {
          callId: call_id,
          userId: resolvedUserId,
          userName: resolvedUserName,
          onFinalSegment: async (payload) => {
            console.log(`[Deepgram Call] FINAL from "${resolvedUserName}" in call=${call_id}: "${payload.text}"`);
          },
        });
      }
    } catch (err) {
      console.error("[Deepgram] deepgram_start error:", err.message);
    }
  });

  // Client streams raw PCM audio chunks (Binary Buffer/ArrayBuffer)
  socket.on("deepgram_audio_chunk", (audioData) => {
    if (!audioData) return;
    const buffer = Buffer.isBuffer(audioData) ? audioData : Buffer.from(audioData);
    sendAudioToDeepgram(socket.id, buffer);
  });

  // Client requests to stop Deepgram session (e.g. on mute or meeting end)
  socket.on("deepgram_stop", async () => {
    await stopDeepgramSession(socket.id);
  });

  // ── Legacy browser SpeechRecognition transcript chunk handler (kept for backwards compat) ──
  socket.on("meeting_transcript_chunk", async (data) => {
    try {
      const { meeting_code, text, user_id, user_name, timestamp, language } = data || {};
      if (!meeting_code || !text || !text.trim()) {
        console.warn("[MeetingTranscript] Chunk rejected: empty text or missing meeting_code");
        return;
      }

      let room = activeMeetingRooms.get(meeting_code);
      if (!room) {
        // Recover room from DB if active in memory was missing
        const [meetings] = await db.promise().query(
          "SELECT * FROM meetings WHERE meeting_code = ?",
          [meeting_code]
        );
        if (meetings.length > 0) {
          const m = meetings[0];
          room = {
            meetingId: m.meeting_id,
            title: m.title,
            hostUserId: Number(m.host_id || m.host_user_id),
            meetingType: m.mode || "voice",
            channelId: m.channel_id,
            workspaceId: m.workspace_id,
            createdAt: m.created_at || new Date(),
            participants: new Map(),
            transcriptSegments: [],
          };
          activeMeetingRooms.set(meeting_code, room);
        } else {
          console.warn(`[MeetingTranscript] Chunk rejected: meeting ${meeting_code} not found in DB`);
          return;
        }
      }

      // Validate identity from active room participants or authenticated onlineUsers
      const participant = room.participants.get(socket.id);
      const onlineUserId = Number(onlineUsers.get(socket.id));
      const resolvedUserId = participant?.userId || (onlineUserId > 0 ? onlineUserId : (user_id ? Number(user_id) : null));
      const resolvedUserName = participant?.userName || user_name || "Speaker";

      if (!room.transcriptSegments) room.transcriptSegments = [];

      const cleanText = text.trim();
      const currentTimestamp = timestamp || new Date().toISOString();
      const currentTsMillis = new Date(currentTimestamp).getTime();

      // Deduplication: prevent identical chunk from the same user within 2 seconds
      const isDuplicate = room.transcriptSegments.some(
        (s) =>
          s.speaker_id === resolvedUserId &&
          s.text.toLowerCase() === cleanText.toLowerCase() &&
          Math.abs(new Date(s.timestamp).getTime() - currentTsMillis) < 2000
      );

      if (!isDuplicate) {
        const segment = {
          speaker_id: resolvedUserId,
          speaker_name: resolvedUserName,
          text: cleanText,
          timestamp: currentTimestamp,
          language: language || "en",
        };
        room.transcriptSegments.push(segment);

        console.log(
          `[MeetingTranscript] Chunk accepted for room ${meeting_code} from "${resolvedUserName}" (uid: ${resolvedUserId}): len=${cleanText.length} text="${cleanText.slice(0, 30)}..." (total segments: ${room.transcriptSegments.length})`
        );

        // Broadcast live transcript fragment to peers in room (e.g. for live captions/transcript)
        io.to(`meeting_${meeting_code}`).emit("meeting_transcript_live", segment);

        // Incremental DB upsert so transcript is never lost if server/browser drops
        const fullText = room.transcriptSegments
          .map((s) => `${s.speaker_name || "Speaker"}: ${s.text}`)
          .join("\n");
        const segmentsJson = JSON.stringify(room.transcriptSegments);

        db.promise()
          .query(
            `INSERT INTO meeting_transcripts (
              meeting_id, meeting_code, workspace_id, channel_id, transcript_text, segments, language
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
              transcript_text = VALUES(transcript_text),
              segments = VALUES(segments),
              language = VALUES(language),
              updated_at = CURRENT_TIMESTAMP`,
            [
              room.meetingId,
              meeting_code,
              room.workspaceId || 0,
              room.channelId || null,
              fullText,
              segmentsJson,
              language || "en",
            ]
          )
          .catch((dbErr) =>
            console.error("[MeetingTranscript] Incremental DB upsert error:", dbErr.message)
          );
      }
    } catch (err) {
      console.error("[MeetingTranscript] Error processing transcript chunk:", err.message);
    }
  });


  // Host: End meeting for everyone
  socket.on("meeting_end", async (data) => {
    const { meeting_code } = data || {};
    if (!meeting_code) return;

    const room = activeMeetingRooms.get(meeting_code);
    const userId = Number(onlineUsers.get(socket.id));
    if (!room || room.hostUserId !== userId) {
      socket.emit("meeting_error", { message: "Only the host can end the meeting" });
      return;
    }

    const roomName = `meeting_${meeting_code}`;
    io.to(roomName).emit("meeting_ended", {
      reason: "Meeting ended by the host",
    });

    if (room && room.channelId) {
      io.to(`channel_${room.channelId}`).emit("meeting_channel_ended", {
        channel_id: Number(room.channelId),
        meeting_id: Number(room.meetingId),
        meeting_code: meeting_code,
      });

      const duration = room.createdAt ? Math.floor((Date.now() - new Date(room.createdAt).getTime()) / 1000) : 0;
      recordMeetingEndHistory({
        meetingId: room.meetingId,
        meetingCode: meeting_code,
        channelId: room.channelId,
        hostId: room.hostUserId,
        title: room.title,
        mode: room.meetingType,
        duration,
        io,
      }).catch(err => console.error("recordMeetingEndHistory socket error:", err.message));
    }

    // Auto-save transcript buffer if any
    saveRoomTranscript(room, meeting_code).catch(err => console.error("saveRoomTranscript error:", err.message));

    activeMeetingRooms.delete(meeting_code);

    try {
      await db.promise().query(
        "UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE meeting_code = ?",
        [meeting_code]
      );
      await db.promise().query(
        "UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = ? AND left_at IS NULL",
        [room.meetingId]
      );
    } catch (err) {
      console.error("meeting_end DB err:", err.message);
    }
  });

  // Leave meeting
  socket.on("meeting_leave", async (data) => {
    const { meeting_code } = data || {};
    if (!meeting_code) return;

    const room = activeMeetingRooms.get(meeting_code);
    if (room && room.participants.has(socket.id)) {
      const p = room.participants.get(socket.id);
      room.participants.delete(socket.id);

      if (room.screenPresenter && room.screenPresenter.socketId === socket.id) {
        room.screenPresenter = null;
        io.to(`meeting_${meeting_code}`).emit("meeting_screen_share_status", {
          socket_id: socket.id,
          is_sharing: false,
        });
      }

      const roomName = `meeting_${meeting_code}`;
      socket.leave(roomName);

      socket.to(roomName).emit("meeting_user_left", {
        socket_id: socket.id,
        user_id: p.userId,
        reason: "left",
      });

      db.promise().query(
        "UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = ? AND user_id = ?",
        [room.meetingId, p.userId]
      ).catch(err => console.error("meeting_leave DB err:", err.message));

      if (room.participants.size === 0) {
        saveRoomTranscript(room, meeting_code).catch(err => console.error("saveRoomTranscript leave error:", err.message));
        activeMeetingRooms.delete(meeting_code);
        if (room.channelId) {
          io.to(`channel_${room.channelId}`).emit("meeting_channel_ended", {
            channel_id: Number(room.channelId),
            meeting_id: Number(room.meetingId),
            meeting_code: meeting_code,
          });

          const duration = room.createdAt ? Math.floor((Date.now() - new Date(room.createdAt).getTime()) / 1000) : 0;
          recordMeetingEndHistory({
            meetingId: room.meetingId,
            meetingCode: meeting_code,
            channelId: room.channelId,
            hostId: room.hostUserId,
            title: room.title,
            mode: room.meetingType,
            duration,
            io,
          }).catch(err => console.error("recordMeetingEndHistory auto-end error:", err.message));
        }
        db.promise().query(
          "UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE meeting_code = ?",
          [meeting_code]
        ).catch(err => console.error("auto-end meeting DB err:", err.message));
      }
    }
  });
};

const saveRoomTranscript = async (room, meetingCode) => {
  if (!room || !room.transcriptSegments || room.transcriptSegments.length === 0) return;
  try {
    const fullText = room.transcriptSegments
      .map(s => `${s.speaker_name || "Speaker"}: ${s.text}`)
      .join("\n");
    const segmentsJson = JSON.stringify(room.transcriptSegments);

    await db.promise().query(
      `INSERT INTO meeting_transcripts (
        meeting_id, meeting_code, workspace_id, channel_id, transcript_text, segments, language
      ) VALUES (?, ?, ?, ?, ?, ?, 'en')
      ON DUPLICATE KEY UPDATE
        transcript_text = VALUES(transcript_text),
        segments = VALUES(segments),
        updated_at = CURRENT_TIMESTAMP`,
      [
        room.meetingId,
        meetingCode,
        room.workspaceId || 0,
        room.channelId || null,
        fullText,
        segmentsJson,
      ]
    );
  } catch (err) {
    console.error("Auto save meeting transcript error:", err.message);
  }
};

// Cleanup helper called on socket disconnect
const handleMeetingDisconnect = async (io, socket) => {
  // Stop any active Deepgram session for this socket
  await stopDeepgramSession(socket.id).catch(() => {});

  for (const [code, room] of activeMeetingRooms.entries()) {
    if (room.participants.has(socket.id)) {
      const p = room.participants.get(socket.id);
      room.participants.delete(socket.id);

      if (room.screenPresenter && room.screenPresenter.socketId === socket.id) {
        room.screenPresenter = null;
        io.to(`meeting_${code}`).emit("meeting_screen_share_status", {
          socket_id: socket.id,
          is_sharing: false,
        });
      }

      const roomName = `meeting_${code}`;
      socket.leave(roomName);

      io.to(roomName).emit("meeting_user_left", {
        socket_id: socket.id,
        user_id: p.userId,
        reason: "disconnected",
      });

      db.promise().query(
        "UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = ? AND user_id = ?",
        [room.meetingId, p.userId]
      ).catch(err => console.error("meeting disconnect DB err:", err.message));

      if (room.participants.size === 0) {
        saveRoomTranscript(room, code).catch(err => console.error("saveRoomTranscript disconnect error:", err.message));
        activeMeetingRooms.delete(code);
        if (room.channelId) {
          io.to(`channel_${room.channelId}`).emit("meeting_channel_ended", {
            channel_id: Number(room.channelId),
            meeting_id: Number(room.meetingId),
            meeting_code: code,
          });

          const duration = room.createdAt ? Math.floor((Date.now() - new Date(room.createdAt).getTime()) / 1000) : 0;
          recordMeetingEndHistory({
            meetingId: room.meetingId,
            meetingCode: code,
            channelId: room.channelId,
            hostId: room.hostUserId,
            title: room.title,
            mode: room.meetingType,
            duration,
            io,
          }).catch(err => console.error("recordMeetingEndHistory disconnect error:", err.message));
        }
        db.promise().query(
          "UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE meeting_code = ?",
          [code]
        ).catch(err => console.error("auto-end disconnect DB err:", err.message));
      }
    }
  }
};

module.exports = {
  meetingSocket,
  handleMeetingDisconnect,
  activeMeetingRooms,
  saveRoomTranscript,
};


