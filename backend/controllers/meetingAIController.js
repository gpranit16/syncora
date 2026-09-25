const db = require('../config/db');
const { analyzeMeetingTranscript, sanitizeMeetingSummary } = require('../services/meetingAIService');
const { syncTaskToCalendar } = require('../services/googleCalendarService');

/**
 * Helper to fetch meeting and verify caller's workspace membership.
 */
const getAuthorizedMeeting = async (meetingCode, userId) => {
  const [meetings] = await db.promise().query(
    `SELECT m.*, u.name AS host_name
     FROM meetings m
     INNER JOIN users u ON m.host_id = u.user_id
     WHERE m.meeting_code = ? OR m.meeting_id = ?`,
    [meetingCode, isNaN(meetingCode) ? -1 : Number(meetingCode)]
  );

  if (meetings.length === 0) {
    return { error: 'Meeting not found', status: 404 };
  }

  const meeting = meetings[0];

  const [members] = await db.promise().query(
    'SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
    [meeting.workspace_id, userId]
  );

  if (members.length === 0) {
    return { error: 'You are not authorized to access this meeting', status: 403 };
  }

  return { meeting };
};

/**
 * Helper to parse natural or relative deadline into YYYY-MM-DD if possible.
 */
const parseDeadlineDate = (deadlineStr) => {
  if (!deadlineStr || typeof deadlineStr !== 'string') return null;
  const trimmed = deadlineStr.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none' || trimmed.toLowerCase() === 'n/a') return null;

  // Direct ISO date: YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  const now = new Date();

  if (lower === 'today') {
    return now.toISOString().split('T')[0];
  }
  if (lower === 'tomorrow') {
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return tomorrow.toISOString().split('T')[0];
  }

  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const matchedDayIndex = dayNames.findIndex(day => lower.includes(day));
  if (matchedDayIndex !== -1) {
    const currentDay = now.getDay();
    let daysToAdd = (matchedDayIndex - currentDay + 7) % 7;
    if (daysToAdd === 0) daysToAdd = 7; // Next week's instance
    const targetDate = new Date(now.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
    return targetDate.toISOString().split('T')[0];
  }

  const parsed = Date.parse(trimmed);
  if (!isNaN(parsed)) {
    return new Date(parsed).toISOString().split('T')[0];
  }

  return null;
};

/**
 * POST /api/meetings/:meetingCode/transcript
 */
const saveTranscript = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;
    const { transcript_text, segments, language = 'en' } = req.body;

    const { meeting, error, status } = await getAuthorizedMeeting(meetingCode, userId);
    if (error) {
      return res.status(status).json({ success: false, message: error });
    }

    if (!transcript_text && (!segments || segments.length === 0)) {
      return res.status(400).json({ success: false, message: 'Transcript text or segments are required' });
    }

    let fullText = transcript_text || '';
    let parsedSegments = segments || [];

    if (typeof parsedSegments === 'string') {
      try {
        parsedSegments = JSON.parse(parsedSegments);
      } catch (_) {
        parsedSegments = [];
      }
    }

    if (!fullText && Array.isArray(parsedSegments)) {
      fullText = parsedSegments
        .map(s => `${s.speaker_name || 'Speaker'}: ${s.text || ''}`)
        .join('\n');
    }

    const segmentsJson = JSON.stringify(parsedSegments);

    await db.promise().query(
      `INSERT INTO meeting_transcripts (
        meeting_id, meeting_code, workspace_id, channel_id, transcript_text, segments, language
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        transcript_text = VALUES(transcript_text),
        segments = VALUES(segments),
        language = VALUES(language),
        updated_at = CURRENT_TIMESTAMP`,
      [
        meeting.meeting_id,
        meeting.meeting_code,
        meeting.workspace_id,
        meeting.channel_id,
        fullText,
        segmentsJson,
        language
      ]
    );

    const [savedRows] = await db.promise().query(
      'SELECT * FROM meeting_transcripts WHERE meeting_code = ?',
      [meeting.meeting_code]
    );

    const saved = savedRows[0] || {};
    let parsedSegmentsResult = [];
    try {
      parsedSegmentsResult = saved.segments ? JSON.parse(saved.segments) : [];
    } catch (_) {
      parsedSegmentsResult = [];
    }

    return res.status(200).json({
      success: true,
      message: 'Transcript saved successfully',
      transcript: {
        transcript_id: saved.transcript_id,
        meeting_id: saved.meeting_id,
        meeting_code: saved.meeting_code,
        workspace_id: saved.workspace_id,
        channel_id: saved.channel_id,
        transcript_text: saved.transcript_text,
        segments: parsedSegmentsResult,
        language: saved.language,
        created_at: saved.created_at,
        updated_at: saved.updated_at
      }
    });
  } catch (err) {
    console.error('Error saving meeting transcript:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/meetings/:meetingCode/transcript
 */
const getTranscript = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;

    const { meeting, error, status } = await getAuthorizedMeeting(meetingCode, userId);
    if (error) {
      return res.status(status).json({ success: false, message: error });
    }

    const [rows] = await db.promise().query(
      'SELECT * FROM meeting_transcripts WHERE meeting_code = ?',
      [meeting.meeting_code]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        transcript: null,
        message: 'No transcript recorded for this meeting'
      });
    }

    const row = rows[0];
    let segments = [];
    try {
      segments = row.segments ? JSON.parse(row.segments) : [];
    } catch (_) {
      segments = [];
    }

    return res.status(200).json({
      success: true,
      transcript: {
        transcript_id: row.transcript_id,
        meeting_id: row.meeting_id,
        meeting_code: row.meeting_code,
        workspace_id: row.workspace_id,
        channel_id: row.channel_id,
        transcript_text: row.transcript_text,
        segments,
        language: row.language,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    });
  } catch (err) {
    console.error('Error fetching meeting transcript:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/meetings/:meetingCode/summary
 */
const generateSummary = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;
    const { language = 'en', force_regenerate = false } = req.body;

    const { meeting, error, status } = await getAuthorizedMeeting(meetingCode, userId);
    if (error) {
      return res.status(status).json({ success: false, message: error });
    }

    const normalizedLang = ['en', 'hi', 'same'].includes(language) ? language : 'en';

    // 1. Check for cached summary unless forced
    if (!force_regenerate) {
      const [existing] = await db.promise().query(
        'SELECT * FROM meeting_summaries WHERE meeting_code = ? AND language = ? ORDER BY created_at DESC LIMIT 1',
        [meeting.meeting_code, normalizedLang]
      );

      if (existing.length > 0) {
        const row = existing[0];
        const isBadCache = !row.summary_text || row.summary_text.includes('could not be structured');

        if (!isBadCache) {
          let decisions = [], action_items = [], blockers = [], deadlines = [];
          try { decisions = row.decisions ? JSON.parse(row.decisions) : []; } catch (_) {}
          try { action_items = row.action_items ? JSON.parse(row.action_items) : []; } catch (_) {}
          try { blockers = row.blockers ? JSON.parse(row.blockers) : []; } catch (_) {}
          try { deadlines = row.deadlines ? JSON.parse(row.deadlines) : []; } catch (_) {}

          return res.status(200).json({
            success: true,
            cached: true,
            summary: {
              summary_id: row.summary_id,
              meeting_id: row.meeting_id,
              meeting_code: row.meeting_code,
              workspace_id: row.workspace_id,
              channel_id: row.channel_id,
              language: row.language,
              summary_text: row.summary_text,
              decisions,
              action_items,
              blockers,
              deadlines,
              created_at: row.created_at,
              updated_at: row.updated_at
            }
          });
        }
      }
    }

    // 2. Fetch transcript
    const [transcriptRows] = await db.promise().query(
      'SELECT * FROM meeting_transcripts WHERE meeting_code = ?',
      [meeting.meeting_code]
    );

    let transcriptText = '';
    if (transcriptRows.length > 0) {
      transcriptText = transcriptRows[0].transcript_text || '';
    } else if (req.body.transcript_text) {
      transcriptText = req.body.transcript_text;
    }

    // 3. Fetch participants for context
    const [participants] = await db.promise().query(
      `SELECT u.name FROM meeting_participants mp
       INNER JOIN users u ON mp.user_id = u.user_id
       WHERE mp.meeting_id = ?`,
      [meeting.meeting_id]
    );
    const participantNames = participants.map(p => p.name).filter(Boolean);

    // 4. Run AI analysis
    const aiResult = await analyzeMeetingTranscript(transcriptText, normalizedLang, participantNames);

    // 5. Clean previous summaries for this meeting & language to prevent stale cache
    await db.promise().query(
      'DELETE FROM meeting_summaries WHERE meeting_id = ? AND language = ?',
      [meeting.meeting_id, normalizedLang]
    ).catch(() => {});

    // 6. Persist summary in DB
    const [insertRes] = await db.promise().query(
      `INSERT INTO meeting_summaries (
        meeting_id, meeting_code, workspace_id, channel_id, language,
        summary_text, decisions, action_items, blockers, deadlines
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        meeting.meeting_id,
        meeting.meeting_code,
        meeting.workspace_id,
        meeting.channel_id,
        normalizedLang,
        aiResult.summary,
        JSON.stringify(aiResult.decisions),
        JSON.stringify(aiResult.action_items),
        JSON.stringify(aiResult.blockers),
        JSON.stringify(aiResult.deadlines)
      ]
    );

    return res.status(200).json({
      success: true,
      cached: false,
      summary: {
        summary_id: insertRes.insertId,
        meeting_id: meeting.meeting_id,
        meeting_code: meeting.meeting_code,
        workspace_id: meeting.workspace_id,
        channel_id: meeting.channel_id,
        language: normalizedLang,
        summary_text: aiResult.summary,
        decisions: aiResult.decisions,
        action_items: aiResult.action_items,
        blockers: aiResult.blockers,
        deadlines: aiResult.deadlines,
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Error generating meeting summary:', err);
    return res.status(500).json({
      success: false,
      message: err.message || 'Internal server error while generating summary'
    });
  }
};

/**
 * GET /api/meetings/:meetingCode/summary
 */
const getSummary = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;
    const { lang = 'en' } = req.query;

    const { meeting, error, status } = await getAuthorizedMeeting(meetingCode, userId);
    if (error) {
      return res.status(status).json({ success: false, message: error });
    }

    const normalizedLang = ['en', 'hi', 'same'].includes(lang) ? lang : 'en';

    const [rows] = await db.promise().query(
      'SELECT * FROM meeting_summaries WHERE meeting_code = ? AND language = ? ORDER BY created_at DESC LIMIT 1',
      [meeting.meeting_code, normalizedLang]
    );

    if (rows.length === 0) {
      return res.status(200).json({
        success: true,
        summary: null,
        message: 'No summary generated yet'
      });
    }

    const row = rows[0];
    const isBadCache = !row.summary_text || row.summary_text.includes('could not be structured');

    if (isBadCache) {
      return res.status(200).json({
        success: true,
        summary: null,
        message: 'Summary requires regeneration'
      });
    }

    let decisions = [], action_items = [], blockers = [], deadlines = [];
    try { decisions = row.decisions ? JSON.parse(row.decisions) : []; } catch (_) {}
    try { action_items = row.action_items ? JSON.parse(row.action_items) : []; } catch (_) {}
    try { blockers = row.blockers ? JSON.parse(row.blockers) : []; } catch (_) {}
    try { deadlines = row.deadlines ? JSON.parse(row.deadlines) : []; } catch (_) {}

    return res.status(200).json({
      success: true,
      summary: {
        summary_id: row.summary_id,
        meeting_id: row.meeting_id,
        meeting_code: row.meeting_code,
        workspace_id: row.workspace_id,
        channel_id: row.channel_id,
        language: row.language,
        summary_text: row.summary_text,
        decisions,
        action_items,
        blockers,
        deadlines,
        created_at: row.created_at,
        updated_at: row.updated_at
      }
    });
  } catch (err) {
    console.error('Error fetching meeting summary:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/meetings/:meetingCode/action-items/convert-task
 */
const createTaskFromActionItem = async (req, res) => {
  try {
    const { meetingCode } = req.params;
    const userId = req.user.user_id;
    const {
      title,
      description,
      assignee_name,
      assigned_to,
      priority = 'medium',
      deadline,
      due_date
    } = req.body;

    const { meeting, error, status } = await getAuthorizedMeeting(meetingCode, userId);
    if (error) {
      return res.status(status).json({ success: false, message: error });
    }

    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Task title is required' });
    }

    const taskPriority = ['low', 'medium', 'high'].includes(priority) ? priority : 'medium';
    const rawDueDate = due_date || deadline || null;
    const parsedDueDate = parseDeadlineDate(rawDueDate);

    // Resolve assigned_to
    let resolvedAssigneeId = null;
    if (assigned_to && !isNaN(assigned_to)) {
      // Validate membership
      const [assigneeMember] = await db.promise().query(
        'SELECT member_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?',
        [meeting.workspace_id, assigned_to]
      );
      if (assigneeMember.length > 0) {
        resolvedAssigneeId = Number(assigned_to);
      }
    } else if (assignee_name && typeof assignee_name === 'string' && assignee_name.trim()) {
      const cleanName = assignee_name.trim().toLowerCase();
      // Search member by name
      const [matchedUsers] = await db.promise().query(
        `SELECT u.user_id FROM workspace_members wm
         INNER JOIN users u ON wm.user_id = u.user_id
         WHERE wm.workspace_id = ? AND (LOWER(u.name) LIKE ? OR LOWER(u.email) LIKE ?)
         LIMIT 1`,
        [meeting.workspace_id, `%${cleanName}%`, `%${cleanName}%`]
      );
      if (matchedUsers.length > 0) {
        resolvedAssigneeId = matchedUsers[0].user_id;
      }
    }

    const taskDescription = description || `Extracted from Meeting ${meeting.title || meeting.meeting_code}`;

    const [insertRes] = await db.promise().query(
      `INSERT INTO tasks (
        workspace_id, assigned_to, created_by, title, description, status, priority, due_date, source_meeting_id
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        meeting.workspace_id,
        resolvedAssigneeId,
        userId,
        title.trim(),
        taskDescription,
        taskPriority,
        parsedDueDate,
        meeting.meeting_id
      ]
    );

    const taskId = insertRes.insertId;

    // Fetch newly created task with user names
    const [taskRows] = await db.promise().query(
      `SELECT t.*, 
              assigned.name AS assigned_to_name, 
              creator.name AS created_by_name
       FROM tasks t
       LEFT JOIN users assigned ON t.assigned_to = assigned.user_id
       INNER JOIN users creator ON t.created_by = creator.user_id
       WHERE t.task_id = ?`,
      [taskId]
    );

    const createdTask = taskRows[0] || {
      task_id: taskId,
      workspace_id: meeting.workspace_id,
      assigned_to: resolvedAssigneeId,
      created_by: userId,
      title: title.trim(),
      description: taskDescription,
      status: 'pending',
      priority: taskPriority,
      due_date: parsedDueDate,
      source_meeting_id: meeting.meeting_id
    };

    // Broadcast realtime event
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`workspace_${meeting.workspace_id}`).emit('task_created', createdTask);
      }
    } catch (_) {}

    // Sync to Google Calendar
    if (createdTask && createdTask.due_date) {
      const targetUserIds = new Set([userId]);
      if (createdTask.assigned_to) targetUserIds.add(Number(createdTask.assigned_to));
      targetUserIds.forEach((uid) => {
        syncTaskToCalendar(uid, createdTask).catch((err) =>
          console.warn(`[Calendar] Failed to sync task from action item #${createdTask.task_id}:`, err.message)
        );
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Task created from action item successfully',
      task: createdTask
    });
  } catch (err) {
    console.error('Error creating task from action item:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  saveTranscript,
  getTranscript,
  generateSummary,
  getSummary,
  createTaskFromActionItem,
  getAuthorizedMeeting,
  parseDeadlineDate
};
