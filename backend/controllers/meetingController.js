const crypto = require("crypto");
const db = require("../config/db");
const { activeMeetingRooms, saveRoomTranscript } = require("../sockets/meetingSocket");
const { recordMeetingEndHistory } = require("../services/meetingHistoryService");

// Generate 3-3-3 pattern meeting code (e.g. abc-def-ghi)
const generateMeetingCode = () => {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let code = "";
  const randomBytes = crypto.randomBytes(9);
  for (let i = 0; i < 9; i++) {
    code += chars[randomBytes[i] % chars.length];
    if (i === 2 || i === 5) {
      code += "-";
    }
  }
  return code;
};

const createMeeting = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const workspaceId = req.body.workspace_id || req.body.workspaceId;
    const channelId = req.body.channel_id !== undefined ? req.body.channel_id : (req.body.channelId !== undefined ? req.body.channelId : null);
    const title = req.body.title;
    const mode = req.body.mode || req.body.meeting_type || req.body.meetingType || "video";

    if (!workspaceId) {
      return res.status(400).json({ success: false, message: "workspace_id is required" });
    }

    const meetingTitle = title && title.trim() ? title.trim() : "Syncora Meeting";
    const meetingMode = mode === "voice" ? "voice" : "video";

    // 1. Verify user is a member of the workspace
    const [membership] = await db.promise().query(
      "SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({ success: false, message: "You are not a member of this workspace" });
    }

    // 2. Prevent duplicate simultaneous active meetings in the same channel
    if (channelId) {
      const [activeInChannel] = await db.promise().query(
        `SELECT m.*, u.name AS host_name, u.email AS host_email 
         FROM meetings m
         INNER JOIN users u ON m.host_id = u.user_id
         WHERE m.channel_id = ? AND m.status = 'active'
         ORDER BY m.created_at DESC LIMIT 1`,
        [channelId]
      );

      if (activeInChannel.length > 0) {
        const existingM = activeInChannel[0];
        const existingData = {
          meeting_id: existingM.meeting_id,
          meetingId: existingM.meeting_id,
          meeting_code: existingM.meeting_code,
          meetingCode: existingM.meeting_code,
          workspace_id: Number(existingM.workspace_id),
          workspaceId: Number(existingM.workspace_id),
          channel_id: Number(existingM.channel_id),
          channelId: Number(existingM.channel_id),
          host_id: Number(existingM.host_id),
          hostId: Number(existingM.host_id),
          host_user_id: Number(existingM.host_id),
          host_name: existingM.host_name,
          title: existingM.title,
          mode: existingM.mode,
          meeting_type: existingM.mode,
          status: "active",
          created_at: existingM.created_at,
          already_active: true,
        };

        return res.status(200).json({
          success: true,
          message: "An active meeting is already in progress in this channel",
          meeting: existingData,
          data: existingData,
          already_active: true,
        });
      }
    }

    // 3. Generate unique meeting code
    let meetingCode = generateMeetingCode();
    let isUnique = false;
    let attempts = 0;

    while (!isUnique && attempts < 5) {
      const [existing] = await db.promise().query(
        "SELECT meeting_id FROM meetings WHERE meeting_code = ?",
        [meetingCode]
      );
      if (existing.length === 0) {
        isUnique = true;
      } else {
        meetingCode = generateMeetingCode();
        attempts++;
      }
    }

    // 4. Insert meeting into database
    const [meetingResult] = await db.promise().query(
      `INSERT INTO meetings (
        meeting_code,
        workspace_id,
        channel_id,
        host_id,
        title,
        mode,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 'active')`,
      [meetingCode, workspaceId, channelId, userId, meetingTitle, meetingMode]
    );

    const meetingId = meetingResult.insertId;

    // 5. Insert creator as host participant
    await db.promise().query(
      `INSERT INTO meeting_participants (
        meeting_id,
        user_id,
        role,
        status
      ) VALUES (?, ?, 'host', 'connected')`,
      [meetingId, userId]
    );

    const meetingData = {
      meeting_id: meetingId,
      meetingId: meetingId,
      meeting_code: meetingCode,
      meetingCode: meetingCode,
      workspace_id: Number(workspaceId),
      workspaceId: Number(workspaceId),
      channel_id: channelId ? Number(channelId) : null,
      channelId: channelId ? Number(channelId) : null,
      host_id: Number(userId),
      hostId: Number(userId),
      host_user_id: Number(userId),
      title: meetingTitle,
      mode: meetingMode,
      meeting_type: meetingMode,
      status: "active",
      created_at: new Date().toISOString(),
    };

    // 6. Realtime broadcast to channel members
    try {
      const io = req.app.get("io");
      if (io && channelId) {
        io.to(`channel_${channelId}`).emit("meeting_channel_started", {
          channel_id: Number(channelId),
          meeting_id: meetingId,
          meetingId: meetingId,
          meeting_code: meetingCode,
          meetingCode: meetingCode,
          title: meetingTitle,
          mode: meetingMode,
          meeting_type: meetingMode,
          host_id: Number(userId),
          hostId: Number(userId),
          host_name: req.user.name || "Host",
          status: "active",
          created_at: new Date().toISOString(),
        });
      }
    } catch (socketErr) {
      console.error("meeting_channel_started socket broadcast err:", socketErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Meeting created successfully",
      meeting: meetingData,
      data: meetingData,
    });
  } catch (error) {
    console.error("Create meeting error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while creating meeting" });
  }
};

const getActiveMeetingByChannel = async (req, res) => {
  try {
    const { channelId } = req.params;
    const userId = req.user.user_id;

    if (!channelId) {
      return res.status(400).json({ success: false, message: "Channel ID is required" });
    }

    // 1. Verify user belongs to the workspace of this channel
    const [channelRows] = await db.promise().query(
      `SELECT c.channel_id, c.workspace_id, c.name AS channel_name, wm.user_id
       FROM channels c
       INNER JOIN workspace_members wm ON c.workspace_id = wm.workspace_id AND wm.user_id = ?
       WHERE c.channel_id = ?`,
      [userId, channelId]
    );

    if (channelRows.length === 0) {
      return res.status(403).json({ success: false, message: "You are not authorized to view this channel" });
    }

    // 2. Fetch active meeting in this channel
    const [meetings] = await db.promise().query(
      `SELECT 
        m.meeting_id,
        m.meeting_code,
        m.workspace_id,
        m.channel_id,
        m.host_id,
        u.name AS host_name,
        u.email AS host_email,
        m.title,
        m.mode,
        m.status,
        m.created_at,
        (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.meeting_id AND mp.status = 'connected') AS participant_count
       FROM meetings m
       INNER JOIN users u ON m.host_id = u.user_id
       WHERE m.channel_id = ? AND m.status = 'active'
       ORDER BY m.created_at DESC
       LIMIT 1`,
      [channelId]
    );

    if (meetings.length === 0) {
      return res.status(200).json({
        success: true,
        active_meeting: null,
        meeting: null,
        data: null,
      });
    }

    const meeting = meetings[0];

    // Check if the meeting has an active socket room or is very newly created (< 60s)
    let liveParticipants = 0;
    if (activeMeetingRooms && activeMeetingRooms.has(meeting.meeting_code)) {
      liveParticipants = activeMeetingRooms.get(meeting.meeting_code).participants.size;
    }

    const meetingAgeMs = Date.now() - new Date(meeting.created_at).getTime();
    // If no live socket room and meeting was created more than 60 seconds ago, or has 0 live participants
    if (liveParticipants === 0 && meetingAgeMs > 60000) {
      // Auto-cleanup stale meeting
      await db.promise().query(
        "UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE meeting_id = ?",
        [meeting.meeting_id]
      ).catch(() => {});
      return res.status(200).json({
        success: true,
        active_meeting: null,
        meeting: null,
        data: null,
      });
    }

    const meetingPayload = {
      ...meeting,
      meeting_id: meeting.meeting_id,
      meetingId: meeting.meeting_id,
      meeting_code: meeting.meeting_code,
      meetingCode: meeting.meeting_code,
      workspace_id: meeting.workspace_id,
      workspaceId: meeting.workspace_id,
      channel_id: meeting.channel_id,
      channelId: meeting.channel_id,
      host_id: meeting.host_id,
      hostId: meeting.host_id,
      host_user_id: meeting.host_id,
      meeting_type: meeting.mode,
      is_host: Number(meeting.host_id) === Number(userId),
      participant_count: liveParticipants || Number(meeting.participant_count || 0),
    };

    return res.status(200).json({
      success: true,
      active_meeting: meetingPayload,
      meeting: meetingPayload,
      data: meetingPayload,
    });
  } catch (error) {
    console.error("Get active meeting by channel error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching active meeting" });
  }
};

const getMeetingByCode = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;

    if (!meetingCode) {
      return res.status(400).json({ success: false, message: "Meeting code is required" });
    }

    // 1. Fetch meeting and host info
    const [meetings] = await db.promise().query(
      `SELECT
        m.meeting_id,
        m.meeting_code,
        m.workspace_id,
        w.name AS workspace_name,
        m.channel_id,
        c.name AS channel_name,
        m.host_id,
        u.name AS host_name,
        u.email AS host_email,
        m.title,
        m.mode,
        m.status,
        m.created_at,
        m.ended_at
      FROM meetings m
      INNER JOIN users u ON m.host_id = u.user_id
      INNER JOIN workspaces w ON m.workspace_id = w.workspace_id
      LEFT JOIN channels c ON m.channel_id = c.channel_id
      WHERE m.meeting_code = ?`,
      [meetingCode]
    );

    if (meetings.length === 0) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    const meeting = meetings[0];

    // 2. Check if user is a member of the workspace
    const [membership] = await db.promise().query(
      "SELECT workspace_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [meeting.workspace_id, userId]
    );

    if (membership.length === 0) {
      return res.status(403).json({ success: false, message: "You are not authorized to join meetings in this workspace" });
    }

    if (meeting.status === "ended") {
      return res.status(410).json({
        success: false,
        message: "This meeting has already ended",
        meeting: {
          meeting_id: meeting.meeting_id,
          meeting_code: meeting.meeting_code,
          title: meeting.title,
          status: "ended",
        },
      });
    }

    // 3. Fetch active participants
    const [participants] = await db.promise().query(
      `SELECT
        mp.participant_id,
        mp.meeting_id,
        mp.user_id,
        u.name,
        u.email,
        mp.role,
        mp.status,
        mp.is_muted,
        mp.is_camera_off,
        mp.joined_at
      FROM meeting_participants mp
      INNER JOIN users u ON mp.user_id = u.user_id
      WHERE mp.meeting_id = ? AND mp.status = 'connected'`,
      [meeting.meeting_id]
    );

    const meetingPayload = {
      ...meeting,
      host_user_id: Number(meeting.host_id),
      meeting_type: meeting.mode,
      is_host: Number(meeting.host_id) === Number(userId),
      participants,
    };

    return res.status(200).json({
      success: true,
      meeting: meetingPayload,
      data: meetingPayload,
    });
  } catch (error) {
    console.error("Get meeting by code error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while fetching meeting" });
  }
};

const endMeeting = async (req, res) => {
  try {
    const { meetingId, meetingCode } = req.params;
    const userId = req.user.user_id;

    const [meetings] = await db.promise().query(
      "SELECT meeting_id, meeting_code, channel_id, host_id, status FROM meetings WHERE meeting_id = ? OR meeting_code = ?",
      [meetingId || null, meetingCode || meetingId || null]
    );

    if (meetings.length === 0) {
      return res.status(404).json({ success: false, message: "Meeting not found" });
    }

    const meeting = meetings[0];

    if (Number(meeting.host_id) !== Number(userId)) {
      return res.status(403).json({ success: false, message: "Only the host can end the meeting" });
    }

    await db.promise().query(
      "UPDATE meetings SET status = 'ended', ended_at = NOW() WHERE meeting_id = ?",
      [meeting.meeting_id]
    );

    await db.promise().query(
      "UPDATE meeting_participants SET status = 'left', left_at = NOW() WHERE meeting_id = ? AND status = 'connected'",
      [meeting.meeting_id]
    );

    // Broadcast channel ended event and persist meeting history if meeting belongs to a channel
    try {
      const io = req.app.get("io");
      if (io && meeting.channel_id) {
        io.to(`channel_${meeting.channel_id}`).emit("meeting_channel_ended", {
          channel_id: Number(meeting.channel_id),
          meeting_id: Number(meeting.meeting_id),
          meeting_code: meeting.meeting_code,
        });

        const duration = meeting.created_at ? Math.floor((Date.now() - new Date(meeting.created_at).getTime()) / 1000) : 0;
        recordMeetingEndHistory({
          meetingId: meeting.meeting_id,
          meetingCode: meeting.meeting_code,
          channelId: meeting.channel_id,
          hostId: meeting.host_id,
          title: meeting.title,
          mode: meeting.mode,
          duration,
          io,
        }).catch(err => console.error("recordMeetingEndHistory endMeeting err:", err.message));
      }
    } catch (socketErr) {
      console.error("meeting_channel_ended socket broadcast err:", socketErr.message);
    }

    // Auto-save transcript buffer if room exists
    if (activeMeetingRooms && activeMeetingRooms.has(meeting.meeting_code)) {
      const activeRoom = activeMeetingRooms.get(meeting.meeting_code);
      saveRoomTranscript(activeRoom, meeting.meeting_code).catch(err =>
        console.error("saveRoomTranscript controller endMeeting error:", err.message)
      );
      activeMeetingRooms.delete(meeting.meeting_code);
    }

    return res.status(200).json({ success: true, message: "Meeting ended successfully" });
  } catch (error) {
    console.error("End meeting error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while ending meeting" });
  }
};

const inviteToMeeting = async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { target_user_ids } = req.body;
    const inviterId = req.user.user_id;

    if (!target_user_ids || !Array.isArray(target_user_ids) || target_user_ids.length === 0) {
      return res.status(400).json({ success: false, message: "target_user_ids array is required" });
    }

    // Verify meeting exists and is active
    const [meetings] = await db.promise().query(
      `SELECT m.meeting_id, m.meeting_code, m.workspace_id, m.title, m.mode, m.status, u.name AS inviter_name
       FROM meetings m
       INNER JOIN users u ON u.user_id = ?
       WHERE m.meeting_id = ?`,
      [inviterId, meetingId]
    );

    if (meetings.length === 0 || meetings[0].status === "ended") {
      return res.status(404).json({ success: false, message: "Meeting not found or already ended" });
    }

    const meeting = meetings[0];

    // Verify target users belong to workspace
    const [validMembers] = await db.promise().query(
      "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id IN (?)",
      [meeting.workspace_id, target_user_ids]
    );

    const validUserIds = validMembers.map((m) => m.user_id);

    return res.status(200).json({
      success: true,
      message: `Invitations sent to ${validUserIds.length} members`,
      invited_user_ids: validUserIds,
      meeting_code: meeting.meeting_code,
    });
  } catch (error) {
    console.error("Invite to meeting error:", error.message);
    return res.status(500).json({ success: false, message: "Server error while inviting to meeting" });
  }
};

const checkDeepgramDiagnostic = async (req, res) => {
  const { DeepgramClient } = require("@deepgram/sdk");
  const rawKey = process.env.DEEPGRAM_API_KEY || "";
  const apiKey = rawKey.trim().replace(/^["']|["']$/g, "").replace(/[\r\n\t]/g, "");

  if (!apiKey) {
    return res.status(200).json({
      configured: false,
      message: "DEEPGRAM_API_KEY is not set in environment",
    });
  }

  const prefix = apiKey.slice(0, 6);
  const suffix = apiKey.slice(-4);
  const keyLength = apiKey.length;

  try {
    const deepgram = new DeepgramClient({ apiKey });
    const live = await deepgram.listen.v1.connect({ model: "nova-3" });

    let resolved = false;
    const testPromise = new Promise((resolve) => {
      live.on("open", () => {
        if (!resolved) {
          resolved = true;
          try { live.close(); } catch (_) {}
          resolve({ success: true, message: "Connected to Deepgram Nova-3 successfully" });
        }
      });
      live.on("error", (err) => {
        if (!resolved) {
          resolved = true;
          resolve({ success: false, error: err?.message || String(err) });
        }
      });
      live.connect();
    });

    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { live.close(); } catch (_) {}
          resolve({ success: false, error: "Connection timed out after 5s" });
        }
      }, 5000);
    });

    const result = await Promise.race([testPromise, timeoutPromise]);

    return res.status(200).json({
      configured: true,
      keyLength,
      prefix: `${prefix}...`,
      suffix: `...${suffix}`,
      result,
    });
  } catch (err) {
    return res.status(200).json({
      configured: true,
      keyLength,
      prefix: `${prefix}...`,
      suffix: `...${suffix}`,
      result: { success: false, error: err.message },
    });
  }
};

module.exports = {
  createMeeting,
  getActiveMeetingByChannel,
  getMeetingByCode,
  endMeeting,
  inviteToMeeting,
  generateMeetingCode,
  checkDeepgramDiagnostic,
};
